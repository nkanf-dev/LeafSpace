import { StrictMode, useEffect, useRef, type ComponentProps } from 'react';
import type { PDFPageProxy } from 'pdfjs-dist';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReaderViewport } from '../../components/reader/ReaderViewport';
import { useBookStore } from '../../stores/bookStore';
import { windowStore } from '../../stores/windowStore';

type Callbacks = { onLoadSuccess: (page: PDFPageProxy) => void; onRenderSuccess: () => void; onRenderError?: (error: Error) => void };
const life = vi.hoisted(() => ({ documentMounts: 0, documentUnmounts: 0, pageMounts: 0, pageUnmounts: 0, nextId: 0, callbacks: new Map<number, Callbacks>() }));
vi.mock('react-pdf', () => ({
  pdfjs: { GlobalWorkerOptions: {}, version: 'test' },
  Document: function MockDocument({ children }: ComponentProps<'div'>) {
    useEffect(() => { life.documentMounts++; return () => { life.documentUnmounts++; }; }, []);
    return <div>{children}</div>;
  },
  Page: function MockPage(props: Callbacks & { pageNumber: number; scale: number }) {
    const id = useRef(0); if (!id.current) id.current = ++life.nextId;
    life.callbacks.set(id.current, props);
    useEffect(() => { life.pageMounts++; return () => { life.pageUnmounts++; }; }, []);
    return <canvas data-testid={`pdf-canvas-${id.current}`} data-page={props.pageNumber} data-scale={props.scale} />;
  },
}));
vi.mock('../../services/ThumbnailService', () => ({ thumbnailService: { activateDocument: vi.fn(), releaseDocument: vi.fn(), ensureThumbnail: vi.fn().mockResolvedValue(undefined) } }));
const observers: (() => void)[] = [];
const frames = new Map<number, FrameRequestCallback>(); let frameId = 0;
function complete(callbacks: Callbacks) {
  act(() => callbacks.onRenderSuccess());
  act(() => { const queued = [...frames.values()]; frames.clear(); queued.forEach(callback => callback(0)); });
}
function fail(callbacks: Callbacks) { act(() => callbacks.onRenderError?.(new Error('Synthetic rejected rasterization'))); }
function load(scale = 1) {
  useBookStore.getState().setDocumentReady({ documentId: 'recovery', documentUrl: 'memory://recovery.pdf', totalPages: 12, initialPage: 3, scale });
  windowStore.getState().updateWindow('main', { viewport: { scale, mode: 'grab', scrollLeft: 150, scrollTop: 300 } });
}
function geometry(region: HTMLElement) {
  let width = 400;
  Object.defineProperties(region, { clientWidth: { configurable: true, get: () => width }, clientHeight: { configurable: true, value: 300 }, scrollWidth: { configurable: true, value: 3000 }, scrollHeight: { configurable: true, value: 8000 } });
  act(() => observers.forEach(observer => observer()));
  return (nextWidth: number) => { width = nextWidth; act(() => observers.forEach(observer => observer())); };
}
const current = () => life.callbacks.get(life.nextId)!;
const retry = () => screen.getByRole('button', { name: /^重试此页/ });

