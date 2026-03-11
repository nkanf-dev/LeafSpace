import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pin } from 'lucide-react';

import { useBookStore } from '../../stores/bookStore';
import { useHeldStore } from '../../stores/heldStore';
import { useWindowStore } from '../../stores/windowStore';
import { thumbnailService } from '../../services/ThumbnailService';
import { CachedThumbnail } from '../thumbnails/CachedThumbnail';

interface Props {
  isVisible: boolean;
  onClose: () => void;
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

const MAX_ALIGNMENT_ATTEMPTS = 18;
const ACCELERATION_THRESHOLD_MS = 180;
const ACCELERATION_IDLE_MS = 180;
const THUMBNAIL_HOLD_INTERVAL_MS = 115;
const TIMELINE_HOLD_INTERVAL_MS = 42;
const MAX_TIMELINE_STEP = 8;
const THUMBNAIL_LOAD_RADIUS = 10;
const VIRTUAL_RENDER_RADIUS = 14;
const SLOT_WIDTH = 240;
const SLOT_HEIGHT = 360;
const FRAME_WIDTH = 176;
const FRAME_HEIGHT = 252;
const STRIP_SMOOTH_DURATION_MS = 220;

type ViewMode = 'thumbnails' | 'timeline';

function clampPage(page: number, totalPages: number): number {
  return Math.min(Math.max(1, page), Math.max(1, totalPages));
}

function buildSectionMarkers(totalPages: number): number[] {
  const chunkCount = Math.min(8, Math.max(2, Math.ceil(totalPages / 40)));
  const step = Math.max(1, Math.round(totalPages / chunkCount));
  const markers = new Set<number>([1, totalPages]);

  for (let page = step; page < totalPages; page += step) {
    markers.add(page);
  }

  return Array.from(markers).sort((left, right) => left - right);
}

export const QuickFlipOverlay: React.FC<Props> = ({ isVisible, onClose, currentPage, totalPages, onPageChange }) => {
  const [selectedPage, setSelectedPage] = useState(currentPage);
  const [scrollAnchorPage, setScrollAnchorPage] = useState(currentPage);
  const [zoom, setZoom] = useState(1.0);
  const [viewMode, setViewMode] = useState<ViewMode>('thumbnails');
  const [pressedDirection, setPressedDirection] = useState<-1 | 1 | null>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const latestSelectedPageRef = useRef(currentPage);
  const alignFrameRef = useRef<number | null>(null);
  const scrollAnimationFrameRef = useRef<number | null>(null);
  const skipNextThumbnailScrollAnimationRef = useRef(false);
  const holdStartTimeRef = useRef<number | null>(null);
  const exitTimelineTimerRef = useRef<number | null>(null);
  const documentUrl = useBookStore((state) => state.documentUrl);
  const heldPages = useHeldStore((state) => state.pages);
  const { holdPage, unholdPage } = useHeldStore.getState();
  const { openInNewWindow } = useWindowStore.getState();
  const heldPageNumbers = useMemo(
    () => Array.from(new Set(heldPages.map((page) => page.pageNumber))).sort((left, right) => left - right),
    [heldPages],
  );
  const sectionMarkers = useMemo(() => buildSectionMarkers(totalPages), [totalPages]);
  const file = useMemo(() => documentUrl ?? null, [documentUrl]);
  const scaledSlotWidth = SLOT_WIDTH * zoom;
  const scaledSlotHeight = SLOT_HEIGHT * zoom;
  const scaledFrameWidth = FRAME_WIDTH * zoom;
  const scaledFrameHeight = FRAME_HEIGHT * zoom;
  const renderedRange = useMemo(() => {
    const anchorStart = Math.min(selectedPage, scrollAnchorPage);
    const anchorEnd = Math.max(selectedPage, scrollAnchorPage);

    return {
      start: clampPage(anchorStart - VIRTUAL_RENDER_RADIUS, totalPages),
      end: clampPage(anchorEnd + VIRTUAL_RENDER_RADIUS, totalPages),
    };
  }, [scrollAnchorPage, selectedPage, totalPages]);
  const renderedPages = useMemo(
    () => Array.from({ length: renderedRange.end - renderedRange.start + 1 }, (_, index) => renderedRange.start + index),
    [renderedRange.end, renderedRange.start],
  );
  const leadingSpacerWidth = Math.max(0, (renderedRange.start - 1) * scaledSlotWidth);
  const trailingSpacerWidth = Math.max(0, (totalPages - renderedRange.end) * scaledSlotWidth);

  const clearExitTimelineTimer = useCallback(() => {
    if (exitTimelineTimerRef.current !== null) {
      window.clearTimeout(exitTimelineTimerRef.current);
      exitTimelineTimerRef.current = null;
    }
  }, []);

  const cancelStripAnimation = useCallback(() => {
    if (scrollAnimationFrameRef.current !== null) {
      window.cancelAnimationFrame(scrollAnimationFrameRef.current);
      scrollAnimationFrameRef.current = null;
    }
  }, []);

  const animateStripScroll = useCallback((targetLeft: number) => {
    const strip = stripRef.current;
    if (!strip) {
      return;
    }

    cancelStripAnimation();

    const startLeft = strip.scrollLeft;
    const delta = targetLeft - startLeft;
    if (Math.abs(delta) < 0.5) {
      strip.scrollLeft = targetLeft;
      return;
    }

    const startedAt = performance.now();
    const step = (timestamp: number) => {
      const elapsed = timestamp - startedAt;
      const progress = Math.min(1, elapsed / STRIP_SMOOTH_DURATION_MS);
      const eased = 1 - Math.pow(1 - progress, 3);
      strip.scrollLeft = startLeft + delta * eased;

      if (progress < 1) {
        scrollAnimationFrameRef.current = window.requestAnimationFrame(step);
      } else {
        scrollAnimationFrameRef.current = null;
      }
    };

    scrollAnimationFrameRef.current = window.requestAnimationFrame(step);
  }, [cancelStripAnimation]);

  const alignStripToPage = useCallback((page: number, behavior: ScrollBehavior, attempt = 0) => {
    if (!isVisible) return;

    const strip = stripRef.current;
    if (!strip) return;

    // Clamp page to ensure it's within valid range
    const clampedPage = clampPage(page, totalPages);
    const activeEl = strip.querySelector(`.p-${clampedPage}`) as HTMLElement | null;
    if (!activeEl) {
      if (attempt >= MAX_ALIGNMENT_ATTEMPTS) return;

      if (alignFrameRef.current !== null) {
        window.cancelAnimationFrame(alignFrameRef.current);
      }

      alignFrameRef.current = window.requestAnimationFrame(() => {
        alignStripToPage(clampedPage, behavior, attempt + 1);
      });
      return;
    }

    const stripRect = strip.getBoundingClientRect();
    const activeRect = activeEl.getBoundingClientRect();
    const targetLeft = strip.scrollLeft + (activeRect.left - stripRect.left) - (strip.clientWidth / 2 - activeEl.clientWidth / 2);
    const nextLeft = Math.max(0, targetLeft);

    if (behavior === 'smooth') {
      animateStripScroll(nextLeft);
      return;
    }

    cancelStripAnimation();
    strip.scrollLeft = nextLeft;
  }, [animateStripScroll, cancelStripAnimation, isVisible, totalPages]);

  const updateSelectedPage = useCallback((updater: (page: number) => number) => {
    setSelectedPage((page) => {
      const nextPage = clampPage(updater(page), totalPages);
      latestSelectedPageRef.current = nextPage;
      return nextPage;
    });
  }, [totalPages]);

  const stepSelection = useCallback((direction: -1 | 1, step = 1) => {
    updateSelectedPage((page) => page + direction * step);
  }, [updateSelectedPage]);

  const getAcceleratedStep = useCallback(() => {
    if (holdStartTimeRef.current === null) {
      return 1;
    }

    const elapsed = performance.now() - holdStartTimeRef.current;
    const ramp = Math.max(0, elapsed - ACCELERATION_THRESHOLD_MS);
    const nextStep = 1 + Math.floor(ramp / 140);

    return Math.max(1, Math.min(MAX_TIMELINE_STEP, nextStep));
  }, []);

  const scheduleTimelineExit = useCallback(() => {
    clearExitTimelineTimer();
    exitTimelineTimerRef.current = window.setTimeout(() => {
      skipNextThumbnailScrollAnimationRef.current = true;
      setViewMode('thumbnails');
    }, ACCELERATION_IDLE_MS);
  }, [alignStripToPage, clearExitTimelineTimer]);

  const handleWheelInput = useCallback((deltaY: number) => {
    if (viewMode === 'timeline') {
      const direction = deltaY >= 0 ? 1 : -1;
      stepSelection(direction as -1 | 1, getAcceleratedStep());
      return;
    }

    setZoom((value) => {
      const factor = deltaY > 0 ? 0.92 : 1.08;
      return Math.min(2.2, Math.max(0.55, Number((value * factor).toFixed(3))));
    });
  }, [getAcceleratedStep, stepSelection, viewMode]);

  const handleWheelCapture = useCallback((event: React.WheelEvent) => {
    event.preventDefault();
    event.stopPropagation();
    handleWheelInput(event.deltaY);
  }, [handleWheelInput]);

  useEffect(() => {
    latestSelectedPageRef.current = selectedPage;
  }, [selectedPage]);

  useEffect(() => {
    if (!isVisible) {
      setViewMode('thumbnails');
      setPressedDirection(null);
      holdStartTimeRef.current = null;
      clearExitTimelineTimer();
      cancelStripAnimation();
      if (alignFrameRef.current !== null) {
        window.cancelAnimationFrame(alignFrameRef.current);
        alignFrameRef.current = null;
      }
      return;
    }

    setViewMode('thumbnails');
    setPressedDirection(null);
    setSelectedPage(currentPage);
    setScrollAnchorPage(currentPage);
    latestSelectedPageRef.current = currentPage;
    holdStartTimeRef.current = null;
    clearExitTimelineTimer();

    const openTimer = window.setTimeout(() => {
      alignStripToPage(currentPage, 'auto');
    }, 40);

    return () => window.clearTimeout(openTimer);
  }, [cancelStripAnimation, clearExitTimelineTimer, currentPage, isVisible]);

  useEffect(() => {
    if (!isVisible || pressedDirection === null) {
      return;
    }

    clearExitTimelineTimer();

    const intervalTimer = window.setInterval(() => {
      const elapsed = holdStartTimeRef.current === null ? 0 : performance.now() - holdStartTimeRef.current;

      if (viewMode === 'thumbnails' && elapsed >= ACCELERATION_THRESHOLD_MS) {
        setViewMode('timeline');
        return;
      }

      if (viewMode === 'thumbnails') {
        stepSelection(pressedDirection, 1);
        return;
      }

      stepSelection(pressedDirection, getAcceleratedStep());
    }, viewMode === 'timeline' ? TIMELINE_HOLD_INTERVAL_MS : THUMBNAIL_HOLD_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalTimer);
    };
  }, [clearExitTimelineTimer, getAcceleratedStep, isVisible, pressedDirection, stepSelection, viewMode]);

