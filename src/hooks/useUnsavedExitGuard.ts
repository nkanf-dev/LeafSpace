import { useLayoutEffect } from 'react';
import { bookStore } from '../stores/bookStore';
import { heldStore } from '../stores/heldStore';
import { windowStore } from '../stores/windowStore';
import { hasUnsavedWorkspace, workspaceStore } from '../stores/workspaceStore';

/** A warning only. Async IndexedDB work cannot be guaranteed during unload. */
export function useUnsavedExitGuard() {
  useLayoutEffect(() => {
    let listening = false;
    const warn = (event: BeforeUnloadEvent) => {
      if (!hasUnsavedWorkspace()) return;
      event.preventDefault();
      event.returnValue = ' '; // Legacy fallback; browsers supply their own text.
    };
    const sync = () => {
      const needed = hasUnsavedWorkspace();
      if (needed === listening) return;
      listening = needed;
      if (needed) window.addEventListener('beforeunload', warn);
      else window.removeEventListener('beforeunload', warn);
    };
    const unsubscribe = [bookStore, heldStore, windowStore, workspaceStore].map(store => store.subscribe(sync));
    sync();
    return () => {
      unsubscribe.forEach(stop => stop());
      window.removeEventListener('beforeunload', warn);
    };
  }, []);
}
