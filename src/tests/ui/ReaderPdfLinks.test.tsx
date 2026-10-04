import { useEffect, useRef, type PropsWithChildren, type Ref } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReaderViewport } from '../../components/reader/ReaderViewport';
import { useBookStore } from '../../stores/bookStore';
import { windowStore } from '../../stores/windowStore';

type LinkCallback = (target: { pageNumber: number }) => void;
type PageCallbacks = { onRenderError?: (error: Error) => void; onRenderSuccess?: () => void };
const life = vi.hoisted(() => ({ nextDocument: 0, documentMounts: 0, documentUnmounts: 0, pageMounts: 0,
  initialLinks: new Map<number, LinkCallback | undefined>(), pages: new Map<number, PageCallbacks>() }));
vi.mock('react-pdf', () => ({
  pdfjs: { GlobalWorkerOptions: {}, version: 'test' },
  Document: function MockDocument({ children, onItemClick }: PropsWithChildren<{ onItemClick?: LinkCallback }>) {
    const id = useRef(0); if (!id.current) id.current = ++life.nextDocument;
    // React-PDF's viewer captures its initial callback in useRef. Reading the
    // latest prop here would hide document-replacement ownership defects.
    const initial = useRef(onItemClick); life.initialLinks.set(id.current, initial.current);
    useEffect(() => { life.documentMounts++; return () => { life.documentUnmounts++; }; }, []);
    return <div data-document={id.current}>{children}</div>;
  },
  Page: function MockPage(props: PageCallbacks & { pageNumber: number; inputRef?: Ref<HTMLDivElement> }) {
    const id = useRef(0); if (!id.current) id.current = ++life.pageMounts;
    life.pages.set(id.current, props);
    return <div ref={props.inputRef} className="react-pdf__Page" data-page-number={props.pageNumber}>
      <canvas /><div className="annotationLayer"><a key={props.pageNumber} href="#link">PDF page {props.pageNumber} link</a></div>
    </div>;
  },
}));
vi.mock('../../services/ThumbnailService', () => ({ thumbnailService: { activateDocument: vi.fn(), releaseDocument: vi.fn(), ensureThumbnail: vi.fn().mockResolvedValue(undefined) } }));
const observers: (() => void)[] = [];
function load(initialPage = 3) {
  useBookStore.getState().setDocumentReady({ documentId: 'links', documentUrl: 'memory://links.pdf', totalPages: 12, initialPage });
}
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
function callback(region: HTMLElement) { return life.initialLinks.get(Number(region.querySelector('[data-document]')!.getAttribute('data-document'))); }
function navigate(link: LinkCallback | undefined, pageNumber: number) { act(() => link?.({ pageNumber })); }
const main = () => screen.getByRole('region', { name: '主阅读区' });
const paper = (region: HTMLElement) => region.querySelector<HTMLElement>('.react-pdf__Page')!;
const anchor = (region: HTMLElement) => region.querySelector<HTMLAnchorElement>('.annotationLayer a')!;

