import { create } from 'zustand';

const DEFAULT_PAGE = 1;
const DEFAULT_SCALE = 1;
const MAX_SCALE = 4;
const MIN_SCALE = 0.25;

export type BookStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface BookStoreState {
  currentPage: number;
  documentId: string | null;
  error: string | null;
  scale: number;
  status: BookStatus;
  totalPages: number;
  failLoading: (message: string) => void;
  nextPage: () => void;
  previousPage: () => void;
  reset: () => void;
  setCurrentPage: (page: number) => void;
  setDocumentReady: (payload: {
    documentId?: string | null;
    initialPage?: number;
    scale?: number;
    totalPages: number;
  }) => void;
  setScale: (scale: number) => void;
  setTotalPages: (totalPages: number) => void;
  startLoading: () => void;
}

const initialState = {
  currentPage: DEFAULT_PAGE,
  documentId: null,
  error: null,
  scale: DEFAULT_SCALE,
  status: 'idle' as const,
  totalPages: 0,
};

function clampPage(page: number, totalPages: number): number {
  if (totalPages <= 0) {
    return DEFAULT_PAGE;
  }

  return Math.min(Math.max(Math.round(page), DEFAULT_PAGE), totalPages);
}

function clampScale(scale: number): number {
  return Math.min(Math.max(scale, MIN_SCALE), MAX_SCALE);
}

export const useBookStore = create<BookStoreState>((set) => ({
  ...initialState,
  failLoading: (message) => {
    set((state) => ({
      ...state,
      error: message,
      status: 'error',
    }));
  },
  nextPage: () => {
    set((state) => ({
      currentPage: clampPage(state.currentPage + 1, state.totalPages),
    }));
  },
  previousPage: () => {
    set((state) => ({
      currentPage: clampPage(state.currentPage - 1, state.totalPages),
    }));
  },
  reset: () => {
    set(() => ({ ...initialState }));
  },
  setCurrentPage: (page) => {
    set((state) => ({
      currentPage: clampPage(page, state.totalPages),
    }));
  },
  setDocumentReady: ({ documentId = null, initialPage = DEFAULT_PAGE, scale = DEFAULT_SCALE, totalPages }) => {
    set(() => ({
      currentPage: clampPage(initialPage, totalPages),
      documentId,
      error: null,
      scale: clampScale(scale),
      status: 'ready',
      totalPages,
    }));
  },
  setScale: (scale) => {
    set(() => ({
      scale: clampScale(scale),
    }));
  },
  setTotalPages: (totalPages) => {
    set((state) => ({
      currentPage: clampPage(state.currentPage, totalPages),
      totalPages,
    }));
  },
  startLoading: () => {
    set((state) => ({
      ...state,
      error: null,
      status: 'loading',
    }));
  },
}));

export const bookStore = useBookStore;
