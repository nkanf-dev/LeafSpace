import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { destroyLoadingTaskMock, getDocumentMock } = vi.hoisted(() => ({
  destroyLoadingTaskMock: vi.fn(),
  getDocumentMock: vi.fn(),
}));

vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: { workerSrc: '' },
  PasswordResponses: { NEED_PASSWORD: 1, INCORRECT_PASSWORD: 2 },
  getDocument: getDocumentMock,
}));

import { PDFService } from '../../services/PDFService';

function metadata(fingerprint = 'fingerprint-1', numPages = 12) {
  return { fingerprints: [fingerprint], numPages, destroy: vi.fn().mockResolvedValue(undefined) };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
function mockFetch(bytes = Uint8Array.from([37, 80, 68, 70])) {
  const fetchMock = vi.fn().mockResolvedValue({
    arrayBuffer: vi.fn().mockResolvedValue(bytes.buffer.slice(0)),
    ok: true, status: 200, statusText: 'OK',
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}
function loadedTask(document = metadata()) {
  return { destroy: destroyLoadingTaskMock, promise: Promise.resolve(document) };
}
function expectNoDocument(service: PDFService) {
  expect(service.hasLoadedDocument()).toBe(false);
  expect(service.getTotalPages()).toBe(0);
  expect(service.getDocumentFingerprint()).toBeNull();
  expect(service.getDocumentData()).toBeNull();
}

describe('PDFService', () => {
  beforeEach(() => {
    destroyLoadingTaskMock.mockReset().mockResolvedValue(undefined);
    getDocumentMock.mockReset();
    mockFetch();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('surfaces PDF loading failures and releases the worker without stale document state', async () => {
    getDocumentMock.mockReturnValue({
      destroy: destroyLoadingTaskMock,
      // Create the rejection only after loadDocument requests the loading task.
      get promise() { return Promise.reject(new Error('Invalid PDF payload')); },
    });
    const service = new PDFService();
    await expect(service.loadDocument('https://example.com/sample.pdf')).rejects.toThrow('Invalid PDF payload');
    expectNoDocument(service);
    expect(destroyLoadingTaskMock).toHaveBeenCalledTimes(1);
  });

  it.each([1, 2])('normalizes parser password response %s without retaining document state', async code => {
    const passwordError = Object.assign(new Error('Private parser detail'), { name: 'PasswordException', code });
    getDocumentMock.mockReturnValue({ destroy: destroyLoadingTaskMock, get promise() { return Promise.reject(passwordError); } });
    const service = new PDFService();
    await expect(service.loadDocument('https://example.com/locked.pdf')).rejects.toMatchObject({ name: 'PDFPasswordRequiredError', message: expect.stringContaining('无需打开密码') });
    expectNoDocument(service);
    expect(destroyLoadingTaskMock).toHaveBeenCalledOnce();
    getDocumentMock.mockReturnValue(loadedTask());
    await expect(service.loadDocument('https://example.com/unlocked.pdf')).resolves.toMatchObject({ numPages: 12 });
  });

  it.each([
    new Error('PasswordException: text alone is not a typed parser response'),
    Object.assign(new Error('Malformed parser response'), { name: 'PasswordException', code: 99 }),
    Object.assign(new Error('Invalid PDF'), { name: 'InvalidPDFException', code: 1 }),
    new DOMException('Cancelled', 'AbortError'),
  ])('preserves non-password parser failures unchanged: %s', async error => {
    getDocumentMock.mockReturnValue({ destroy: destroyLoadingTaskMock, get promise() { return Promise.reject(error); } });
    await expect(new PDFService().loadDocument('https://example.com/broken.pdf')).rejects.toBe(error);
  });

  it('does not classify source-reading failures as parser password requirements', async () => {
    const error = Object.assign(new Error('Source read failed'), { name: 'PasswordException', code: 1 });
    vi.mocked(fetch).mockRejectedValueOnce(error);
    await expect(new PDFService().loadDocument('https://example.com/source.pdf')).rejects.toBe(error);
    expect(getDocumentMock).not.toHaveBeenCalled();
  });

  it('stores metadata and a separate thumbnail byte source after a successful load', async () => {
    const bytes = Uint8Array.from([37, 80, 68, 70]);
    mockFetch(bytes);
    getDocumentMock.mockReturnValue(loadedTask());
    const service = new PDFService();
    await expect(service.loadDocument('https://example.com/sample.pdf')).resolves.toEqual({ numPages: 12, toc: [] });
    expect(service.hasLoadedDocument()).toBe(true);
    expect(service.getTotalPages()).toBe(12);
    expect(service.getDocumentFingerprint()).toBe('fingerprint-1');
    expect(Array.from(service.getDocumentData() ?? [])).toEqual(Array.from(bytes));
    expect(getDocumentMock).toHaveBeenCalledWith(expect.objectContaining({ useWorkerFetch: false, isEvalSupported: false }));
    expect(destroyLoadingTaskMock).toHaveBeenCalledTimes(1);
  });

  it('preserves thumbnail bytes even if PDF.js detaches its input buffer', async () => {
    mockFetch(Uint8Array.from([1, 2, 3, 4, 5, 6]));
    getDocumentMock.mockImplementation(({ data }: { data: Uint8Array }) => {
      structuredClone(data.buffer, { transfer: [data.buffer] });
      return loadedTask(metadata('fingerprint-detached', 6));
    });
    const service = new PDFService();
    await service.loadDocument('https://example.com/detached.pdf');
    expect(Array.from(service.getDocumentData() ?? [])).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('clears the previous document when fetching a replacement fails', async () => {
    const fetchMock = mockFetch();
    getDocumentMock.mockReturnValue(loadedTask());
    const service = new PDFService();
    await service.loadDocument('https://example.com/first.pdf');
    fetchMock.mockResolvedValueOnce({ ok: false, status: 404, statusText: 'Not Found' });
    await expect(service.loadDocument('https://example.com/missing.pdf')).rejects.toThrow('404');
    expectNoDocument(service);
    expect(getDocumentMock).toHaveBeenCalledTimes(1);
  });

  it('clears the previous document when source reading rejects', async () => {
    const fetchMock = mockFetch();
    getDocumentMock.mockReturnValue(loadedTask());
    const service = new PDFService();
    await service.loadDocument('https://example.com/first.pdf');
    fetchMock.mockRejectedValueOnce(new Error('Network offline'));
    await expect(service.loadDocument('https://example.com/second.pdf')).rejects.toThrow('Network offline');
    expectNoDocument(service);
  });

  it('keeps the latest document when an older load resolves afterward', async () => {
    const oldDocument = deferred<ReturnType<typeof metadata>>();
    const oldDestroy = vi.fn().mockResolvedValue(undefined);
    getDocumentMock.mockReturnValueOnce({ destroy: oldDestroy, promise: oldDocument.promise });
    getDocumentMock.mockReturnValueOnce(loadedTask(metadata('new-document', 20)));
    const service = new PDFService();
    const first = service.loadDocument('https://example.com/old.pdf');
    const cancelled = expect(first).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(getDocumentMock).toHaveBeenCalledTimes(1));
    await service.loadDocument('https://example.com/new.pdf');
    oldDocument.resolve(metadata('old-document', 5));
    await cancelled;
    expect(service.getDocumentFingerprint()).toBe('new-document');
    expect(service.getTotalPages()).toBe(20);
    expect(oldDestroy).toHaveBeenCalledTimes(1);
  });

  it('does not clear the latest metadata when an older load rejects', async () => {
    const oldDocument = deferred<ReturnType<typeof metadata>>();
    getDocumentMock.mockReturnValueOnce({ destroy: destroyLoadingTaskMock, promise: oldDocument.promise });
    getDocumentMock.mockReturnValueOnce(loadedTask(metadata('new-document', 20)));
    const service = new PDFService();
    const first = service.loadDocument('https://example.com/old.pdf');
    const rejected = expect(first).rejects.toThrow('Old request failed');
    await vi.waitFor(() => expect(getDocumentMock).toHaveBeenCalledTimes(1));
    await service.loadDocument('https://example.com/new.pdf');
    oldDocument.reject(new Error('Old request failed'));
    await rejected;
    expect(service.getDocumentFingerprint()).toBe('new-document');
    expect(service.hasLoadedDocument()).toBe(true);
  });

  it('invalidates an in-flight load when destroyed', async () => {
    const pending = deferred<ReturnType<typeof metadata>>();
    getDocumentMock.mockReturnValueOnce({ destroy: destroyLoadingTaskMock, promise: pending.promise });
    const service = new PDFService();
    const loading = service.loadDocument('https://example.com/slow.pdf');
    const cancelled = expect(loading).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(getDocumentMock).toHaveBeenCalledTimes(1));
    await service.destroy();
    pending.resolve(metadata());
    await cancelled;
    expectNoDocument(service);
  });

  it('does not let worker cleanup failure hide the original loading error', async () => {
    destroyLoadingTaskMock.mockRejectedValue(new Error('Cleanup failed'));
    getDocumentMock.mockReturnValue({
      destroy: destroyLoadingTaskMock,
      get promise() { return Promise.reject(new Error('Invalid PDF payload')); },
    });
    await expect(new PDFService().loadDocument('https://example.com/broken.pdf')).rejects.toThrow('Invalid PDF payload');
  });
  it('resolves nested outlines, named destinations and numeric destinations without failing on a broken item', async () => {
    const doc = { ...metadata(),
      getOutline: vi.fn().mockResolvedValue([
        { title: 'Chapter', dest: [{ num: 4, gen: 0 }], items: [
          { title: 'Nested', dest: 'named-target', items: [] },
        ] },
        { title: 'Broken', dest: 'broken-target', items: [] },
        { title: 'Numeric', dest: [11], items: [] },
      ]),
      getDestination: vi.fn().mockImplementation((name: string) => name === 'named-target' ? [5] : Promise.reject(new Error('Invalid destination'))),
      getPageIndex: vi.fn().mockResolvedValue(1),
    };
    getDocumentMock.mockReturnValue(loadedTask(doc));
    const result = await new PDFService().loadDocument('https://example.com/outline.pdf');
    expect(result.toc).toEqual([
      { id: 'outline-0', title: 'Chapter', page: 2, level: 0 },
      { id: 'outline-1', title: 'Nested', page: 6, level: 1 },
      { id: 'outline-2', title: 'Numeric', page: 12, level: 0 },
    ]);
  });

});
