import { afterEach, describe, expect, it } from 'vitest';
import { DexieWorkspacePersistencePort, PersistenceService } from '../../services/PersistenceService';
import type { WorkspaceSnapshot } from '../../types/domain';

const ports: DexieWorkspacePersistencePort[] = [];
afterEach(async () => {
  await Promise.all(ports.splice(0).map((port) => port.deleteDatabase()));
});

function createService() {
  const port = new DexieWorkspacePersistencePort(`leafspace-retention-${crypto.randomUUID()}`);
  ports.push(port);
  return { port, service: new PersistenceService(port) };
}

function snapshot(documentId: string): WorkspaceSnapshot {
  return {
    documentId, currentPage: 5, scale: 1.25, activeWindowId: 'main', layoutPreset: 'single',
    heldPages: [], windows: [], savedAt: new Date().toISOString(),
  };
}

describe('persistent book retention', () => {
  it('limits the recent list without deleting older PDF assets or reading snapshots', async () => {
    const { port, service } = createService();
    for (let index = 0; index < 5; index += 1) {
      const documentId = `book-${index}`;
      await service.saveBookAsset({
        documentId, file: new Blob(['%PDF-example'], { type: 'application/pdf' }),
        fileName: `${documentId}.pdf`, fileSize: 12, totalPages: 10,
      });
      await service.saveWorkspace(snapshot(documentId));
    }
    expect(await service.listRecentBooks()).toHaveLength(3);
    expect(await port.books.count()).toBe(5);
    expect(await port.workspaces.count()).toBe(5);
    expect(await service.loadWorkspace('book-0')).toMatchObject({ currentPage: 5, scale: 1.25 });
    const file = await service.loadBookAsset('book-0');
    expect(file?.name).toBe('book-0.pdf');
    expect(file?.type).toBe('application/pdf');
    await service.touchBook('book-4');
    expect(await port.books.count()).toBe(5);
    expect(await port.workspaces.count()).toBe(5);
  });

  it('does not include PDF blobs in recent metadata', async () => {
    const { service } = createService();
    await service.saveBookAsset({
      documentId: 'book', file: new Blob(['pdf']), fileName: 'book.pdf', fileSize: 3, totalPages: 2,
    });
    const [recent] = await service.listRecentBooks();
    expect(recent).toMatchObject({ documentId: 'book', fileName: 'book.pdf', totalPages: 2 });
    expect(recent).not.toHaveProperty('blob');
  });
  it('stores portable ArrayBuffer bytes and still opens legacy Blob records', async () => {
    const { port, service } = createService();
    await service.saveBookAsset({ documentId: 'portable', file: new Blob(['%PDF-portable']), fileName: 'portable.pdf', fileSize: 13, totalPages: 1 });
    const record = await port.books.get('portable');
    expect(Object.prototype.toString.call(record?.bytes)).toBe("[object ArrayBuffer]");
    expect(record).not.toHaveProperty('blob');
    expect((await service.loadBookAsset('portable'))?.size).toBe(13);
    await port.books.put({ documentId: 'legacy', blob: new Blob(['%PDF-legacy'], { type: 'application/pdf' }), fileName: 'legacy.pdf', fileSize: 11, totalPages: 1, lastOpenedAt: new Date().toISOString() });
    expect((await service.loadBookAsset('legacy'))?.name).toBe('legacy.pdf');
    expect((await service.listRecentBooks()).every(book => !('bytes' in book) && !('blob' in book))).toBe(true);
  });

});
