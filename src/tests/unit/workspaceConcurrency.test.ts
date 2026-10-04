import { afterEach, describe, expect, it } from 'vitest';
import Dexie from 'dexie';
import { DexieWorkspacePersistencePort, PersistenceService, WorkspaceConflictError, workspaceVersion } from '../../services/PersistenceService';
import type { WorkspaceSnapshot } from '../../types/domain';

const ports: DexieWorkspacePersistencePort[] = [];
afterEach(async () => {
  const all = ports.splice(0);
  all.forEach(port => port.close());
  for (const name of new Set(all.map(port => port.name))) await Dexie.delete(name);
});
function snapshot(currentPage: number, documentId = 'generated-book'): WorkspaceSnapshot {
  return { documentId, currentPage, scale: 1, activeWindowId: 'main', layoutPreset: 'single', heldPages: [], windows: [], savedAt: '2026-10-04T00:00:00.000Z' };
}
function setup() {
  const name = `leafspace-concurrency-${crypto.randomUUID()}`;
  const a = new DexieWorkspacePersistencePort(name), b = new DexieWorkspacePersistencePort(name);
  ports.push(a, b);
  return { a, b, tabA: new PersistenceService(a), tabB: new PersistenceService(b) };
}

describe('transactional cross-connection workspace ownership', () => {
  it('rejects the deterministically reproduced stale-tab overwrite, preserving both snapshots', async () => {
    const { tabA, tabB } = setup();
    await tabA.saveWorkspace(snapshot(1));
    const baselineA = await tabA.loadWorkspace('generated-book');
    const baselineB = await tabB.loadWorkspace('generated-book');
    expect(baselineA).toEqual(baselineB);
    const savedA = await tabA.saveWorkspace(snapshot(7), workspaceVersion(baselineA));
    const localB = snapshot(2);
    await expect(tabB.saveWorkspace(localB, workspaceVersion(baselineB))).rejects.toMatchObject({
      name: 'WorkspaceConflictError', current: savedA, version: workspaceVersion(savedA),
    });
    expect(await tabA.loadWorkspace('generated-book')).toEqual(savedA);
    expect(localB).toEqual(snapshot(2));
  });

  it('allows exactly one simultaneous first writer after both tabs read absence', async () => {
    const { tabA, tabB } = setup();
    expect(await tabA.loadWorkspace('generated-book')).toBeNull();
    expect(await tabB.loadWorkspace('generated-book')).toBeNull();
    const results = await Promise.allSettled([tabA.saveWorkspace(snapshot(2), null), tabB.saveWorkspace(snapshot(7), null)]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find(result => result.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(WorkspaceConflictError);
    expect((await tabA.loadWorkspace('generated-book'))?.currentPage).toBe(results[0].status === 'fulfilled' ? 2 : 7);
  });

  it('serializes concurrent CAS transactions rather than separately checking before blind writes', async () => {
    const { tabA, tabB } = setup();
    const original = await tabA.saveWorkspace(snapshot(1));
    const version = workspaceVersion(original);
    const results = await Promise.allSettled([tabA.saveWorkspace(snapshot(2), version), tabB.saveWorkspace(snapshot(7), version)]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
  });

  it('compares the full legacy snapshot even when timestamps are identical', async () => {
    const { a, tabA, tabB } = setup();
    await a.workspaces.put(snapshot(1)); // A v1/v2 snapshot without revision.
    const old = await tabB.loadWorkspace('generated-book');
    await a.workspaces.put(snapshot(7)); // Old code writes without changing savedAt.
    await expect(tabB.saveWorkspace(snapshot(2), workspaceVersion(old))).rejects.toBeInstanceOf(WorkspaceConflictError);
    const current = await tabA.loadWorkspace('generated-book');
    const migrated = await tabA.saveWorkspace(snapshot(8), workspaceVersion(current));
    expect(migrated.revision).toEqual(expect.any(String));
    expect((await tabB.loadWorkspace('generated-book'))?.currentPage).toBe(8);
  });

  it('detects old writers that remove or accidentally reuse a modern revision', async () => {
    const { a, tabA, tabB } = setup();
    const original = await tabA.saveWorkspace(snapshot(1));
    await a.workspaces.put({ ...original, currentPage: 7 });
    await expect(tabB.saveWorkspace(snapshot(2), workspaceVersion(original))).rejects.toBeInstanceOf(WorkspaceConflictError);
    await a.workspaces.put(snapshot(8));
    await expect(tabB.saveWorkspace(snapshot(3), workspaceVersion(original))).rejects.toBeInstanceOf(WorkspaceConflictError);
    expect((await tabA.loadWorkspace('generated-book'))?.currentPage).toBe(8);
  });

  it('rejects an overwrite approved before a third competing save, including removal', async () => {
    const { a, tabA, tabB } = setup();
    const original = await tabA.saveWorkspace(snapshot(1));
    const detected = await tabA.saveWorkspace(snapshot(7), workspaceVersion(original));
    const newer = await tabA.saveWorkspace(snapshot(8), workspaceVersion(detected));
    await expect(tabB.saveWorkspace(snapshot(2), workspaceVersion(detected))).rejects.toMatchObject({ current: newer });
    await a.deleteWorkspace('generated-book');
    await expect(tabB.saveWorkspace(snapshot(2), workspaceVersion(newer))).rejects.toMatchObject({ current: null, version: null });
    const replacement = await tabB.saveWorkspace(snapshot(2), null);
    expect(await tabA.loadWorkspace('generated-book')).toEqual(replacement);
  });

  it('keeps different documents independent', async () => {
    const { tabA, tabB } = setup();
    const results = await Promise.all([tabA.saveWorkspace(snapshot(2, 'one')), tabB.saveWorkspace(snapshot(7, 'two'))]);
    expect(results.map(result => result.currentPage)).toEqual([2, 7]);
    expect((await tabB.loadWorkspace('one'))?.currentPage).toBe(2);
    expect((await tabA.loadWorkspace('two'))?.currentPage).toBe(7);
  });

  it('does not advance revision, timestamps or metadata for an owned identical-content save', async () => {
    const { a, tabA } = setup();
    const original = await tabA.saveWorkspace(snapshot(1));
    let writes = 0;
    a.workspaces.hook('updating', () => { writes++; });
    const noOp = await tabA.saveWorkspace({ ...snapshot(1), savedAt: '2026-10-05T00:00:00.000Z' }, workspaceVersion(original));
    expect(noOp).toEqual(original);
    expect(writes).toBe(0);
    // A no-op never grants ownership to a stale caller, even if it matches.
    await expect(tabA.saveWorkspace(snapshot(1), null)).rejects.toBeInstanceOf(WorkspaceConflictError);
  });

  it('rolls back the snapshot and its revision when metadata fails, allowing an exact retry', async () => {
    const { a, tabA, tabB } = setup();
    await tabA.saveBookAsset({ documentId: 'generated-book', file: new Blob(['generated']), fileName: 'fixture.pdf', fileSize: 9, totalPages: 9 });
    const original = await tabA.saveWorkspace(snapshot(1));
    const metadata = await a.getBookMetadata('generated-book');
    const bytes = (await a.getBook('generated-book'))!.bytes;
    const fault = () => { throw new DOMException('Synthetic metadata quota', 'QuotaExceededError'); };
    a.bookMetadata.hook('updating', fault);
    await expect(tabA.saveWorkspace(snapshot(7), workspaceVersion(original))).rejects.toThrow('Synthetic metadata quota');
    expect(await tabB.loadWorkspace('generated-book')).toEqual(original);
    expect(await a.getBookMetadata('generated-book')).toEqual(metadata);
    expect((await a.getBook('generated-book'))!.bytes).toEqual(bytes);
    a.bookMetadata.hook('updating').unsubscribe(fault);
    const saved = await tabA.saveWorkspace(snapshot(7), workspaceVersion(original));
    expect(saved.currentPage).toBe(7);
    expect(saved.revision).not.toBe(original.revision);
  });

  it('migrates v1 in place and protects its first modern write without moving PDF bytes', async () => {
    const { a, tabA, tabB } = setup();
    const legacy = new Dexie(a.name);
    legacy.version(1).stores({ books: 'documentId, lastOpenedAt, lastSavedAt', workspaces: 'documentId, savedAt' });
    await legacy.table('workspaces').put(snapshot(1));
    await legacy.table('books').put({ documentId: 'generated-book', fileName: 'generated.pdf', totalPages: 9, fileSize: 3,
      bytes: new Uint8Array([1, 2, 3]).buffer, lastOpenedAt: '2026-10-04T00:00:00.000Z' });
    legacy.close();
    const baselineA = await tabA.loadWorkspace('generated-book'), baselineB = await tabB.loadWorkspace('generated-book');
    const saved = await tabA.saveWorkspace(snapshot(7), workspaceVersion(baselineA));
    await expect(tabB.saveWorkspace(snapshot(2), workspaceVersion(baselineB))).rejects.toBeInstanceOf(WorkspaceConflictError);
    expect(await a.workspaces.count()).toBe(1);
    expect(await a.books.count()).toBe(1);
    expect(Array.from(new Uint8Array((await a.getBook('generated-book'))!.bytes!))).toEqual([1, 2, 3]);
    expect(await tabB.loadWorkspace('generated-book')).toEqual(saved);
  });
});
