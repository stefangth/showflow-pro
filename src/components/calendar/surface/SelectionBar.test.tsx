import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SelectionBar } from './SelectionBar';
import type { SelectionBarAction } from './SelectionBar';

const ACTIONS: SelectionBarAction[] = [
  { key: 'confirm', label: 'Confirm holds' },
  { key: 'hire-orders', label: 'Generate hire orders' },
];

describe('SelectionBar', () => {
  it('shows the selected count and one button per action', () => {
    render(<SelectionBar count={3} actions={ACTIONS} onAction={vi.fn()} onClear={vi.fn()} />);

    expect(screen.getByTestId('selection-bar')).toBeInTheDocument();
    expect(screen.getByText('3 selected')).toBeInTheDocument();
    expect(screen.getByTestId('selection-bar-action-confirm')).toHaveTextContent('Confirm holds');
    expect(screen.getByTestId('selection-bar-action-hire-orders')).toHaveTextContent(
      'Generate hire orders'
    );
  });

  it('fires onAction with the action key when an action button is clicked', () => {
    const onAction = vi.fn();
    render(<SelectionBar count={3} actions={ACTIONS} onAction={onAction} onClear={vi.fn()} />);

    fireEvent.click(screen.getByTestId('selection-bar-action-confirm'));

    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith('confirm');
  });

  it('fires onClear when the clear control is clicked', () => {
    const onClear = vi.fn();
    render(<SelectionBar count={3} actions={ACTIONS} onAction={vi.fn()} onClear={onClear} />);

    fireEvent.click(screen.getByTestId('selection-bar-clear'));

    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('renders nothing when count is 0', () => {
    render(<SelectionBar count={0} actions={ACTIONS} onAction={vi.fn()} onClear={vi.fn()} />);

    expect(screen.queryByTestId('selection-bar')).not.toBeInTheDocument();
  });

  it('disables a gated action and carries its title', () => {
    const gatedActions: SelectionBarAction[] = [
      { key: 'confirm', label: 'Confirm holds', disabled: true, title: 'No open holds selected' },
    ];
    render(<SelectionBar count={2} actions={gatedActions} onAction={vi.fn()} onClear={vi.fn()} />);

    const button = screen.getByTestId('selection-bar-action-confirm');
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('title', 'No open holds selected');
  });
});
