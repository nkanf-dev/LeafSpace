// @ts-nocheck

import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ReaderViewport } from '../../components/reader/ReaderViewport';

describe('ReaderViewport', () => {
  it('renders initial page and scale', () => {
    render(<ReaderViewport pageNumber={1} isMain={true} />);
    expect(screen.getByText('Main: Page 1')).toBeInTheDocument();
  });

  it('increases scale when Zoom + is clicked', () => {
    render(<ReaderViewport pageNumber={1} isMain={true} />);
    const zoomInButton = screen.getByText('+');
    fireEvent.click(zoomInButton);
    expect(screen.getByText('110%')).toBeInTheDocument();
  });

  it('decreases scale when Zoom - is clicked', () => {
    render(<ReaderViewport pageNumber={1} isMain={true} />);
    const zoomOutButton = screen.getByText('-');
    fireEvent.click(zoomOutButton);
    expect(screen.getByText('90%')).toBeInTheDocument();
  });
});
