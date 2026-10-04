import Dexie, { type Table } from 'dexie';

import type { RecentBookEntry, WorkspaceSnapshot } from '../types/domain';

// Compare the complete lightweight record as well as its opaque revision. This
// also detects legacy writers that omit revisions or preserve one while editing.
export type WorkspaceVersion = string | null;
export function workspaceVersion(snapshot: WorkspaceSnapshot | null | undefined): WorkspaceVersion {
  return snapshot ? JSON.stringify(snapshot) : null;
}
function workspaceContent(snapshot: WorkspaceSnapshot): string {
  return JSON.stringify([snapshot.documentId, snapshot.currentPage, snapshot.scale, snapshot.activeWindowId,
    snapshot.layoutPreset, snapshot.heldPages, snapshot.windows]);
}
export class WorkspaceConflictError extends Error {
  readonly version: WorkspaceVersion;
  readonly current: WorkspaceSnapshot | null;
  constructor(current: WorkspaceSnapshot | null) {
    super('另一个标签页已更改这本书的阅读现场。此页的更改仍保留，已暂停保存和切换。请选择载入已存现场，或明确覆盖；请勿关闭此页。');
    this.name = 'WorkspaceConflictError';
    this.current = current;
    this.version = workspaceVersion(current);
  }
}

interface PersistedBookRecord extends RecentBookEntry {
  // Legacy records used Blob/File; bytes avoid WebKit file-backed Blob failures.
  blob?: Blob;
  bytes?: ArrayBuffer;
}
interface BookMetadataRecord extends RecentBookEntry {
  sourceLastOpenedAt: string;
}
type BookMetadataChanges = Pick<Partial<RecentBookEntry>, 'lastOpenedAt' | 'lastSavedAt'>;
class StorageUpgradeBlockedError extends Error {
  constructor() {
    super('其他页境标签页仍占用旧版存储。请先保存并关闭或刷新那些标签页，再重试读取或保存。');
    this.name = 'StorageUpgradeBlockedError';
  }
}

function recentEntry(record: RecentBookEntry): RecentBookEntry {
  const { documentId, fileName, fileSize, totalPages, lastOpenedAt, lastSavedAt } = record;
  return { documentId, fileName, fileSize, totalPages, lastOpenedAt, lastSavedAt };
}
function validTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value;
}
function latest(left: unknown, right: unknown): string | undefined {
  if (!validTimestamp(left)) return validTimestamp(right) ? right : undefined;
  if (!validTimestamp(right)) return left;
  return Date.parse(left) > Date.parse(right) ? left : right;
}
function metadataEntry(source: RecentBookEntry, current?: BookMetadataRecord): BookMetadataRecord {
  return { ...recentEntry(source), sourceLastOpenedAt: source.lastOpenedAt,
    lastOpenedAt: latest(source.lastOpenedAt, current?.lastOpenedAt) ?? source.lastOpenedAt,
    lastSavedAt: latest(source.lastSavedAt, current?.lastSavedAt) };
}
function validMetadata(record: BookMetadataRecord | undefined): record is BookMetadataRecord {
  return !!record && typeof record.fileName === 'string' && Number.isFinite(record.fileSize)
    && record.fileSize >= 0 && Number.isInteger(record.totalPages) && record.totalPages > 0
    && validTimestamp(record.sourceLastOpenedAt) && validTimestamp(record.lastOpenedAt)
    && (record.lastSavedAt === undefined || validTimestamp(record.lastSavedAt));
}

interface WorkspacePersistencePort {
  deleteBook(documentId: string): Promise<void>;
  deleteWorkspace(documentId: string): Promise<void>;
  deleteDatabase(): Promise<void>;
  getBook(documentId: string): Promise<PersistedBookRecord | undefined>;
  getBookMetadata(documentId: string): Promise<RecentBookEntry | undefined>;
  getRecentBooks(limit?: number): Promise<RecentBookEntry[]>;
  getWorkspace(documentId: string): Promise<WorkspaceSnapshot | undefined>;
  putBook(record: PersistedBookRecord): Promise<void>;
  putWorkspace(snapshot: WorkspaceSnapshot, expectedVersion: WorkspaceVersion): Promise<WorkspaceSnapshot>;
  updateBookMetadata(documentId: string, changes: BookMetadataChanges, source?: RecentBookEntry): Promise<number>;
}

