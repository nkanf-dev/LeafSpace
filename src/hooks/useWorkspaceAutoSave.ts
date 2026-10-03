import { useEffect, useLayoutEffect, useRef } from 'react';
import type { HeldPage, ReaderWindow, WorkspaceSnapshot } from '../types/domain';

interface WorkspaceAutoSaveRevision {
  documentId: string | null;
  sessionId: number;
  currentPage: number;
  scale: number;
  heldPages: HeldPage[];
  windows: ReaderWindow[];
  activeWindowId: string | null;
  enabled: boolean;
}

interface WorkspaceAutoSaveInput extends WorkspaceAutoSaveRevision {
  currentSnapshot: WorkspaceSnapshot | null;
  readCurrent: () => WorkspaceAutoSaveRevision;
  saveWorkspace: (documentId: string) => Promise<void>;
}

/** Debounce visible reading changes; attempt eligible pending changes when hidden. */
export function useWorkspaceAutoSave({
  documentId, sessionId, currentPage, scale, heldPages, windows, activeWindowId,
  enabled, currentSnapshot, readCurrent, saveWorkspace,
}: WorkspaceAutoSaveInput) {
  const lastAttempt = useRef<readonly unknown[] | null>(null);
  const readCurrentRef = useRef(readCurrent);
  useLayoutEffect(() => { readCurrentRef.current = readCurrent; }, [readCurrent]);

  useEffect(() => {
    if (!documentId) {
      lastAttempt.current = null;
      return;
    }
    let timer: number | undefined;
    const cancelTimer = () => { window.clearTimeout(timer); timer = undefined; };
    const attempt = () => {
      // A lifecycle event can precede React's next commit. Check the live owner,
      // barriers and revision that saveWorkspace will capture, never stale props.
      const current = readCurrentRef.current();
      if (!current.enabled || current.documentId !== documentId || current.sessionId !== sessionId) return;
      const revision = [documentId, sessionId, current.currentPage, current.scale,
        current.heldPages, current.windows, current.activeWindowId];
      if (lastAttempt.current?.every((value, index) => Object.is(value, revision[index]))) return;
      // Record before saving. An unchanged failure requires an explicit retry.
      lastAttempt.current = revision;
      void saveWorkspace(documentId);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState !== 'hidden') return;
      cancelTimer();
      attempt();
    };
    // Keep listening even if the rendered revision was already attempted: a live
    // reading change may not have committed to React when visibility changes.
    document.addEventListener('visibilitychange', onVisibilityChange);
    if (document.visibilityState === 'hidden') attempt();
    else if (enabled) timer = window.setTimeout(attempt, 500);
    return () => { cancelTimer(); document.removeEventListener('visibilitychange', onVisibilityChange); };
    // A successful write publishes a new snapshot even when batched reading/status
    // updates return to their rendered values. Recheck it, without deduping by it.
  }, [documentId, sessionId, currentPage, scale, heldPages, windows, activeWindowId,
    enabled, currentSnapshot, saveWorkspace]);
}
