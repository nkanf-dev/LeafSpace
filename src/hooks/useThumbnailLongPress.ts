import { useCallback, useLayoutEffect, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent, MouseEvent as ReactMouseEvent } from 'react';
import type { ThumbnailActions, ThumbnailActionRequest } from '../services/ThumbnailActions';

interface Options<T> {
  controller?: ThumbnailActions;
  enabled: boolean;
  contextKey: string;
  request: (item: T, opener: HTMLElement) => Omit<ThumbnailActionRequest, 'isCurrent'> & { isCurrent?: () => boolean };
}
const HOLD_MS = 500;
const MOVE_TOLERANCE = 10;

export function useThumbnailLongPress<T>(options: Options<T>) {
  const latest = useRef(options);
  const sourceRevision = useRef(0);
  const pending = useRef<{ cancel: () => void; pointerId: number } | null>(null);
  useLayoutEffect(() => { latest.current = options; });
  const cancel = useCallback(() => { pending.current?.cancel(); pending.current = null; }, []);
  useLayoutEffect(() => {
    sourceRevision.current += 1;
    cancel();
    return () => { sourceRevision.current += 1; cancel(); };
  }, [cancel, options.contextKey]);
  useLayoutEffect(() => {
    if (!options.enabled) cancel();
    const unsubscribeClaim = options.controller?.onInterrupt(cancel);
    const unsubscribeInvalidation = options.controller?.onInvalidate(cancel);
    return () => { unsubscribeClaim?.(); unsubscribeInvalidation?.(); };
  }, [cancel, options.controller, options.enabled]);

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLElement>, item: T) => {
    const { controller, enabled } = latest.current;
    if (!controller || !enabled || controller.ownsInput() || event.pointerType !== 'touch'
      || event.isPrimary === false || event.button !== 0) return;
    cancel();
    const opener = event.currentTarget;
    const { pointerId, clientX, clientY } = event;
    const controllerRevision = controller.getRevision();
    const revision = sourceRevision.current;
    const end = () => cancel();
    const move = (event: PointerEvent) => {
      if (event.pointerId === pointerId && Math.hypot(event.clientX - clientX, event.clientY - clientY) > MOVE_TOLERANCE) cancel();
    };
    const another = (event: PointerEvent) => { if (event.pointerId !== pointerId) cancel(); };
    const release = (event: PointerEvent) => { if (event.pointerId === pointerId) cancel(); };
    const hidden = () => { if (document.hidden) cancel(); };
    const cleanup = () => {
      clearTimeout(timer);
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerdown', another, true);
      window.removeEventListener('pointerup', release, true);
      window.removeEventListener('pointercancel', release, true);
      window.removeEventListener('lostpointercapture', release, true);
      window.removeEventListener('scroll', end, true);
      window.removeEventListener('blur', end);
      window.removeEventListener('keydown', end, true);
      document.removeEventListener('visibilitychange', hidden);
    };
    pending.current = { cancel: cleanup, pointerId };
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerdown', another, true);
    window.addEventListener('pointerup', release, true);
    window.addEventListener('pointercancel', release, true);
    window.addEventListener('lostpointercapture', release, true);
    window.addEventListener('scroll', end, true);
    window.addEventListener('blur', end);
    window.addEventListener('keydown', end, true);
    document.addEventListener('visibilitychange', hidden);
    const timer = setTimeout(() => {
      if (sourceRevision.current !== revision || !latest.current.enabled || controllerRevision !== controller.getRevision()
        || !opener.isConnected || opener.closest('[inert], [hidden]')) { cancel(); return; }
      const request = latest.current.request(item, opener);
      controller.open({ ...request, isCurrent: () => sourceRevision.current === revision && (request.isCurrent?.() ?? true) },
        { pointerId, clientX, clientY }, controllerRevision);
      cancel();
    }, HOLD_MS);
  }, [cancel]);
  const onContextMenu = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    if (pending.current) event.preventDefault();
  }, []);
  return { onPointerDown, onContextMenu, cancel };
}
