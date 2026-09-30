import { useEffect, useRef } from 'react';
import type { HeldPage, ReaderWindow } from '../types/domain';

interface WorkspaceAutoSaveInput {
  documentId: string | null;
  currentPage: number;
  scale: number;
  heldPages: HeldPage[];
  windows: ReaderWindow[];
  activeWindowId: string | null;
  enabled: boolean;
  saveWorkspace: (documentId: string) => Promise<void>;
}

/** Debounce reading changes, not the saving/idle status cycle of persistence. */
export function useWorkspaceAutoSave({
  documentId, currentPage, scale, heldPages, windows, activeWindowId, enabled, saveWorkspace,
}: WorkspaceAutoSaveInput) {
  const lastAttempt = useRef<readonly unknown[] | null>(null);

  useEffect(() => {
    if (!documentId) {
      lastAttempt.current = null;
      return;
    }
    if (!enabled) return;

    const revision = [documentId, currentPage, scale, heldPages, windows, activeWindowId];
    if (lastAttempt.current?.every((value, index) => Object.is(value, revision[index]))) return;

    const timer = window.setTimeout(() => {
      // Mark this revision before saving: returning to idle must not save it again.
      // Failed saves stay available through the explicit Save action, without a retry loop.
      lastAttempt.current = revision;
      void saveWorkspace(documentId);
    }, 500);

    return () => window.clearTimeout(timer);
  }, [documentId, currentPage, scale, heldPages, windows, activeWindowId, enabled, saveWorkspace]);
}
