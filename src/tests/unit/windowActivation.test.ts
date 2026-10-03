import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bookStore } from '../../stores/bookStore';
import { windowStore } from '../../stores/windowStore';

vi.mock('../../services/ThumbnailService', () => ({ thumbnailService: { activateDocument: vi.fn(), releaseDocument: vi.fn() } }));
describe('window activation identity', () => {
  beforeEach(() => { bookStore.getState().reset(); windowStore.getState().reset(); });
  it('preserves root, array and pane identities without notifying for an already-normalized active pane', () => {
    const reference = windowStore.getState().openInNewWindow(4);
    const before = windowStore.getState(); const notify = vi.fn(); const unsubscribe = windowStore.subscribe(notify);
    try {
      windowStore.getState().setActiveWindow(reference);
      expect(windowStore.getState()).toBe(before); expect(windowStore.getState().windows).toBe(before.windows);
      expect(notify).not.toHaveBeenCalled();
    } finally { unsubscribe(); }
  });
  it('ignores missing ids and still repairs inconsistent flags for the same active id', () => {
    const reference = windowStore.getState().openInNewWindow(4);
    const before = windowStore.getState(); windowStore.getState().setActiveWindow('missing'); expect(windowStore.getState()).toBe(before);
    windowStore.setState({ windows: before.windows.map(win => ({ ...win, isActive: true })) });
    windowStore.getState().setActiveWindow(reference);
    expect(windowStore.getState().windows.filter(win => win.isActive).map(win => win.id)).toEqual([reference]);
  });
  it('changes genuine active ownership once and retains restored-state normalization', () => {
    const reference = windowStore.getState().openInNewWindow(4);
    const notify = vi.fn(); const unsubscribe = windowStore.subscribe(notify);
    try { windowStore.getState().setActiveWindow('main'); expect(notify).toHaveBeenCalledTimes(1); } finally { unsubscribe(); }
    const windows = windowStore.getState().windows.map(win => ({ ...win, isActive: false }));
    windowStore.getState().restoreWindows(windows, reference);
    expect(windowStore.getState().activeWindowId).toBe(reference);
    expect(windowStore.getState().windows.filter(win => win.isActive).map(win => win.id)).toEqual([reference]);
  });
});
