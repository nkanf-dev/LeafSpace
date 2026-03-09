import { create } from 'zustand';

import { pdfService } from '../services/PDFService';
import type { PDFService } from '../services/PDFService';
import type { TOCItem } from '../types/domain';

const DEFAULT_PAGE = 1;
const DEFAULT_SCALE = 1;
const MAX_SCALE = 4;
const MIN_SCALE = 0.25;
const SCALE_STEP = 0.1;

export type BookStatus = 'idle' | 'loading' | 'ready' | 'error';

interface BookStoreDependencies {
  pdfService: PDFService;
}

export interface BookStoreState {
  currentPage: number;
  documentId: string | null;
  error: string | null;
  scale: number;
  status: BookStatus;
  toc: TOCItem[];
  totalPages: number;
  failLoading: (message: string) => void;
  loadDocument: (fileOrUrl: File | string) => Promise<void>;
  nextPage: () => void;
  previousPage: () => void;
  reset: () => void;
  setCurrentPage: (page: number) => void;
  setDocumentReady: (payload: {
    documentId?: string | null;
    initialPage?: number;
    scale?: number;
    totalPages: number;
    toc?: TOCItem[];
  }) => void;
  setScale: (scale: number) => void;
  setToc: (toc: TOCItem[]) => void;
  setTotalPages: (totalPages: number) => void;
  startLoading: () => void;
  unloadDocument: () => Promise<void>;
  zoomIn: () => void;
  zoomOut: () => void;
}

const initialState = {
  currentPage: DEFAULT_PAGE,
  documentId: null,
  error: null,
  scale: DEFAULT_SCALE,
  status: 'idle' as const,
  toc: [] as TOCItem[],
  totalPages: 0,
};

let dependencies: BookStoreDependencies = {
  pdfService,
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

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return typeof error === 'string' ? error : 'Unknown document error';
}

export function configureBookStoreDependencies(nextDependencies: Partial<BookStoreDependencies>): void {
  dependencies = {
    ...dependencies,
    ...nextDependencies,
  };
}

export function resetBookStoreDependencies(): void {
  dependencies = {
    pdfService,
  };
}

export const useBookStore = create<BookStoreState>((set, get) => ({
  ...initialState,
  failLoading: (message) => {
    set((state) => ({
      ...state,
      error: message,
      status: 'error',
    }));
  },
  loadDocument: async (fileOrUrl) => {
    get().startLoading();

    try {
      const document = await dependencies.pdfService.loadDocument(fileOrUrl);
      const documentId = dependencies.pdfService.getDocumentFingerprint();

      get().setDocumentReady({
        documentId,
        initialPage: DEFAULT_PAGE,
        scale: DEFAULT_SCALE,
        toc: [],
        totalPages: document.numPages,
      });
    } catch (error) {
      const message = normalizeErrorMessage(error);
      get().failLoading(message);
      throw error;
    }
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
  setDocumentReady: ({ documentId = null, initialPage = DEFAULT_PAGE, scale = DEFAULT_SCALE, toc = [], totalPages }) => {
    set(() => ({
      currentPage: clampPage(initialPage, totalPages),
      documentId,
      error: null,
      scale: clampScale(scale),
      status: 'ready',
      toc,
      totalPages,
    }));
  },
  setScale: (scale) => {
    set(() => ({
      scale: clampScale(scale),
    }));
  },
  setToc: (toc) => {
    set(() => ({ toc }));
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
      toc: [],
    }));
  },
  unloadDocument: async () => {
    await dependencies.pdfService.destroy();
    get().reset();
  },
  zoomIn: () => {
    set((state) => ({
      scale: clampScale(state.scale + SCALE_STEP),
    }));
  },
  zoomOut: () => {
    set((state) => ({
      scale: clampScale(state.scale - SCALE_STEP),
    }));
  },
}));

export const bookStore = useBookStore;
