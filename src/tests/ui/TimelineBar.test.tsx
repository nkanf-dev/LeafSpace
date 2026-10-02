import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TimelineBar } from '../../components/timeline/TimelineBar';

function setup() {
  const navigate = vi.fn();
  const view = render(<TimelineBar currentPage={3} totalPages={20} onPageClick={navigate} />);
  const slider = screen.getByRole('slider');
  slider.setPointerCapture = vi.fn();
  const start = () => fireEvent.pointerDown(slider, { pointerId: 1, button: 0 });
  const move = () => fireEvent.change(slider, { target: { value: '12' } });
  const end = () => fireEvent.pointerUp(slider, { pointerId: 1 });
  return { navigate, view, slider, start, move, end };
}

describe('timeline preview', () => {
  it('previews without navigation, commits once on release, and keeps keyboard changes immediate', () => {
    const { start, move, end, navigate, slider } = setup();
    start(); move();
    expect(navigate).not.toHaveBeenCalled();
    expect(slider).toHaveAttribute('aria-valuetext', '预览：第 12 页，共 20 页');
    expect(screen.getByText('预览第 12 页')).toBeVisible();
    end();
    expect(navigate).toHaveBeenCalledExactlyOnceWith(12);
    fireEvent.change(slider, { target: { value: '4' } });
    expect(navigate).toHaveBeenLastCalledWith(4);
  });
  it.each(['Escape', ' '])('cancels %s without late pointer movement committing and supports another drag', key => {
    const { start, move, end, navigate, slider } = setup();
    start(); move();
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    fireEvent(slider, event);
    expect(event.defaultPrevented).toBe(true);
    move(); end();
    expect(navigate).not.toHaveBeenCalled();
    expect(slider).toHaveAttribute('aria-valuetext', '第 3 页，共 20 页');
    start(); move(); end();
    expect(navigate).toHaveBeenCalledExactlyOnceWith(12);
  });
  it.each(['pointerCancel', 'lostPointerCapture', 'blur'])('discards on %s', kind => {
    const { start, move, end, navigate, slider } = setup();
    start(); move();
    if (kind === 'pointerCancel') fireEvent.pointerCancel(slider);
    else if (kind === 'lostPointerCapture') fireEvent.lostPointerCapture(slider);
    else fireEvent.blur(window);
    end();
    fireEvent.change(slider, { target: { value: '12' } });
    expect(navigate).not.toHaveBeenCalled();
  });
  it('allows a fresh drag after blur without receiving the old pointerup', () => {
    const { start, move, end, navigate } = setup();
    start(); move(); fireEvent.blur(window);
    start(); move(); end();
    expect(navigate).toHaveBeenCalledExactlyOnceWith(12);
  });
  it('restores keyboard navigation after blur without the old pointerup', () => {
    const { start, move, navigate, slider } = setup();
    start(); move(); fireEvent.blur(window);
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    fireEvent.change(slider, { target: { value: '4' } });
    expect(navigate).toHaveBeenCalledExactlyOnceWith(4);
  });
  it('accepts independent onChange-only input after a canceled pointer has finished', async () => {
    const { start, move, end, navigate, slider } = setup();
    start(); move(); fireEvent.pointerCancel(slider); end();
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 1)); });
    fireEvent.change(slider, { target: { value: '5' } });
    expect(navigate).toHaveBeenCalledExactlyOnceWith(5);
  });
  it('discards a stale drag after external navigation', () => {
    const { start, move, end, navigate, view } = setup();
    start(); move();
    view.rerender(<TimelineBar currentPage={8} totalPages={20} onPageClick={navigate} />);
    expect(screen.queryByText('预览第 12 页')).not.toBeInTheDocument();
    end();
    expect(navigate).not.toHaveBeenCalled();
  });
});
