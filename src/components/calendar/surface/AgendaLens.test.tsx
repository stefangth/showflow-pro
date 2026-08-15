import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AgendaLens } from './AgendaLens';
import type { ProducerDateEntry } from '@/lib/calendar/types';

function entry(overrides: Partial<ProducerDateEntry> = {}): ProducerDateEntry {
  return {
    id: 'pd-1',
    date: new Date(2026, 7, 10),
    program: 'Cirque Noir',
    subProgram: null,
    venue: 'Big Top',
    city: 'Berlin',
    session1: '19:00',
    session2: null,
    session3: null,
    status: 'open',
    mainSlots: 6,
    confirmedMain: 0,
    acceptedMain: 0,
    pendingMain: 0,
    understudySlots: 0,
    confirmedUs: 0,
    custom: null,
    hireOrderId: null,
    hireOrderStatus: null,
    ...overrides,
  };
}

describe('AgendaLens', () => {
  it('groups entries into 2 ISO (Monday-first) weeks across 3 entries', () => {
    // 2026-08-10 = Monday (week A); 2026-08-12 = Wednesday, same week A;
    // 2026-08-20 = Thursday, week starting 2026-08-17 (week B).
    const e1 = entry({ id: 'pd-1', date: new Date(2026, 7, 10) });
    const e2 = entry({ id: 'pd-2', date: new Date(2026, 7, 12) });
    const e3 = entry({ id: 'pd-3', date: new Date(2026, 7, 20), status: 'fully_filled', confirmedMain: 6 });

    render(<AgendaLens entries={[e1, e2, e3]} onOpenDay={vi.fn()} onAction={vi.fn()} />);

    expect(screen.getAllByText(/^Week of/)).toHaveLength(2);
    expect(screen.getByTestId('agenda-row-pd-1')).toBeInTheDocument();
    expect(screen.getByTestId('agenda-row-pd-2')).toBeInTheDocument();
    expect(screen.getByTestId('agenda-row-pd-3')).toBeInTheDocument();
  });

  it('a fully-filled row shows "Generate hire order" and fires onAction(entry, "generate")', () => {
    const e = entry({ id: 'pd-3', status: 'fully_filled', confirmedMain: 6 });
    const onAction = vi.fn();
    render(<AgendaLens entries={[e]} onOpenDay={vi.fn()} onAction={onAction} />);

    const actionBtn = screen.getByTestId('agenda-action-pd-3');
    expect(actionBtn).toHaveTextContent('Generate hire order');
    fireEvent.click(actionBtn);
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith(e, 'generate');
  });

  it('a fully-filled row with an active order shows the order status instead of "Generate hire order"', () => {
    const e = entry({
      id: 'pd-4',
      status: 'fully_filled',
      confirmedMain: 6,
      hireOrderId: 'ho-1',
      hireOrderStatus: 'issued',
    });
    const onAction = vi.fn();
    render(<AgendaLens entries={[e]} onOpenDay={vi.fn()} onAction={onAction} />);

    expect(screen.queryByTestId('agenda-action-pd-4')).not.toBeInTheDocument();
    expect(screen.getByTestId('agenda-order-status-pd-4')).toHaveTextContent('Awaiting countersign');
  });

  it('shows "Confirm holds" for partially_filled and "Open casting" for open, and no action for cancelled', () => {
    render(
      <AgendaLens
        entries={[
          entry({ id: 'a', status: 'partially_filled' }),
          entry({ id: 'b', status: 'open' }),
          entry({ id: 'c', status: 'cancelled' }),
        ]}
        onOpenDay={vi.fn()}
        onAction={vi.fn()}
      />
    );
    expect(screen.getByTestId('agenda-action-a')).toHaveTextContent('Confirm holds');
    expect(screen.getByTestId('agenda-action-b')).toHaveTextContent('Open casting');
    expect(screen.queryByTestId('agenda-action-c')).not.toBeInTheDocument();
  });

  it('clicking a row fires onOpenDay with the entry date, without also firing onAction', () => {
    const e = entry({ id: 'pd-1', status: 'partially_filled' });
    const onOpenDay = vi.fn();
    const onAction = vi.fn();
    render(<AgendaLens entries={[e]} onOpenDay={onOpenDay} onAction={onAction} />);

    fireEvent.click(screen.getByTestId('agenda-row-pd-1'));
    expect(onOpenDay).toHaveBeenCalledTimes(1);
    expect(onOpenDay).toHaveBeenCalledWith(e.date);
    expect(onAction).not.toHaveBeenCalled();
  });

  it('clicking the row action button fires onAction but not onOpenDay (no bubbling)', () => {
    const e = entry({ id: 'pd-3', status: 'fully_filled', confirmedMain: 6 });
    const onOpenDay = vi.fn();
    const onAction = vi.fn();
    render(<AgendaLens entries={[e]} onOpenDay={onOpenDay} onAction={onAction} />);

    fireEvent.click(screen.getByTestId('agenda-action-pd-3'));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onOpenDay).not.toHaveBeenCalled();
  });

  it('renders the fill meter + "confirmedMain/mainSlots main" label for a row', () => {
    const e = entry({ id: 'pd-1', mainSlots: 6, confirmedMain: 3 });
    render(<AgendaLens entries={[e]} onOpenDay={vi.fn()} onAction={vi.fn()} />);
    expect(screen.getByTestId('fill-meter')).toBeInTheDocument();
    expect(screen.getByText('3/6 main')).toBeInTheDocument();
  });

  it('renders the status badge for a row', () => {
    const e = entry({ id: 'pd-1', status: 'partially_filled' });
    render(<AgendaLens entries={[e]} onOpenDay={vi.fn()} onAction={vi.fn()} />);
    expect(screen.getByText('Casting')).toBeInTheDocument();
  });

  it('disables the "Confirm holds" action button and exposes its title when actionGates.confirmHolds is gated', () => {
    const e = entry({ id: 'pd-1', status: 'partially_filled' });
    const onAction = vi.fn();
    render(
      <AgendaLens
        entries={[e]}
        onOpenDay={vi.fn()}
        onAction={onAction}
        actionGates={{ confirmHolds: { disabled: true, title: "You don't have permission to confirm bookings" } }}
      />
    );
    const btn = screen.getByTestId('agenda-action-pd-1');
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('title', "You don't have permission to confirm bookings");
    fireEvent.click(btn);
    expect(onAction).not.toHaveBeenCalled();
  });

  it('disables the "Generate hire order" action button when actionGates.generateHireOrder is gated', () => {
    const e = entry({ id: 'pd-3', status: 'fully_filled', confirmedMain: 6 });
    render(
      <AgendaLens
        entries={[e]}
        onOpenDay={vi.fn()}
        onAction={vi.fn()}
        actionGates={{ generateHireOrder: { disabled: true, title: 'Nope' } }}
      />
    );
    const btn = screen.getByTestId('agenda-action-pd-3');
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('title', 'Nope');
  });

  it('disables the "Open casting" action button when actionGates.openCasting is gated', () => {
    const e = entry({ id: 'pd-b', status: 'open' });
    render(
      <AgendaLens
        entries={[e]}
        onOpenDay={vi.fn()}
        onAction={vi.fn()}
        actionGates={{ openCasting: { disabled: true, title: 'Nope' } }}
      />
    );
    const btn = screen.getByTestId('agenda-action-pd-b');
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('title', 'Nope');
  });

  it('leaves the action button enabled when its gate is absent or not disabled', () => {
    const e = entry({ id: 'pd-1', status: 'partially_filled' });
    render(
      <AgendaLens
        entries={[e]}
        onOpenDay={vi.fn()}
        onAction={vi.fn()}
        actionGates={{ generateHireOrder: { disabled: true, title: 'Nope' } }}
      />
    );
    const btn = screen.getByTestId('agenda-action-pd-1');
    expect(btn).not.toBeDisabled();
    expect(btn).not.toHaveAttribute('title');
  });
});
