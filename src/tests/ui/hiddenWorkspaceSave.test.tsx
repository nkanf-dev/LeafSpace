import { StrictMode, useCallback } from 'react';
import { act, cleanup, render, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkspaceAutoSave } from '../../hooks/useWorkspaceAutoSave';
import { PersistenceService, WorkspaceConflictError } from '../../services/PersistenceService';
import { bookStore, useBookStore } from '../../stores/bookStore';
import { heldStore, useHeldStore } from '../../stores/heldStore';
import { windowStore, useWindowStore } from '../../stores/windowStore';
import { configureWorkspaceStoreDependencies, resetWorkspaceStoreDependencies, useWorkspaceStore, workspaceStore } from '../../stores/workspaceStore';
import type { HeldPage, ReaderWindow, WorkspaceSnapshot } from '../../types/domain';

vi.mock('../../services/ThumbnailService', () => ({ thumbnailService: { activateDocument: vi.fn(), releaseDocument: vi.fn(),
  ensureThumbnail: vi.fn().mockResolvedValue(undefined), getThumbnailKey: () => 'fixture' } }));
interface ReadingInput { documentId: string | null; sessionId: number; currentPage: number; scale: number;
  heldPages: HeldPage[]; windows: ReaderWindow[]; activeWindowId: string | null; enabled: boolean }