export class DexieWorkspacePersistencePort extends Dexie implements WorkspacePersistencePort {
  books!: Table<PersistedBookRecord, string>;
  bookMetadata!: Table<BookMetadataRecord, string>;
  workspaces!: Table<WorkspaceSnapshot, string>;
  private legacyReads: Dexie | null = null;
  private upgradeBlocked = false;
  private openGeneration = 0;
  private blockedWaiters = new Set<(error: Error) => void>();

  constructor(databaseName = 'leafspace') {
    super(databaseName);

    this.version(1).stores({
      books: 'documentId, lastOpenedAt, lastSavedAt',
      workspaces: 'documentId, savedAt',
    });
    // Add only a tiny sidecar. Never copy, convert or delete existing PDF values
    // inside the versionchange transaction.
    this.version(2).stores({ bookMetadata: 'documentId, lastOpenedAt, lastSavedAt' });
    this.on('blocked', () => {
      this.upgradeBlocked = true;
      for (const reject of this.blockedWaiters) reject(new StorageUpgradeBlockedError());
    });
    this.on.ready.subscribe(() => { this.upgradeBlocked = false; }, true);
  }

  private async ensureOpen() {
    if (this.isOpen()) return;
    if (this.upgradeBlocked) throw new StorageUpgradeBlockedError();
    let rejectBlocked!: (error: Error) => void;
    const blocked = new Promise<never>((_, reject) => { rejectBlocked = reject; });
    this.blockedWaiters.add(rejectBlocked);
    try {
      const generation = ++this.openGeneration;
      const opening = this.open();
      // A blocked caller has already received its actionable error. If the
      // eventual upgrade then fails, unlock retries and legacy read fallback.
      void opening.catch(() => { if (generation === this.openGeneration) this.upgradeBlocked = false; });
      await Promise.race([opening, blocked]);
    }
    finally { this.blockedWaiters.delete(rejectBlocked); }
  }

  private async readConnection(): Promise<Dexie> {
    try { await this.ensureOpen(); return this; }
    catch (upgradeError) {
      if (upgradeError instanceof StorageUpgradeBlockedError) throw upgradeError;
      // A failed schema upgrade must not strand an intact v1 PDF/workspace.
      // Dynamic-schema access is read-only here; writes keep reporting failure.
      this.legacyReads ??= new Dexie(this.name);
      try {
        await this.legacyReads.open();
        if (!this.legacyReads.tables.some(table => table.name === 'books')) throw upgradeError;
        return this.legacyReads;
      } catch { throw upgradeError; }
    }
  }

  private async sourceMatches(db: Dexie, documentId: string, timestamp: string) {
    const keys = await db.table<PersistedBookRecord, string>('books').where('lastOpenedAt').equals(timestamp).primaryKeys();
    return keys.includes(documentId);
  }

  private async readMetadata(db: Dexie, documentId: string, knownSource?: RecentBookEntry): Promise<BookMetadataRecord | undefined> {
    const current = await db.table<BookMetadataRecord, string>('bookMetadata').get(documentId);
    if (knownSource && await this.sourceMatches(db, documentId, knownSource.lastOpenedAt)) return metadataEntry(knownSource, current);
    if (validMetadata(current) && await this.sourceMatches(db, documentId, current.sourceLastOpenedAt)) return { ...recentEntry(current), sourceLastOpenedAt: current.sourceLastOpenedAt };
    const source = await db.table<PersistedBookRecord, string>('books').get(documentId);
    return source ? metadataEntry(source, current) : undefined;
  }

  private async backfill(records: BookMetadataRecord[]) {
    if (!records.length) return;
    try {
      await this.ensureOpen();
      await this.transaction('rw', this.books, this.bookMetadata, async () => {
        for (const record of records) {
          if (!await this.sourceMatches(this, record.documentId, record.sourceLastOpenedAt)) continue;
          const current = await this.bookMetadata.get(record.documentId);
          await this.bookMetadata.put({ ...record,
            lastOpenedAt: latest(record.lastOpenedAt, current?.lastOpenedAt) ?? record.lastOpenedAt,
            lastSavedAt: latest(record.lastSavedAt, current?.lastSavedAt) });
        }
      });
    } catch { /* Optional indexing cannot turn a successful read into a failure. */ }
  }

