import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PersistenceService } from '../../services/PersistenceService';
import { bookStore } from '../../stores/bookStore';
import { heldStore } from '../../stores/heldStore';
import { windowStore } from '../../stores/windowStore';
import { configureWorkspaceStoreDependencies, hasUnsavedWorkspace, resetWorkspaceStoreDependencies, workspaceStore } from '../../stores/workspaceStore';
import type { WorkspaceSnapshot } from '../../types/domain';

vi.mock('../../services/ThumbnailService', () => ({ thumbnailService: { activateDocument: vi.fn(), releaseDocument: vi.fn(),
  ensureThumbnail: vi.fn().mockResolvedValue(undefined), getThumbnailKey: (page: number) => `fixture_${page}` } }));

const finish: (() => void)[] = [];
const pending: Promise<void>[] = [];
function deferred() {
  let resolve!: () => void, reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  finish.push(resolve);
  return { promise, resolve, reject };
}
function track(promise: Promise<void>) { pending.push(promise); return promise; }
function ready() { bookStore.getState().setDocumentReady({ documentId: 'fixture', totalPages: 20 }); }
function dependencies() {
  const service = new PersistenceService();
  const save = vi.spyOn(service, 'saveWorkspace').mockImplementation(async snapshot => snapshot);
  const register = vi.spyOn(service, 'saveBookAsset').mockResolvedValue(undefined);
  vi.spyOn(service, 'loadWorkspace').mockResolvedValue(null);
  const recent = vi.spyOn(service, 'listRecentBooks').mockResolvedValue([]);
  configureWorkspaceStoreDependencies({ persistenceService: service });
  return { save, register, recent };
}
async function initial() {
  const result = dependencies(); ready();
  await workspaceStore.getState().restoreWorkspace('fixture');
  expect(hasUnsavedWorkspace()).toBe(false);
  return result;
}

