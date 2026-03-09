// @ts-nocheck

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  configureBookStoreDependencies,
  resetBookStoreDependencies,
  useBookStore,
} from '../../stores/bookStore';

describe('bookStore', () => {
  beforeEach(() => {
    resetBookStoreDependencies();
    useBookStore.getState().reset();
  });

  it('transitions from loading to ready with clamped page and scale values', () => {
    const store = useBookStore.getState();

    store.startLoading();
    expect(useBookStore.getState().status).toBe('loading');
    expect(useBookStore.getState().error).toBeNull();

    store.setDocumentReady({
      documentId: 'doc-1',
      initialPage: 99,
      scale: 9,
      totalPages: 24,
    });

    expect(useBookStore.getState()).toMatchObject({
      currentPage: 24,
      documentId: 'doc-1',
      error: null,
      scale: 4,
      status: 'ready',
      totalPages: 24,
    });
  });

  it('loads document metadata through PDFService dependency injection', async () => {
    const fakePdfService = {
      destroy: vi.fn().mockResolvedValue(undefined),
      getDocumentData: vi.fn(),
      getDocumentFingerprint: vi.fn().mockReturnValue('doc-123'),
      getPage: vi.fn(),
      getTotalPages: vi.fn(),
      hasLoadedDocument: vi.fn(),
      loadDocument: vi.fn().mockResolvedValue({ numPages: 12 }),
      renderPage: vi.fn(),
    };

    configureBookStoreDependencies({
      pdfService: fakePdfService as never,
    });

    await useBookStore.getState().loadDocument('memory://sample.pdf');

    expect(fakePdfService.loadDocument).toHaveBeenCalledWith('memory://sample.pdf');
    expect(useBookStore.getState()).toMatchObject({
      currentPage: 1,
      documentId: 'doc-123',
      error: null,
      scale: 1,
      status: 'ready',
      totalPages: 12,
    });
  });

  it('keeps currentPage inside bounds when the total page count changes', () => {
    useBookStore.getState().setDocumentReady({
      documentId: 'doc-2',
      initialPage: 10,
      totalPages: 20,
    });

    useBookStore.getState().setCurrentPage(18);
    useBookStore.getState().setTotalPages(12);

    expect(useBookStore.getState().currentPage).toBe(12);

    useBookStore.getState().previousPage();
    expect(useBookStore.getState().currentPage).toBe(11);

    useBookStore.getState().nextPage();
    expect(useBookStore.getState().currentPage).toBe(12);

    useBookStore.getState().setCurrentPage(-5);
    expect(useBookStore.getState().currentPage).toBe(1);
  });

  it('records load failures as explicit error states', async () => {
    const fakePdfService = {
      destroy: vi.fn().mockResolvedValue(undefined),
      getDocumentData: vi.fn(),
      getDocumentFingerprint: vi.fn().mockReturnValue(null),
      getPage: vi.fn(),
      getTotalPages: vi.fn(),
      hasLoadedDocument: vi.fn(),
      loadDocument: vi.fn().mockRejectedValue(new Error('Unable to parse PDF')),
      renderPage: vi.fn(),
    };

    configureBookStoreDependencies({
      pdfService: fakePdfService as never,
    });

    await expect(useBookStore.getState().loadDocument('memory://broken.pdf')).rejects.toThrow('Unable to parse PDF');

    expect(useBookStore.getState()).toMatchObject({
      error: 'Unable to parse PDF',
      status: 'error',
    });
  });
});
