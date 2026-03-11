// @ts-nocheck

import { render, screen, fireEvent } from '@testing-library/react';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { QuickFlipOverlay } from '../../components/quick-flip/QuickFlipOverlay';

describe('QuickFlipOverlay', () => {
  const defaultProps = {
    isVisible: true,
    onClose: vi.fn(),
    currentPage: 10,
    totalPages: 100,
    onPageChange: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders when visible', () => {
    render(<QuickFlipOverlay {...defaultProps} />);
    expect(screen.getByText('速翻视图')).toBeInTheDocument();
    expect(screen.getByText('长按进入时间轴')).toBeInTheDocument();
  });

  it('calls onClose when Escape is pressed', () => {
    render(<QuickFlipOverlay {...defaultProps} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it('moves selection with ArrowRight and commits on Enter', () => {
    render(<QuickFlipOverlay {...defaultProps} />);
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(defaultProps.onPageChange).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(defaultProps.onPageChange).toHaveBeenCalledWith(11);
  });

  it('moves selection with ArrowLeft and commits on Enter', () => {
    render(<QuickFlipOverlay {...defaultProps} />);
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(defaultProps.onPageChange).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(defaultProps.onPageChange).toHaveBeenCalledWith(9);
  });

  it('does not render when isVisible is false', () => {
    const { container } = render(<QuickFlipOverlay {...defaultProps} isVisible={false} />);
    expect(container.firstChild).toBeNull();
  });
});