beforeEach(() => {
  useBookStore.getState().reset(); windowStore.getState().reset();
  Object.assign(life, { documentMounts: 0, documentUnmounts: 0, pageMounts: 0, pageUnmounts: 0, nextId: 0 }); life.callbacks.clear();
  observers.length = 0; frames.clear(); frameId = 0;
  vi.stubGlobal('ResizeObserver', class { constructor(callback: () => void) { observers.push(callback); } observe() {} disconnect() {} });
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { frames.set(++frameId, callback); return frameId; });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => { frames.delete(id); });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('page-local raster failure recovery', () => {
  it.each([0.1, 1, 4])('retries only Page at scale %s and preserves the document and desired viewport', scale => {
    load(scale); render(<ReaderViewport isMain windowId="main" />);
    const region = screen.getByRole('region', { name: '主阅读区' }); geometry(region);
    const original = current(); complete(original);
    const before = structuredClone(windowStore.getState().windows);
    region.focus(); fail(original);
    expect(screen.getByRole('alert')).toHaveTextContent(/第\s*3\s*页暂时无法显示/);
    expect(region).toHaveFocus(); expect(life.pageMounts).toBe(1);
    retry().focus(); fireEvent.click(retry());
    expect(region).toHaveFocus();
    expect(life.pageMounts).toBe(2); expect(life.pageUnmounts).toBe(1);
    expect(life.documentMounts).toBe(1); expect(life.documentUnmounts).toBe(0);
    expect(screen.getByRole('status')).toHaveTextContent(/正在重试.*3/);
    const next = current();
    act(() => next.onLoadSuccess({ pageNumber: 3, getViewport: () => ({ width: 420, height: 594 }) } as unknown as PDFPageProxy));
    expect(screen.getByRole('status')).toHaveTextContent(/正在重试.*3/);
    complete(current());
    expect(screen.queryByRole('alert')).toBeNull(); expect(screen.queryByRole('status')).toBeNull();
    expect(useBookStore.getState().scale).toBe(scale);
    expect(windowStore.getState().windows).toEqual(before);
    expect([region.scrollLeft, region.scrollTop]).toEqual([150, 300]);
  });

  it('keeps failed attempts explicit and ignores double clicks and superseded callbacks', () => {
    load(); render(<ReaderViewport isMain windowId="main" />);
    geometry(screen.getByRole('region', { name: '主阅读区' }));
    const initial = current(); fail(initial);
    const button = retry();
    act(() => { fireEvent.click(button); fireEvent.click(button); initial.onRenderError?.(new Error('old failure')); initial.onRenderSuccess(); });
    expect(life.pageMounts).toBe(2);
    expect(screen.getByRole('status')).toHaveTextContent(/正在重试/);
    const second = current(); fail(second);
    expect(screen.getByRole('alert')).toBeVisible();
    act(() => observers.forEach(observer => observer()));
    expect(life.pageMounts).toBe(2); // No automatic retry from layout or state updates.
    fireEvent.click(retry()); expect(life.pageMounts).toBe(3);
    complete(second); expect(screen.getByRole('status')).toHaveTextContent(/正在重试/);
    complete(current()); expect(screen.queryByRole('alert')).toBeNull();
    expect(life.documentMounts).toBe(1); expect(life.documentUnmounts).toBe(0);
  });

  it.each(['page', 'zoom', 'width', 'session'])('rejects obsolete %s owners, including changes away and back', kind => {
    load(); render(<ReaderViewport isMain windowId="main" />);
    const resize = geometry(screen.getByRole('region', { name: '主阅读区' })); const initial = current();
    if (kind === 'page') { act(() => useBookStore.getState().setCurrentPage(4)); act(() => useBookStore.getState().setCurrentPage(3)); }
    else if (kind === 'zoom') { fireEvent.click(screen.getByRole('button', { name: '放大' })); fireEvent.click(screen.getByRole('button', { name: '恢复适合宽度' })); }
    else if (kind === 'width') { resize(500); resize(400); }
    else act(() => useBookStore.getState().setDocumentReady({ documentId: 'recovery', documentUrl: 'memory://recovery.pdf', totalPages: 12, initialPage: 3, scale: 1 }));
    fail(current()); expect(screen.getByRole('alert')).toBeVisible();
    complete(initial); expect(screen.getByRole('alert')).toBeVisible();
    fireEvent.click(retry());
    fail(initial); expect(screen.getByRole('status')).toHaveTextContent(/正在重试/);
    complete(current()); expect(screen.queryByRole('alert')).toBeNull();
  });

  it('keeps background pane failures and completion passive, but lets Retry activate its own pane', async () => {
    load(); const id = windowStore.getState().openInNewWindow(3);
    windowStore.getState().setActiveWindow('main');
    render(<><ReaderViewport isMain windowId="main" /><ReaderViewport pageNumber={3} windowId={id} /></>);
    const main = screen.getByRole('region', { name: '主阅读区' }); main.focus();
    const referenceCallbacks = current(); fail(referenceCallbacks);
    expect(screen.getByRole('alert')).toBeVisible(); expect(main).toHaveFocus();
    expect(windowStore.getState().activeWindowId).toBe('main');
    await userEvent.setup().click(retry());
    const reference = screen.getByRole('region', { name: '参考阅读区，第 3 页' });
    expect(reference).toHaveFocus(); expect(windowStore.getState().activeWindowId).toBe(id);
    main.focus(); complete(current());
    expect(main).toHaveFocus(); expect(windowStore.getState().activeWindowId).toBe('main');
    expect(useBookStore.getState().currentPage).toBe(3);
  });

  it('returns owned Retry focus to the reader when a resize removes its old error card', () => {
    load(); render(<ReaderViewport isMain windowId="main" />);
    const region = screen.getByRole('region', { name: '主阅读区' }); const resize = geometry(region);
    fail(current()); retry().focus();
    resize(500);
    expect(screen.queryByRole('button', { name: /^重试此页/ })).toBeNull();
    expect(region).toHaveFocus();
    fail(current()); retry().focus();
    const newer = screen.getByRole('button', { name: '选择文字' }); newer.focus();
    resize(450);
    expect(newer).toHaveFocus();
  });

  it.each([false, true])('retires load/error/success callback ownership after unmount (StrictMode %s)', strict => {
    load();
    const view = render(strict ? <StrictMode><ReaderViewport isMain windowId="main" /></StrictMode> : <ReaderViewport isMain windowId="main" />);
    const old = current();
    view.unmount();
    const schedule = vi.mocked(window.requestAnimationFrame); schedule.mockClear();
    act(() => {
      old.onLoadSuccess({ pageNumber: 3, getViewport: () => ({ width: 420, height: 594 }) } as unknown as PDFPageProxy);
      old.onRenderError?.(new Error('late error'));
      old.onRenderSuccess();
    });
    expect(schedule).not.toHaveBeenCalled();
    expect(frames.size).toBe(0);
  });

  it('cancels an older pinch preview when explicit Retry starts a new attempt', () => {
    load(); render(<ReaderViewport isMain windowId="main" />);
    const region = screen.getByRole('region', { name: '主阅读区' }); geometry(region);
    const frame = region.querySelector<HTMLElement>('.w-max')!;
    vi.spyOn(frame, 'getBoundingClientRect').mockReturnValue(new DOMRect(40, 60, 300, 420));
    fail(current());
    const touch = (id: number, x: number) => ({ identifier: id, clientX: x, clientY: 150, target: frame });
    fireEvent.touchStart(region, { touches: [touch(1, 100), touch(2, 200)] });
    fireEvent.touchMove(region, { touches: [touch(1, 50), touch(2, 250)] });
    expect(frame.style.transform).toContain('scale(2)');
    fireEvent.click(retry());
    expect(frame.style.transform).toBe('');
    fireEvent.touchEnd(region, { touches: [], changedTouches: [touch(1, 50), touch(2, 250)] });
    expect(useBookStore.getState().scale).toBe(1);
    expect(life.pageMounts).toBe(2);
  });

  it('keeps the retry button outside the grab-pan scrollport and supports native keyboard activation', async () => {
    load(); render(<ReaderViewport isMain windowId="main" />);
    const region = screen.getByRole('region', { name: '主阅读区' }); geometry(region); fail(current());
    const button = retry(); expect(region.contains(button)).toBe(false);
    button.focus(); await userEvent.setup().keyboard(' ');
    expect(life.pageMounts).toBe(2); expect(region).toHaveFocus();
    expect(region).toHaveStyle({ cursor: 'grab' });
    complete(current());
  });
});