  async deleteDatabase(): Promise<void> {
    this.legacyReads?.close();
    this.close();
    await Dexie.delete(this.name);
  }

  async deleteBook(documentId: string): Promise<void> {
    await this.ensureOpen();
    await this.transaction('rw', this.books, this.bookMetadata, async () => {
      await this.books.delete(documentId); await this.bookMetadata.delete(documentId);
    });
  }

  async deleteWorkspace(documentId: string): Promise<void> {
    await this.ensureOpen();
    await this.workspaces.delete(documentId);
  }

  async getBook(documentId: string): Promise<PersistedBookRecord | undefined> {
    return (await this.readConnection()).table<PersistedBookRecord, string>('books').get(documentId);
  }

  async getBookMetadata(documentId: string): Promise<RecentBookEntry | undefined> {
    const db = await this.readConnection();
    if (!db.tables.some(table => table.name === 'bookMetadata')) {
      const source = await db.table<PersistedBookRecord, string>('books').get(documentId);
      return source ? recentEntry(source) : undefined;
    }
    const record = await db.transaction('r', ['books', 'bookMetadata'], () => this.readMetadata(db, documentId));
    if (record) await this.backfill([record]);
    return record ? recentEntry(record) : undefined;
  }

  async getRecentBooks(limit = 8): Promise<RecentBookEntry[]> {
    limit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 8;
    if (!limit) return [];
    const db = await this.readConnection();
    const books = db.table<PersistedBookRecord, string>('books');
    if (!db.tables.some(table => table.name === 'bookMetadata')) {
      return (await books.orderBy('lastOpenedAt').reverse().limit(limit).toArray()).map(recentEntry);
    }
    const refresh: BookMetadataRecord[] = [];
    const result = await db.transaction('r', ['books', 'bookMetadata'], async () => {
      const metadata = new Map((await db.table<BookMetadataRecord, string>('bookMetadata').toArray()).map(record => [record.documentId, record]));
      const sourceTimes = new Map<string, string>();
      // Scan lightweight keys, not PDF values. This also validates each sidecar
      // against old tabs that can still rewrite v1 records after versionchange.
      await books.orderBy('lastOpenedAt').eachPrimaryKey((key, cursor) => { sourceTimes.set(key, String(cursor.key)); });
      const candidates = Array.from(sourceTimes, ([documentId, sourceLastOpenedAt]) => ({ documentId, sourceLastOpenedAt,
        lastOpenedAt: latest(sourceLastOpenedAt, metadata.get(documentId)?.lastOpenedAt) ?? sourceLastOpenedAt,
      })).sort((left, right) => indexedDB.cmp(right.lastOpenedAt, left.lastOpenedAt) || indexedDB.cmp(right.documentId, left.documentId)).slice(0, limit);
      const entries: RecentBookEntry[] = [];
      for (const candidate of candidates) {
        const current = metadata.get(candidate.documentId);
        if (validMetadata(current) && current.sourceLastOpenedAt === candidate.sourceLastOpenedAt) entries.push(recentEntry(current));
        else {
          const source = await books.get(candidate.documentId);
          if (source) { const record = metadataEntry(source, current); refresh.push(record); entries.push(recentEntry(record)); }
        }
      }
      return entries;
    });
    await this.backfill(refresh);
    return result;
  }

  async getWorkspace(documentId: string): Promise<WorkspaceSnapshot | undefined> {
    return (await this.readConnection()).table<WorkspaceSnapshot, string>('workspaces').get(documentId);
  }

  async putBook(record: PersistedBookRecord): Promise<void> {
    await this.ensureOpen();
    await this.transaction('rw', this.books, this.bookMetadata, async () => {
      const current = await this.bookMetadata.get(record.documentId);
      await this.books.put(record); await this.bookMetadata.put(metadataEntry(record, current));
    });
  }

