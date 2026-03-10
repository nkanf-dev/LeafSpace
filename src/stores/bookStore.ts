import { create } from 'zustand';
import type { PDFService } from '../services/PDFService';

export type BookStatus = 'idle' | 'loading' | 'ready' | 'error';

const MIN_SCALE = 0.5;
const MAX_SCALE = 4;

export interface BookStoreState {
  currentPage: number;
  documentId: string | null;
  documentUrl: string | null;
  error: string | null;
  status: BookStatus;
  totalPages: number;
  scale: number;
  loadDocument: (input: string | File) => Promise<void>;
  setCurrentPage: (page: number) => void;
  setDocumentReady: (payload: { documentId: string; documentUrl?: string; totalPages: number; initialPage?: number; scale?: number }) => void;
  setScale: (scale: number) => void;
  setTotalPages: (totalPages: number) => void;
  startLoading: () => void;
  nextPage: () => void;
  previousPage: () => void;
  reset: () => void;
}

// Injected service – null means "use the real singleton, lazily imported"
let pdfServiceDep: PDFService | null = null;

export function configureBookStoreDependencies(deps: { pdfService: PDFService }) {
  pdfServiceDep = deps.pdfService;
}

export function resetBookStoreDependencies() {
  pdfServiceDep = null;
}

async function getPdfService(): Promise<PDFService> {
  if (pdfServiceDep) return pdfServiceDep;
  return import('../services/PDFService').then((m) => m.pdfService);
}

export const useBookStore = create<BookStoreState>((set, get) => ({
  currentPage: 1,
  documentId: null,
  documentUrl: null,
  error: null,
  status: 'idle',
  totalPages: 0,
  scale: 1.0,

  startLoading: () => set({ status: 'loading', error: null }),

  loadDocument: async (input: string | File) => {
    get().startLoading();
    try {
      const service = await getPdfService();
      const { numPages } = await service.loadDocument(input);
      const fingerprint = service.getDocumentFingerprint();
      const documentUrl = input instanceof File ? URL.createObjectURL(input) : input;

      get().setDocumentReady({
        documentId: fingerprint ?? crypto.randomUUID(),
        documentUrl,
        totalPages: numPages,
      });
    } catch (err: any) {
      set({ status: 'error', error: err.message });
      throw err;
    }
  },

  setDocumentReady: (payload) => {
    const totalPages = payload.totalPages;
    const rawPage = payload.initialPage ?? 1;
    const rawScale = payload.scale ?? 1.0;
    const currentPage = Math.min(Math.max(1, rawPage), totalPages || 1);
    const scale = Math.min(Math.max(MIN_SCALE, rawScale), MAX_SCALE);
    set({
      documentId: payload.documentId,
      documentUrl: payload.documentUrl ?? get().documentUrl,
      totalPages,
      status: 'ready',
      currentPage,
      scale,
      error: null,
    });
  },

  setCurrentPage: (page) => {
    const { totalPages } = get();
    set({ currentPage: Math.min(Math.max(1, page), totalPages || 1) });
  },

  setScale: (scale) => {
    set({ scale: Math.min(Math.max(MIN_SCALE, scale), MAX_SCALE) });
  },

  setTotalPages: (totalPages) => {
    const { currentPage } = get();
    set({ totalPages, currentPage: Math.min(currentPage, totalPages || 1) });
  },

  nextPage: () => get().setCurrentPage(get().currentPage + 1),
  previousPage: () => get().setCurrentPage(get().currentPage - 1),

  reset: () => {
    const { documentUrl } = get();
    if (documentUrl?.startsWith('blob:')) URL.revokeObjectURL(documentUrl);
    set({ documentId: null, documentUrl: null, status: 'idle', totalPages: 0, currentPage: 1, scale: 1.0, error: null });
  },
}));

export const bookStore = useBookStore;
