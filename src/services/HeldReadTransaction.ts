import { bookStore } from '../stores/bookStore';
import { windowStore } from '../stores/windowStore';
import { notifyReaderNavigation, subscribeReaderNavigation } from './readerNavigationIntent';

export interface PreparedHeldRead {
  commit(): boolean;
  rollback(): boolean;
  dispose(): void;
}

/** One click sequence owns only its originating reader, never a whole workspace. */
export function prepareHeldRead(pageNumber: number): PreparedHeldRead {
  const windowId = windowStore.getState().activeWindowId ?? 'main';
  const origin = windowStore.getState().windows.find(window => window.id === windowId);
  const book = bookStore.getState();
  if (!origin || !book.documentId || book.status !== 'ready') {
    return { commit: () => false, rollback: () => false, dispose: () => undefined };
  }
  // The click expresses intent now, before the double-click grace period.
  // An older deferred PDF link must not invalidate this newer prepared read.
  notifyReaderNavigation(windowId);
  const position = { pageNumber: origin.pageNumber, title: origin.title,
    viewport: { ...origin.viewport, scale: windowId === 'main' ? book.scale : origin.viewport?.scale ?? 1 } };
  const signature = (): readonly unknown[] => {
    const currentBook = bookStore.getState();
    const state = windowStore.getState();
    const window = state.windows.find(candidate => candidate.id === windowId);
    return [currentBook.documentId, currentBook.sessionId, currentBook.documentUrl, currentBook.status, state.activeWindowId, !!window,
      window?.pageNumber, windowId === 'main' ? currentBook.scale : window?.viewport?.scale ?? 1,
      window?.viewport?.mode ?? 'grab', window?.viewport?.scrollLeft ?? 0, window?.viewport?.scrollTop ?? 0];
  };
  let expected = signature();
  let stage: 'pending' | 'committed' | 'disposed' = 'pending';
  let writing = false;
  let navigated = false;
  let unsubscribeBook = () => {};
  let unsubscribeWindows = () => {};
  let unsubscribeNavigation = () => {};
  const current = () => signature().every((value, index) => Object.is(value, expected[index]));
  const dispose = () => {
    stage = 'disposed';
    unsubscribeBook(); unsubscribeWindows(); unsubscribeNavigation();
  };
  const invalidate = () => { if (!writing && !current()) dispose(); };
  unsubscribeBook = bookStore.subscribe(invalidate);
  unsubscribeWindows = windowStore.subscribe(invalidate);
  unsubscribeNavigation = subscribeReaderNavigation(id => { if (id === windowId && !writing) dispose(); });
  return {
    commit: () => {
      if (stage !== 'pending' || !current()) { dispose(); return false; }
      writing = true;
      try {
        if (origin.pageNumber !== pageNumber) windowStore.getState().updateWindow(windowId, { pageNumber });
        navigated = windowStore.getState().windows.find(window => window.id === windowId)?.pageNumber !== position.pageNumber;
        expected = signature();
        stage = 'committed';
        return true;
      } finally { writing = false; }
    },
    rollback: () => {
      const restore = stage === 'committed' && navigated && current();
      dispose();
      if (restore) windowStore.getState().restoreWindowPosition(windowId, position);
      return restore;
    },
    dispose,
  };
}
