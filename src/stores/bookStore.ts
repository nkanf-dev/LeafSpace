import { create } from 'zustand';
import { pdfService } from '../services/PDFService';
import { thumbnailService } from '../services/ThumbnailService';
import type { TOCItem } from '../types/domain';

type DocumentSource = File | string;

interface BookStoreDependencies {
  pdfService: Pick<typeof pdfService, 'loadDocument' | 'getDocumentFingerprint' | 'getDocumentData' | 'destroy'>;
  thumbnailService: Pick<typeof thumbnailService, 'activateDocument' | 'releaseDocument'>;
}

const defaultDependencies: BookStoreDependencies = { pdfService, thumbnailService };
let dependencies: BookStoreDependencies = { ...defaultDependencies };
let loadGeneration = 0;

function normalizeTotalPages(totalPages: number): number {
  return Number.isFinite(totalPages) ? Math.max(0, Math.floor(totalPages)) : 0;
}

function clampPage(page: number, totalPages: number): number {
  const validPage = Number.isFinite(page) ? Math.round(page) : 1;
  return Math.min(Math.max(1, validPage), totalPages || 1);
}

function clampScale(scale: number | undefined): number {
  if (typeof scale !== 'number' || !Number.isFinite(scale)) return 1;
  return Math.min(4, Math.max(0.1, scale));
}

function releaseDocumentUrl(url: string | null, nextUrl?: string | null) {
  if (url?.startsWith('blob:') && url !== nextUrl) URL.revokeObjectURL(url);
}

export type BookStatus = 'idle' | 'loading' | 'ready' | 'error';
export interface DocumentReadyPayload {
  documentId: string;
  documentName?: string | null;
  documentUrl?: string | null;
  totalPages: number;
  currentPage?: number;
  initialPage?: number;
  scale?: number;
  toc?: TOCItem[];
}

export interface BookStoreState {
  currentPage: number;
  documentId: string | null;
  documentName: string | null;
  documentUrl: string | null;
  error: string | null;
  status: BookStatus;
  totalPages: number;
  scale: number;
  toc: TOCItem[];
  clearError: () => void;
  loadDocument: (file: DocumentSource) => Promise<void>;
  restoreDocument: (payload: DocumentReadyPayload) => void;
  setCurrentPage: (page: number) => void;
  setDocumentReady: (payload: DocumentReadyPayload) => void;
  setScale: (scale: number) => void;
  setTotalPages: (totalPages: number) => void;
  startLoading: () => void;
  nextPage: () => void;
  previousPage: () => void;
  reset: () => void;
}

const emptyDocument = {
  currentPage: 1, documentId: null, documentName: null, documentUrl: null,
  error: null, totalPages: 0, scale: 1, toc: [] as TOCItem[],
};

export const useBookStore = create<BookStoreState>((set, get) => ({
  ...emptyDocument,
  status: 'idle',

  clearError: () => set({ error: null, status: get().documentId ? 'ready' : 'idle' }),
  startLoading: () => {
    loadGeneration += 1;
    void dependencies.pdfService.destroy();
    dependencies.thumbnailService.releaseDocument();
    releaseDocumentUrl(get().documentUrl);
    set({ ...emptyDocument, status: 'loading' });
  },

  loadDocument: async (file) => {
    get().startLoading();
    const generation = loadGeneration;
    try {
      const { numPages, toc } = await dependencies.pdfService.loadDocument(file);
      if (generation !== loadGeneration) throw new DOMException('文档加载已取消', 'AbortError');
      const fingerprint = dependencies.pdfService.getDocumentFingerprint();
      if (!fingerprint) throw new Error('无法识别这份 PDF，请重新导入');
      const isRemoteSource = typeof file === 'string';
      const documentUrl = isRemoteSource ? file : URL.createObjectURL(file);
      const documentName = isRemoteSource ? file.split('/').pop() || 'PDF 文档' : file.name;
      get().setDocumentReady({ documentId: fingerprint, documentName, documentUrl, totalPages: numPages, toc });
    } catch (error) {
      if (generation === loadGeneration) {
        set({ ...emptyDocument, status: 'error', error: error instanceof Error ? error.message : '无法读取 PDF，请确认文件完整后重试' });
      }
      throw error;
    }
  },

  setDocumentReady: (payload) => {
    loadGeneration += 1;
    const totalPages = normalizeTotalPages(payload.totalPages);
    const documentUrl = payload.documentUrl ?? null;
    releaseDocumentUrl(get().documentUrl, documentUrl);
    const source = dependencies.pdfService.getDocumentFingerprint() === payload.documentId
      ? dependencies.pdfService.getDocumentData() : null;
    if (source) dependencies.thumbnailService.activateDocument({ documentId: payload.documentId, totalPages, source });
    else dependencies.thumbnailService.releaseDocument();
    set({
      documentId: payload.documentId,
      documentName: payload.documentName ?? null,
      documentUrl,
      totalPages,
      status: 'ready',
      currentPage: clampPage(payload.initialPage ?? payload.currentPage ?? 1, totalPages),
      scale: clampScale(payload.scale),
      toc: payload.toc ?? [],
      error: null,
    });
  },

  restoreDocument: (payload) => get().setDocumentReady(payload),
  setCurrentPage: (page) => set({ currentPage: clampPage(page, get().totalPages) }),
  setScale: (scale) => set({ scale: clampScale(scale) }),
  setTotalPages: (value) => {
    const totalPages = normalizeTotalPages(value);
    set({ totalPages, currentPage: clampPage(get().currentPage, totalPages) });
  },
  nextPage: () => get().setCurrentPage(get().currentPage + 1),
  previousPage: () => get().setCurrentPage(get().currentPage - 1),
  reset: () => {
    loadGeneration += 1;
    void dependencies.pdfService.destroy();
    dependencies.thumbnailService.releaseDocument();
    releaseDocumentUrl(get().documentUrl);
    set({ ...emptyDocument, status: 'idle' });
  },
}));

export const bookStore = useBookStore;
export const configureBookStoreDependencies = (overrides: Partial<BookStoreDependencies>) => {
  dependencies = { ...dependencies, ...overrides };
};
export const resetBookStoreDependencies = () => { dependencies = { ...defaultDependencies }; };
