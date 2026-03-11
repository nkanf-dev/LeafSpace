import React, { useEffect, useMemo, useRef, useState } from 'react';

import { useBookStore } from '../../stores/bookStore';
import { useThumbnailStore } from '../../stores/thumbnailStore';
import { thumbnailService } from '../../services/ThumbnailService';

interface Props {
  alt: string;
  className?: string;
  height: number;
  pageNumber: number;
  placeholder?: React.ReactNode;
  priority?: boolean;
  width: number;
}

const OBSERVER_ROOT_MARGIN = '240px 320px';

export const CachedThumbnail: React.FC<Props> = ({ alt, className, height, pageNumber, placeholder, priority = false, width }) => {
  const documentId = useBookStore((state) => state.documentId);
  const [shouldLoad, setShouldLoad] = useState(priority);
  const containerRef = useRef<HTMLDivElement>(null);
  const key = useMemo(() => thumbnailService.getThumbnailKey(pageNumber, width), [documentId, pageNumber, width]);
  const entry = useThumbnailStore((state) => state.entries[key]);
  const fallbackEntry = useThumbnailStore((state) => {
    if (!documentId) {
      return undefined;
    }

    const prefix = `${documentId}_${pageNumber}_`;

    return Object.values(state.entries).find((candidate) => candidate.key.startsWith(prefix) && candidate.status === 'ready');
  });

  useEffect(() => {
    if (priority) {
      setShouldLoad(true);
    }
  }, [priority]);

  useEffect(() => {
    const element = containerRef.current;

    if (!element || shouldLoad || typeof IntersectionObserver === 'undefined') {
      if (!shouldLoad) {
        setShouldLoad(true);
      }

      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((item) => item.isIntersecting)) {
          setShouldLoad(true);
          observer.disconnect();
        }
      },
      { rootMargin: OBSERVER_ROOT_MARGIN },
    );

    observer.observe(element);

    return () => observer.disconnect();
  }, [shouldLoad]);

  useEffect(() => {
    if (!shouldLoad) {
      return;
    }

    void thumbnailService.ensureThumbnail(pageNumber, width).catch(() => undefined);
  }, [documentId, entry?.status, key, pageNumber, shouldLoad, width]);

  useEffect(() => {
    if (entry?.status === 'ready') {
      useThumbnailStore.getState().touchEntry(key);
    }
  }, [entry?.status, key]);

  return (
    <div ref={containerRef} className={className} style={{ height, width }}>
      {(entry?.status === 'ready' && entry.blobUrl) || fallbackEntry?.blobUrl ? (
        <img src={entry?.blobUrl ?? fallbackEntry?.blobUrl} alt={alt} className="h-full w-full object-contain" draggable={false} />
      ) : (
        <>{placeholder ?? null}</>
      )}
    </div>
  );
};