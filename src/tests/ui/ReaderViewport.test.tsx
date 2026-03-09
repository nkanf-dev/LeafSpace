import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { ReaderViewport } from '../../components/reader/ReaderViewport';

describe('ReaderViewport', () => {
  it('renders initial page and scale', () => {
    render(<ReaderViewport initialPage={1} />);
    expect(screen.getByText(/P\.\s+1/)).toBeInTheDocument();
    expect(screen.getByText(/100/)).toBeInTheDocument();
  });

  it('increases scale when + is clicked', () => {
    render(<ReaderViewport initialPage={1} />);
    const zoomInBtn = screen.getByText('+');
    fireEvent.click(zoomInBtn);
    expect(screen.getByText(/110/)).toBeInTheDocument();
  });

  it('decreases scale when - is clicked', () => {
    render(<ReaderViewport initialPage={1} />);
    const zoomOutBtn = screen.getByText('-');
    fireEvent.click(zoomOutBtn);
    expect(screen.getByText(/90/)).toBeInTheDocument();
  });

  it('navigates to next page when Next is clicked', () => {
    render(<ReaderViewport initialPage={1} />);
    const nextBtn = screen.getByText('Next');
    fireEvent.click(nextBtn);
    expect(screen.getByText(/P\.\s+2/)).toBeInTheDocument();
  });

  it('navigates to previous page when Prev is clicked', () => {
    render(<ReaderViewport initialPage={2} />);
    const prevBtn = screen.getByText('Prev');
    fireEvent.click(prevBtn);
    expect(screen.getByText(/P\.\s+1/)).toBeInTheDocument();
  });
});
