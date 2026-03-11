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
const pendingHoldPages = new Set<number>();

function createDefaultName(pageNumber: number): string {
  return `Page ${pageNumber}`;
}

function sanitizeLinkedWindowIds(linkedWindowIds: string[]): string[] {
  return Array.from(new Set(linkedWindowIds));
}

export const useHeldStore = create<HeldStoreState>((set) => ({
  ...initialState,
  holdPage: async (pageNumber) => {
    if (pendingHoldPages.has(pageNumber)) {
      return;
    }

    const existingPage = useHeldStore.getState().pages.find((page) => page.pageNumber === pageNumber);

    if (existingPage) {
      return;
    }

    pendingHoldPages.add(pageNumber);

    const thumbnailKey = thumbnailService.getThumbnailKey(pageNumber);

    set((state) => ({
      pages: state.pages.some((page) => page.pageNumber === pageNumber)
        ? state.pages
        : [
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

    try {
      await thumbnailService.ensureThumbnail(pageNumber);
    } catch {
      // Thumbnail warmup is best effort only.
    } finally {
      pendingHoldPages.delete(pageNumber);
    }
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
    pendingHoldPages.clear();
    set(() => ({
      ...initialState,
    }));
  },
  restorePages: (pages) => {
    set(() => ({
      pages: Array.from(new Map(
        pages.map((page) => {
          const linkedWindowIds = sanitizeLinkedWindowIds(page.linkedWindowIds ?? []);

          return [page.pageNumber, {
            ...page,
            isOpen: linkedWindowIds.length > 0,
            linkedWindowIds,
          }];
        }),
      ).values()),
    }));
  },
  unholdPage: (pageNumber) => {
    pendingHoldPages.delete(pageNumber);
    set((state) => ({
      pages: state.pages.filter((page) => page.pageNumber !== pageNumber),
    }));
  },
}));

export const heldStore = useHeldStore;
