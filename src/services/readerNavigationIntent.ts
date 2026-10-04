type NavigationListener = (windowId: string) => void;
const listeners = new Set<NavigationListener>();

/** Explicit page choices are intent even when clamping keeps the same page.
 * This transient signal never enters a saved workspace or dirties autosave. */
export function notifyReaderNavigation(windowId: string): void {
  for (const listener of listeners) listener(windowId);
}

export function subscribeReaderNavigation(listener: NavigationListener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
