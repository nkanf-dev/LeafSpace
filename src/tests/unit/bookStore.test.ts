import { beforeEach, describe, expect, it } from 'vitest';

import { useBookStore } from '../../stores/bookStore';

describe('bookStore', () => {
  beforeEach(() => {
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

  it('records load failures as explicit error states', () => {
    useBookStore.getState().startLoading();
    useBookStore.getState().failLoading('Unable to parse PDF');

    expect(useBookStore.getState()).toMatchObject({
      error: 'Unable to parse PDF',
      status: 'error',
    });
  });
});
