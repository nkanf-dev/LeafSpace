// @ts-nocheck

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { destroyLoadingTaskMock, getDocumentMock } = vi.hoisted(() => ({
  destroyLoadingTaskMock: vi.fn(),
  getDocumentMock: vi.fn(),
}));

vi.mock('pdfjs-dist/build/pdf.worker.mjs?url', () => ({
  default: '/mocked/pdf.worker.mjs',
}));

vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: {
    workerSrc: '',
  },
  getDocument: getDocumentMock,
}));

import { PDFService } from '../../services/PDFService';

describe('PDFService', () => {
  beforeEach(() => {
    destroyLoadingTaskMock.mockReset();
    getDocumentMock.mockReset();
    vi.restoreAllMocks();
  });

  it('surfaces PDF loading failures without leaving stale document state', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
        ok: true,
        status: 200,
        statusText: 'OK',
      }),
    );

    const rejectedPromise = Promise.reject(new Error('Invalid PDF payload'));
    void rejectedPromise.catch(() => undefined);

    getDocumentMock.mockReturnValue({
      destroy: destroyLoadingTaskMock,
      promise: rejectedPromise,
    });

    const service = new PDFService();

    await expect(service.loadDocument('https://example.com/sample.pdf')).rejects.toThrow('Invalid PDF payload');

    expect(service.hasLoadedDocument()).toBe(false);
    expect(service.getDocumentFingerprint()).toBeNull();
    expect(service.getDocumentData()).toBeNull();
  });

  it('stores document metadata after a successful load', async () => {
    const bytes = Uint8Array.from([37, 80, 68, 70]);
    const destroyDocumentMock = vi.fn().mockResolvedValue(undefined);

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        arrayBuffer: vi.fn().mockResolvedValue(bytes.buffer),
        ok: true,
        status: 200,
        statusText: 'OK',
      }),
    );

    getDocumentMock.mockReturnValue({
      destroy: destroyLoadingTaskMock,
      docId: 'doc-1',
      promise: Promise.resolve({
        destroy: destroyDocumentMock,
        fingerprints: ['fingerprint-1'],
        getPage: vi.fn(),
        numPages: 12,
      }),
    });

    const service = new PDFService();
    const document = await service.loadDocument('https://example.com/sample.pdf');

    expect(document.numPages).toBe(12);
    expect(service.hasLoadedDocument()).toBe(true);
    expect(service.getTotalPages()).toBe(12);
    expect(service.getDocumentFingerprint()).toBe('fingerprint-1');
    expect(Array.from(service.getDocumentData() ?? [])).toEqual(Array.from(bytes));
  });

  it('preserves thumbnail source bytes even if pdfjs detaches its input buffer', async () => {
    const bytes = Uint8Array.from([1, 2, 3, 4, 5, 6]);

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        arrayBuffer: vi.fn().mockResolvedValue(bytes.buffer.slice(0)),
        ok: true,
        status: 200,
        statusText: 'OK',
      }),
    );

    getDocumentMock.mockImplementation(({ data }: { data: Uint8Array }) => {
      structuredClone(data.buffer, { transfer: [data.buffer] });

      return {
        destroy: destroyLoadingTaskMock,
        promise: Promise.resolve({
          destroy: vi.fn().mockResolvedValue(undefined),
          fingerprints: ['fingerprint-detached'],
          getPage: vi.fn(),
          numPages: 6,
        }),
      };
    });

    const service = new PDFService();
    await service.loadDocument('https://example.com/detached.pdf');

    expect(Array.from(service.getDocumentData() ?? [])).toEqual([1, 2, 3, 4, 5, 6]);
  });
});
