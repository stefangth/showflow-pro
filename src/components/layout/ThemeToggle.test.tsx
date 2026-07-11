import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useTheme } from 'next-themes';
import { ThemeToggle } from './ThemeToggle';

vi.mock('next-themes', () => ({ useTheme: vi.fn() }));

const setTheme = vi.fn();

beforeEach(() => {
  setTheme.mockClear();
  vi.mocked(useTheme).mockReturnValue({ theme: 'system', setTheme } as any);
});

describe('ThemeToggle', () => {
  it('renders three theme buttons with accessible labels', () => {
    render(<ThemeToggle />);
    expect(screen.getByRole('button', { name: 'Light theme' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'System theme' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dark theme' })).toBeInTheDocument();
  });

  it('marks the current theme button as pressed and others as not', () => {
    render(<ThemeToggle />);
    expect(screen.getByRole('button', { name: 'System theme' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Light theme' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Dark theme' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('calls setTheme with the chosen value on click', () => {
    render(<ThemeToggle />);
    fireEvent.click(screen.getByRole('button', { name: 'Dark theme' }));
    expect(setTheme).toHaveBeenCalledWith('dark');
    fireEvent.click(screen.getByRole('button', { name: 'Light theme' }));
    expect(setTheme).toHaveBeenCalledWith('light');
    fireEvent.click(screen.getByRole('button', { name: 'System theme' }));
    expect(setTheme).toHaveBeenCalledWith('system');
  });
});
