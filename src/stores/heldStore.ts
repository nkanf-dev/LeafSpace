import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';

import { thumbnailService } from '../services/ThumbnailService';
import type { HeldPage } from '../types/domain';

export interface HeldStoreState {
  holdPage: (pageNumber: number) => Promise<void>;
  markHeldPageClosed: (pageNumber: number, windowId: string) => void;
  markHeldPageOpen: (pageNumber: number, windowId: string) => void;
  pages: HeldPage[];
  reorderHeldPages: (fromIndex: number, toIndex: number) => void;
  reset: () => void;
  restorePages: (pages: HeldPage[]) => void;
  unholdPage: (pageNumber: number) => void;
}

const initialState = {
  pages: [] as HeldPage[],
};

function createDefaultName(pageNumber: number): string {
  return `Page ${pageNumber}`;
}

function sanitizeLinkedWindowIds(linkedWindowIds: string[]): string[] {
  return Array.from(new Set(linkedWindowIds));
}

export const useHeldStore = create<HeldStoreState>((set) => ({
  ...initialState,
  holdPage: async (pageNumber) => {
    const existingPage = useHeldStore.getState().pages.find((page) => page.pageNumber === pageNumber);

    if (existingPage) {
      return;
    }

    const thumbnailKey = thumbnailService.getThumbnailKey(pageNumber);

    try {
      await thumbnailService.ensureThumbnail(pageNumber);
    } catch {
      // Thumbnail warmup is best effort only.
    }

    set((state) => ({
      pages: [
        ...state.pages,
        {
          createdAt: new Date().toISOString(),
          defaultName: createDefaultName(pageNumber),
          id: uuidv4(),
          isOpen: false,
          linkedWindowIds: [],
          pageNumber,
          thumbnailKey,
        },
      ],
    }));
  },
  markHeldPageClosed: (pageNumber, windowId) => {
    set((state) => ({
      pages: state.pages.map((page) => {
        if (page.pageNumber !== pageNumber) {
          return page;
        }

        const linkedWindowIds = page.linkedWindowIds.filter((id) => id !== windowId);

        return {
          ...page,
          isOpen: linkedWindowIds.length > 0,
          linkedWindowIds,
        };
      }),
    }));
  },
  markHeldPageOpen: (pageNumber, windowId) => {
    set((state) => ({
      pages: state.pages.map((page) =>
        page.pageNumber === pageNumber
          ? {
              ...page,
              isOpen: true,
              linkedWindowIds: sanitizeLinkedWindowIds([...page.linkedWindowIds, windowId]),
            }
          : page,
      ),
    }));
  },
  reorderHeldPages: (fromIndex, toIndex) => {
    set((state) => {
      if (
        fromIndex < 0 ||
        toIndex < 0 ||
        fromIndex >= state.pages.length ||
        toIndex >= state.pages.length ||
        fromIndex === toIndex
      ) {
        return state;
      }

      const pages = [...state.pages];
      const [movedPage] = pages.splice(fromIndex, 1);
      pages.splice(toIndex, 0, movedPage);

      return { pages };
    });
  },
  reset: () => {
    set(() => ({
      ...initialState,
    }));
  },
  restorePages: (pages) => {
    set(() => ({
      pages: pages.map((page) => {
        const linkedWindowIds = sanitizeLinkedWindowIds(page.linkedWindowIds ?? []);

        return {
          ...page,
          isOpen: linkedWindowIds.length > 0,
          linkedWindowIds,
        };
      }),
    }));
  },
  unholdPage: (pageNumber) => {
    set((state) => ({
      pages: state.pages.filter((page) => page.pageNumber !== pageNumber),
    }));
  },
}));

export const heldStore = useHeldStore;
