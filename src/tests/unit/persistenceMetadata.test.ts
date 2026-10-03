import { afterEach, describe, expect, it, vi } from 'vitest';
import Dexie from 'dexie';
import { DexieWorkspacePersistencePort, PersistenceService } from '../../services/PersistenceService';
import type { WorkspaceSnapshot } from '../../types/domain';

const ports: DexieWorkspacePersistencePort[] = [];
const legacyConnections: Dexie[] = [];
afterEach(async () => { vi.restoreAllMocks(); legacyConnections.splice(0).forEach(db => db.close()); await Promise.all(ports.splice(0).map(port => port.deleteDatabase())); });
const size = 5 * 1024 * 1024;
function snapshot(documentId: string): WorkspaceSnapshot {
  return { documentId, currentPage: 3, scale: 1, activeWindowId: 'main', layoutPreset: 'single', heldPages: [], windows: [], savedAt: new Date().toISOString() };
}

async function setup() {
  const port = new DexieWorkspacePersistencePort(`leafspace-metadata-${crypto.randomUUID()}`);
  ports.push(port);
  const stats = { readBytes: 0, writeBytes: 0, bookWrites: 0, failBookkeeping: false, failMetadataOnly: false };
  const bytes = (value: unknown) => {
    const record = value as { bytes?: ArrayBuffer; blob?: Blob; fileSize?: number } | undefined;
    // The seeded payload size is exact. Counting its containing record avoids
    // jsdom/fake-indexeddb cross-realm ArrayBuffer getter artifacts in Dexie.
    return record && ('bytes' in record || 'blob' in record) ? record.fileSize ?? 0 : 0;
  };
  port.use({ stack: 'dbcore', name: 'measure-pdf-payload', create: down => ({ ...down, table: name => {
    const table = down.table(name);
    return { ...table,
      get: async request => { const value = await table.get(request); if (name === 'books') stats.readBytes += bytes(value); return value; },
      getMany: async request => { const values = await table.getMany(request); if (name === 'books') stats.readBytes += values.reduce((total, value) => total + bytes(value), 0); return values; },
      query: async request => { const result = await table.query(request); if (name === 'books' && request.values) stats.readBytes += result.result.reduce((total, value) => total + bytes(value), 0); return result; },
      openCursor: async request => {
        const cursor = await table.openCursor(request);
        if (cursor && name === 'books' && request.values) {
          const start = cursor.start.bind(cursor);
          cursor.start = onNext => start(() => { stats.readBytes += bytes(cursor.value); onNext(); });
        }
        return cursor;
      },
      mutate: request => {
        if (stats.failBookkeeping && (name === 'books' || name === 'bookMetadata')) throw new DOMException('Metadata quota exceeded', 'QuotaExceededError');
        if (stats.failMetadataOnly && name === 'bookMetadata') throw new DOMException('Metadata quota exceeded', 'QuotaExceededError');
        if (name === 'books' && 'values' in request) { stats.bookWrites += request.values.length; stats.writeBytes += request.values.reduce((total, value) => total + bytes(value), 0); }
        return table.mutate(request);
      },
    };
  } }) });
  const service = new PersistenceService(port);
  for (let index = 0; index < 3; index++) await service.saveBookAsset({
    documentId: `book-${index}`, file: new Blob([new Uint8Array(size)], { type: 'application/pdf' }), fileName: `book-${index}.pdf`, fileSize: size, totalPages: 12,
  });
  stats.readBytes = 0; stats.writeBytes = 0; stats.bookWrites = 0;
  return { port, service, stats };
}

async function setupLegacy(keepOpen = false) {
  const name = `leafspace-legacy-${crypto.randomUUID()}`;
  const legacy = new Dexie(name);
  legacyConnections.push(legacy);
  legacy.version(1).stores({ books: 'documentId, lastOpenedAt, lastSavedAt', workspaces: 'documentId, savedAt' });
  for (let index = 0; index < 5; index++) {
    const documentId = `legacy-${index}`;
    await legacy.table('books').put({ documentId, fileName: `${documentId}.pdf`, fileSize: 3, totalPages: 12,
      lastOpenedAt: new Date(Date.UTC(2026, 0, Math.min(index + 1, 4))).toISOString(),
      ...(index === 0 ? { blob: new Blob(['pdf'], { type: 'application/pdf' }) } : { bytes: new Uint8Array([index, 2, 3]).buffer }),
    });
    await legacy.table('workspaces').put(snapshot(documentId));
  }
  if (!keepOpen) legacy.close();
  const port = new DexieWorkspacePersistencePort(name);
  ports.push(port);
  return { port, legacy, service: new PersistenceService(port) };
}