  useEffect(() => {
    if (!isVisible) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }

      if (e.key === ' ') {
        return;
      }

      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        const direction = (e.key === 'ArrowRight' ? 1 : -1) as -1 | 1;

        if (pressedDirection === direction) {
          return;
        }

        holdStartTimeRef.current = performance.now();
        clearExitTimelineTimer();
        stepSelection(direction, 1);
        setPressedDirection(direction);
        return;
      }

      if (e.key === 'ArrowUp') {
        e.preventDefault();
        void holdPage(selectedPage);
        return;
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        unholdPage(selectedPage);
        return;
      }

      if (e.key === 'Enter') {
        e.preventDefault();
        onPageChange(selectedPage);
        onClose();
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if ((e.key === 'ArrowRight' && pressedDirection === 1) || (e.key === 'ArrowLeft' && pressedDirection === -1)) {
        e.preventDefault();
        setPressedDirection(null);
        holdStartTimeRef.current = null;

        if (viewMode === 'timeline') {
          scheduleTimelineExit();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown, { passive: false });
    window.addEventListener('keyup', handleKeyUp, { passive: false });

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [clearExitTimelineTimer, holdPage, isVisible, onClose, onPageChange, pressedDirection, scheduleTimelineExit, selectedPage, stepSelection, unholdPage, viewMode]);

  useEffect(() => {
    if (!isVisible || viewMode !== 'thumbnails') return;

    const behavior = skipNextThumbnailScrollAnimationRef.current ? 'auto' : 'smooth';
    skipNextThumbnailScrollAnimationRef.current = false;
    alignStripToPage(selectedPage, behavior);
  }, [alignStripToPage, isVisible, pressedDirection, selectedPage, viewMode]);

  useEffect(() => {
    if (!isVisible || viewMode !== 'thumbnails') {
      return;
    }

    alignStripToPage(selectedPage, 'auto');
  }, [alignStripToPage, isVisible, selectedPage, viewMode, zoom]);

  useEffect(() => {
    if (!isVisible) {
      return;
    }

    const overlay = overlayRef.current;
    if (!overlay) {
      return;
    }

    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
      handleWheelInput(event.deltaY);
    };

    overlay.addEventListener('wheel', handleWheel, { passive: false });

    return () => overlay.removeEventListener('wheel', handleWheel);
  }, [handleWheelInput, isVisible]);

