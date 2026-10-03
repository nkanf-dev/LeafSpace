import { StrictMode, type ComponentProps } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useUnsavedExitGuard } from '../../hooks/useUnsavedExitGuard';
import { PersistenceService } from '../../services/PersistenceService';
import { bookStore } from '../../stores/bookStore';
import { heldStore } from '../../stores/heldStore';
import { windowStore } from '../../stores/windowStore';
import { configureWorkspaceStoreDependencies, resetWorkspaceStoreDependencies, workspaceStore } from '../../stores/workspaceStore';

vi.mock('../../services/ThumbnailService', () => ({ thumbnailService: { activateDocument: vi.fn(), releaseDocument: vi.fn(),
  ensureThumbnail: vi.fn().mockResolvedValue(undefined), getThumbnailKey: () => 'fixture' } }));
function blocked() {
  const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented;
}
async function initial() {
  const service = new PersistenceService();
  const save = vi.spyOn(service, 'saveWorkspace').mockResolvedValue(undefined);
  const restore = vi.spyOn(service, 'loadWorkspace').mockResolvedValue(null);
  const register = vi.spyOn(service, 'saveBookAsset').mockResolvedValue(undefined); vi.spyOn(service, 'listRecentBooks').mockResolvedValue([]);
  configureWorkspaceStoreDependencies({ persistenceService: service });
  bookStore.getState().setDocumentReady({ documentId: 'fixture', totalPages: 20 });
  await workspaceStore.getState().restoreWorkspace('fixture'); return { save, restore, register };
}
describe('conditional browser exit warning', () => {
  beforeEach(() => { bookStore.getState().reset(); heldStore.getState().reset(); windowStore.getState().reset(); workspaceStore.getState().reset(); });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); resetWorkspaceStoreDependencies(); });

  it('has no clean listener, observes store changes synchronously, and never saves at exit', async () => {
    const { save, restore, register } = await initial(); const add = vi.spyOn(window, 'addEventListener');
    renderHook(useUnsavedExitGuard);
    expect(add.mock.calls.filter(call => call[0] === 'beforeunload')).toHaveLength(0);
    expect(blocked()).toBe(false);
    act(() => bookStore.getState().setCurrentPage(2));
    expect(blocked()).toBe(true);
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    for (let attempt = 0; attempt < 3; attempt++) expect(blocked()).toBe(true);
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));
      window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    });
    expect(blocked()).toBe(true);
    expect(bookStore.getState().currentPage).toBe(2);
    expect(save).not.toHaveBeenCalled();
    expect(restore).toHaveBeenCalledOnce();
    expect(register).not.toHaveBeenCalled();
    await act(async () => { await workspaceStore.getState().saveWorkspace('fixture'); });
    expect(blocked()).toBe(false);
  });

  it('cleans up StrictMode subscriptions and the listener through save, re-edit and unmount', async () => {
    await initial(); bookStore.getState().setCurrentPage(2);
    const add = vi.spyOn(window, 'addEventListener'), remove = vi.spyOn(window, 'removeEventListener');
    const count = () => add.mock.calls.filter(call => call[0] === 'beforeunload').length - remove.mock.calls.filter(call => call[0] === 'beforeunload').length;
    const wrapper = ({ children }: ComponentProps<typeof StrictMode>) => <StrictMode>{children}</StrictMode>;
    const hook = renderHook(useUnsavedExitGuard, { wrapper });
    expect(blocked()).toBe(true); expect(count()).toBe(1);
    hook.rerender(); expect(count()).toBe(1);
    await act(async () => { await workspaceStore.getState().saveWorkspace('fixture'); });
    expect(blocked()).toBe(false); expect(count()).toBe(0);
    act(() => bookStore.getState().setScale(1.5));
    expect(blocked()).toBe(true); expect(count()).toBe(1);
    hook.unmount(); expect(blocked()).toBe(false); expect(count()).toBe(0);
    const calls = add.mock.calls.length;
    bookStore.getState().setCurrentPage(3); workspaceStore.getState().clearError();
    expect(add.mock.calls).toHaveLength(calls);
  });

  it('removes the old session warning immediately when the reader is retired', async () => {
    await initial(); renderHook(useUnsavedExitGuard);
    act(() => bookStore.getState().setCurrentPage(2)); expect(blocked()).toBe(true);
    act(() => bookStore.getState().reset()); expect(blocked()).toBe(false);
    expect(workspaceStore.getState().exitBaseline).toBeNull();
    act(() => bookStore.getState().setDocumentReady({ documentId: 'fixture', totalPages: 20 }));
    expect(blocked()).toBe(false);
  });
});
