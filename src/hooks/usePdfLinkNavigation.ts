import { useCallback, useLayoutEffect, useMemo, useRef, useState, type MouseEvent, type RefObject } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { bookStore } from '../stores/bookStore';
import { windowStore } from '../stores/windowStore';
import { quickFlipStore } from '../stores/quickFlipStore';
import { notifyReaderNavigation, subscribeReaderNavigation } from '../services/readerNavigationIntent';

type Owner = { sessionId: number; documentUrl: string | null; windowId: string };
type PageOwner = { owner: Owner; pageNumber: number; attempt: number };
type Annotation = { id: string; destination?: unknown };
type Ticket = { id: number; page: PageOwner; pdf: PDFDocumentProxy };
interface Options extends Owner {
  pageNumber: number;
  attempt: number;
  containerRef: RefObject<HTMLDivElement | null>;
  pageRef: RefObject<HTMLDivElement | null>;
}

/** Own only local PDF destinations; URI/actions/forms retain PDF.js handling. */
export function usePdfLinkNavigation({ sessionId, documentUrl, windowId, pageNumber, attempt, containerRef, pageRef }: Options) {
  const owner = useMemo(() => ({ sessionId, documentUrl, windowId }), [sessionId, documentUrl, windowId]);
  const page = useMemo(() => ({ owner, pageNumber, attempt }), [owner, pageNumber, attempt]);
  const liveOwner = useRef<Owner | null>(owner), livePage = useRef<PageOwner | null>(page);
  const pdfDocument = useRef<{ owner: Owner; pdf: PDFDocumentProxy } | null>(null);
  const annotations = useRef<{ page: PageOwner; items: Map<string, Annotation> } | null>(null);
  const sequence = useRef(0), pending = useRef<Ticket | null>(null);
  const [notice, setNotice] = useState<{ page: PageOwner; id: number } | null>(null);
  const retire = useCallback(() => { sequence.current++; pending.current = null; }, []);
  const cancel = useCallback(() => { retire(); setNotice(null); }, [retire]);
  const isOwnerCurrent = useCallback(() => {
    const book = bookStore.getState();
    return liveOwner.current === owner && book.status === 'ready' && book.sessionId === owner.sessionId
      && book.documentUrl === owner.documentUrl && windowStore.getState().windows.some(window => window.id === owner.windowId);
  }, [owner]);

  useLayoutEffect(() => {
    liveOwner.current = owner;
    const cancelRetiredBook = () => { if (!isOwnerCurrent()) cancel(); };
    const subscriptions = [subscribeReaderNavigation(id => { if (id === owner.windowId) cancel(); }),
      bookStore.subscribe(cancelRetiredBook), windowStore.subscribe((next, previous) => {
      const origin = next.windows.find(window => window.id === owner.windowId);
      const before = previous.windows.find(window => window.id === owner.windowId);
      // Observe every transition synchronously: away-and-back cannot revive a
      // deferred link. Focus/viewport writes alone are not navigation intent.
      if (!origin || origin.pageNumber !== before?.pageNumber) cancel();
    }), quickFlipStore.subscribe((next, previous) => {
      if (next.isOpen && !previous.isOpen && windowStore.getState().activeWindowId === owner.windowId) cancel();
    })];
    return () => {
      subscriptions.forEach(unsubscribe => unsubscribe());
      if (liveOwner.current === owner) liveOwner.current = null;
      retire(); pdfDocument.current = null; annotations.current = null;
    };
  }, [cancel, isOwnerCurrent, owner, retire]);

  useLayoutEffect(() => {
    livePage.current = page; annotations.current = null; cancel();
    return () => { if (livePage.current === page) livePage.current = null; };
  }, [cancel, page]);

  const onDocumentLoad = useCallback((pdf: PDFDocumentProxy) => {
    if (!isOwnerCurrent()) return;
    if (pdfDocument.current && pdfDocument.current.pdf !== pdf) { cancel(); annotations.current = null; }
    pdfDocument.current = { owner, pdf };
  }, [cancel, isOwnerCurrent, owner]);
  const onAnnotations = useCallback((items: unknown[]) => {
    if (!isOwnerCurrent() || livePage.current !== page
      || windowStore.getState().windows.find(window => window.id === owner.windowId)?.pageNumber !== page.pageNumber) return;
    const entries = new Map<string, Annotation>();
    for (const item of items) {
      if (!item || typeof item !== 'object') continue;
      const data = item as Record<string, unknown>;
      if (typeof data.id !== 'string') continue;
      // Match LinkAnnotationElement's precedence. A URI, named action,
      // attachment or optional-content action wins over an ordinary dest.
      const internal = data.annotationType === 2 && !data.url && !data.action && !data.attachment && !data.setOCGState && !!data.dest;
      entries.set(data.id, { id: data.id, ...(internal ? { destination: data.dest } : {}) });
    }
    // AnnotationLayer calls this before rendering links. State-only caching
    // would leave a gap in which its native untokened handler could run.
    annotations.current = { page, items: entries };
  }, [isOwnerCurrent, owner, page]);

  const isCurrent = useCallback((ticket: Ticket) => isOwnerCurrent() && pending.current === ticket
    && sequence.current === ticket.id && livePage.current === ticket.page
    && pdfDocument.current?.pdf === ticket.pdf
    && windowStore.getState().windows.find(window => window.id === owner.windowId)?.pageNumber === ticket.page.pageNumber,
  [isOwnerCurrent, owner]);

  const follow = useCallback(async (ticket: Ticket, destination: unknown) => {
    let target: number;
    try {
      let explicit = destination;
      if (typeof explicit === 'string') {
        explicit = await ticket.pdf.getDestination(explicit);
        if (!isCurrent(ticket)) return;
      }
      if (!Array.isArray(explicit) || !explicit.length) throw new Error('Invalid PDF destination');
      const reference: unknown = explicit[0];
      let index: number;
      if (typeof reference === 'number') index = reference;
      else if (reference && typeof reference === 'object' && 'num' in reference && 'gen' in reference
        && typeof reference.num === 'number' && Number.isInteger(reference.num) && reference.num > 0
        && typeof reference.gen === 'number' && Number.isInteger(reference.gen) && reference.gen >= 0) {
        index = await ticket.pdf.getPageIndex({ num: reference.num, gen: reference.gen });
        if (!isCurrent(ticket)) return;
      } else throw new Error('Invalid PDF page reference');
      target = index + 1;
      if (!Number.isInteger(index) || index < 0 || target > ticket.pdf.numPages || target > bookStore.getState().totalPages) throw new Error('PDF destination is out of bounds');
    } catch {
      // Handle only this resolution/validation promise, never unrelated PDF.js,
      // DOM or application errors. Obsolete work cannot publish a new notice.
      if (isCurrent(ticket)) { pending.current = null; setNotice({ page: ticket.page, id: ticket.id }); }
      return;
    }
    if (!isCurrent(ticket)) return;
    pending.current = null;
    const container = containerRef.current, element = pageRef.current, workspace = windowStore.getState();
    const visible = container?.isConnected && container.clientWidth > 0 && container.clientHeight > 0 && !container.closest('[inert]');
    const displayedPage = element?.isConnected && container?.contains(element) && element.dataset.pageNumber === String(ticket.page.pageNumber);
    if (target === ticket.page.pageNumber) {
      if (visible && displayedPage) element.scrollIntoView();
      return;
    }
    if (visible && displayedPage && workspace.activeWindowId === owner.windowId
      && element.querySelector('.annotationLayer')?.contains(globalThis.document.activeElement)) container.focus({ preventScroll: true });
    workspace.updateWindow(owner.windowId, { pageNumber: target });
  }, [containerRef, isCurrent, owner, pageRef]);

  const onClickCapture = useCallback((event: MouseEvent<HTMLDivElement>) => {
    if (!(event.target instanceof Element)) return;
    const anchor = event.target.closest('a'), element = pageRef.current;
    if (!anchor || !element?.querySelector('.annotationLayer')?.contains(anchor)) return;
    const annotation = anchor.closest<HTMLElement>('[data-annotation-id]');
    if (!annotation) return;
    const metadata = annotations.current, current = metadata?.page === page && livePage.current === page && isOwnerCurrent()
      && element.dataset.pageNumber === String(page.pageNumber);
    const item = current ? metadata.items.get(annotation.dataset.annotationId ?? '') : undefined;
    if (!item) {
      // A retired internal anchor must not fall through to PDF.js navigation.
      // Current unrelated annotations and external URI anchors are untouched.
      if (annotation.hasAttribute('data-internal-link')) { event.preventDefault(); event.stopPropagation(); }
      return;
    }
    if (item.destination === undefined) return;
    event.preventDefault(); event.stopPropagation();
    cancel();
    const source = pdfDocument.current;
    if (!source || source.owner !== owner || !isOwnerCurrent()
      || containerRef.current?.closest('[inert]')
      || (quickFlipStore.getState().isOpen && windowStore.getState().activeWindowId === owner.windowId)
      || windowStore.getState().windows.find(window => window.id === owner.windowId)?.pageNumber !== page.pageNumber) return;
    // Retire older held-read/link intent at activation, before any await. Publish
    // before making our ticket: its synchronous subscription advances the sequence.
    notifyReaderNavigation(owner.windowId);
    const ticket = { id: sequence.current, page, pdf: source.pdf };
    pending.current = ticket;
    void follow(ticket, item.destination);
  }, [cancel, containerRef, follow, isOwnerCurrent, owner, page, pageRef]);

  return {
    documentKey: JSON.stringify([owner.sessionId, owner.documentUrl, owner.windowId]),
    onDocumentLoad, onAnnotations, onClickCapture, cancel,
    notice: notice?.page === page && notice.id === sequence.current && isOwnerCurrent(),
  };
}