  useEffect(() => {
    if (!isVisible || viewMode !== 'thumbnails' || !file) {
      return;
    }

    const pages = Array.from(
      new Set(
        Array.from({ length: THUMBNAIL_LOAD_RADIUS * 2 + 1 }, (_, index) => selectedPage - THUMBNAIL_LOAD_RADIUS + index)
          .concat(renderedPages)
          .filter((page) => page >= 1 && page <= totalPages),
      ),
    );

    void thumbnailService.ensureThumbnails(pages, scaledFrameWidth).catch(() => undefined);
  }, [file, isVisible, renderedPages, scaledFrameWidth, selectedPage, totalPages, viewMode]);

  useEffect(() => {
    if (!isVisible || viewMode !== 'thumbnails') {
      return;
    }

    const strip = stripRef.current;
    if (!strip) {
      return;
    }

    const handleScroll = () => {
      const centerOffset = strip.scrollLeft + strip.clientWidth / 2;
      const page = clampPage(Math.round(centerOffset / Math.max(1, scaledSlotWidth)) + 1, totalPages);
      setScrollAnchorPage((current) => (current === page ? current : page));
    };

    handleScroll();
    strip.addEventListener('scroll', handleScroll, { passive: true });

    return () => strip.removeEventListener('scroll', handleScroll);
  }, [isVisible, scaledSlotWidth, totalPages, viewMode]);