  async putWorkspace(snapshot: WorkspaceSnapshot, expectedVersion: WorkspaceVersion): Promise<WorkspaceSnapshot> {
    await this.ensureOpen();
    // IndexedDB serializes overlapping readwrite transactions across connections
    // and tabs. The read MUST be in the same transaction as the conditional put.
    return this.transaction('rw', this.workspaces, this.books, this.bookMetadata, async () => {
      const current = await this.workspaces.get(snapshot.documentId);
      if (workspaceVersion(current) !== expectedVersion) throw new WorkspaceConflictError(current ?? null);
      if (current && workspaceContent(current) === workspaceContent(snapshot)) return current;
      const saved = { ...snapshot, revision: crypto.randomUUID() };
      await this.workspaces.put(saved);
      // Commit bookkeeping with the snapshot: a failed sidecar write must not
      // advance durable ownership while the caller still believes its save failed.
      await this.updateBookMetadata(snapshot.documentId, { lastSavedAt: snapshot.savedAt, lastOpenedAt: new Date().toISOString() });
      return saved;
    });
  }

  async updateBookMetadata(documentId: string, changes: BookMetadataChanges, source?: RecentBookEntry): Promise<number> {
    await this.ensureOpen();
    return this.transaction('rw', this.books, this.bookMetadata, async () => {
      const current = await this.readMetadata(this, documentId, source);
      if (!current) return 0;
      await this.bookMetadata.put({ ...current, ...changes });
      return 1;
    });
  }
}

export class PersistenceService {
  private readonly port: WorkspacePersistencePort;
  private static readonly MAX_RECENT_BOOKS = 3;

  constructor(port: WorkspacePersistencePort = new DexieWorkspacePersistencePort()) {
    this.port = port;
  }

  async loadWorkspace(documentId: string): Promise<WorkspaceSnapshot | null> {
    return (await this.port.getWorkspace(documentId)) ?? null;
  }

  async saveWorkspace(snapshot: WorkspaceSnapshot, expectedVersion: WorkspaceVersion = null): Promise<WorkspaceSnapshot> {
    return this.port.putWorkspace(snapshot, expectedVersion);
  }

  async saveBookAsset(input: {
    documentId: string;
    file: Blob;
    fileName: string;
    fileSize: number;
    totalPages: number;
  }): Promise<void> {
    const existing = await this.port.getBookMetadata(input.documentId);
    const now = new Date().toISOString();

    await this.port.putBook({
      documentId: input.documentId,
      fileName: input.fileName,
      totalPages: input.totalPages,
      fileSize: input.fileSize,
      lastOpenedAt: now,
      lastSavedAt: existing?.lastSavedAt,
      bytes: typeof input.file.arrayBuffer === 'function'
        ? await input.file.arrayBuffer()
        : await new Promise<ArrayBuffer>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as ArrayBuffer);
          reader.onerror = () => reject(reader.error);
          reader.readAsArrayBuffer(input.file);
        }),
    });
  }

  async loadBookAsset(documentId: string): Promise<File | null> {
    const record = await this.port.getBook(documentId);

    if (!record) {
      return null;
    }

    const data = record.bytes ?? record.blob;
    if (!data) return null;
    const file = new File([data], record.fileName, {
      type: record.blob?.type || 'application/pdf',
      lastModified: Date.now(),
    });
    try { await this.port.updateBookMetadata(documentId, { lastOpenedAt: new Date().toISOString() }, recentEntry(record)); }
    catch { /* Recency bookkeeping cannot prevent reading an intact local PDF. */ }
    return file;
  }

  async listRecentBooks(limit = PersistenceService.MAX_RECENT_BOOKS): Promise<RecentBookEntry[]> {
    return this.port.getRecentBooks(limit);
  }

  async touchBook(documentId: string): Promise<void> {
    await this.port.updateBookMetadata(documentId, { lastOpenedAt: new Date().toISOString() });
  }

  // The recent-book limit controls presentation only. Older PDF assets and
  // reading snapshots must remain available when the same book is imported again.

}

export const persistenceService = new PersistenceService();
