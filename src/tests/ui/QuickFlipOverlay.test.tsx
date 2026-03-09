// @ts-nocheck

import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { QuickFlipOverlay } from '../../components/quick-flip/QuickFlipOverlay';

describe('QuickFlipOverlay', () => {
  const defaultProps = {
    isVisible: true,
    onClose: vi.fn(),
    currentPage: 10,
    totalPages: 100,
    onPageChange: vi.fn(),
  };

  it('renders when visible', () => {
    render(<QuickFlipOverlay {...defaultProps} />);
    expect(screen.getByText('Page 10 / 100')).toBeInTheDocument();
  });

  it('calls onClose when Escape is pressed', () => {
    render(<QuickFlipOverlay {...defaultProps} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it('calls onPageChange with next page when ArrowRight is pressed', () => {
    render(<QuickFlipOverlay {...defaultProps} />);
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(defaultProps.onPageChange).toHaveBeenCalledWith(11);
  });

  it('calls onPageChange with previous page when ArrowLeft is pressed', () => {
    render(<QuickFlipOverlay {...defaultProps} />);
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(defaultProps.onPageChange).toHaveBeenCalledWith(9);
  });

  it('does not render when isVisible is false', () => {
    const { container } = render(<QuickFlipOverlay {...defaultProps} isVisible={false} />);
    expect(container.firstChild).toBeNull();
  });
});