describe('lightweight persistence metadata', () => {
  it('saves a workspace and refreshes recents without reading or rewriting PDF payloads', async () => {
    const { service, stats } = await setup();
    await service.saveWorkspace(snapshot('book-1'));
    expect(await service.listRecentBooks()).toHaveLength(3);
    await service.touchBook('book-2');
    expect(stats).toMatchObject({ readBytes: 0, writeBytes: 0, bookWrites: 0 });
  });

  it('opens a PDF with one payload read and no payload rewrite', async () => {
    const { service, stats } = await setup();
    expect((await service.loadBookAsset('book-1'))?.size).toBe(size);
    expect(stats).toMatchObject({ readBytes: size, writeBytes: 0, bookWrites: 0 });
  });

  it('returns the intact PDF when metadata-only bookkeeping cannot be written', async () => {
    const { service, stats } = await setup();
    stats.failBookkeeping = true;
    const file = await service.loadBookAsset('book-1');
    expect(file?.name).toBe('book-1.pdf'); expect(file?.size).toBe(size);
  });

  it.each([undefined, { broken: true }, 'not a date'])('repairs a malformed sidecar timestamp (%s) without hiding intact books', async timestamp => {
    const { port, service } = await setup();
    const current = (await port.bookMetadata.get('book-1'))!;
    await port.bookMetadata.put({ ...current, lastOpenedAt: timestamp as unknown as string, lastSavedAt: { broken: true } as unknown as string });
    const recent = await service.listRecentBooks();
    expect(recent).toHaveLength(3);
    const repaired = recent.find(book => book.documentId === 'book-1')!;
    expect(repaired.lastOpenedAt).toBe(current.sourceLastOpenedAt);
    expect(repaired.lastSavedAt).toBeUndefined();
    expect(repaired).not.toHaveProperty('sourceLastOpenedAt');
    expect((await service.loadBookAsset('book-1'))?.size).toBe(size);
  });

  it('upgrades v1 by adding an empty sidecar without moving Blob, byte or workspace records', async () => {
    const { port, service } = await setupLegacy();
    await port.open();
    expect(await port.bookMetadata.count()).toBe(0);
    expect(await port.books.count()).toBe(5); expect(await port.workspaces.count()).toBe(5);
    expect(await port.books.get('legacy-0')).toHaveProperty('blob');
    expect(await port.books.get('legacy-0')).not.toHaveProperty('bytes');
    expect(Array.from(new Uint8Array((await port.books.get('legacy-4'))!.bytes!))).toEqual([4, 2, 3]);
    expect(await service.listRecentBooks(0)).toEqual([]);
    expect((await service.listRecentBooks(1)).map(book => book.documentId)).toEqual(['legacy-4']);
    expect((await service.listRecentBooks(3)).map(book => book.documentId)).toEqual(['legacy-4', 'legacy-3', 'legacy-2']);
    expect(await service.listRecentBooks(10)).toHaveLength(5);
    expect((await service.loadWorkspace('legacy-0'))?.currentPage).toBe(3);
    expect(await port.books.count()).toBe(5);
  });

  it('returns legacy recents and files even if lazy metadata backfill runs out of quota', async () => {
    const { port, service } = await setupLegacy();
    const fail = () => { throw new DOMException('Metadata quota exceeded', 'QuotaExceededError'); };
    port.bookMetadata.hook('creating', fail);
    expect(await service.listRecentBooks()).toHaveLength(3);
    expect(await port.bookMetadata.count()).toBe(0);
    expect((await service.loadBookAsset('legacy-4'))?.name).toBe('legacy-4.pdf');
    expect(await port.books.count()).toBe(5); expect(await port.workspaces.count()).toBe(5);
    port.bookMetadata.hook('creating').unsubscribe(fail);
    await service.touchBook('legacy-0');
    expect((await service.listRecentBooks())[0].documentId).toBe('legacy-0');
  });

  it('rolls back both halves of a failed asset replacement without losing the prior PDF or workspace', async () => {
    const { port, service, stats } = await setup();
    await service.saveWorkspace(snapshot('book-1'));
    stats.failMetadataOnly = true;
    await expect(service.saveBookAsset({ documentId: 'book-1', file: new Blob(['new']), fileName: 'replacement.pdf', fileSize: 3, totalPages: 2 })).rejects.toThrow('Metadata quota exceeded');
    expect(await port.getBook('book-1')).toMatchObject({ fileName: 'book-1.pdf', fileSize: size, totalPages: 12 });
    expect(await port.getWorkspace('book-1')).toMatchObject({ currentPage: 3 });
    expect(await port.bookMetadata.get('book-1')).toMatchObject({ fileName: 'book-1.pdf', fileSize: size });
  });

  it('keeps legacy data readable after a real schema-creation failure, then recovers the upgrade', async () => {
    const { port, legacy, service } = await setupLegacy();
    const createStore = IDBDatabase.prototype.createObjectStore;
    const fault = vi.spyOn(IDBDatabase.prototype, 'createObjectStore').mockImplementation(function (this: IDBDatabase, name, options) {
      if (name === 'bookMetadata') throw new DOMException('Schema quota exceeded', 'QuotaExceededError');
      return createStore.call(this, name, options);
    });
    expect(await service.listRecentBooks()).toHaveLength(3);
    expect((await service.loadBookAsset('legacy-4'))?.name).toBe('legacy-4.pdf');
    expect((await service.loadWorkspace('legacy-4'))?.currentPage).toBe(3);
    await legacy.open();
    expect(legacy.backendDB().version).toBe(10);
    expect(await legacy.table('books').count()).toBe(5);
    legacy.close(); fault.mockRestore();
    expect(await service.listRecentBooks()).toHaveLength(3);
    expect(port.backendDB().version).toBe(20);
    expect(await port.books.count()).toBe(5);
  });

  it('reconciles an old v1 writer even after a newer sidecar-only touch', async () => {
    const { port, legacy, service } = await setupLegacy(true);
    await service.listRecentBooks();
    const original = await legacy.table('books').get('legacy-4');
    await legacy.table('books').put({ ...original, fileName: 'Renamed by old tab.pdf', lastOpenedAt: '2026-02-01T09:01:00.000Z' });
    await port.bookMetadata.update('legacy-4', { lastOpenedAt: '2026-02-01T09:02:00.000Z' });
    const [recent] = await service.listRecentBooks();
    expect(recent).toMatchObject({ documentId: 'legacy-4', fileName: 'Renamed by old tab.pdf', lastOpenedAt: '2026-02-01T09:02:00.000Z' });
    expect(await port.bookMetadata.get('legacy-4')).toMatchObject({ sourceLastOpenedAt: '2026-02-01T09:01:00.000Z' });
  });

  it('uses the actual file metadata when opening a same-timestamp legacy rewrite', async () => {
    const { legacy, service } = await setupLegacy(true);
    await service.listRecentBooks();
    const original = await legacy.table('books').get('legacy-4');
    await legacy.table('books').put({ ...original, fileName: 'Same timestamp rename.pdf' });
    // The legacy index has no revision signal for a same-stamp mutation.
    expect((await service.listRecentBooks())[0].fileName).toBe('legacy-4.pdf');
    expect((await service.loadBookAsset('legacy-4'))?.name).toBe('Same timestamp rename.pdf');
    expect((await service.listRecentBooks())[0].fileName).toBe('Same timestamp rename.pdf');
  });

  it.each(['source', 'metadata'] as const)('does not overwrite a concurrent newer %s during optional backfill', async changed => {
    const { port, service } = await setupLegacy();
    let pending: Promise<unknown> | undefined;
    const other = new Dexie(port.name); legacyConnections.push(other);
    port.use({ stack: 'dbcore', name: 'race-backfill', create: down => ({ ...down, table: name => {
      const table = down.table(name);
      return { ...table, get: async request => {
        const value = await table.get(request);
        if (name === 'books' && request.key === 'legacy-4' && !pending) {
          const source = value as Record<string, unknown>;
          if (changed === 'source') pending = other.table('books').put({ ...source, fileName: 'Newer source.pdf', lastOpenedAt: '2026-02-01T09:00:00.000Z' });
          else pending = other.table('bookMetadata').put({ documentId: source.documentId, fileName: source.fileName,
            fileSize: source.fileSize, totalPages: source.totalPages, sourceLastOpenedAt: source.lastOpenedAt,
            lastOpenedAt: '2026-02-01T09:00:00.000Z', lastSavedAt: '2026-02-01T09:00:00.000Z' });
        }
        return value;
      } };
    } }) });
    await port.open();
    await other.open();
    await service.listRecentBooks(); await pending;
    if (changed === 'source') {
      expect(await port.bookMetadata.get('legacy-4')).toBeUndefined();
      expect((await service.listRecentBooks())[0].fileName).toBe('Newer source.pdf');
    } else expect(await port.bookMetadata.get('legacy-4')).toMatchObject({ lastOpenedAt: '2026-02-01T09:00:00.000Z', lastSavedAt: '2026-02-01T09:00:00.000Z' });
  });

  it('preserves a newer metadata touch while an explicitly reimported file is being read', async () => {
    const { port, service } = await setup();
    let finish!: (bytes: ArrayBuffer) => void;
    const file = new Blob(['new']);
    Object.defineProperty(file, 'arrayBuffer', { value: () => new Promise<ArrayBuffer>(resolve => { finish = resolve; }) });
    const saving = service.saveBookAsset({ documentId: 'book-1', file, fileName: 'Replacement.pdf', fileSize: 3, totalPages: 2 });
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    await port.updateBookMetadata('book-1', { lastOpenedAt: '2026-12-01T09:00:00.000Z', lastSavedAt: '2026-12-01T09:00:00.000Z' });
    finish(new Uint8Array([1, 2, 3]).buffer); await saving;
    expect(await port.bookMetadata.get('book-1')).toMatchObject({ fileName: 'Replacement.pdf', lastOpenedAt: '2026-12-01T09:00:00.000Z', lastSavedAt: '2026-12-01T09:00:00.000Z' });
    expect(await port.getBook('book-1')).toMatchObject({ fileName: 'Replacement.pdf', fileSize: 3 });
  });

  it('reports a blocked upgrade promptly and recovers after the old connection closes', async () => {
    const { port, service } = await setupLegacy();
    const blocker = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(port.name); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    try {
      await expect(service.listRecentBooks()).rejects.toThrow('其他页境标签页');
      await expect(service.saveWorkspace(snapshot('legacy-4'))).rejects.toThrow('其他页境标签页');
    } finally { blocker.close(); }
    await vi.waitFor(() => expect(port.isOpen()).toBe(true));
    expect(await service.listRecentBooks()).toHaveLength(3);
    expect(await port.books.count()).toBe(5); expect(await port.workspaces.count()).toBe(5);
  });

  it('clears a blocked gate if the eventual upgrade fails, preserving legacy reads and another retry', async () => {
    const { port, service } = await setupLegacy();
    const blocker = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(port.name); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    const createStore = IDBDatabase.prototype.createObjectStore;
    const fault = vi.spyOn(IDBDatabase.prototype, 'createObjectStore').mockImplementation(function (this: IDBDatabase, name, options) {
      if (name === 'bookMetadata') throw new DOMException('Schema quota exceeded', 'QuotaExceededError');
      return createStore.call(this, name, options);
    });
    try { await expect(service.listRecentBooks()).rejects.toThrow('其他页境标签页'); }
    finally { blocker.close(); }
    await vi.waitFor(async () => expect(await service.listRecentBooks()).toHaveLength(3));
    expect((await service.loadBookAsset('legacy-4'))?.name).toBe('legacy-4.pdf');
    fault.mockRestore();
    expect(await service.listRecentBooks()).toHaveLength(3);
    expect(port.backendDB().version).toBe(20);
  });
});
