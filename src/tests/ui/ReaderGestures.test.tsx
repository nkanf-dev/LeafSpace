import { useRef } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useReaderGestures } from '../../hooks/useReaderGestures';

function Harness({ onTurn, onZoom, contextKey = 'book:1', canSwipe = true }: { onTurn: (direction: number) => void; onZoom: (scale: number, anchor: {x:number;y:number}, midpoint:{x:number;y:number}) => void; contextKey?: string; canSwipe?: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  useReaderGestures({ containerRef, frameRef, contextKey, scale: 1, canSwipe, isActive: true, onActivate: () => {}, onTurn, onZoom });
  return <div ref={containerRef} data-testid="reader"><div ref={frameRef} data-testid="paper" /></div>;
}
function setup(overflow = false, canSwipe = true) {
  const onTurn = vi.fn(), onZoom = vi.fn();
  const view = render(<Harness onTurn={onTurn} onZoom={onZoom} canSwipe={canSwipe} />);
  const region = screen.getByTestId('reader'), paper = screen.getByTestId('paper');
  Object.defineProperties(region, { clientWidth: { value: 400 }, clientHeight: { value: 600 }, scrollWidth: { value: overflow ? 800 : 400 } });
  const touch = (id: number, x: number, y = 200, target: EventTarget = paper) => ({ identifier: id, clientX: x, clientY: y, target });
  const event = (type: string, touches: ReturnType<typeof touch>[], changedTouches = touches) => fireEvent(region, new TouchEvent(type, { bubbles: true, cancelable: true, touches: touches as unknown as Touch[], changedTouches: changedTouches as unknown as Touch[] }));
  return { view, region, paper, onTurn, onZoom, touch, event };
}
describe('reader touch transactions', () => {
  it('turns once for a deliberate horizontal swipe but ignores short or vertical movement', () => {
    const { event, touch, onTurn } = setup();
    event('touchstart', [touch(1, 300)]); event('touchmove', [touch(1, 180)]); event('touchend', [], [touch(1, 180)]);
    expect(onTurn).toHaveBeenCalledExactlyOnceWith(1);
    event('touchstart', [touch(1, 300)]); event('touchend', [], [touch(1, 280)]);
    event('touchstart', [touch(1, 300)]); event('touchmove', [touch(1, 285, 100)]); event('touchend', [], [touch(1, 100, 90)]);
    expect(onTurn).toHaveBeenCalledTimes(1);
  });
  it.each([[false, true], [true, true], [false, false]])('allows staggered pinch (overflow %s, swipe %s), previews then commits and never turns the remaining finger', (overflow, canSwipe) => {
    const { event, touch, onZoom, onTurn, paper } = setup(overflow, canSwipe);
    event('touchstart', [touch(1, 100)]); event('touchstart', [touch(1, 100), touch(2, 200)]);
    event('touchmove', [touch(1, 80), touch(2, 280)]);
    expect(paper.style.transform).toContain('scale(2)');
    expect(onZoom).not.toHaveBeenCalled();
    event('touchend', [touch(1, 80)], [touch(2, 280)]);
    expect(onZoom).toHaveBeenCalledExactlyOnceWith(2, { x: 150, y: 200 }, { x: 180, y: 200 });
    event('touchmove', [touch(1, 300)]); event('touchend', [], [touch(1, 300)]);
    expect(onTurn).not.toHaveBeenCalled();
    expect(paper.style.transform).toBe('');
  });
  it.each(['touchcancel', 'blur', 'third-contact', 'context', 'Escape', ' '])('rolls back pinch on %s and allows a fresh gesture', kind => {
    const { event, touch, onZoom, onTurn, paper, view } = setup();
    event('touchstart', [touch(1, 100), touch(2, 200)]); event('touchmove', [touch(1, 50), touch(2, 250)]);
    if (kind === 'touchcancel') event('touchcancel', []);
    else if (kind === 'blur') fireEvent.blur(window);
    else if (kind === 'Escape' || kind === ' ') fireEvent.keyDown(window, { key: kind });
    else if (kind === 'context') view.rerender(<Harness onTurn={onTurn} onZoom={onZoom} contextKey="book:2" />);
    else event('touchstart', [touch(1, 50), touch(2, 250), touch(3, 300)]);
    event('touchend', []);
    expect(onZoom).not.toHaveBeenCalled(); expect(paper.style.transform).toBe('');
    event('touchstart', [touch(1, 300)]); event('touchend', [], [touch(1, 200)]);
    expect(onTurn).toHaveBeenCalledExactlyOnceWith(1);
  });
  it('does not reuse a surviving finger after context interruption', () => {
    const { event, touch, onZoom, onTurn, view } = setup();
    event('touchstart', [touch(1, 100)]);
    view.rerender(<Harness onTurn={onTurn} onZoom={onZoom} contextKey="book:2" />);
    event('touchstart', [touch(1, 100), touch(2, 200)]);
    event('touchmove', [touch(1, 50), touch(2, 250)]); event('touchend', []);
    expect(onZoom).not.toHaveBeenCalled();
    event('touchstart', [touch(1, 100), touch(2, 200)]);
    event('touchmove', [touch(1, 50), touch(2, 250)]); event('touchend', []);
    expect(onZoom).toHaveBeenCalledTimes(1);
  });
  it('rejects contacts from a different pane', () => {
    const { event, touch, onZoom } = setup();
    event('touchstart', [touch(1, 100), touch(2, 200, 200, document.body)]);
    event('touchmove', [touch(1, 50), touch(2, 250, 200, document.body)]); event('touchend', []);
    expect(onZoom).not.toHaveBeenCalled();
  });
});
