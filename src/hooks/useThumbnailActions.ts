import { useLayoutEffect, useState, useSyncExternalStore } from 'react';
import { ThumbnailActions } from '../services/ThumbnailActions';
import { bookStore } from '../stores/bookStore';
import { windowStore } from '../stores/windowStore';
import { heldStore } from '../stores/heldStore';
import { quickFlipStore } from '../stores/quickFlipStore';

function readingIdentity() {
  const book = bookStore.getState();
  const windows = windowStore.getState();
  const active = windows.windows.find(window => window.id === windows.activeWindowId);
  const viewport = active?.viewport;
  return JSON.stringify([book.documentId, book.documentUrl, book.status, windows.activeWindowId,
    active?.type === 'main' ? book.currentPage : active?.pageNumber,
    active?.type === 'main' ? book.scale : viewport?.scale ?? 1,
    viewport?.mode ?? 'grab', viewport?.scrollLeft ?? 0, viewport?.scrollTop ?? 0,
    quickFlipStore.getState().isOpen, heldStore.getState().pages.map(page => [page.id, page.pageNumber])]);
}

export function useThumbnailActions(surfaceContext: string) {
  const [controller] = useState(() => new ThumbnailActions());
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  useLayoutEffect(() => { controller.invalidate(); }, [controller, surfaceContext]);
  useLayoutEffect(() => {
    let identity = readingIdentity();
    let readingRevision = 0;
    const changed = () => {
      const next = readingIdentity();
      if (next !== identity) { identity = next; readingRevision += 1; controller.invalidate(); }
    };
    const subscriptions = [bookStore.subscribe(changed), windowStore.subscribe(changed), heldStore.subscribe(changed), quickFlipStore.subscribe(changed)];
    const interrupt = () => { controller.noteFocusIntent(); controller.invalidate(); };
    const resize = () => {
      const revision = readingRevision;
      controller.recoverAfterLayout(() => revision === readingRevision);
    };
    const hidden = () => { if (document.hidden) interrupt(); };
    const escape = (event: KeyboardEvent) => {
      controller.noteFocusIntent();
      if (!controller.ownsInput() || event.key !== 'Escape') return;
      event.preventDefault(); event.stopImmediatePropagation(); controller.dismiss();
    };
    window.addEventListener('keydown', escape, true);
    window.addEventListener('focusin', controller.noteFocusIntent, true);
    window.addEventListener('pointerdown', controller.pointerDown, true);
    window.addEventListener('pointerup', controller.pointerEnd, true);
    window.addEventListener('pointercancel', controller.pointerEnd, true);
    window.addEventListener('click', controller.consumeClick, true);
    window.addEventListener('dblclick', controller.consumeClick, true);
    window.addEventListener('contextmenu', controller.consumeContextMenu, true);
    window.addEventListener('blur', interrupt);
    window.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      subscriptions.forEach(unsubscribe => unsubscribe());
      window.removeEventListener('keydown', escape, true);
      window.removeEventListener('focusin', controller.noteFocusIntent, true);
      window.removeEventListener('pointerdown', controller.pointerDown, true);
      window.removeEventListener('pointerup', controller.pointerEnd, true);
      window.removeEventListener('pointercancel', controller.pointerEnd, true);
      window.removeEventListener('click', controller.consumeClick, true);
      window.removeEventListener('dblclick', controller.consumeClick, true);
      window.removeEventListener('contextmenu', controller.consumeContextMenu, true);
      window.removeEventListener('blur', interrupt);
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', hidden);
      controller.dispose();
    };
  }, [controller]);
  return { controller, ...state, isOpen: state.request !== null };
}
