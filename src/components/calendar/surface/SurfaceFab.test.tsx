import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SurfaceFab } from './SurfaceFab';

describe('SurfaceFab', () => {
  it('renders a fixed bottom-right button with the label', () => {
    render(<SurfaceFab label="New date" onClick={vi.fn()} />);

    const fab = screen.getByTestId('surface-fab');
    expect(fab).toHaveTextContent('New date');
    expect(fab.className).toContain('fixed');
    expect(fab.className).toContain('right-4');
    expect(fab.className).toContain('bottom-12');
  });

  it('fires onClick when clicked', () => {
    const onClick = vi.fn();
    render(<SurfaceFab label="New date" onClick={onClick} />);

    fireEvent.click(screen.getByTestId('surface-fab'));

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('renders a default plus icon when no icon is passed', () => {
    render(<SurfaceFab label="New date" onClick={vi.fn()} />);

    const fab = screen.getByTestId('surface-fab');
    expect(fab.querySelector('svg')).toBeInTheDocument();
  });

  it('renders a custom icon when one is passed', () => {
    render(
      <SurfaceFab
        label="New date"
        onClick={vi.fn()}
        icon={<span data-testid="custom-icon">*</span>}
      />,
    );

    expect(screen.getByTestId('custom-icon')).toBeInTheDocument();
  });
});
