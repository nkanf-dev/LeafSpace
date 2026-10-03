import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useThumbnailLongPress } from '../../hooks/useThumbnailLongPress';
import { ThumbnailActions } from '../../services/ThumbnailActions';

function Harness({ controller, contextKey = 'a', enabled = true }: { controller: ThumbnailActions; contextKey?: string; enabled?: boolean }) {
  const press = useThumbnailLongPress({ controller, contextKey, enabled,
    request: (pageNumber: number, opener) => ({ pageNumber, opener, actions: [] }) });
  return <button onPointerDown={event => press.onPointerDown(event, 8)} onContextMenu={press.onContextMenu}>Thumbnail</button>;
}
function pointer(target: Element | Window, type: string, overrides = {}) {
  const event = Object.assign(new Event(type, { bubbles: true, cancelable: true }), { pointerType: 'touch', pointerId: 7, isPrimary: true, button: 0, clientX: 40, clientY: 60 }, overrides);
  fireEvent(target, event); return event;
}
describe('thumbnail long-press recognition', () => {
  let controller: ThumbnailActions;
  beforeEach(() => { vi.useFakeTimers(); controller = new ThumbnailActions(); });
  afterEach(() => { controller.dispose(); vi.useRealTimers(); vi.restoreAllMocks(); });
  const wait = (ms = 500) => act(() => vi.advanceTimersByTime(ms));
  it('claims only after the hold and does not prevent ordinary touch scrolling', () => {
    render(<Harness controller={controller} />);
    expect(pointer(screen.getByRole('button'), 'pointerdown').defaultPrevented).toBe(false);
    wait(499); expect(controller.ownsInput()).toBe(false);
    wait(1); expect(controller.getSnapshot().request?.pageNumber).toBe(8);
  });
  it.each(['pointerup', 'pointercancel', 'lostpointercapture', 'scroll', 'blur', 'keydown', 'move', 'second-contact'])(
    'abandons interrupted %s input without reopening', type => {
      render(<Harness controller={controller} />); pointer(screen.getByRole('button'), 'pointerdown'); wait(200);
      if (type === 'move') pointer(window, 'pointermove', { clientX: 51 });
      else if (type === 'second-contact') pointer(window, 'pointerdown', { pointerId: 8, isPrimary: false });
      else pointer(window, type);
      wait(600); expect(controller.ownsInput()).toBe(false);
    },
  );
  it.each(['mouse', 'pen', 'secondary'])('leaves %s input alone', type => {
    render(<Harness controller={controller} />);
    pointer(screen.getByRole('button'), 'pointerdown', type === 'secondary' ? { isPrimary: false } : { pointerType: type });
    wait(); expect(controller.ownsInput()).toBe(false);
  });
  it('latches an away-and-back surface change and accepts a fresh sequence', () => {
    const result = render(<Harness controller={controller} />); pointer(screen.getByRole('button'), 'pointerdown');
    result.rerender(<Harness controller={controller} contextKey="b" />); result.rerender(<Harness controller={controller} />);
    wait(); expect(controller.ownsInput()).toBe(false);
    pointer(screen.getByRole('button'), 'pointerdown', { pointerId: 8 }); wait(); expect(controller.ownsInput()).toBe(true);
  });
  it('does not invalidate its own claimed request when the surface becomes suspended', () => {
    const result = render(<Harness controller={controller} />); pointer(screen.getByRole('button'), 'pointerdown'); wait();
    result.rerender(<Harness controller={controller} enabled={false} />);
    expect(controller.getSnapshot().request?.isCurrent()).toBe(true);
  });
  it('cancels source invalidation, disabled surfaces and unmounted targets', () => {
    const result = render(<Harness controller={controller} />); pointer(screen.getByRole('button'), 'pointerdown');
    act(() => controller.invalidate()); wait(); expect(controller.ownsInput()).toBe(false);
    pointer(screen.getByRole('button'), 'pointerdown'); result.rerender(<Harness controller={controller} enabled={false} />);
    wait(); expect(controller.ownsInput()).toBe(false);
    result.rerender(<Harness controller={controller} />); pointer(screen.getByRole('button'), 'pointerdown'); result.unmount();
    wait(); expect(controller.ownsInput()).toBe(false);
  });
});
