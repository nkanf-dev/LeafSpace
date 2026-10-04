import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Dexie from 'dexie';
import { DexieWorkspacePersistencePort, PersistenceService, workspaceVersion } from '../../services/PersistenceService';
import { bookStore } from '../../stores/bookStore';
import { heldStore } from '../../stores/heldStore';
import { windowStore } from '../../stores/windowStore';
import { prepareHeldRead } from '../../services/HeldReadTransaction';
import { configureWorkspaceStoreDependencies, hasUnsavedWorkspace, resetWorkspaceStoreDependencies, workspaceStore } from '../../stores/workspaceStore';
import type { WorkspaceSnapshot } from '../../types/domain';

vi.mock('../../services/ThumbnailService', () => ({ thumbnailService: { activateDocument: vi.fn(), releaseDocument: vi.fn(),
  ensureThumbnail: vi.fn().mockResolvedValue(undefined), getThumbnailKey: (page: number) => `generated_${page}` } }));

const ports: DexieWorkspacePersistencePort[] = [];
const pending: Promise<void>[] = [];
const finish: (() => void)[] = [];
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(yes => { resolve = yes; });
  finish.push(resolve);
  return { promise, resolve };
}
function track(promise: Promise<void>) { pending.push(promise); return promise; }
function snapshot(currentPage: number, documentId = 'fixture'): WorkspaceSnapshot {
  return { documentId, currentPage, scale: 1, activeWindowId: 'main', layoutPreset: 'single', heldPages: [], windows: [], savedAt: '2026-10-04T00:00:00.000Z' };
}
function live() {
  return structuredClone({ page: bookStore.getState().currentPage, scale: bookStore.getState().scale,
    held: heldStore.getState().pages, windows: windowStore.getState().windows, active: windowStore.getState().activeWindowId });
}
async function setup() {
  const name = `leafspace-conflict-state-${crypto.randomUUID()}`;
  const port = new DexieWorkspacePersistencePort(name), otherPort = new DexieWorkspacePersistencePort(name);
  ports.push(port, otherPort);
  const service = new PersistenceService(port), other = new PersistenceService(otherPort);
  configureWorkspaceStoreDependencies({ persistenceService: service });
  const original = await other.saveWorkspace(snapshot(1));
  bookStore.getState().setDocumentReady({ documentId: 'fixture', totalPages: 20 });
  await workspaceStore.getState().restoreWorkspace('fixture');
  return { port, otherPort, service, other, original };
}
async function conflicted() {
  const result = await setup();
  const stored = await result.other.saveWorkspace(snapshot(7), workspaceVersion(result.original));
  bookStore.getState().setCurrentPage(2);
  bookStore.getState().setScale(1.5);
  await heldStore.getState().holdPage(3);
  windowStore.getState().openInNewWindow(4);
  const local = live();
  await workspaceStore.getState().saveWorkspace('fixture');
  expect(workspaceStore.getState().conflict?.version).toBe(workspaceVersion(stored));
  return { ...result, stored, local };
}

beforeEach(() => { bookStore.getState().reset(); heldStore.getState().reset(); windowStore.getState().reset(); workspaceStore.getState().reset(); });
afterEach(async () => {
  finish.splice(0).forEach(resolve => resolve());
  await Promise.allSettled(pending.splice(0));
  vi.restoreAllMocks(); resetWorkspaceStoreDependencies();
  const all = ports.splice(0); all.forEach(port => port.close());
  for (const name of new Set(all.map(port => port.name))) await Dexie.delete(name);
});