describe('session-owned exit state', () => {
  beforeEach(() => { bookStore.getState().reset(); heldStore.getState().reset(); windowStore.getState().reset(); workspaceStore.getState().reset(); });
  afterEach(async () => {
    finish.splice(0).forEach(resolve => resolve());
    await Promise.allSettled(pending.splice(0));
    vi.restoreAllMocks(); resetWorkspaceStoreDependencies();
  });

  it.each(['page', 'scale', 'held', 'window', 'viewport', 'active'] as const)('tracks a new %s revision independently of autosave eligibility', async field => {
    await initial();
    if (field === 'page') bookStore.getState().setCurrentPage(2);
    if (field === 'scale') bookStore.getState().setScale(1.4);
    if (field === 'held') await heldStore.getState().holdPage(3);
    if (field === 'window') windowStore.getState().openInNewWindow(4);
    if (field === 'viewport') windowStore.getState().updateWindow('main', { viewport: { scrollLeft: 12, scrollTop: 34, scale: 1, mode: 'grab' } });
    if (field === 'active') {
      const id = windowStore.getState().openInNewWindow(4);
      await workspaceStore.getState().saveWorkspace('fixture');
      expect(windowStore.getState().activeWindowId).toBe(id);
      windowStore.getState().setActiveWindow('main');
    }
    expect(hasUnsavedWorkspace()).toBe(true);
    await workspaceStore.getState().saveWorkspace('fixture');
    expect(hasUnsavedWorkspace()).toBe(false);
  });

  it('does not bless edits made while the captured snapshot is being written', async () => {
    const { save } = await initial(); const write = deferred();
    save.mockImplementationOnce(snapshot => write.promise.then(() => snapshot));
    bookStore.getState().setCurrentPage(2);
    const saving = track(workspaceStore.getState().saveWorkspace('fixture'));
    await vi.waitFor(() => expect(save).toHaveBeenCalledOnce());
    bookStore.getState().setCurrentPage(3);
    write.resolve(); await saving;
    expect(workspaceStore.getState().unconfirmedSave).toBeNull();
    expect(hasUnsavedWorkspace()).toBe(true);
    await workspaceStore.getState().saveWorkspace('fixture');
    expect(hasUnsavedWorkspace()).toBe(false);
    expect(save.mock.lastCall?.[0]).not.toHaveProperty('sessionId');
    expect(save.mock.lastCall?.[0]).not.toHaveProperty('exitBaseline');
  });

  it('keeps a queued edit guarded even if the live reader returns to the old baseline', async () => {
    const { save } = await initial(); const write = deferred();
    save.mockImplementationOnce(snapshot => write.promise.then(() => snapshot));
    bookStore.getState().setCurrentPage(2);
    const saving = track(workspaceStore.getState().saveWorkspace('fixture'));
    bookStore.getState().setCurrentPage(1);
    expect(hasUnsavedWorkspace()).toBe(true);
    write.resolve(); await saving;
    expect(hasUnsavedWorkspace()).toBe(true); // Durable page 2 now differs from live page 1.
    await workspaceStore.getState().saveWorkspace('fixture');
    expect(hasUnsavedWorkspace()).toBe(false);
  });

  it('advances the older durable baseline without clearing a newer queued request or its failure', async () => {
    const { save } = await initial(); const firstWrite = deferred(), secondWrite = deferred();
    save.mockImplementationOnce(snapshot => firstWrite.promise.then(() => snapshot)).mockImplementationOnce(snapshot => secondWrite.promise.then(() => snapshot));
    bookStore.getState().setCurrentPage(2);
    const first = track(workspaceStore.getState().saveWorkspace('fixture'));
    await vi.waitFor(() => expect(save).toHaveBeenCalledOnce());
    bookStore.getState().setCurrentPage(3);
    const second = track(workspaceStore.getState().saveWorkspace('fixture'));
    const latestOwner = workspaceStore.getState().unconfirmedSave;
    firstWrite.resolve(); await first;
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(JSON.parse(workspaceStore.getState().exitBaseline!.signature)[0]).toBe(2);
    expect(workspaceStore.getState().unconfirmedSave).toBe(latestOwner);
    bookStore.getState().setCurrentPage(2);
    secondWrite.reject(new Error('Metadata may have failed after the write')); await second;
    expect(hasUnsavedWorkspace()).toBe(true);
    workspaceStore.getState().clearError();
    expect(hasUnsavedWorkspace()).toBe(true);
    expect(save).toHaveBeenCalledTimes(2);
    await workspaceStore.getState().saveWorkspace('fixture');
    expect(hasUnsavedWorkspace()).toBe(false);
  });

  it('retains an uncertain save warning even when a method rejects after writing the snapshot', async () => {
    const { save } = await initial(); let durable: WorkspaceSnapshot | null = null;
    save.mockImplementationOnce(async snapshot => { durable = snapshot; throw new Error('Metadata update failed'); });
    bookStore.getState().setCurrentPage(2);
    await workspaceStore.getState().saveWorkspace('fixture');
    expect(durable).toMatchObject({ currentPage: 2 });
    bookStore.getState().setCurrentPage(1);
    expect(hasUnsavedWorkspace()).toBe(true);
    await workspaceStore.getState().hydrateRecentBooks(); workspaceStore.getState().clearError();
    expect(hasUnsavedWorkspace()).toBe(true);
    expect(save).toHaveBeenCalledOnce();
    await workspaceStore.getState().saveWorkspace('fixture');
    expect(hasUnsavedWorkspace()).toBe(false);
  });

  it('keeps the second same-session PDF registration pending when the first source finishes', async () => {
    const { register } = await initial(); const firstWrite = deferred(), secondWrite = deferred();
    register.mockImplementationOnce(() => firstWrite.promise).mockImplementationOnce(() => secondWrite.promise);
    const first = track(workspaceStore.getState().registerCurrentBook(new File(['first'], 'first.pdf')));
    await vi.waitFor(() => expect(register).toHaveBeenCalledOnce());
    const second = track(workspaceStore.getState().registerCurrentBook(new File(['second'], 'second.pdf')));
    const secondOwner = workspaceStore.getState().pendingPdf;
    firstWrite.resolve(); await first;
    await vi.waitFor(() => expect(register).toHaveBeenCalledTimes(2));
    expect(workspaceStore.getState().pendingPdf).toBe(secondOwner);
    expect(hasUnsavedWorkspace()).toBe(true);
    secondWrite.resolve(); await second;
    expect(workspaceStore.getState().pendingPdf).toBeNull();
    expect(hasUnsavedWorkspace()).toBe(false);
  });

  it('clears confirmed PDF ownership even when a queued snapshot has advanced request generation', async () => {
    const { register, save } = await initial(); const assetWrite = deferred(), snapshotWrite = deferred();
    register.mockImplementationOnce(() => assetWrite.promise); save.mockImplementationOnce(snapshot => snapshotWrite.promise.then(() => snapshot));
    const registration = track(workspaceStore.getState().registerCurrentBook(new File(['asset'], 'asset.pdf')));
    await vi.waitFor(() => expect(register).toHaveBeenCalledOnce());
    const saving = track(workspaceStore.getState().saveWorkspace('fixture'));
    assetWrite.resolve(); await registration;
    await vi.waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(workspaceStore.getState().pendingPdf).toBeNull();
    expect(workspaceStore.getState().unconfirmedSave).not.toBeNull();
    expect(hasUnsavedWorkspace()).toBe(true);
    snapshotWrite.resolve(); await saving;
    expect(hasUnsavedWorkspace()).toBe(false);
    expect(register).toHaveBeenCalledOnce();
  });

  it('does not let a retired source clear a same-fingerprint reopening source', async () => {
    const { register } = await initial(); const oldWrite = deferred(), newWrite = deferred();
    register.mockImplementationOnce(() => oldWrite.promise).mockImplementationOnce(() => newWrite.promise);
    const old = track(workspaceStore.getState().registerCurrentBook(new File(['old'], 'old.pdf')));
    await vi.waitFor(() => expect(register).toHaveBeenCalledOnce());
    const oldSession = bookStore.getState().sessionId;
    bookStore.getState().reset(); workspaceStore.getState().reset(); ready();
    expect(bookStore.getState().sessionId).toBeGreaterThan(oldSession);
    await workspaceStore.getState().restoreWorkspace('fixture');
    const current = track(workspaceStore.getState().registerCurrentBook(new File(['new'], 'new.pdf')));
    const currentOwner = workspaceStore.getState().pendingPdf;
    oldWrite.resolve(); await old;
    await vi.waitFor(() => expect(register).toHaveBeenCalledTimes(2));
    expect(workspaceStore.getState().pendingPdf).toBe(currentOwner);
    expect(hasUnsavedWorkspace()).toBe(true);
    newWrite.resolve(); await current;
    expect(hasUnsavedWorkspace()).toBe(false);
  });

  it('does not publish an old same-fingerprint write into the new session baseline or request owner', async () => {
    const { save } = await initial(); const oldWrite = deferred(), newWrite = deferred();
    save.mockImplementationOnce(snapshot => oldWrite.promise.then(() => snapshot)).mockImplementationOnce(snapshot => newWrite.promise.then(() => snapshot));
    bookStore.getState().setCurrentPage(2);
    const old = track(workspaceStore.getState().saveWorkspace('fixture'));
    await vi.waitFor(() => expect(save).toHaveBeenCalledOnce());
    bookStore.getState().reset(); workspaceStore.getState().reset(); ready();
    await workspaceStore.getState().restoreWorkspace('fixture');
    const baseline = workspaceStore.getState().exitBaseline;
    bookStore.getState().setCurrentPage(3);
    const current = track(workspaceStore.getState().saveWorkspace('fixture'));
    const currentOwner = workspaceStore.getState().unconfirmedSave;
    oldWrite.resolve(); await old;
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(workspaceStore.getState().exitBaseline).toBe(baseline);
    expect(workspaceStore.getState().unconfirmedSave).toBe(currentOwner);
    expect(hasUnsavedWorkspace()).toBe(true);
    newWrite.resolve(); await current;
    expect(hasUnsavedWorkspace()).toBe(false);
    // The guard does not cancel existing queued I/O; it only rejects stale metadata.
    expect(save.mock.calls.map(call => call[0].currentPage)).toEqual([2, 3]);
  });
});
