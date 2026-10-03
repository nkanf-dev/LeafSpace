export interface ThumbnailAction {
  id: 'read' | 'reference' | 'hold' | 'unhold' | 'remove';
  label: string;
  run: () => void;
  focus: 'restore' | 'delegate';
}
export interface ThumbnailActionRequest {
  pageNumber: number;
  opener: HTMLElement;
  actions: ThumbnailAction[];
  isCurrent: () => boolean;
  fallbackFocus?: () => HTMLElement | null;
}
export interface ThumbnailTouch {
  pointerId: number;
  clientX: number;
  clientY: number;
}
interface ClaimedTouch extends ThumbnailTouch {
  opener: HTMLElement;
  released: boolean;
}
export interface ThumbnailActionSnapshot {
  request: ThumbnailActionRequest | null;
  awaitingRelease: boolean;
}

/** Transient input ownership only; never part of a saved reading workspace. */
export class ThumbnailActions {
  private state: ThumbnailActionSnapshot = { request: null, awaitingRelease: false };
  private epoch = 0;
  private focusRevision = 0;
  private claim: ClaimedTouch | null = null;
  private expiry: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<() => void>();
  private interruptions = new Set<() => void>();
  private invalidations = new Set<() => void>();
  getSnapshot = () => this.state;
  getRevision = () => this.epoch;
  ownsInput = () => this.state.request !== null;
  noteFocusIntent = () => { this.focusRevision += 1; };
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  onInterrupt = (listener: () => void) => { this.interruptions.add(listener); return () => { this.interruptions.delete(listener); }; };
  onInvalidate = (listener: () => void) => { this.invalidations.add(listener); return () => { this.invalidations.delete(listener); }; };
  private publish(request = this.state.request) {
    this.state = { request, awaitingRelease: !!request && !!this.claim && !this.claim.released };
    this.listeners.forEach(listener => listener());
  }
  private clearClaim() {
    if (this.expiry !== null) clearTimeout(this.expiry);
    this.expiry = null;
    this.claim = null;
  }
  invalidate = () => {
    this.epoch += 1;
    this.invalidations.forEach(listener => listener());
    if (this.state.request) this.publish(null);
  };
  open(request: ThumbnailActionRequest, touch: ThumbnailTouch, revision: number): boolean {
    if (revision !== this.epoch || this.ownsInput() || !request.isCurrent()
      || !request.opener.isConnected || request.opener.closest('[inert], [hidden]')) return false;
    this.clearClaim();
    this.noteFocusIntent();
    this.claim = { ...touch, opener: request.opener, released: false };
    this.interruptions.forEach(listener => listener());
    this.publish(request);
    return true;
  }
  dismiss = (restoreFocus = true) => {
    const request = this.state.request;
    if (!request) return;
    this.publish(null);
    if (restoreFocus) this.restoreFocus(request, this.epoch);
  };
  recoverAfterLayout = (isReadingCurrent: () => boolean) => {
    const request = this.state.request;
    const focusRevision = this.focusRevision;
    this.invalidate();
    if (!request) return;
    // A breakpoint can legitimately replace the drawer with the sidebar. Only
    // this focus ticket ignores that surface revision; reading intent still owns it.
    window.requestAnimationFrame(() => {
      if (!isReadingCurrent() || this.focusRevision !== focusRevision || this.ownsInput()) return;
      const visible = (target: HTMLElement | null | undefined): target is HTMLElement =>
        !!target?.isConnected && !target.closest('[inert], [hidden]') && target.getClientRects().length > 0;
      const target = visible(request.opener) ? request.opener : request.fallbackFocus?.();
      if (visible(target)) target.focus({ preventScroll: true });
    });
  };
  private restoreFocus(request: ThumbnailActionRequest, revision: number, focusRevision = this.focusRevision) {
    window.requestAnimationFrame(() => {
      if (this.epoch !== revision || this.focusRevision !== focusRevision || this.ownsInput() || !request.isCurrent()) return;
      const target = request.opener.isConnected ? request.opener : request.fallbackFocus?.();
      if (target?.isConnected && !target.closest('[inert], [hidden]')) target.focus({ preventScroll: true });
    });
  }
  run = (id: ThumbnailAction['id']) => {
    const request = this.state.request;
    if (!request || this.state.awaitingRelease) return;
    if (!request.isCurrent()) { this.invalidate(); return; }
    const action = request.actions.find(action => action.id === id);
    if (!action) return;
    const revision = this.epoch;
    const focusRevision = this.focusRevision;
    this.publish(null);
    // Remove background inertness before delegating existing focus/navigation flows.
    window.requestAnimationFrame(() => {
      if (revision !== this.epoch || this.ownsInput() || !request.isCurrent()) return;
      action.run();
      if (action.focus === 'restore') this.restoreFocus(request, this.epoch, focusRevision);
    });
  };
  pointerDown = (event: PointerEvent) => {
    this.noteFocusIntent();
    if (!this.claim) return;
    if (this.claim.released || event.pointerId === this.claim.pointerId
      || (event.pointerType === 'touch' && event.isPrimary)) {
      this.clearClaim();
      this.publish();
      return;
    }
    // A second contact interrupts the claimed gesture. Keep its original ID so
    // its eventual release cannot activate an underlying control.
    this.dismiss(false);
  };
  pointerEnd = (event: PointerEvent) => {
    const claim = this.claim;
    if (!claim || event.pointerId !== claim.pointerId) return;
    claim.released = true;
    claim.clientX = event.clientX;
    claim.clientY = event.clientY;
    if (event.type === 'pointercancel') this.dismiss(false);
    this.publish();
    if (this.expiry !== null) clearTimeout(this.expiry);
    this.expiry = setTimeout(() => { if (this.claim === claim) this.clearClaim(); }, 1000);
  };
  consumeClick = (event: MouseEvent): boolean => {
    const claim = this.claim;
    if (!claim || event.detail === 0) return false; // Keyboard and AT activation.
    const pointer = event as PointerEvent;
    const identifiedTouch = pointer.pointerType === 'touch' && pointer.pointerId === claim.pointerId;
    const legacyTouch = !pointer.pointerType
      && Math.hypot(event.clientX - claim.clientX, event.clientY - claim.clientY) <= 24
      && event.target instanceof Node && (claim.opener.contains(event.target)
        || !!(event.target instanceof Element && event.target.closest('[data-thumbnail-actions]')));
    if (!identifiedTouch && !legacyTouch) return false;
    event.preventDefault(); event.stopImmediatePropagation();
    // Retain the token for a paired dblclick/contextmenu. A new pointer sequence
    // clears it, so the next real tap is never swallowed by a blanket timeout.
    return true;
  };
  consumeContextMenu = (event: MouseEvent) => {
    const claim = this.claim;
    if (!claim) return;
    const pointer = event as PointerEvent;
    if (pointer.pointerType === 'touch' || (!pointer.pointerType
      && Math.hypot(event.clientX - claim.clientX, event.clientY - claim.clientY) <= 24)) {
      event.preventDefault(); event.stopImmediatePropagation();
    }
  };
  dispose = () => {
    this.noteFocusIntent();
    this.invalidate();
    this.clearClaim();
  };
}
