import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from 'react';

type Point = { x: number; y: number };
type Gesture =
  | { kind: 'swipe'; id: number; start: Point; last: Point; time: number }
  | { kind: 'pinch'; ids: number[]; distance: number; scale: number; frame: Point; anchor: Point; paperPoint: Point; midpoint: Point; nextScale: number }
  | { kind: 'blocked' }
  | { kind: 'native' };

interface Options {
  containerRef: RefObject<HTMLDivElement | null>;
  frameRef: RefObject<HTMLDivElement | null>;
  contextKey: string;
  scale: number;
  canSwipe: boolean;
  isActive: boolean;
  onActivate: () => void;
  onTurn: (direction: number) => void;
  getPaperBounds: () => { left: number; top: number; width: number; height: number } | null;
  // The source point is normalized to the untransformed paper at pinch start.
  onZoom: (scale: number, paperPoint: Point, midpoint: Point) => void;
}
const point = (touch: Touch): Point => ({ x: touch.clientX, y: touch.clientY });
const midpoint = (a: Touch, b: Touch): Point => ({ x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 });
const distance = (a: Touch, b: Touch) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);

/** Local, transactional touch gestures. Native one-finger scrolling is never replaced. */
export function useReaderGestures(options: Options) {
  const latest = useRef(options);
  useLayoutEffect(() => { latest.current = options; });
  const cancelRef = useRef<() => void>(() => {});
  const suppressClickUntil = useRef(0);
  // React root capture runs before the reader's native capture listener.
  // Share this guard with PDF link capture so a post-gesture ghost click
  // cannot navigate first. Keyboard activation (detail=0) stays available.
  const suppressClick = useCallback((event: Pick<MouseEvent, 'detail' | 'preventDefault' | 'stopPropagation'>) => {
    if (event.detail === 0 || performance.now() >= suppressClickUntil.current) return false;
    event.preventDefault(); event.stopPropagation();
    return true;
  }, []);
  useEffect(() => { cancelRef.current(); }, [options.contextKey]);
  useEffect(() => { if (!options.isActive) cancelRef.current(); }, [options.isActive]);

  useEffect(() => {
    const container = options.containerRef.current;
    const frame = options.frameRef.current;
    if (!container || !frame) return;
    let gesture: Gesture | null = null;
    const clearPreview = () => { frame.style.transform = ''; frame.style.transformOrigin = ''; frame.style.willChange = ''; };
    const cancel = () => { clearPreview(); gesture = null; };
    const interrupt = () => {
      const ongoing = !!gesture;
      cancel();
      if (ongoing) gesture = { kind: 'blocked' };
    };
    cancelRef.current = interrupt;
    const unavailable = () => !!container.closest('[inert]') || container.clientWidth === 0 || container.clientHeight === 0;
    const start = (event: TouchEvent) => {
      if (unavailable()) {
        if (event.touches.length) interrupt(); else cancel();
        return;
      }
      const touches = Array.from(event.touches);
      // A fresh single-contact start also recovers after an OS interruption that
      // never delivered its final touchend. Surviving multi-touch stays blocked.
      if (gesture?.kind === 'blocked' && touches.length === 1) gesture = null;
      // A second finger on a different pane must never zoom the first pane.
      if (touches.some(touch => !container.contains(touch.target as Node)) || touches.length > 2) { cancel(); gesture = { kind: 'blocked' }; return; }
      latest.current.onActivate();
      if (touches.length === 2 && gesture?.kind !== 'blocked') {
        if (!event.cancelable) { cancel(); gesture = { kind: 'blocked' }; return; }
        const [a, b] = touches;
        const center = midpoint(a, b);
        const rect = frame.getBoundingClientRect();
        const paper = latest.current.getPaperBounds();
        if (!paper?.width || !paper.height) { cancel(); gesture = { kind: 'blocked' }; return; }
        const paperPoint = { x: (center.x - paper.left) / paper.width, y: (center.y - paper.top) / paper.height };
        const span = distance(a, b);
        if (span < 12) { gesture = { kind: 'blocked' }; return; }
        clearPreview();
        gesture = { kind: 'pinch', ids: [a.identifier, b.identifier], distance: span, scale: latest.current.scale, nextScale: latest.current.scale,
          paperPoint, frame: { x: rect.left, y: rect.top }, anchor: { x: center.x - rect.left, y: center.y - rect.top }, midpoint: center };
        event.preventDefault();
        return;
      }
      if (touches.length !== 1 || gesture) return;
      const interactive = event.target instanceof Element && event.target.closest('a, button, input, textarea, select, [contenteditable="true"]');
      // At intentional zoom overflow, horizontal movement pans the paper instead.
      if (interactive || !latest.current.canSwipe || container.scrollWidth > container.clientWidth + 2) { gesture = { kind: 'native' }; return; }
      gesture = { kind: 'swipe', id: touches[0].identifier, start: point(touches[0]), last: point(touches[0]), time: performance.now() };
    };
    const move = (event: TouchEvent) => {
      if (!gesture || gesture.kind === 'blocked' || gesture.kind === 'native') return;
      if (unavailable() || !event.cancelable) { cancel(); gesture = { kind: 'blocked' }; return; }
      if (gesture.kind === 'pinch') {
        const touches = Array.from(event.touches);
        const a = touches.find(touch => touch.identifier === (gesture?.kind === 'pinch' ? gesture.ids[0] : -1));
        const b = touches.find(touch => touch.identifier === (gesture?.kind === 'pinch' ? gesture.ids[1] : -1));
        if (!a || !b || touches.length !== 2) { cancel(); gesture = { kind: 'blocked' }; return; }
        event.preventDefault();
        const nextScale = Math.max(0.1, Math.min(4, gesture.scale * distance(a, b) / gesture.distance));
        const ratio = nextScale / gesture.scale;
        gesture.nextScale = nextScale;
        gesture.midpoint = midpoint(a, b);
        frame.style.transformOrigin = '0 0';
        frame.style.willChange = 'transform';
        frame.style.transform = `translate(${gesture.midpoint.x - gesture.frame.x - gesture.anchor.x * ratio}px, ${gesture.midpoint.y - gesture.frame.y - gesture.anchor.y * ratio}px) scale(${ratio})`;
        suppressClickUntil.current = performance.now() + 600;
      } else {
        const touch = Array.from(event.touches).find(touch => touch.identifier === (gesture?.kind === 'swipe' ? gesture.id : -1));
        if (!touch || event.touches.length !== 1) { cancel(); return; }
        gesture.last = point(touch);
        const dx = Math.abs(gesture.last.x - gesture.start.x);
        const dy = Math.abs(gesture.last.y - gesture.start.y);
        if (dy > 12 && dy * 1.5 >= dx) { gesture = { kind: 'blocked' }; return; }
        if (dx > 12 && dx > dy * 1.5) event.preventDefault();
      }
    };
    const end = (event: TouchEvent) => {
      if (unavailable()) {
        if (event.touches.length) interrupt(); else cancel();
        return;
      }
      const completed = gesture;
      if (completed?.kind === 'pinch') {
        clearPreview();
        // Once a pinch ends, remaining fingers cannot become a swipe.
        gesture = event.touches.length ? { kind: 'blocked' } : null;
        if (Math.abs(completed.nextScale - completed.scale) > 0.0001) latest.current.onZoom(completed.nextScale,
          completed.paperPoint, completed.midpoint);
        suppressClickUntil.current = performance.now() + 600;
      } else if (!event.touches.length) {
        gesture = null;
        if (completed?.kind !== 'swipe') return;
        const touch = Array.from(event.changedTouches).find(touch => touch.identifier === completed.id);
        const last = touch ? point(touch) : completed.last;
        const dx = last.x - completed.start.x;
        const dy = last.y - completed.start.y;
        if (Math.abs(dx) >= 56 && Math.abs(dx) > Math.abs(dy) * 1.5 && performance.now() - completed.time <= 700) {
          if (event.cancelable) event.preventDefault();
          suppressClickUntil.current = performance.now() + 600;
          latest.current.onTurn(dx < 0 ? 1 : -1);
        }
      }
    };
    const cancelTouch = (event: TouchEvent) => { cancel(); if (event.touches.length) gesture = { kind: 'blocked' }; };
    const click = (event: MouseEvent) => { suppressClick(event); };
    const visibility = () => { if (document.hidden) interrupt(); };
    const key = (event: KeyboardEvent) => {
      if ((gesture?.kind === 'pinch' || gesture?.kind === 'swipe') && (event.key === 'Escape' || event.key === ' ')) {
        event.preventDefault(); event.stopPropagation(); interrupt();
      }
    };
    const observer = new MutationObserver(() => { if (gesture && unavailable()) interrupt(); });
    observer.observe(document.body, { attributes: true, attributeFilter: ['inert'], subtree: true });
    container.addEventListener('touchstart', start, { passive: false });
    container.addEventListener('touchmove', move, { passive: false });
    container.addEventListener('touchend', end, { passive: false });
    container.addEventListener('touchcancel', cancelTouch);
    container.addEventListener('click', click, true);
    window.addEventListener('keydown', key, true);
    window.addEventListener('blur', interrupt);
    window.addEventListener('resize', interrupt);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      cancel();
      observer.disconnect();
      container.removeEventListener('touchstart', start);
      container.removeEventListener('touchmove', move);
      container.removeEventListener('touchend', end);
      container.removeEventListener('touchcancel', cancelTouch);
      container.removeEventListener('click', click, true);
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('blur', interrupt);
      window.removeEventListener('resize', interrupt);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [options.containerRef, options.frameRef, suppressClick]);
  return { suppressClick };
}