describe('session-owned conflict state', () => {
  it.each(['reload', 'overwrite'] as const)('preserves conflicting held-page names and notes until explicit %s', async action => {
    const { other } = await setup();
    await heldStore.getState().holdPage(3);
    const held = heldStore.getState().pages[0], generation = heldStore.getState().metadataGeneration;
    expect(heldStore.getState().updatePageMetadata(held.id, generation, { customName: '共同定义', note: '初始备注' })).toBe(true);
    await workspaceStore.getState().saveWorkspace('fixture');
    const baseline = (await other.loadWorkspace('fixture'))!;
    const stored = await other.saveWorkspace({ ...baseline, heldPages: baseline.heldPages.map(page => ({ ...page, customName: '另一标签的定义', note: '已经保存的证明' })) }, workspaceVersion(baseline));
    expect(heldStore.getState().updatePageMetadata(held.id, generation, { customName: '本页的定义', note: '尚未保存的推导' })).toBe(true);
    await workspaceStore.getState().saveWorkspace('fixture');
    const local = live();
    expect(heldStore.getState().pages[0]).toMatchObject({ customName: '本页的定义', note: '尚未保存的推导' });
    expect(await other.loadWorkspace('fixture')).toEqual(stored); expect(hasUnsavedWorkspace()).toBe(true);
    await workspaceStore.getState().saveWorkspace('fixture');
    expect(live()).toEqual(local); expect(await other.loadWorkspace('fixture')).toEqual(stored);
    await workspaceStore.getState().resolveWorkspaceConflict('fixture', action, workspaceVersion(stored));
    const expected = action === 'reload' ? stored.heldPages : local.held;
    expect(heldStore.getState().pages).toEqual(expected);
    expect((await other.loadWorkspace('fixture'))?.heldPages).toEqual(expected);
    expect(hasUnsavedWorkspace()).toBe(false);
    if (action === 'reload') expect(heldStore.getState().updatePageMetadata(held.id, generation, { note: '已退休草稿不可写回' })).toBe(false);
  });
  it('preserves the stored snapshot and live page, zoom, held pages and windows across failed retries', async () => {
    const { stored, local, other, service } = await conflicted();
    const save = vi.spyOn(service, 'saveWorkspace');
    expect(hasUnsavedWorkspace()).toBe(true);
    workspaceStore.getState().clearError();
    await workspaceStore.getState().saveWorkspace('fixture');
    await workspaceStore.getState().restoreWorkspace('fixture');
    await workspaceStore.getState().hydrateRecentBooks();
    expect(save).not.toHaveBeenCalled();
    expect(live()).toEqual(local);
    expect(await other.loadWorkspace('fixture')).toEqual(stored);
    expect(workspaceStore.getState()).toMatchObject({ status: 'error', errorOperation: 'conflict' });
    expect(hasUnsavedWorkspace()).toBe(true);
  });

  it('advances the ownership cursor for earlier same-tab queued saves even when later requests own the UI', async () => {
    const { service, other, original } = await setup();
    const gate = deferred(); const realSave = service.saveWorkspace.bind(service);
    const save = vi.spyOn(service, 'saveWorkspace').mockImplementationOnce(async (state, version) => { await gate.promise; return realSave(state, version); });
    bookStore.getState().setCurrentPage(2);
    const first = track(workspaceStore.getState().saveWorkspace('fixture'));
    await vi.waitFor(() => expect(save).toHaveBeenCalledOnce());
    bookStore.getState().setCurrentPage(3);
    const second = track(workspaceStore.getState().saveWorkspace('fixture'));
    gate.resolve(); await Promise.all([first, second]);
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[0][1]).toBe(workspaceVersion(original));
    expect(save.mock.calls[1][1]).not.toBe(workspaceVersion(original));
    expect((await other.loadWorkspace('fixture'))?.currentPage).toBe(3);
    expect(workspaceStore.getState()).toMatchObject({ status: 'idle', conflict: null });
    expect(hasUnsavedWorkspace()).toBe(false);
  });

  it('halts every later queued request when an earlier request detects a competing write', async () => {
    const { service, other, original } = await setup();
    const gate = deferred(); const realSave = service.saveWorkspace.bind(service);
    const save = vi.spyOn(service, 'saveWorkspace').mockImplementationOnce(async (state, version) => { await gate.promise; return realSave(state, version); });
    bookStore.getState().setCurrentPage(2);
    const first = track(workspaceStore.getState().saveWorkspace('fixture'));
    await vi.waitFor(() => expect(save).toHaveBeenCalledOnce());
    bookStore.getState().setCurrentPage(3);
    const second = track(workspaceStore.getState().saveWorkspace('fixture'));
    const stored = await other.saveWorkspace(snapshot(7), workspaceVersion(original));
    gate.resolve(); await Promise.all([first, second]);
    expect(save).toHaveBeenCalledOnce();
    expect(bookStore.getState().currentPage).toBe(3);
    expect(await other.loadWorkspace('fixture')).toEqual(stored);
    expect(workspaceStore.getState()).toMatchObject({ status: 'error', errorOperation: 'conflict' });
    expect(hasUnsavedWorkspace()).toBe(true);
  });

  it('loads the detected stored scene only after explicit resolution and clears the exit warning', async () => {
    const { stored, other } = await conflicted();
    await workspaceStore.getState().resolveWorkspaceConflict('fixture', 'reload', workspaceVersion(stored));
    expect(bookStore.getState().currentPage).toBe(7);
    expect(heldStore.getState().pages).toEqual([]);
    expect(windowStore.getState().windows.filter(window => window.canClose)).toEqual([]);
    expect(await other.loadWorkspace('fixture')).toEqual(stored);
    expect(workspaceStore.getState()).toMatchObject({ status: 'idle', conflict: null, error: null });
    expect(hasUnsavedWorkspace()).toBe(false);
  });

  it.each(['before-read', 'during-read'] as const)('preserves live work when the confirmed reload version changes %s', async timing => {
    const { stored, other, service, local } = await conflicted();
    const gate = deferred();
    const realLoad = service.loadWorkspace.bind(service);
    if (timing === 'during-read') vi.spyOn(service, 'loadWorkspace').mockImplementationOnce(async docId => { await gate.promise; return realLoad(docId); });
    const reloading = timing === 'during-read'
      ? track(workspaceStore.getState().resolveWorkspaceConflict('fixture', 'reload', workspaceVersion(stored))) : null;
    const newer = await other.saveWorkspace(snapshot(9), workspaceVersion(stored));
    if (reloading) { gate.resolve(); await reloading; }
    else await workspaceStore.getState().resolveWorkspaceConflict('fixture', 'reload', workspaceVersion(stored));
    expect(live()).toEqual(local);
    expect(await other.loadWorkspace('fixture')).toEqual(newer);
    expect(workspaceStore.getState()).toMatchObject({ status: 'error', errorOperation: 'conflict', conflict: { currentPage: 9, version: workspaceVersion(newer) } });
    expect(hasUnsavedWorkspace()).toBe(true);
    // A stale double click cannot substitute the newer version for the old consent.
    await workspaceStore.getState().resolveWorkspaceConflict('fixture', 'reload', workspaceVersion(stored));
    expect(live()).toEqual(local);
    await workspaceStore.getState().resolveWorkspaceConflict('fixture', 'reload', workspaceVersion(newer));
    expect(bookStore.getState().currentPage).toBe(9);
    expect(workspaceStore.getState().conflict).toBeNull();
    expect(hasUnsavedWorkspace()).toBe(false);
  });

  it.each(['read', 'invalid-array', 'partial-apply', 'removed'] as const)('preserves live work if confirmed reload fails at %s', async fault => {
    const { stored, local, port, service } = await conflicted();
    if (fault === 'read') vi.spyOn(service, 'loadWorkspace').mockRejectedValue(new Error('Synthetic read failure'));
    if (fault === 'invalid-array') await port.workspaces.put({ ...stored, heldPages: null } as unknown as WorkspaceSnapshot);
    if (fault === 'partial-apply') await port.workspaces.put({ ...stored, heldPages: [null] } as unknown as WorkspaceSnapshot);
    if (fault === 'removed') await port.deleteWorkspace('fixture');
    await workspaceStore.getState().resolveWorkspaceConflict('fixture', 'reload', workspaceVersion(stored));
    if (fault !== 'read') await workspaceStore.getState().resolveWorkspaceConflict('fixture', 'reload', workspaceStore.getState().conflict!.version);
    expect(live()).toEqual(local);
    expect(workspaceStore.getState()).toMatchObject({ status: 'error', errorOperation: 'conflict' });
    expect(workspaceStore.getState().conflict).not.toBeNull();
    expect(hasUnsavedWorkspace()).toBe(true);
  });

  it('overwrites only the observed competing revision and captures the latest live edits', async () => {
    const { stored, other } = await conflicted();
    bookStore.getState().setCurrentPage(5);
    const current = live();
    await workspaceStore.getState().resolveWorkspaceConflict('fixture', 'overwrite', workspaceVersion(stored));
    const saved = await other.loadWorkspace('fixture');
    expect(saved).toMatchObject({ currentPage: 5, scale: 1.5, heldPages: current.held, windows: current.windows });
    expect(live()).toEqual(current);
    expect(workspaceStore.getState()).toMatchObject({ status: 'idle', conflict: null });
    expect(hasUnsavedWorkspace()).toBe(false);
  });

  it('retires deferred reading intent as soon as a confirmed reload begins', async () => {
    const { stored, service, local } = await conflicted();
    const gate = deferred(), realLoad = service.loadWorkspace.bind(service);
    vi.spyOn(service, 'loadWorkspace').mockImplementationOnce(async id => { await gate.promise; return realLoad(id); });
    const oldRead = prepareHeldRead(8);
    const reloading = track(workspaceStore.getState().resolveWorkspaceConflict('fixture', 'reload', workspaceVersion(stored)));
    expect(oldRead.commit()).toBe(false); expect(live()).toEqual(local);
    gate.resolve(); await reloading;
    expect(bookStore.getState().currentPage).toBe(7); expect(hasUnsavedWorkspace()).toBe(false);
  });

  it('rolls back malformed layout content without reviving retired metadata ownership', async () => {
    const { stored, port, local } = await conflicted();
    const generation = heldStore.getState().metadataGeneration, held = heldStore.getState().pages[0];
    const broken = { ...stored, heldPages: local.held, windows: [null] } as unknown as WorkspaceSnapshot;
    await port.workspaces.put(broken);
    await workspaceStore.getState().resolveWorkspaceConflict('fixture', 'reload', workspaceVersion(stored));
    await workspaceStore.getState().resolveWorkspaceConflict('fixture', 'reload', workspaceVersion(broken));
    expect(live()).toEqual(local); expect(heldStore.getState().metadataGeneration).toBeGreaterThan(generation);
    expect(heldStore.getState().updatePageMetadata(held.id, generation, { note: '不应复活的旧草稿' })).toBe(false);
    expect(live()).toEqual(local); expect(hasUnsavedWorkspace()).toBe(true);
  });

  it('requires fresh resolution after another tab saves during overwrite confirmation', async () => {
    const { stored, local, other } = await conflicted();
    const newer = await other.saveWorkspace(snapshot(8), workspaceVersion(stored));
    await workspaceStore.getState().resolveWorkspaceConflict('fixture', 'overwrite', workspaceVersion(stored));
    expect(await other.loadWorkspace('fixture')).toEqual(newer);
    expect(live()).toEqual(local);
    expect(workspaceStore.getState().conflict?.version).toBe(workspaceVersion(newer));
    // A delayed click with the old consent cannot overwrite the updated conflict.
    await workspaceStore.getState().resolveWorkspaceConflict('fixture', 'overwrite', workspaceVersion(stored));
    expect(await other.loadWorkspace('fixture')).toEqual(newer);
    await workspaceStore.getState().resolveWorkspaceConflict('fixture', 'overwrite', workspaceVersion(newer));
    expect((await other.loadWorkspace('fixture'))?.currentPage).toBe(2);
  });

  it('retains conflict and live work on failed overwrite, then retries with the same valid consent', async () => {
    const { port, stored, local, other } = await conflicted();
    const fault = () => { throw new Error('Synthetic write interruption'); };
    port.workspaces.hook('updating', fault);
    await workspaceStore.getState().resolveWorkspaceConflict('fixture', 'overwrite', workspaceVersion(stored));
    expect(await other.loadWorkspace('fixture')).toEqual(stored);
    expect(live()).toEqual(local);
    expect(workspaceStore.getState()).toMatchObject({ status: 'error', errorOperation: 'conflict' });
    expect(hasUnsavedWorkspace()).toBe(true);
    port.workspaces.hook('updating').unsubscribe(fault);
    await workspaceStore.getState().resolveWorkspaceConflict('fixture', 'overwrite', workspaceVersion(stored));
    expect(workspaceStore.getState().conflict).toBeNull();
    expect(hasUnsavedWorkspace()).toBe(false);
  });

  it('cannot blindly replace an unread snapshot when the comparison read still fails', async () => {
    const { service, other, original } = await setup();
    vi.spyOn(service, 'loadWorkspace').mockRejectedValue(new Error('Comparison read unavailable'));
    const save = vi.spyOn(service, 'saveWorkspace');
    await workspaceStore.getState().restoreWorkspace('fixture');
    bookStore.getState().setCurrentPage(2);
    await workspaceStore.getState().saveWorkspace('fixture', { replaceUnrestored: true });
    expect(save).not.toHaveBeenCalled();
    expect(await other.loadWorkspace('fixture')).toEqual(original);
    expect(bookStore.getState().currentPage).toBe(2);
    expect(workspaceStore.getState().unrestoredDocumentId).toBe('fixture');
  });

  it.each(['fixture', 'different'])('does not apply a delayed conflict reload to a new opening of %s', async documentId => {
    const { stored, service, local } = await conflicted();
    const gate = deferred();
    vi.spyOn(service, 'loadWorkspace').mockImplementationOnce(async () => { await gate.promise; return stored; });
    const loading = track(workspaceStore.getState().resolveWorkspaceConflict('fixture', 'reload', workspaceVersion(stored)));
    bookStore.getState().reset(); workspaceStore.getState().reset();
    bookStore.getState().setDocumentReady({ documentId, totalPages: 20, initialPage: 11 });
    gate.resolve(); await loading;
    expect(bookStore.getState().currentPage).toBe(11);
    expect(workspaceStore.getState().conflict).toBeNull();
    expect(local.page).toBe(2);
  });
});