function liveState(locked = false): ReadingInput {
  const book = bookStore.getState(), workspace = workspaceStore.getState();
  return { documentId: book.documentId, sessionId: book.sessionId, currentPage: book.currentPage, scale: book.scale,
    heldPages: heldStore.getState().pages, windows: windowStore.getState().windows, activeWindowId: windowStore.getState().activeWindowId,
    enabled: !locked && book.status === 'ready' && workspace.status === 'idle' && workspace.unrestoredDocumentId !== book.documentId && !workspace.conflict };
}
const transition = { current: false };
function Harness() {
  const book = useBookStore(), held = useHeldStore(), windows = useWindowStore(), workspace = useWorkspaceStore();
  const readCurrent = useCallback(() => liveState(transition.current), []);
  const input = { documentId: book.documentId, sessionId: book.sessionId, currentPage: book.currentPage, scale: book.scale,
    heldPages: held.pages, windows: windows.windows, activeWindowId: windows.activeWindowId,
    enabled: !transition.current && book.status === 'ready' && workspace.status === 'idle' && workspace.unrestoredDocumentId !== book.documentId && !workspace.conflict,
    currentSnapshot: workspace.currentSnapshot, readCurrent, saveWorkspace: workspace.saveWorkspace };
  useWorkspaceAutoSave(input);
  return null;
}
let hidden = false;
const releases: (() => void)[] = [];
function deferred() { let resolve!: () => void; const promise = new Promise<void>(yes => { resolve = yes; }); releases.push(resolve); return { promise, resolve }; }
async function tick(milliseconds: number) { await act(async () => { await vi.advanceTimersByTimeAsync(milliseconds); }); }
function hide() { hidden = true; document.dispatchEvent(new Event('visibilitychange')); }
async function prepare() {
  const service = new PersistenceService();
  const written: WorkspaceSnapshot[] = [];
  const save = vi.spyOn(service, 'saveWorkspace').mockImplementation(async snapshot => { written.push(structuredClone(snapshot)); return snapshot; });
  vi.spyOn(service, 'loadWorkspace').mockResolvedValue(null); vi.spyOn(service, 'listRecentBooks').mockResolvedValue([]);
  configureWorkspaceStoreDependencies({ persistenceService: service });
  bookStore.getState().setDocumentReady({ documentId: 'fixture', totalPages: 20, initialPage: 8 });
  await workspaceStore.getState().restoreWorkspace('fixture');
  return { service, save, written };
}
describe('hidden workspace autosave', () => {
  beforeEach(() => {
    vi.useFakeTimers(); hidden = false; transition.current = false;
    vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => hidden ? 'hidden' : 'visible');
    bookStore.getState().reset(); heldStore.getState().reset(); windowStore.getState().reset(); workspaceStore.getState().reset();
  });
  afterEach(async () => {
    cleanup(); await act(async () => { releases.splice(0).forEach(resolve => resolve()); });
    vi.restoreAllMocks(); vi.useRealTimers(); resetWorkspaceStoreDependencies();
  });

  it('starts the pending reading save at hidden without waiting for the remaining debounce', async () => {
    const { save, written } = await prepare(); render(<Harness />); await tick(500);
    expect(written.map(snapshot => snapshot.currentPage)).toEqual([8]);
    act(() => bookStore.getState().setCurrentPage(9)); await tick(200);
    await act(async () => { hide(); });
    expect(written.map(snapshot => snapshot.currentPage)).toEqual([8, 9]);
    await act(async () => { hide(); hide(); }); await tick(2_000);
    expect(save).toHaveBeenCalledTimes(2);
  });

  it('corrects a later rollback after an in-flight hidden save succeeds without another debounce', async () => {
    const { save, written } = await prepare(); render(<Harness />); await tick(500);
    const first = deferred();
    save.mockImplementationOnce(async snapshot => { await first.promise; written.push(structuredClone(snapshot)); return snapshot; });
    act(() => bookStore.getState().setScale(1.5));
    const rollback = () => bookStore.getState().setScale(1);
    document.addEventListener('visibilitychange', rollback);
    try { await act(async () => { hide(); }); } finally { document.removeEventListener('visibilitychange', rollback); }
    expect(save).toHaveBeenCalledTimes(2);
    expect(bookStore.getState().scale).toBe(1);
    await act(async () => { first.resolve(); });
    expect(written.map(snapshot => snapshot.scale)).toEqual([1, 1.5, 1]);
    expect(workspaceStore.getState().currentSnapshot?.scale).toBe(1);
    await tick(1_000); expect(save).toHaveBeenCalledTimes(3);
  });

  it('rechecks a batched rollback when only the confirmed snapshot reference changes', async () => {
    const base: ReadingInput = { documentId: 'batched', sessionId: 1, currentPage: 1, scale: 1,
      heldPages: [], windows: [], activeWindowId: 'main', enabled: true };
    let live = base;
    const saved: number[] = [];
    const saveWorkspace = vi.fn(async () => { saved.push(live.scale); });
    const readCurrent = () => live;
    const snapshot = (scale: number): WorkspaceSnapshot => ({ documentId: 'batched', currentPage: 1, scale,
      heldPages: [], windows: [], activeWindowId: 'main', layoutPreset: 'single', savedAt: '2026-01-01T00:00:00.000Z' });
    const input = { ...base, saveWorkspace, readCurrent, currentSnapshot: snapshot(1) };
    const hook = renderHook(useWorkspaceAutoSave, { initialProps: input });
    const rollback = () => { live = base; };
    document.addEventListener('visibilitychange', rollback);
    live = { ...base, scale: 1.5 }; // Live change before a React commit; rendered props remain A.
    try { await act(async () => { hide(); }); } finally { document.removeEventListener('visibilitychange', rollback); }
    expect(saved).toEqual([1.5]);
    // Deliberately never commit scale B or enabled=false. Only successful save SB changes.
    await act(async () => { hook.rerender({ ...input, currentSnapshot: snapshot(1.5) }); });
    expect(saved).toEqual([1.5, 1]);
    await act(async () => { hook.rerender({ ...input, currentSnapshot: snapshot(1) }); hide(); });
    await tick(1_000); expect(saved).toEqual([1.5, 1]);
  });

  it('does not save a preview rolled back by an earlier hidden listener', async () => {
    const { written } = await prepare();
    const rollback = () => bookStore.getState().setScale(1);
    document.addEventListener('visibilitychange', rollback);
    try {
      render(<Harness />); await tick(500);
      act(() => bookStore.getState().setScale(1.5));
      await act(async () => { hide(); });
      expect(written.map(snapshot => snapshot.scale)).toEqual([1]);
    } finally { document.removeEventListener('visibilitychange', rollback); }
  });

  it('does not retry a failed hidden save or a later rollback until explicit recovery', async () => {
    const { save, written } = await prepare(); render(<Harness />); await tick(500);
    save.mockRejectedValueOnce(new Error('Synthetic hidden failure'));
    act(() => bookStore.getState().setScale(1.5));
    const rollback = () => bookStore.getState().setScale(1);
    document.addEventListener('visibilitychange', rollback);
    try { await act(async () => { hide(); }); } finally { document.removeEventListener('visibilitychange', rollback); }
    expect(workspaceStore.getState().status).toBe('error');
    await act(async () => { hide(); hide(); }); await tick(2_000);
    expect(save).toHaveBeenCalledTimes(2);
    expect(written.map(snapshot => snapshot.scale)).toEqual([1]);
    expect(workspaceStore.getState().unconfirmedSave).not.toBeNull();
    await act(async () => { await workspaceStore.getState().saveWorkspace('fixture'); });
    expect(workspaceStore.getState().status).toBe('idle');
    expect(workspaceStore.getState().currentSnapshot?.scale).toBe(1);
    const count = save.mock.calls.length;
    await act(async () => { hide(); }); await tick(2_000);
    expect(save).toHaveBeenCalledTimes(count);
  });

  it.each(['transition', 'restoring', 'error', 'unrestored'] as const)(
    'reads the live %s barrier before React commits and resumes when safely eligible', async barrier => {
      const { save, written } = await prepare(); const view = render(<Harness />); await tick(500);
      act(() => bookStore.getState().setCurrentPage(9));
      await act(async () => {
        // Keep mutation and lifecycle dispatch in one batch; rendered enabled is stale.
        if (barrier === 'transition') transition.current = true;
        else if (barrier === 'unrestored') workspaceStore.setState({ unrestoredDocumentId: 'fixture' });
        else workspaceStore.setState({ status: barrier });
        hide();
        view.rerender(<Harness />); // App commits its transition UI after the live event.
      });
      await tick(2_000); expect(save).toHaveBeenCalledTimes(1);
      await act(async () => {
        transition.current = false;
        workspaceStore.setState({ status: 'idle', unrestoredDocumentId: null });
        view.rerender(<Harness />);
      });
      expect(written.map(snapshot => snapshot.currentPage)).toEqual([8, 9]);
    },
  );

  it('keeps hidden and debounced saves blocked by conflict ownership even if the status is cleared', async () => {
    const { save, written } = await prepare(); render(<Harness />); await tick(500);
    save.mockRejectedValueOnce(new WorkspaceConflictError({ ...written[0], currentPage: 7, revision: 'other-tab' }));
    act(() => bookStore.getState().setCurrentPage(9));
    await act(async () => { hide(); });
    expect(workspaceStore.getState().conflict).not.toBeNull();
    expect(save).toHaveBeenCalledTimes(2);
    await act(async () => {
      workspaceStore.getState().clearError();
      // The live conflict barrier is independent of error UI status.
      workspaceStore.setState({ status: 'idle', error: null });
      bookStore.getState().setCurrentPage(10);
      hide();
    });
    await tick(2_000);
    expect(save).toHaveBeenCalledTimes(2);
    expect(written.map(snapshot => snapshot.currentPage)).toEqual([8]);
    expect(bookStore.getState().currentPage).toBe(10);
  });

  it('waits for an in-flight write then immediately saves the newer hidden revision', async () => {
    const { save, written } = await prepare(); render(<Harness />); await tick(500);
    const first = deferred();
    save.mockImplementationOnce(async snapshot => { await first.promise; written.push(structuredClone(snapshot)); return snapshot; });
    act(() => bookStore.getState().setCurrentPage(9)); await tick(500);
    expect(save).toHaveBeenCalledTimes(2);
    await act(async () => { bookStore.getState().setCurrentPage(10); hide(); });
    expect(save).toHaveBeenCalledTimes(2);
    await act(async () => { first.resolve(); });
    expect(written.map(snapshot => snapshot.currentPage)).toEqual([8, 9, 10]);
    await tick(2_000); expect(save).toHaveBeenCalledTimes(3);
  });

  it('rejects an old handler when the same fingerprint has a new opening before React commits', async () => {
    const { save, written } = await prepare(); render(<Harness />); await tick(500);
    const firstSession = bookStore.getState().sessionId;
    await act(async () => {
      bookStore.getState().setDocumentReady({ documentId: 'fixture', totalPages: 20, initialPage: 11 });
      expect(bookStore.getState().sessionId).not.toBe(firstSession);
      hide();
      expect(save).toHaveBeenCalledTimes(1); // Old rendered owner cannot save this opening.
    });
    expect(written.map(snapshot => snapshot.currentPage)).toEqual([8, 11]);
  });

  it('does not save for pagehide, pageshow, beforeunload or cleanup', async () => {
    const { save } = await prepare(); const view = render(<Harness />); await tick(500);
    act(() => bookStore.getState().setCurrentPage(9));
    act(() => {
      window.dispatchEvent(new Event('pagehide'));
      window.dispatchEvent(new Event('pageshow'));
      window.dispatchEvent(new Event('beforeunload'));
    });
    expect(save).toHaveBeenCalledTimes(1);
    view.unmount(); await act(async () => { hide(); }); await tick(2_000);
    expect(save).toHaveBeenCalledTimes(1);
  });


  it('attempts once when mounted hidden under StrictMode and removes its hidden listener', async () => {
    const { save } = await prepare(); hidden = true;
    const view = render(<StrictMode><Harness /></StrictMode>);
    await act(async () => {});
    expect(save).toHaveBeenCalledTimes(1);
    view.unmount();
    await act(async () => { bookStore.getState().setCurrentPage(9); hide(); });
    await tick(2_000); expect(save).toHaveBeenCalledTimes(1);
  });

});
