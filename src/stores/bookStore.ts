import { create } from 'zustand';
import { pdfService } from '../services/PDFService';

type DocumentSource = File | string;

interface BookStoreDependencies {
  pdfService: typeof pdfService;
}

const defaultDependencies: BookStoreDependencies = {
  pdfService,
};

let dependencies: BookStoreDependencies = { ...defaultDependencies };

function clampPage(page: number, totalPages: number): number {
  return Math.min(Math.max(1, page), totalPages || 1);
}

function clampScale(scale: number | undefined): number {
  if (typeof scale !== 'number' || Number.isNaN(scale)) {
    return 1;
  }

  return Math.min(4, Math.max(0.1, scale));
}

export type BookStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface BookStoreState {
  currentPage: number;
  documentId: string | null;
  documentName: string | null;
  documentUrl: string | null;
  error: string | null;
  status: BookStatus;
  totalPages: number;
  scale: number;
  loadDocument: (file: DocumentSource) => Promise<void>;
  restoreDocument: (payload: { documentId: string; documentName?: string | null; documentUrl: string; totalPages: number; currentPage?: number; scale?: number }) => void;
  setCurrentPage: (page: number) => void;
  setDocumentReady: (payload: any) => void;
  setScale: (scale: number) => void;
  setTotalPages: (totalPages: number) => void;
  startLoading: () => void;
  nextPage: () => void;
  previousPage: () => void;
  reset: () => void;
}

export const useBookStore = create<BookStoreState>((set, get) => ({
  currentPage: 1,
  documentId: null,
  documentName: null,
  documentUrl: null,
  error: null,
  status: 'idle',
  totalPages: 0,
  scale: 1.0,

  startLoading: () => set({ status: 'loading', error: null }),

  loadDocument: async (file: DocumentSource) => {
    get().startLoading();
    try {
      const { numPages } = await dependencies.pdfService.loadDocument(file);
      const fingerprint = dependencies.pdfService.getDocumentFingerprint();
      const isRemoteSource = typeof file === 'string';
      const blobUrl = isRemoteSource ? file : URL.createObjectURL(file);
      const documentName = isRemoteSource ? file.split('/').pop() || 'PDF Document' : file.name;

      get().setDocumentReady({
        documentId: fingerprint,
        documentName,
        documentUrl: blobUrl,
        totalPages: numPages
      });
    } catch (err: any) {
      set({ status: 'error', error: err.message });
      throw err;
    }
  },

  setDocumentReady: (payload) => {
    const totalPages = payload.totalPages ?? 0;
    const nextScale = clampScale(payload.scale);
    const nextPage = clampPage(payload.initialPage ?? payload.currentPage ?? 1, totalPages);

    set({
      documentId: payload.documentId,
      documentName: payload.documentName ?? null,
      documentUrl: payload.documentUrl,
      totalPages,
      status: 'ready',
      currentPage: nextPage,
      scale: nextScale,
      error: null,
    });
  },

  restoreDocument: (payload) => {
    set({
      currentPage: clampPage(payload.currentPage ?? 1, payload.totalPages),
      documentId: payload.documentId,
      documentName: payload.documentName ?? null,
      documentUrl: payload.documentUrl,
      error: null,
      scale: clampScale(payload.scale),
      status: 'ready',
      totalPages: payload.totalPages,
    });
  },

  setCurrentPage: (page) => {
    const { totalPages } = get();
    set({ currentPage: clampPage(page, totalPages) });
  },

  setScale: (scale) => set({ scale: clampScale(scale) }),

  setTotalPages: (totalPages) => set((state) => ({ totalPages, currentPage: clampPage(state.currentPage, totalPages) })),

  nextPage: () => get().setCurrentPage(get().currentPage + 1),
  previousPage: () => get().setCurrentPage(get().currentPage - 1),

  reset: () => {
    if (get().documentUrl) URL.revokeObjectURL(get().documentUrl!);
    set({ documentId: null, documentName: null, documentUrl: null, status: 'idle', totalPages: 0, currentPage: 1, scale: 1, error: null });
  }
}));

export const bookStore = useBookStore;
export const configureBookStoreDependencies = (overrides: Partial<BookStoreDependencies>) => {
  dependencies = { ...dependencies, ...overrides };
};
export const resetBookStoreDependencies = () => {
  dependencies = { ...defaultDependencies };
};
