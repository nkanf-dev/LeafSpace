import { StrictMode, useEffect, useRef, type PropsWithChildren, type Ref } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReaderViewport } from '../../components/reader/ReaderViewport';
import { useBookStore } from '../../stores/bookStore';
import { windowStore } from '../../stores/windowStore';
import { quickFlipStore } from '../../stores/quickFlipStore';
import { prepareHeldRead } from '../../services/HeldReadTransaction';

type PdfStub = { numPages: number; getDestination: ReturnType<typeof vi.fn>; getPageIndex: ReturnType<typeof vi.fn> };
type PageCallbacks = { onRenderError?: (error: Error) => void; onRenderSuccess?: () => void; onGetAnnotationsSuccess?: (items: unknown[]) => void };
const life = vi.hoisted(() => ({ nextDocument: 0, documentMounts: 0, documentUnmounts: 0, pageMounts: 0,
  documents: new Map<number, { pdf: PdfStub; loaded?: (pdf: PDFDocumentProxy) => void }>(), pages: new Map<number, PageCallbacks>(), nativeClicks: [] as boolean[] }));
function createPdf(): PdfStub { return { numPages: 12, getDestination: vi.fn().mockResolvedValue([{ num: 7, gen: 0 }]), getPageIndex: vi.fn().mockResolvedValue(2) }; }
vi.mock('react-pdf', () => ({
  pdfjs: { GlobalWorkerOptions: {}, version: 'test' },
  Document: function MockDocument({ children, onLoadSuccess }: PropsWithChildren<{ onLoadSuccess?: (pdf: PDFDocumentProxy) => void }>) {
    const id = useRef(0); if (!id.current) id.current = ++life.nextDocument;
    const source = useRef<PdfStub | null>(null); if (!source.current) source.current = createPdf();
    const pdf = source.current, initial = useRef(onLoadSuccess);
    life.documents.set(id.current, { pdf, loaded: initial.current });
    useEffect(() => { life.documentMounts++; initial.current?.(pdf as unknown as PDFDocumentProxy); return () => { life.documentUnmounts++; }; }, [pdf]);
    return <div data-document={id.current}>{children}</div>;
  },
  Page: function MockPage(props: PageCallbacks & { pageNumber: number; inputRef?: Ref<HTMLDivElement> }) {
    const id = useRef(0); if (!id.current) id.current = ++life.pageMounts;
    life.pages.set(id.current, props);
    const { pageNumber, onGetAnnotationsSuccess } = props;
    useEffect(() => { onGetAnnotationsSuccess?.([{ id: 'local', annotationType: 2, dest: [6] }, { id: 'external', annotationType: 2, url: 'https://example.com/paper' }]); }, [pageNumber, onGetAnnotationsSuccess]);
    const native = (event: React.MouseEvent) => { life.nativeClicks.push(event.defaultPrevented); event.preventDefault(); };
    return <div ref={props.inputRef} className="react-pdf__Page" data-page-number={props.pageNumber} data-page-mock={id.current}>
      <canvas /><div className="annotationLayer">
        <section data-annotation-id="local" data-internal-link><a key={props.pageNumber} href="#" onClick={native}>PDF page {props.pageNumber} link</a></section>
        <section data-annotation-id="external"><a href="https://example.com/paper" onClick={native}>External link</a></section>
      </div>
    </div>;
  },
}));
vi.mock('../../services/ThumbnailService', () => ({ thumbnailService: { activateDocument: vi.fn(), releaseDocument: vi.fn(), ensureThumbnail: vi.fn().mockResolvedValue(undefined) } }));
const observers: (() => void)[] = [];
function load(initialPage = 1) { useBookStore.getState().setDocumentReady({ documentId: 'links', documentUrl: 'memory://links.pdf', totalPages: 12, initialPage }); }
function Reference({ id }: { id: string }) {
  const pageNumber = windowStore(state => state.windows.find(window => window.id === id)?.pageNumber ?? 1);
  return <ReaderViewport windowId={id} pageNumber={pageNumber} />;
}
function geometry(region: HTMLElement) {
  let width = 400;
  Object.defineProperties(region, { clientWidth: { configurable: true, get: () => width }, clientHeight: { configurable: true, value: 300 } });
  act(() => observers.forEach(observer => observer()));
  return (nextWidth: number) => { width = nextWidth; act(() => observers.forEach(observer => observer())); };
}
const main = () => screen.getByRole('region', { name: '主阅读区' });
const paper = (region: HTMLElement) => region.querySelector<HTMLElement>('.react-pdf__Page')!;
const anchor = (region: HTMLElement) => region.querySelector<HTMLAnchorElement>('[data-annotation-id="local"] a')!;
const pageCallbacks = (region: HTMLElement) => life.pages.get(Number(paper(region).dataset.pageMock))!;
const documentState = (region: HTMLElement) => life.documents.get(Number(region.querySelector<HTMLElement>('[data-document]')!.dataset.document))!;
function metadata(region: HTMLElement, destination: unknown, extra: Record<string, unknown> = {}) { pageCallbacks(region).onGetAnnotationsSuccess?.([{ id: 'local', annotationType: 2, dest: destination, ...extra }, { id: 'external', annotationType: 2, url: 'https://example.com/paper' }]); }
async function activate(region: HTMLElement, destination: unknown, extra: Record<string, unknown> = {}) { await act(async () => { metadata(region, destination, extra); fireEvent.click(anchor(region)); }); }
function deferred() { let resolve!: (value: unknown) => void, reject!: (error: Error) => void; const promise = new Promise<unknown>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
async function beginNamed(region: HTMLElement) { const pending = deferred(); documentState(region).pdf.getDestination.mockReturnValueOnce(pending.promise); await activate(region, 'chapter'); return pending; }
async function resolve(pending: ReturnType<typeof deferred>, destination: unknown = [{ num: 7, gen: 0 }]) { await act(async () => pending.resolve(destination)); }

beforeEach(() => {
  useBookStore.getState().reset(); windowStore.getState().reset(); quickFlipStore.getState().reset();
  Object.assign(life, { nextDocument: 0, documentMounts: 0, documentUnmounts: 0, pageMounts: 0 }); life.documents.clear(); life.pages.clear(); life.nativeClicks.length = 0; observers.length = 0;
  vi.stubGlobal('ResizeObserver', class { constructor(callback: () => void) { observers.push(callback); } observe() {} disconnect() {} });
  vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1); vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('owner-scoped internal PDF link activation', () => {
  it.each(['numeric', 'named', 'reference'])('resolves %s once through the captured public PDF proxy', async kind => {
    load(); useBookStore.getState().setScale(2); render(<ReaderViewport isMain windowId="main" />); const pdf = documentState(main()).pdf;
    await activate(main(), kind === 'numeric' ? [2] : kind === 'named' ? 'chapter' : [{ num: 7, gen: 0 }]);
    expect(useBookStore.getState().currentPage).toBe(3); expect(useBookStore.getState().scale).toBe(2);
    expect(pdf.getDestination).toHaveBeenCalledTimes(kind === 'named' ? 1 : 0);
    expect(pdf.getPageIndex).toHaveBeenCalledTimes(kind === 'numeric' ? 0 : 1); expect(life.nativeClicks).toEqual([]);
  });
  it('treats implicit and explicit main IDs as the same Document owner', async () => {
    load(); const view = render(<ReaderViewport isMain />); view.rerender(<ReaderViewport isMain windowId="main" />);
    await activate(main(), [6]); expect(useBookStore.getState().currentPage).toBe(7);
    view.rerender(<ReaderViewport isMain />); await activate(main(), [3]); expect(useBookStore.getState().currentPage).toBe(4); expect(life.documentMounts).toBe(1);
  });
  it('keeps delayed reference completion source-owned after activity and focus move to main', async () => {
    load(4); const id = windowStore.getState().openInNewWindow(1);
    windowStore.getState().updateWindow(id, { viewport: { scale: 2, mode: 'pointer', scrollTop: 70, scrollLeft: 40 } });
    render(<><ReaderViewport isMain windowId="main" /><Reference id={id} /></>);
    const reference = screen.getByRole('region', { name: '参考阅读区，第 1 页' }), pending = await beginNamed(reference);
    main().focus(); const original = structuredClone(windowStore.getState().windows.find(window => window.id === 'main')); await resolve(pending);
    expect(windowStore.getState().windows.find(window => window.id === id)?.pageNumber).toBe(3);
    expect(windowStore.getState().windows.find(window => window.id === id)?.viewport?.scale).toBe(2);
    expect(windowStore.getState().windows.find(window => window.id === 'main')).toEqual(original);
    expect(windowStore.getState().activeWindowId).toBe('main'); expect(main()).toHaveFocus(); expect(useBookStore.getState().currentPage).toBe(4);
  });
  it('keeps Document alive across navigation, zoom, width, activation and raster retry', async () => {
    load(); render(<ReaderViewport isMain windowId="main" />); const region = main(), resize = geometry(region), pdf = documentState(region).pdf;
    await activate(region, [3]); fireEvent.click(screen.getByRole('button', { name: '放大' })); resize(500); region.focus();
    act(() => pageCallbacks(region).onRenderError?.(new Error('controlled raster failure'))); fireEvent.click(screen.getByRole('button', { name: '重试此页' }));
    act(() => pageCallbacks(region).onRenderSuccess?.());
    expect(life.documentMounts).toBe(1); expect(life.documentUnmounts).toBe(0); expect(documentState(region).pdf).toBe(pdf);
    await activate(region, [8]); expect(useBookStore.getState().currentPage).toBe(9);
  });
  it('retains same-page scoped scrolling and annotation focus without a state write', async () => {
    load(); render(<ReaderViewport isMain windowId="main" />); const region = main(); geometry(region); await activate(region, [5]);
    const scroll = vi.fn(); paper(region).scrollIntoView = scroll; anchor(region).focus(); const windows = windowStore.getState().windows, focus = vi.spyOn(region, 'focus');
    await activate(region, [5]); expect(scroll).toHaveBeenCalledOnce(); expect(windowStore.getState().windows).toBe(windows); expect(anchor(region)).toHaveFocus(); expect(focus).not.toHaveBeenCalled();
  });
  it('rejects old sessions before commit and accepts a fresh same-URL source', async () => {
    load(); render(<ReaderViewport isMain windowId="main" />); const old = documentState(main()), pending = await beginNamed(main());
    act(() => { load(4); old.loaded?.(old.pdf as unknown as PDFDocumentProxy); }); await resolve(pending);
    expect(useBookStore.getState().currentPage).toBe(4); expect(life.documentMounts).toBe(2); expect(life.documentUnmounts).toBe(1);
    await activate(main(), [7]); expect(useBookStore.getState().currentPage).toBe(8); expect(documentState(main()).pdf).not.toBe(old.pdf);
  });
  it('rejects a source URL replacement even if the session is unchanged', async () => {
    load(); render(<ReaderViewport isMain windowId="main" />); const pending = await beginNamed(main());
    act(() => useBookStore.setState({ documentUrl: 'memory://replacement.pdf' })); await resolve(pending); expect(useBookStore.getState().currentPage).toBe(1);
    await activate(main(), [6]); expect(useBookStore.getState().currentPage).toBe(7); expect(life.documentMounts).toBe(2);
  });
  it.each([false, true])('rejects unmounted readers even after same-session replacement (StrictMode %s)', async strict => {
    load(); const node = () => strict ? <StrictMode><ReaderViewport isMain windowId="main" /></StrictMode> : <ReaderViewport isMain windowId="main" />;
    const view = render(node()), pending = await beginNamed(main()); view.unmount(); render(node()); await resolve(pending);
    expect(useBookStore.getState().currentPage).toBe(1); await activate(main(), [6]); expect(useBookStore.getState().currentPage).toBe(7);
  });
  it('rejects closed and replaced originating windows', async () => {
    load(); const first = windowStore.getState().openInNewWindow(1), second = windowStore.getState().openInNewWindow(2);
    const view = render(<Reference id={first} />), pending = await beginNamed(screen.getByRole('region')); view.rerender(<Reference id={second} />); await resolve(pending);
    expect(windowStore.getState().windows.find(window => window.id === first)?.pageNumber).toBe(1);
    const region = screen.getByRole('region'); await activate(region, [6]); expect(windowStore.getState().windows.find(window => window.id === second)?.pageNumber).toBe(7);
    const closing = await beginNamed(region); act(() => windowStore.getState().closeWindow(second)); await resolve(closing);
    expect(windowStore.getState().windows.find(window => window.id === second)).toBeUndefined(); expect(screen.queryByText(/无法打开此链接/)).toBeNull();
  });
  it('hands departing annotation focus back before the page-store mutation', async () => {
    load(); render(<ReaderViewport isMain windowId="main" />); const region = main(); geometry(region); anchor(region).focus();
    const observed: (Element | null)[] = [], stop = windowStore.subscribe((next, prev) => { if (next.windows[0].pageNumber !== prev.windows[0].pageNumber) observed.push(document.activeElement); });
    const focus = vi.spyOn(region, 'focus'); await activate(region, [6]); stop();
    expect(observed).toEqual([region]); expect(region).toHaveFocus(); expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    fireEvent.keyDown(region, { key: 'ArrowRight' }); expect(useBookStore.getState().currentPage).toBe(8);
  });
  it.each(['toolbar', 'page-input', 'body', 'reader'])('preserves newer %s focus during resolution', async target => {
    load(); render(<><ReaderViewport isMain windowId="main" /><input aria-label="Other page input" /></>); const region = main(); geometry(region); anchor(region).focus();
    const pending = await beginNamed(region), newer = target === 'toolbar' ? screen.getByRole('button', { name: '放大' }) : target === 'page-input' ? screen.getByRole('textbox') : target === 'reader' ? region : document.body;
    if (target === 'body') anchor(region).blur(); else newer.focus(); const focus = vi.spyOn(region, 'focus'); await resolve(pending);
    expect(document.activeElement).toBe(newer); expect(focus).not.toHaveBeenCalled(); expect(useBookStore.getState().currentPage).toBe(3);
  });
  it.each(['hidden', 'inert', 'inactive'])('does not focus an annotation owner that became %s', async condition => {
    load(); const other = windowStore.getState().openInNewWindow(1); render(<ReaderViewport isMain windowId="main" />); const region = main(), resize = geometry(region); anchor(region).focus(); const pending = await beginNamed(region);
    if (condition === 'hidden') resize(0); if (condition === 'inert') region.setAttribute('inert', ''); if (condition === 'inactive') act(() => windowStore.getState().setActiveWindow(other));
    const focus = vi.spyOn(region, 'focus'); await resolve(pending); expect(focus).not.toHaveBeenCalled(); expect(useBookStore.getState().currentPage).toBe(3);
  });
  it.each(['manual', 'away-back', 'link'])('a newer %s navigation permanently supersedes an older named link', async kind => {
    load(); render(<ReaderViewport isMain windowId="main" />); const region = main(), pending = await beginNamed(region);
    if (kind === 'link') await activate(region, [1]);
    else act(() => { useBookStore.getState().setCurrentPage(2); if (kind === 'away-back') useBookStore.getState().setCurrentPage(1); });
    await resolve(pending); expect(useBookStore.getState().currentPage).toBe(kind === 'away-back' ? 1 : 2);
  });
  it('a newer same-page link supersedes an older request without a page transition', async () => {
    load(); render(<ReaderViewport isMain windowId="main" />); const region = main(), pending = await beginNamed(region);
    await activate(region, [0]); await resolve(pending); expect(useBookStore.getState().currentPage).toBe(1);
  });
  it.each(['main', 'reference'])('a newer same-page choice in %s permanently cancels a pending named link', async kind => {
    load(); const id = kind === 'main' ? 'main' : windowStore.getState().openInNewWindow(1);
    render(kind === 'main' ? <ReaderViewport isMain windowId="main" /> : <Reference id={id} />);
    const region = screen.getByRole('region');
    for (const action of ['Home', 'active-navigation'] as const) {
      const pending = await beginNamed(region);
      if (action === 'Home') fireEvent.keyDown(region, { key: 'Home' });
      else act(() => windowStore.getState().navigateActive(1));
      await resolve(pending);
      expect(windowStore.getState().windows.find(window => window.id === id)?.pageNumber).toBe(1);
    }
  });
  it.each([1, 5])('preparing a held read to page %s supersedes an older link before its delayed commit', async target => {
    load(); render(<ReaderViewport isMain windowId="main" />); const pending = await beginNamed(main());
    let prepared!: ReturnType<typeof prepareHeldRead>; act(() => { prepared = prepareHeldRead(target); });
    await resolve(pending); expect(useBookStore.getState().currentPage).toBe(1);
    act(() => { expect(prepared.commit()).toBe(true); });
    expect(useBookStore.getState().currentPage).toBe(target); prepared.dispose();
  });
  it('reference geometry, activation and viewport writes do not supersede its pending link', async () => {
    load(); const id = windowStore.getState().openInNewWindow(1); render(<Reference id={id} />);
    const region = screen.getByRole('region'), pending = await beginNamed(region);
    act(() => { windowStore.getState().setActiveWindow('main'); windowStore.getState().updateWindow(id, { x: 90, width: 400, isActive: true, zIndex: 5 });
      windowStore.getState().updateWindow(id, { viewport: { scale: 2, scrollLeft: 20, scrollTop: 30 } }); });
    await resolve(pending); expect(windowStore.getState().windows.find(window => window.id === id)?.pageNumber).toBe(3);
  });
  it('accepted same-page scene restoration retires a reference link before it can overwrite the restored scene', async () => {
    load(); const id = windowStore.getState().openInNewWindow(1); render(<Reference id={id} />);
    const region = screen.getByRole('region'), pending = await beginNamed(region);
    act(() => windowStore.getState().restoreWindows(windowStore.getState().windows, id));
    await resolve(pending); expect(windowStore.getState().windows.find(window => window.id === id)?.pageNumber).toBe(1);
    await activate(region, [6]); expect(windowStore.getState().windows.find(window => window.id === id)?.pageNumber).toBe(7);
  });
  it.each(['pending', 'committed'])('new PDF-link activation retires older %s held-read intent before resolution', async stage => {
    load(); render(<ReaderViewport isMain windowId="main" />);
    const old = prepareHeldRead(4); if (stage === 'committed') act(() => { expect(old.commit()).toBe(true); });
    const pending = await beginNamed(main());
    expect(stage === 'pending' ? old.commit() : old.rollback()).toBe(false);
    expect(useBookStore.getState().currentPage).toBe(stage === 'pending' ? 1 : 4);
    await resolve(pending); expect(useBookStore.getState().currentPage).toBe(3);
  });
  it('cancels during indirect reference resolution and catches a current reference rejection', async () => {
    load(); render(<ReaderViewport isMain windowId="main" />); const region = main(), pdf = documentState(region).pdf;
    const pending = deferred(); pdf.getPageIndex.mockReturnValueOnce(pending.promise);
    await activate(region, [{ num: 7, gen: 0 }]); act(() => useBookStore.getState().setCurrentPage(1)); await resolve(pending, 2);
    expect(useBookStore.getState().currentPage).toBe(1);
    pdf.getPageIndex.mockRejectedValueOnce(new Error('missing reference')); await activate(region, [{ num: 7, gen: 0 }]);
    expect(screen.getByRole('alert')).toHaveTextContent('无法打开此链接'); expect(useBookStore.getState().currentPage).toBe(1);
  });
  it('raster retry retires a pending link without reparsing the document', async () => {
    load(); render(<ReaderViewport isMain windowId="main" />); const region = main(), pending = await beginNamed(region), pdf = documentState(region).pdf;
    act(() => pageCallbacks(region).onRenderError?.(new Error('raster'))); fireEvent.click(screen.getByRole('button', { name: '重试此页' }));
    await resolve(pending); expect(useBookStore.getState().currentPage).toBe(1); expect(documentState(region).pdf).toBe(pdf);
  });
  it.each(['main', 'reference'])('Escape dismisses the %s link notice before any window-close handler', async kind => {
    load(); const id = windowStore.getState().openInNewWindow(1);
    render(kind === 'main' ? <ReaderViewport isMain windowId="main" /> : <Reference id={id} />);
    const region = screen.getByRole('region'), escaped = vi.fn(); window.addEventListener('keydown', escaped);
    try {
      await activate(region, [-1]); fireEvent.keyDown(screen.getByRole('button', { name: '关闭链接提示' }), { key: 'Escape' });
      expect(screen.queryByRole('alert')).toBeNull(); expect(region).toHaveFocus(); expect(escaped).not.toHaveBeenCalled();
      expect(windowStore.getState().windows).toHaveLength(2);
    } finally { window.removeEventListener('keydown', escaped); }
  });
  it.each(['keyboard', 'keyboard-pointer', 'later-pointer'])('blocks post-pinch link ghost clicks while preserving %s activation', async next => {
    load(); render(<ReaderViewport isMain windowId="main" />); const region = main(); geometry(region);
    const frame = region.querySelector<HTMLElement>('.w-max')!;
    vi.spyOn(frame, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 402, 602));
    const now = vi.spyOn(performance, 'now').mockReturnValue(1000), pdf = documentState(region).pdf;
    const touch = (identifier: number, clientX: number) => ({ identifier, clientX, clientY: 100, target: region });
    const start = [touch(1, 100), touch(2, 200)];
    fireEvent(region, new TouchEvent('touchstart', { bubbles: true, cancelable: true, touches: start as unknown as Touch[] }));
    fireEvent(region, new TouchEvent('touchend', { bubbles: true, cancelable: true, touches: [], changedTouches: start as unknown as Touch[] }));
    await act(async () => {
      metadata(region, 'chapter');
      const ghost = new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 });
      Object.defineProperty(ghost, 'pointerId', { value: 7 }); fireEvent(anchor(region), ghost);
    });
    expect(pdf.getDestination).not.toHaveBeenCalled(); expect(useBookStore.getState().currentPage).toBe(1);
    if (next === 'later-pointer') now.mockReturnValue(1601);
    await act(async () => {
      const event = new MouseEvent('click', { bubbles: true, cancelable: true, detail: next === 'keyboard' ? 0 : 1 });
      if (next === 'keyboard-pointer') Object.defineProperty(event, 'pointerId', { value: -1 });
      fireEvent(anchor(region), event);
    });
    expect(pdf.getDestination).toHaveBeenCalledOnce(); expect(useBookStore.getState().currentPage).toBe(3);
  });
  it('repeated same-destination activations complete only the latest ticket', async () => {
    load(); render(<ReaderViewport isMain windowId="main" />); const region = main(); geometry(region); const scroll = vi.fn(); paper(region).scrollIntoView = scroll;
    const first = await beginNamed(region), second = await beginNamed(region); await resolve(second, [0]); await resolve(first, [0]);
    expect(scroll).toHaveBeenCalledOnce(); expect(useBookStore.getState().currentPage).toBe(1); expect(documentState(region).pdf.getDestination).toHaveBeenCalledTimes(2);
  });
  it.each(['open', 'cancel', 'commit'])('QuickFlip %s supersedes the originating reader link', async kind => {
    load(); render(<ReaderViewport isMain windowId="main" />); const pending = await beginNamed(main());
    act(() => { quickFlipStore.getState().open(); if (kind === 'commit') { quickFlipStore.getState().setSelectedPage(2); quickFlipStore.getState().commitSelection(); } else if (kind === 'cancel') quickFlipStore.getState().close(); });
    await resolve(pending); expect(useBookStore.getState().currentPage).toBe(kind === 'commit' ? 2 : 1);
  });
  it('another pane opening QuickFlip does not cancel the source reader', async () => {
    load(); const id = windowStore.getState().openInNewWindow(4); render(<><ReaderViewport isMain windowId="main" /><Reference id={id} /></>);
    const reference = screen.getByRole('region', { name: '参考阅读区，第 4 页' }), pending = await beginNamed(reference); main().focus(); act(() => quickFlipStore.getState().open()); await resolve(pending);
    expect(windowStore.getState().windows.find(window => window.id === id)?.pageNumber).toBe(3); expect(useBookStore.getState().currentPage).toBe(1); expect(main()).toHaveFocus();
  });
  it('ignores old page/retry metadata and prevents stale internal native activation', async () => {
    load(); render(<ReaderViewport isMain windowId="main" />); const region = main(), old = pageCallbacks(region);
    act(() => { useBookStore.getState().setCurrentPage(2); });
    await act(async () => { old.onGetAnnotationsSuccess?.([{ id: 'local', annotationType: 2, dest: [9] }]); fireEvent.click(anchor(region)); });
    expect(useBookStore.getState().currentPage).toBe(7);
    const beforeRetry = pageCallbacks(region); act(() => beforeRetry.onRenderError?.(new Error('raster'))); fireEvent.click(screen.getByRole('button', { name: '重试此页' }));
    await act(async () => { beforeRetry.onGetAnnotationsSuccess?.([{ id: 'local', annotationType: 2, dest: [9] }]); fireEvent.click(anchor(region)); });
    expect(useBookStore.getState().currentPage).toBe(7);
    await activate(region, [3]); expect(useBookStore.getState().currentPage).toBe(4); expect(life.nativeClicks).toEqual([]);
  });
  it('blocks uncached or stale internal anchors without intercepting an external URI', async () => {
    load(); render(<ReaderViewport isMain windowId="main" />); const region = main();
    await act(async () => { pageCallbacks(region).onGetAnnotationsSuccess?.([]); fireEvent.click(anchor(region)); });
    expect(useBookStore.getState().currentPage).toBe(1); expect(life.nativeClicks).toEqual([]);
    fireEvent.click(region.querySelector('[data-annotation-id="external"] a')!); expect(life.nativeClicks).toEqual([false]);
    await act(async () => { metadata(region, [6]); paper(region).dataset.pageNumber = '9'; fireEvent.click(anchor(region)); });
    expect(useBookStore.getState().currentPage).toBe(1); expect(life.nativeClicks).toEqual([false]);
  });
  it('does not start a new internal request inside an inert or QuickFlip-owned reader', async () => {
    load(); render(<ReaderViewport isMain windowId="main" />); const region = main(), pdf = documentState(region).pdf;
    region.setAttribute('inert', ''); await activate(region, 'chapter'); region.removeAttribute('inert');
    act(() => quickFlipStore.getState().open()); await activate(region, 'chapter');
    expect(pdf.getDestination).not.toHaveBeenCalled(); expect(useBookStore.getState().currentPage).toBe(1); expect(life.nativeClicks).toEqual([]);
  });
  it.each(['url', 'action', 'attachment', 'setOCGState'])('preserves higher-priority %s annotations and external links', async field => {
    load(); render(<ReaderViewport isMain windowId="main" />); await activate(main(), [6], { [field]: field === 'url' ? 'https://example.com/paper' : {} });
    fireEvent.click(main().querySelector('[data-annotation-id="external"] a')!);
    expect(life.nativeClicks).toEqual([false, false]); expect(useBookStore.getState().currentPage).toBe(1);
  });
  it.each([null, [], [-1], [1.5], [NaN], [Infinity], [12], [{}]])('reports an invalid owned destination %j without changing page or focus', async destination => {
    load(); render(<ReaderViewport isMain windowId="main" />); const region = main(); geometry(region); anchor(region).focus();
    if (destination === null) { documentState(region).pdf.getDestination.mockResolvedValueOnce(null); await activate(region, 'missing'); }
    else await activate(region, destination);
    expect(screen.getByRole('alert')).toHaveTextContent('无法打开此链接'); expect(useBookStore.getState().currentPage).toBe(1); expect(anchor(region)).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: '关闭链接提示' })); expect(region).toHaveFocus(); expect(screen.queryByRole('alert')).toBeNull();
  });
  it('reports only a current rejection; superseded failures never publish a notice', async () => {
    load(); render(<ReaderViewport isMain windowId="main" />); const region = main(); const old = await beginNamed(region); await activate(region, [1]);
    await act(async () => old.reject(new Error('retired read failure'))); expect(screen.queryByRole('alert')).toBeNull();
    const current = await beginNamed(region); await act(async () => current.reject(new Error('current read failure'))); expect(screen.getByRole('alert')).toHaveTextContent('无法打开此链接');
    await activate(region, [3]); expect(screen.queryByRole('alert')).toBeNull(); expect(useBookStore.getState().currentPage).toBe(4);
  });
});
