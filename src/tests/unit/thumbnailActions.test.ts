import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThumbnailActions, type ThumbnailActionRequest } from '../../services/ThumbnailActions';

describe('thumbnail action input ownership', () => {
  let controller: ThumbnailActions;
  let opener: HTMLButtonElement;
  let request: ThumbnailActionRequest;
  const touch = { pointerId: 7, clientX: 40, clientY: 60 };
  const pointer = (type: string, overrides = {}) => Object.assign(new Event(type), touch, { pointerType: 'touch' }, overrides) as PointerEvent;
  const click = (overrides = {}) => Object.assign(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1, clientX: 40, clientY: 60 }), { pointerType: 'touch', pointerId: 7 }, overrides);
  beforeEach(() => {
    vi.useFakeTimers();
    controller = new ThumbnailActions();
    opener = document.createElement('button'); document.body.append(opener);
    request = { pageNumber: 8, opener, isCurrent: () => true, actions: [{ id: 'read', label: 'Read', run: vi.fn(), focus: 'delegate' }] };
  });
  afterEach(() => { controller.dispose(); opener.remove(); vi.useRealTimers(); vi.restoreAllMocks(); });
  const open = () => controller.open(request, touch, controller.getRevision());

  it('separates changed source intent from acquiring background input', () => {
    const invalidate = vi.fn(), interrupt = vi.fn();
    controller.onInvalidate(invalidate); controller.onInterrupt(interrupt);
    const before = controller.getRevision(); controller.invalidate();
    expect(invalidate).toHaveBeenCalledOnce(); expect(interrupt).not.toHaveBeenCalled();
    expect(controller.open(request, touch, before)).toBe(false);
    expect(open()).toBe(true); expect(interrupt).toHaveBeenCalledOnce();
  });
  it.each(['disconnected', 'inert', 'stale'] as const)('rejects a %s opener', kind => {
    if (kind === 'disconnected') opener.remove();
    if (kind === 'inert') opener.setAttribute('inert', '');
    if (kind === 'stale') request.isCurrent = () => false;
    expect(open()).toBe(false); expect(controller.ownsInput()).toBe(false);
  });
  it('does not run an action before release or more than once', () => {
    open(); controller.run('read'); vi.advanceTimersByTime(20);
    expect(request.actions[0].run).not.toHaveBeenCalled();
    controller.pointerEnd(pointer('pointerup')); controller.run('read'); controller.run('read');
    expect(controller.ownsInput()).toBe(false); expect(request.actions[0].run).not.toHaveBeenCalled();
    vi.advanceTimersByTime(20); expect(request.actions[0].run).toHaveBeenCalledOnce();
  });
  it('drops a deferred action after an away-and-back source change', () => {
    open(); controller.pointerEnd(pointer('pointerup')); controller.run('read');
    controller.invalidate(); controller.invalidate(); vi.advanceTimersByTime(20);
    expect(request.actions[0].run).not.toHaveBeenCalled();
  });
  it('suppresses the claimed compatibility click and double click after dismissal', () => {
    open(); controller.dismiss(); controller.pointerEnd(pointer('pointerup'));
    const first = click(), second = click();
    expect(controller.consumeClick(first)).toBe(true); expect(first.defaultPrevented).toBe(true);
    expect(controller.consumeClick(second)).toBe(true);
    expect(controller.consumeClick(click({ pointerId: 8 }))).toBe(false);
    expect(controller.consumeClick(click({ pointerType: 'mouse' }))).toBe(false);
    expect(controller.consumeClick(new MouseEvent('click', { detail: 0 }))).toBe(false);
    controller.pointerDown(pointer('pointerdown', { pointerId: 9 }));
    expect(controller.consumeClick(click())).toBe(false);
  });
  it('scopes legacy compatibility clicks to the opener or action host', () => {
    open(); controller.pointerEnd(pointer('pointerup'));
    const native = new MouseEvent('click', { detail: 1, cancelable: true, clientX: 40, clientY: 60 });
    opener.dispatchEvent(native);
    expect(controller.consumeClick(native)).toBe(true);
    const unrelated = new MouseEvent('click', { detail: 1, clientX: 40, clientY: 60 });
    document.body.dispatchEvent(unrelated);
    expect(controller.consumeClick(unrelated)).toBe(false);
    vi.advanceTimersByTime(1001); expect(controller.consumeClick(click())).toBe(false);
  });
  it('cancels a second-contact gesture while retaining only the original pointer identity', () => {
    open(); controller.pointerDown(pointer('pointerdown', { pointerId: 8 }));
    expect(controller.ownsInput()).toBe(false);
    controller.pointerEnd(pointer('pointerup', { pointerId: 8 }));
    expect(controller.consumeClick(click({ pointerId: 8 }))).toBe(false);
    controller.pointerEnd(pointer('pointerup'));
    expect(controller.consumeClick(click())).toBe(true);
    const legacy = new MouseEvent('click', { detail: 1, cancelable: true, clientX: 40, clientY: 60 });
    opener.dispatchEvent(legacy);
    expect(controller.consumeClick(legacy)).toBe(true);
  });
  it('cancels pointercancel without restoring background focus', () => {
    const focus = vi.spyOn(opener, 'focus');
    open(); controller.pointerEnd(pointer('pointercancel')); vi.advanceTimersByTime(20);
    expect(controller.ownsInput()).toBe(false); expect(focus).not.toHaveBeenCalled();
  });
  it('recovers a missing release when the browser starts a fresh primary touch', () => {
    open(); controller.invalidate();
    controller.pointerDown(pointer('pointerdown', { pointerId: 9, isPrimary: true }));
    expect(controller.consumeClick(click())).toBe(false);
    expect(open()).toBe(true);
  });
  it('restores cancellation focus without scrolling, but not across newer intent', () => {
    const focus = vi.spyOn(opener, 'focus');
    open(); controller.dismiss(); vi.advanceTimersByTime(20);
    expect(focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });
    open(); controller.dismiss(); controller.invalidate(); vi.advanceTimersByTime(20);
    expect(focus).toHaveBeenCalledOnce();
  });
  it('does not steal a fresh pointer focus while cancellation restoration is queued', () => {
    const other = document.createElement('button'); document.body.append(other);
    open(); controller.pointerEnd(pointer('pointerup')); controller.dismiss();
    controller.pointerDown(pointer('pointerdown', { pointerType: 'mouse', pointerId: 1 }));
    other.focus(); vi.advanceTimersByTime(20);
    expect(document.activeElement).toBe(other); other.remove();
  });
  it('executes a requested hold without stealing newer focus across its two animation frames', () => {
    const other = document.createElement('button'); document.body.append(other);
    const run = vi.fn(); request.actions = [{ id: 'hold', label: 'Hold', run, focus: 'restore' }];
    open(); controller.pointerEnd(pointer('pointerup')); controller.run('hold');
    controller.pointerDown(pointer('pointerdown', { pointerType: 'mouse', pointerId: 1 }));
    other.focus(); vi.advanceTimersByTime(40);
    expect(run).toHaveBeenCalledOnce(); expect(document.activeElement).toBe(other); other.remove();
  });
  it('recovers layout focus across surface revisions but rejects changed reading intent', () => {
    vi.spyOn(opener, 'getClientRects').mockReturnValue([new DOMRect(0, 0, 50, 50)] as unknown as DOMRectList);
    const focus = vi.spyOn(opener, 'focus');
    open(); controller.recoverAfterLayout(() => true); controller.invalidate(); vi.advanceTimersByTime(20);
    expect(focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });
    open(); controller.recoverAfterLayout(() => false); vi.advanceTimersByTime(20);
    expect(focus).toHaveBeenCalledOnce();
  });
  it('uses a visible layout fallback instead of a CSS-hidden thumbnail', () => {
    const fallback = document.createElement('button'); document.body.append(fallback);
    vi.spyOn(fallback, 'getClientRects').mockReturnValue([new DOMRect(0, 0, 50, 50)] as unknown as DOMRectList);
    request.fallbackFocus = () => fallback;
    open(); controller.recoverAfterLayout(() => true); vi.advanceTimersByTime(20);
    expect(document.activeElement).toBe(fallback); fallback.remove();
  });
  it('does not let layout recovery override newer focus', () => {
    const focus = vi.spyOn(opener, 'focus');
    open(); controller.recoverAfterLayout(() => true); controller.noteFocusIntent(); vi.advanceTimersByTime(20);
    expect(focus).not.toHaveBeenCalled();
  });
});
