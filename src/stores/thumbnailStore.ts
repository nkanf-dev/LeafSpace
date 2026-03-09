import { create } from 'zustand';

import type { ThumbnailEntry } from '../types/domain';

export interface ThumbnailStoreState {
  entries: Record<string, ThumbnailEntry>;
  lruKeys: string[];
  getEntry: (key: string) => ThumbnailEntry | undefined;
  markError: (key: string) => void;
  markQueued: (entry: Pick<ThumbnailEntry, 'key' | 'pageNumber' | 'width'>) => void;
  markReady: (payload: Pick<ThumbnailEntry, 'key' | 'width' | 'height' | 'blobUrl'>) => void;
  markRendering: (key: string) => void;
  removeEntry: (key: string) => void;
  reset: () => void;
  touchEntry: (key: string) => void;
}

const initialState = {
  entries: {} as Record<string, ThumbnailEntry>,
  lruKeys: [] as string[],
};

function orderKeys(entries: Record<string, ThumbnailEntry>): string[] {
  return Object.values(entries)
    .sort((left, right) => right.lastAccessedAt - left.lastAccessedAt)
    .map((entry) => entry.key);
}

function buildBaseEntry(entry: Pick<ThumbnailEntry, 'key' | 'pageNumber' | 'width'>): ThumbnailEntry {
  return {
    key: entry.key,
    pageNumber: entry.pageNumber,
    width: entry.width,
    height: 0,
    lastAccessedAt: Date.now(),
    status: 'queued',
  };
}

export const useThumbnailStore = create<ThumbnailStoreState>((set, get) => ({
  ...initialState,
  getEntry: (key) => get().entries[key],
  markError: (key) => {
    set((state) => {
      const current = state.entries[key];

      if (!current) {
        return state;
      }

      const nextEntry: ThumbnailEntry = {
        ...current,
        lastAccessedAt: Date.now(),
        status: 'error',
      };
      const entries: Record<string, ThumbnailEntry> = {
        ...state.entries,
        [key]: nextEntry,
      };

      return {
        entries,
        lruKeys: orderKeys(entries),
      };
    });
  },
  markQueued: (entry) => {
    set((state) => {
      const current = state.entries[entry.key];
      const nextEntry: ThumbnailEntry = current
        ? {
            ...current,
            lastAccessedAt: Date.now(),
            pageNumber: entry.pageNumber,
            status: 'queued',
            width: entry.width,
          }
        : buildBaseEntry(entry);
      const entries: Record<string, ThumbnailEntry> = {
        ...state.entries,
        [entry.key]: nextEntry,
      };

      return {
        entries,
        lruKeys: orderKeys(entries),
      };
    });
  },
  markReady: ({ blobUrl, height, key, width }) => {
    set((state) => {
      const current = state.entries[key];

      if (!current) {
        return state;
      }

      const nextEntry: ThumbnailEntry = {
        ...current,
        blobUrl,
        height,
        lastAccessedAt: Date.now(),
        status: 'ready',
        width,
      };
      const entries: Record<string, ThumbnailEntry> = {
        ...state.entries,
        [key]: nextEntry,
      };

      return {
        entries,
        lruKeys: orderKeys(entries),
      };
    });
  },
  markRendering: (key) => {
    set((state) => {
      const current = state.entries[key];

      if (!current) {
        return state;
      }

      const nextEntry: ThumbnailEntry = {
        ...current,
        lastAccessedAt: Date.now(),
        status: 'rendering',
      };
      const entries: Record<string, ThumbnailEntry> = {
        ...state.entries,
        [key]: nextEntry,
      };

      return {
        entries,
        lruKeys: orderKeys(entries),
      };
    });
  },
  removeEntry: (key) => {
    set((state) => {
      const entries = { ...state.entries };
      delete entries[key];

      return {
        entries,
        lruKeys: orderKeys(entries),
      };
    });
  },
  reset: () => {
    set(() => ({
      ...initialState,
    }));
  },
  touchEntry: (key) => {
    set((state) => {
      const current = state.entries[key];

      if (!current) {
        return state;
      }

      const nextEntry: ThumbnailEntry = {
        ...current,
        lastAccessedAt: Date.now(),
      };
      const entries: Record<string, ThumbnailEntry> = {
        ...state.entries,
        [key]: nextEntry,
      };

      return {
        entries,
        lruKeys: orderKeys(entries),
      };
    });
  },
}));

export const thumbnailStore = useThumbnailStore;
