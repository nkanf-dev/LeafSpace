import Dexie, { type Table } from 'dexie';

import type { RecentBookEntry, WorkspaceSnapshot } from '../types/domain';

interface PersistedBookRecord extends RecentBookEntry {
  blob: Blob;
}

interface WorkspacePersistencePort {
  deleteDatabase(): Promise<void>;
  getBook(documentId: string): Promise<PersistedBookRecord | undefined>;
  getRecentBooks(limit?: number): Promise<RecentBookEntry[]>;
  getWorkspace(documentId: string): Promise<WorkspaceSnapshot | undefined>;
  putBook(record: PersistedBookRecord): Promise<void>;
  putWorkspace(snapshot: WorkspaceSnapshot): Promise<void>;
  updateBook(documentId: string, changes: Partial<PersistedBookRecord>): Promise<number>;
}

export class DexieWorkspacePersistencePort extends Dexie implements WorkspacePersistencePort {
  books!: Table<PersistedBookRecord, string>;
  workspaces!: Table<WorkspaceSnapshot, string>;

  constructor(databaseName = 'leafspace') {
    super(databaseName);

    this.version(1).stores({
      books: 'documentId, lastOpenedAt, lastSavedAt',
      workspaces: 'documentId, savedAt',
    });
  }

  async deleteDatabase(): Promise<void> {
    this.close();
    await Dexie.delete(this.name);
  }

  getBook(documentId: string): Promise<PersistedBookRecord | undefined> {
    return this.books.get(documentId);
  }

  async getRecentBooks(limit = 8): Promise<RecentBookEntry[]> {
    const books = await this.books.orderBy('lastOpenedAt').reverse().limit(limit).toArray();

    return books.map(({ blob: _blob, ...rest }) => rest);
  }

  getWorkspace(documentId: string): Promise<WorkspaceSnapshot | undefined> {
    return this.workspaces.get(documentId);
  }

  async putBook(record: PersistedBookRecord): Promise<void> {
    await this.books.put(record);
  }

  async putWorkspace(snapshot: WorkspaceSnapshot): Promise<void> {
    await this.workspaces.put(snapshot);
  }

  updateBook(documentId: string, changes: Partial<PersistedBookRecord>): Promise<number> {
    return this.books.update(documentId, changes);
  }
}

export class PersistenceService {
  private readonly port: WorkspacePersistencePort;

  constructor(port: WorkspacePersistencePort = new DexieWorkspacePersistencePort()) {
    this.port = port;
  }

  async loadWorkspace(documentId: string): Promise<WorkspaceSnapshot | null> {
    return (await this.port.getWorkspace(documentId)) ?? null;
  }

  async saveWorkspace(snapshot: WorkspaceSnapshot): Promise<void> {
    await this.port.putWorkspace(snapshot);
    await this.port.updateBook(snapshot.documentId, { lastSavedAt: snapshot.savedAt, lastOpenedAt: new Date().toISOString() });
  }

  async saveBookAsset(input: {
    documentId: string;
    file: Blob;
    fileName: string;
    fileSize: number;
    totalPages: number;
  }): Promise<void> {
    const existing = await this.port.getBook(input.documentId);
    const now = new Date().toISOString();

    await this.port.putBook({
      documentId: input.documentId,
      fileName: input.fileName,
      totalPages: input.totalPages,
      fileSize: input.fileSize,
      lastOpenedAt: now,
      lastSavedAt: existing?.lastSavedAt,
      blob: input.file,
    });
  }

  async loadBookAsset(documentId: string): Promise<File | null> {
    const record = await this.port.getBook(documentId);

    if (!record) {
      return null;
    }

    await this.port.updateBook(documentId, { lastOpenedAt: new Date().toISOString() });

    return new File([record.blob], record.fileName, {
      type: record.blob.type || 'application/pdf',
      lastModified: Date.now(),
    });
  }

  async listRecentBooks(limit = 8): Promise<RecentBookEntry[]> {
    return this.port.getRecentBooks(limit);
  }

  async touchBook(documentId: string): Promise<void> {
    await this.port.updateBook(documentId, { lastOpenedAt: new Date().toISOString() });
  }
}

export const persistenceService = new PersistenceService();
