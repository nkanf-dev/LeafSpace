import { StrictMode, type ComponentProps } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkspaceAutoSave } from '../../hooks/useWorkspaceAutoSave';

type Input = Parameters<typeof useWorkspaceAutoSave>[0];

function initialInput(): Input {
  return {
    documentId: 'book-a', currentPage: 1, scale: 1, heldPages: [], windows: [],
    activeWindowId: 'main', enabled: true, saveWorkspace: vi.fn().mockResolvedValue(undefined),
  };
}

function advance(milliseconds = 500) {
  act(() => vi.advanceTimersByTime(milliseconds));
}

describe('workspace autosave', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('saves once after the debounce and stays idle after saving completes', () => {
    const input = initialInput();
    const { rerender } = renderHook(useWorkspaceAutoSave, { initialProps: input });
    advance(499);
    expect(input.saveWorkspace).not.toHaveBeenCalled();
    advance(1);
    expect(input.saveWorkspace).toHaveBeenCalledExactlyOnceWith('book-a');
    rerender({ ...input, enabled: false }); // persistence status: saving
    rerender(input); // persistence status: idle
    advance(10_000);
    expect(input.saveWorkspace).toHaveBeenCalledTimes(1);
  });

  it('debounces rapid changes and saves again for a new reading revision', () => {
    const input = initialInput();
    const { rerender } = renderHook(useWorkspaceAutoSave, { initialProps: input });
    advance(300);
    rerender({ ...input, currentPage: 2 });
    advance(300);
    rerender({ ...input, currentPage: 3 });
    advance(499);
    expect(input.saveWorkspace).not.toHaveBeenCalled();
    advance(1);
    rerender({ ...input, currentPage: 4 });
    advance();
    expect(input.saveWorkspace).toHaveBeenCalledTimes(2);
  });

  it('waits for import/restore hydration to finish before saving', () => {
    const input = initialInput();
    const { rerender } = renderHook(useWorkspaceAutoSave, {
      initialProps: { ...input, enabled: false },
    });
    advance(2_000);
    expect(input.saveWorkspace).not.toHaveBeenCalled();
    rerender({ ...input, currentPage: 12, scale: 1.5 });
    advance();
    expect(input.saveWorkspace).toHaveBeenCalledExactlyOnceWith('book-a');
  });

  it('retains edits made while a previous save is in progress', () => {
    const input = initialInput();
    const { rerender } = renderHook(useWorkspaceAutoSave, { initialProps: input });
    advance();
    rerender({ ...input, enabled: false });
    rerender({ ...input, currentPage: 2, enabled: false });
    advance(2_000);
    expect(input.saveWorkspace).toHaveBeenCalledTimes(1);
    rerender({ ...input, currentPage: 2 });
    advance();
    expect(input.saveWorkspace).toHaveBeenCalledTimes(2);
  });

  it('cancels pending saves when blocked and does not retry unchanged failed saves', () => {
    const input = initialInput();
    const { rerender } = renderHook(useWorkspaceAutoSave, { initialProps: input });
    advance(300);
    rerender({ ...input, enabled: false });
    advance(2_000);
    expect(input.saveWorkspace).not.toHaveBeenCalled();
    rerender(input);
    advance();
    rerender({ ...input, enabled: false }); // store handles failure and exposes error
    advance(2_000);
    rerender(input); // explicit retry can return store to idle
    advance(2_000);
    expect(input.saveWorkspace).toHaveBeenCalledTimes(1);
  });

  it.each(['scale', 'heldPages', 'windows', 'activeWindowId'] as const)(
    'persists changes to %s even when the page stays the same', (field) => {
      const input = initialInput();
      const { rerender } = renderHook(useWorkspaceAutoSave, { initialProps: input });
      advance();
      const updates = { scale: 1.5, heldPages: [], windows: [], activeWindowId: 'reference' };
      rerender({ ...input, [field]: updates[field] });
      advance();
      expect(input.saveWorkspace).toHaveBeenCalledTimes(2);
    },
  );

  it('cancels the old document timer and resets tracking when the document closes', () => {
    const input = initialInput();
    const { rerender } = renderHook(useWorkspaceAutoSave, { initialProps: input });
    advance(300);
    rerender({ ...input, documentId: 'book-b' });
    advance();
    expect(input.saveWorkspace).toHaveBeenCalledExactlyOnceWith('book-b');
    rerender({ ...input, documentId: null });
    advance(2_000);
    rerender({ ...input, documentId: 'book-b' });
    advance();
    expect(input.saveWorkspace).toHaveBeenCalledTimes(2);
  });

  it('cleans up on unmount and tolerates StrictMode effect replay', () => {
    const input = initialInput();
    const wrapper = ({ children }: ComponentProps<typeof StrictMode>) => <StrictMode>{children}</StrictMode>;
    const { unmount } = renderHook(useWorkspaceAutoSave, { initialProps: input, wrapper });
    advance();
    expect(input.saveWorkspace).toHaveBeenCalledTimes(1);
    unmount();
    advance(2_000);
    expect(input.saveWorkspace).toHaveBeenCalledTimes(1);
    const second = renderHook(useWorkspaceAutoSave, { initialProps: input });
    second.unmount();
    advance();
    expect(input.saveWorkspace).toHaveBeenCalledTimes(1);
  });
});
