import { create } from 'zustand';

import { bookStore } from './bookStore';

export interface QuickFlipStoreState {
  close: () => void;
  commitSelection: () => void;
  isAccelerating: boolean;
  isOpen: boolean;
  open: (pageNumber?: number) => void;
  reset: () => void;
  selectedPage: number;
  setAccelerating: (isAccelerating: boolean) => void;
  setSelectedPage: (pageNumber: number) => void;
  stepSelection: (delta: number) => void;
}

const initialState = {
  isAccelerating: false,
  isOpen: false,
  selectedPage: 1,
};

function clampPage(pageNumber: number): number {
  const totalPages = bookStore.getState().totalPages;

  if (totalPages <= 0) {
    return Math.max(1, Math.round(pageNumber));
  }

  return Math.min(Math.max(1, Math.round(pageNumber)), totalPages);
}

export const useQuickFlipStore = create<QuickFlipStoreState>((set, get) => ({
  ...initialState,
  close: () => {
    set(() => ({
      isAccelerating: false,
      isOpen: false,
    }));
  },
  commitSelection: () => {
    bookStore.getState().setCurrentPage(get().selectedPage);
    get().close();
  },
  open: (pageNumber) => {
    const nextPage = pageNumber ?? bookStore.getState().currentPage;

    set(() => ({
      isAccelerating: false,
      isOpen: true,
      selectedPage: clampPage(nextPage),
    }));
  },
  reset: () => {
    set(() => ({
      ...initialState,
      selectedPage: bookStore.getState().currentPage,
    }));
  },
  setAccelerating: (isAccelerating) => {
    set(() => ({ isAccelerating }));
  },
  setSelectedPage: (pageNumber) => {
    set(() => ({
      selectedPage: clampPage(pageNumber),
    }));
  },
  stepSelection: (delta) => {
    set((state) => ({
      selectedPage: clampPage(state.selectedPage + delta),
    }));
  },
}));

export const quickFlipStore = useQuickFlipStore;