  useEffect(() => () => {
    clearExitTimelineTimer();
    cancelStripAnimation();
    if (alignFrameRef.current !== null) {
      window.cancelAnimationFrame(alignFrameRef.current);
    }
  }, [cancelStripAnimation, clearExitTimelineTimer]);

  if (!isVisible) return null;

  const selectedProgress = ((selectedPage - 1) / Math.max(1, totalPages - 1)) * 100;

  return (
    <div ref={overlayRef} className="fixed inset-0 z-[3000] overflow-hidden" onWheelCapture={handleWheelCapture}>
      <div className="absolute inset-0 bg-[rgba(251,250,248,0.7)] backdrop-blur-[40px]" onClick={onClose} />
      <div className="relative z-10 flex min-h-screen w-full flex-col px-6 py-6">
        <div className="mb-5 shrink-0 text-center">
          <div className="text-[2.8rem] font-extrabold text-stone-900" style={{ fontFamily: 'Georgia, Times New Roman, serif' }}>速翻视图</div>
          <div className="mt-2 text-[0.85rem] text-stone-500">
            <kbd className="border border-[var(--border)] bg-white px-1.5 py-0.5">←</kbd>
            <kbd className="ml-1 border border-[var(--border)] bg-white px-1.5 py-0.5">→</kbd>
            <span className="mx-2">选择</span>•
            <span className="mx-2">长按进入时间轴</span>•
            <kbd className="mx-2 border border-[var(--border)] bg-white px-1.5 py-0.5">↑</kbd>
            夹住 •
            <kbd className="mx-2 border border-[var(--border)] bg-white px-1.5 py-0.5">Enter</kbd>
            跳转 •
            <kbd className="mx-2 border border-[var(--border)] bg-white px-1.5 py-0.5">Space</kbd>
            退出速翻 •
            <kbd className="mx-2 border border-[var(--border)] bg-white px-1.5 py-0.5">Shift + 点击</kbd>
            浮窗
          </div>
        </div>

        <div className="relative flex min-h-0 flex-1 items-center">
          {viewMode === 'thumbnails' && (
            <div
              className="quick-flip-strip h-full w-full overflow-x-auto overflow-y-visible"
              ref={stripRef}
              onWheelCapture={handleWheelCapture}
              style={{ overscrollBehavior: 'contain' }}
            >
              {file && (
                <div className="flex h-full items-center">
                  <div aria-hidden="true" style={{ width: leadingSpacerWidth, minWidth: leadingSpacerWidth }} />
                  {renderedPages.map((page) => {
                const isSelected = page === selectedPage;
                const isHeld = heldPageNumbers.includes(page);
                const isPriority = Math.abs(page - selectedPage) <= THUMBNAIL_LOAD_RADIUS;

                return (
                  <button
                    key={page}
                    type="button"
                    data-page={page}
                    className={`p-${page} flex shrink-0 cursor-pointer flex-col items-center justify-center gap-6 border-0 bg-transparent px-2 transition-opacity duration-200 ${isSelected ? 'opacity-100' : 'opacity-35 hover:opacity-60'}`}
                    style={{ width: scaledSlotWidth, minWidth: scaledSlotWidth, height: scaledSlotHeight }}
                    onClick={(e) => {
                      if (e.shiftKey) {
                        openInNewWindow(page);
                        return;
                      }
                      setSelectedPage(page);
                      latestSelectedPageRef.current = page;
                    }}
                    onDoubleClick={() => { onPageChange(page); onClose(); }}
                  >
                    <div
                      className={`relative flex items-center justify-center overflow-hidden border bg-white transition-transform duration-200 ${isSelected ? 'translate-y-[-15px] border-[3px] border-stone-900' : isHeld ? 'border-[#f5a623]' : 'border-[var(--border)]'}`}
                      style={{
                        height: scaledFrameHeight,
                        transform: `scale(${isSelected ? 1.16 : 0.86})`,
                        width: scaledFrameWidth,
                      }}
                    >
                      <CachedThumbnail
                        alt={`第 ${page} 页缩略图`}
                        className="flex items-center justify-center bg-white"
                        height={Math.round(scaledFrameHeight)}
                        pageNumber={page}
                        placeholder={<div className="text-xl font-bold text-stone-300">{page}</div>}
                        priority={isPriority}
                        width={Math.round(scaledFrameWidth)}
                      />
                      {isHeld && (
                        <div className="absolute right-3 top-3 text-[#f5a623] [filter:drop-shadow(0_2px_4px_rgba(0,0,0,0.2))]">
                          <Pin size={24} fill="currentColor" />
                        </div>
                      )}
                    </div>
                    <div className={`text-[1.1rem] font-bold text-stone-900 transition-opacity ${isSelected ? 'opacity-100' : 'opacity-0'}`} style={{ fontFamily: 'Georgia, Times New Roman, serif' }}>
                      {page}
                    </div>
                  </button>
                );
                  })}
                  <div aria-hidden="true" style={{ width: trailingSpacerWidth, minWidth: trailingSpacerWidth }} />
                </div>
              )}
            </div>
          )}

          {viewMode === 'timeline' && (
            <div className="absolute inset-0 z-20 flex items-center justify-center px-8 py-10 sm:px-14">
              <div className="w-full border border-[var(--border)] bg-[var(--surface)] px-8 py-8">
                <div className="mb-4 flex items-end justify-between text-stone-500">
                  <span className="text-[0.75rem] uppercase tracking-[0.18em]">时间轴视图</span>
                  <span className="text-[0.75rem]">第 {selectedPage} 页 / 共 {Math.max(1, totalPages)} 页</span>
                </div>

                <div
                  className="relative h-16 cursor-pointer"
                  onClick={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const ratio = (e.clientX - rect.left) / rect.width;
                    const nextPage = clampPage(Math.round(ratio * Math.max(1, totalPages - 1)) + 1, totalPages);
                    setSelectedPage(nextPage);
                    latestSelectedPageRef.current = nextPage;
                  }}
                >
                  <div className="absolute inset-x-0 top-1/2 h-[2px] -translate-y-1/2 bg-[var(--border)]" />
                  <div className="absolute left-0 top-1/2 h-[2px] -translate-y-1/2 bg-stone-900" style={{ width: `${selectedProgress}%` }} />

                  {sectionMarkers.map((markerPage) => (
                    <div
                      key={`section-${markerPage}`}
                      className="absolute top-1/2 z-10 h-3 w-[2px] -translate-x-1/2 -translate-y-1/2 bg-stone-900/40"
                      style={{ left: `${((markerPage - 1) / Math.max(1, totalPages - 1)) * 100}%` }}
                    />
                  ))}

                  {heldPageNumbers.map((markerPage) => (
                    <button
                      key={`held-${markerPage}`}
                      type="button"
                      className="absolute top-1/2 z-20 h-4 w-[3px] -translate-x-1/2 -translate-y-1/2 bg-[#f5a623]"
                      style={{ left: `${((markerPage - 1) / Math.max(1, totalPages - 1)) * 100}%` }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedPage(markerPage);
                        latestSelectedPageRef.current = markerPage;
                      }}
                      title={`第 ${markerPage} 页`}
                    />
                  ))}

                  <div
                    className="absolute top-1/2 z-30 h-4 w-4 -translate-x-1/2 -translate-y-1/2 border-2 border-stone-900 bg-[var(--surface)]"
                    style={{ left: `${selectedProgress}%` }}
                  />
                </div>

                <div className="mt-4 flex items-center justify-between text-[0.72rem] text-stone-500">
                  <span>1</span>
                  <span>长按左右键进入时间轴；松开后回到缩略图；Enter 才会真正跳转</span>
                  <span>{totalPages}</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
