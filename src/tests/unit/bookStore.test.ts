import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PDFService } from '../../services/PDFService';

import {
  configureBookStoreDependencies,
  resetBookStoreDependencies,
  useBookStore,
} from '../../stores/bookStore';

describe('bookStore', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    resetBookStoreDependencies();
  });
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
    const fakePdfService = new PDFService();
    vi.spyOn(fakePdfService, 'loadDocument').mockResolvedValue({ numPages: 12 });
    vi.spyOn(fakePdfService, 'getDocumentFingerprint').mockReturnValue('doc-123');
    configureBookStoreDependencies({ pdfService: fakePdfService });

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
    const fakePdfService = new PDFService();
    vi.spyOn(fakePdfService, 'loadDocument').mockRejectedValue(new Error('Unable to parse PDF'));
    configureBookStoreDependencies({ pdfService: fakePdfService });

    await expect(useBookStore.getState().loadDocument('memory://broken.pdf')).rejects.toThrow('Unable to parse PDF');

    expect(useBookStore.getState()).toMatchObject({
      error: 'Unable to parse PDF',
      status: 'error',
    });
  });

  it.each([NaN, Infinity, -Infinity])('normalizes non-finite page and scale values (%s)', (value) => {
    useBookStore.getState().setDocumentReady({ documentId: 'bounds', totalPages: 20 });
    useBookStore.getState().setCurrentPage(value);
    useBookStore.getState().setScale(value);
    expect(useBookStore.getState().currentPage).toBe(1);
    expect(useBookStore.getState().scale).toBe(1);
    useBookStore.getState().setTotalPages(value);
    expect(useBookStore.getState().totalPages).toBe(0);
  });

  it('rounds fractional page requests and keeps scale within bounds', () => {
    useBookStore.getState().setDocumentReady({ documentId: 'bounds', totalPages: 20.9 });
    useBookStore.getState().setCurrentPage(4.7);
    expect(useBookStore.getState().currentPage).toBe(5);
    expect(useBookStore.getState().totalPages).toBe(20);
    useBookStore.getState().setScale(0);
    expect(useBookStore.getState().scale).toBe(0.1);
    useBookStore.getState().setScale(50);
    expect(useBookStore.getState().scale).toBe(4);
  });

  it('revokes a replaced local object URL exactly once and never revokes remote URLs', () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    useBookStore.getState().setDocumentReady({ documentId: 'first', documentUrl: 'blob:first', totalPages: 3 });
    useBookStore.getState().setDocumentReady({ documentId: 'second', documentUrl: 'blob:second', totalPages: 5 });
    expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:first');
    useBookStore.getState().reset();
    expect(revoke).toHaveBeenNthCalledWith(2, 'blob:second');
    useBookStore.getState().setDocumentReady({ documentId: 'remote', documentUrl: 'https://example.com/book.pdf', totalPages: 5 });
    useBookStore.getState().reset();
    expect(revoke).toHaveBeenCalledTimes(2);
  });

  it('clears stale metadata and releases the previous URL when a replacement fails', async () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    useBookStore.getState().setDocumentReady({ documentId: 'first', documentUrl: 'blob:first', totalPages: 3 });
    const fakePdfService = new PDFService();
    vi.spyOn(fakePdfService, 'loadDocument').mockRejectedValue(new Error('Invalid replacement'));
    configureBookStoreDependencies({ pdfService: fakePdfService });
    await expect(useBookStore.getState().loadDocument('memory://broken.pdf')).rejects.toThrow('Invalid replacement');
    expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:first');
    expect(useBookStore.getState()).toMatchObject({
      documentId: null, documentUrl: null, totalPages: 0, currentPage: 1, status: 'error',
    });
    useBookStore.getState().clearError();
    expect(useBookStore.getState()).toMatchObject({ status: 'idle', error: null });
  });

  it('ignores stale load completion after the reader has been reset', async () => {
    let finish!: (metadata: { numPages: number }) => void;
    const fakePdfService = new PDFService();
    vi.spyOn(fakePdfService, 'loadDocument').mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    vi.spyOn(fakePdfService, 'getDocumentFingerprint').mockReturnValue('stale');
    configureBookStoreDependencies({ pdfService: fakePdfService });
    const loading = useBookStore.getState().loadDocument('memory://slow.pdf');
    const cancelled = expect(loading).rejects.toMatchObject({ name: 'AbortError' });
    useBookStore.getState().reset();
    finish({ numPages: 12 });
    await cancelled;
    expect(useBookStore.getState()).toMatchObject({ documentId: null, documentUrl: null, status: 'idle' });
  });

  it('keeps the newest load when an earlier request resolves last', async () => {
    let finish!: (metadata: { numPages: number }) => void;
    const fakePdfService = new PDFService();
    vi.spyOn(fakePdfService, 'loadDocument')
      .mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
      .mockResolvedValueOnce({ numPages: 22 });
    vi.spyOn(fakePdfService, 'getDocumentFingerprint').mockReturnValue('new-document');
    configureBookStoreDependencies({ pdfService: fakePdfService });
    const first = useBookStore.getState().loadDocument('memory://old.pdf');
    const cancelled = expect(first).rejects.toMatchObject({ name: 'AbortError' });
    await useBookStore.getState().loadDocument('memory://new.pdf');
    finish({ numPages: 10 });
    await cancelled;
    expect(useBookStore.getState()).toMatchObject({
      documentId: 'new-document', documentUrl: 'memory://new.pdf', status: 'ready', totalPages: 22,
    });
  });

  it('loads a local file using a generated object URL and its original filename', async () => {
    const file = new File(['%PDF-'], 'Research.pdf', { type: 'application/pdf' });
    const createUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:local-book');
    const fakePdfService = new PDFService();
    vi.spyOn(fakePdfService, 'loadDocument').mockResolvedValue({ numPages: 6 });
    vi.spyOn(fakePdfService, 'getDocumentFingerprint').mockReturnValue('local-book');
    configureBookStoreDependencies({ pdfService: fakePdfService });
    await useBookStore.getState().loadDocument(file);
    expect(createUrl).toHaveBeenCalledExactlyOnceWith(file);
    expect(useBookStore.getState()).toMatchObject({
      documentId: 'local-book', documentUrl: 'blob:local-book', documentName: 'Research.pdf', totalPages: 6,
    });
  });

});