beforeEach(() => {
  useBookStore.getState().reset(); windowStore.getState().reset();
  Object.assign(life, { nextDocument: 0, documentMounts: 0, documentUnmounts: 0, pageMounts: 0 }); life.initialLinks.clear(); life.pages.clear(); observers.length = 0;
  vi.stubGlobal('ResizeObserver', class { constructor(callback: () => void) { observers.push(callback); } observe() {} disconnect() {} });
  vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1); vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('owner-scoped internal PDF links', () => {
  it('navigates main using the resolved page and keeps its independent scale', () => {
    load(); useBookStore.getState().setScale(2); render(<ReaderViewport isMain windowId="main" />);
    navigate(callback(main()), 7);
    expect(useBookStore.getState().currentPage).toBe(7); expect(useBookStore.getState().scale).toBe(2);
    expect(windowStore.getState().windows[0].pageNumber).toBe(7);
  });

  it('treats implicit and explicit main IDs as the same Document owner', () => {
    load(); const view = render(<ReaderViewport isMain />); const initial = callback(main());
    view.rerender(<ReaderViewport isMain windowId="main" />); navigate(initial, 7);
    expect(useBookStore.getState().currentPage).toBe(7);
    view.rerender(<ReaderViewport isMain />); navigate(initial, 4);
    expect(useBookStore.getState().currentPage).toBe(4); expect(life.documentMounts).toBe(1);
  });

  it('keeps delayed reference completion owned by its source after activity and focus move elsewhere', () => {
    load(); const id = windowStore.getState().openInNewWindow(1);
    windowStore.getState().updateWindow(id, { viewport: { scale: 2, mode: 'pointer', scrollTop: 70, scrollLeft: 40 } });
    render(<><ReaderViewport isMain windowId="main" /><Reference id={id} /></>);
    const reference = screen.getByRole('region', { name: '参考阅读区，第 1 页' }), link = callback(reference);
    main().focus(); const originalMain = structuredClone(windowStore.getState().windows.find(window => window.id === 'main'));
    navigate(link, 8);
    const current = windowStore.getState();
    expect(current.windows.find(window => window.id === id)?.pageNumber).toBe(8);
    expect(current.windows.find(window => window.id === id)?.viewport?.scale).toBe(2);
    expect(current.windows.find(window => window.id === 'main')).toEqual(originalMain);
    expect(current.activeWindowId).toBe('main'); expect(main()).toHaveFocus(); expect(useBookStore.getState().currentPage).toBe(3);
  });

  it('retains initial Document callbacks through page, zoom, width, activation and raster retry changes', () => {
    load(); render(<ReaderViewport isMain windowId="main" />); const region = main(), resize = geometry(region), link = callback(region);
    navigate(link, 4); fireEvent.click(screen.getByRole('button', { name: '放大' })); resize(500); region.focus();
    act(() => life.pages.get(life.pageMounts)?.onRenderError?.(new Error('controlled raster failure')));
    fireEvent.click(screen.getByRole('button', { name: '重试此页' }));
    act(() => life.pages.get(life.pageMounts)?.onRenderSuccess?.());
    expect(life.documentMounts).toBe(1); expect(life.documentUnmounts).toBe(0); expect(callback(region)).toBe(link);
    navigate(link, 9); expect(useBookStore.getState().currentPage).toBe(9);
  });

  it('keeps same-page scrolling scoped to the currently displayed Page without moving focus', () => {
    load(); render(<ReaderViewport isMain windowId="main" />); const region = main(); geometry(region);
    navigate(callback(region), 6); const scroll = vi.fn(); paper(region).scrollIntoView = scroll; anchor(region).focus();
    const windows = windowStore.getState().windows, focus = vi.spyOn(region, 'focus');
    navigate(callback(region), 6);
    expect(scroll).toHaveBeenCalledOnce(); expect(windowStore.getState().windows).toBe(windows);
    expect(anchor(region)).toHaveFocus(); expect(focus).not.toHaveBeenCalled();
  });

  it('rejects a retired session before commit and accepts links from a fresh same-URL Document', () => {
    load(); render(<ReaderViewport isMain windowId="main" />); const old = callback(main());
    act(() => { load(4); old?.({ pageNumber: 9 }); });
    expect(useBookStore.getState().currentPage).toBe(4); expect(life.documentMounts).toBe(2); expect(life.documentUnmounts).toBe(1);
    navigate(callback(main()), 8); expect(useBookStore.getState().currentPage).toBe(8);
    navigate(old, 2); expect(useBookStore.getState().currentPage).toBe(8);
  });

  it('retires a source URL change even when its session number is retained', () => {
    load(); render(<ReaderViewport isMain windowId="main" />); const old = callback(main());
    act(() => useBookStore.setState({ documentUrl: 'memory://replacement.pdf' }));
    navigate(old, 10); expect(useBookStore.getState().currentPage).toBe(3);
    navigate(callback(main()), 7); expect(useBookStore.getState().currentPage).toBe(7); expect(life.documentMounts).toBe(2);
  });

  it('rejects callbacks from an unmounted reader even if a replacement uses the same session', () => {
    load(); const view = render(<ReaderViewport isMain windowId="main" />); const old = callback(main()); view.unmount();
    render(<ReaderViewport isMain windowId="main" />); navigate(old, 10);
    expect(useBookStore.getState().currentPage).toBe(3); navigate(callback(main()), 7); expect(useBookStore.getState().currentPage).toBe(7);
  });

  it('rejects a closed origin and never redirects a stale owner callback to another reader', () => {
    load(); const first = windowStore.getState().openInNewWindow(1), second = windowStore.getState().openInNewWindow(2);
    const view = render(<Reference id={first} />); const old = callback(screen.getByRole('region'));
    view.rerender(<Reference id={second} />); navigate(old, 8);
    expect(windowStore.getState().windows.find(window => window.id === first)?.pageNumber).toBe(1);
    navigate(callback(screen.getByRole('region')), 7); expect(windowStore.getState().windows.find(window => window.id === second)?.pageNumber).toBe(7);
    const retired = callback(screen.getByRole('region'));
    act(() => { windowStore.getState().closeWindow(second); retired?.({ pageNumber: 6 }); });
    expect(windowStore.getState().windows.find(window => window.id === second)).toBeUndefined();
  });

  it('hands disappearing annotation focus to its reader before cross-page navigation', () => {
    load(); render(<ReaderViewport isMain windowId="main" />); const region = main(); geometry(region); anchor(region).focus();
    const focus = vi.spyOn(region, 'focus'); navigate(callback(region), 7);
    expect(region).toHaveFocus(); expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    fireEvent.keyDown(region, { key: 'ArrowRight' }); expect(useBookStore.getState().currentPage).toBe(8);
  });

  it.each(['toolbar', 'page-input', 'body', 'reader'])('preserves newer %s focus without redundant handback', target => {
    load(); render(<><ReaderViewport isMain windowId="main" /><input aria-label="Other page input" /></>); const region = main(); geometry(region);
    anchor(region).focus();
    const newer = target === 'toolbar' ? screen.getByRole('button', { name: '放大' }) : target === 'page-input' ? screen.getByRole('textbox') : target === 'reader' ? region : document.body;
    if (target === 'body') anchor(region).blur(); else newer.focus();
    const focus = vi.spyOn(region, 'focus'); navigate(callback(region), 7);
    expect(document.activeElement).toBe(newer); expect(focus).not.toHaveBeenCalled(); expect(useBookStore.getState().currentPage).toBe(7);
  });

  it.each(['hidden', 'inert', 'inactive'])('does not focus an annotation owner that became %s', condition => {
    load(); const other = windowStore.getState().openInNewWindow(1); render(<ReaderViewport isMain windowId="main" />);
    const region = main(), resize = geometry(region); anchor(region).focus();
    if (condition === 'hidden') resize(0);
    if (condition === 'inert') region.setAttribute('inert', '');
    if (condition === 'inactive') act(() => windowStore.getState().setActiveWindow(other));
    const focus = vi.spyOn(region, 'focus'); navigate(callback(region), 7);
    expect(focus).not.toHaveBeenCalled(); expect(useBookStore.getState().currentPage).toBe(7);
  });

  it('validates destination bounds before any navigation or focus write', () => {
    load(); render(<ReaderViewport isMain windowId="main" />); const region = main(); geometry(region); anchor(region).focus();
    const windows = windowStore.getState().windows, focus = vi.spyOn(region, 'focus');
    for (const value of [0, -1, 1.5, NaN, Infinity, 13]) navigate(callback(region), value);
    expect(windowStore.getState().windows).toBe(windows); expect(anchor(region)).toHaveFocus(); expect(focus).not.toHaveBeenCalled();
  });
});
