import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '@/test/renderWithProviders';
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

    render(<AgendaLens entries={[e1, e2, e3]} onOpenEntry={vi.fn()} onAction={vi.fn()} />);

    expect(screen.getAllByText(/^Week of/)).toHaveLength(2);
    expect(screen.getByTestId('agenda-row-pd-1')).toBeInTheDocument();
    expect(screen.getByTestId('agenda-row-pd-2')).toBeInTheDocument();
    expect(screen.getByTestId('agenda-row-pd-3')).toBeInTheDocument();
  });

  it('a fully-filled row shows "Generate hire order" and fires onAction(entry, "generate")', () => {
    const e = entry({ id: 'pd-3', status: 'fully_filled', confirmedMain: 6 });
    const onAction = vi.fn();
    render(<AgendaLens entries={[e]} onOpenEntry={vi.fn()} onAction={onAction} />);

    const actionBtn = screen.getByTestId('agenda-action-pd-3');
    expect(actionBtn).toHaveTextContent('Draft the contract');
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
    render(<AgendaLens entries={[e]} onOpenEntry={vi.fn()} onAction={onAction} />);

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
        onOpenEntry={vi.fn()}
        onAction={vi.fn()}
      />
    );
    expect(screen.getByTestId('agenda-action-a')).toHaveTextContent('Book who said yes');
    expect(screen.getByTestId('agenda-action-b')).toHaveTextContent('Open casting');
    expect(screen.queryByTestId('agenda-action-c')).not.toBeInTheDocument();
  });

  it('clicking a row fires onOpenEntry with THIS row entry, without also firing onAction', () => {
    const e = entry({ id: 'pd-1', status: 'partially_filled' });
    const onOpenEntry = vi.fn();
    const onAction = vi.fn();
    render(<AgendaLens entries={[e]} onOpenEntry={onOpenEntry} onAction={onAction} />);

    fireEvent.click(screen.getByTestId('agenda-row-pd-1'));
    expect(onOpenEntry).toHaveBeenCalledTimes(1);
    expect(onOpenEntry).toHaveBeenCalledWith(e);
    expect(onAction).not.toHaveBeenCalled();
  });

  it('pressing Enter on a focused row fires onOpenEntry with that row entry', () => {
    const e = entry({ id: 'pd-1', status: 'partially_filled' });
    const onOpenEntry = vi.fn();
    render(<AgendaLens entries={[e]} onOpenEntry={onOpenEntry} onAction={vi.fn()} />);

    fireEvent.keyDown(screen.getByTestId('agenda-row-pd-1'), { key: 'Enter' });
    expect(onOpenEntry).toHaveBeenCalledTimes(1);
    expect(onOpenEntry).toHaveBeenCalledWith(e);
  });

  it('pressing Space on a focused row fires onOpenEntry with that row entry', () => {
    const e = entry({ id: 'pd-1', status: 'partially_filled' });
    const onOpenEntry = vi.fn();
    render(<AgendaLens entries={[e]} onOpenEntry={onOpenEntry} onAction={vi.fn()} />);

    fireEvent.keyDown(screen.getByTestId('agenda-row-pd-1'), { key: ' ' });
    expect(onOpenEntry).toHaveBeenCalledTimes(1);
    expect(onOpenEntry).toHaveBeenCalledWith(e);
  });

  it('clicking the row action button fires onAction but not onOpenEntry (no bubbling)', () => {
    const e = entry({ id: 'pd-3', status: 'fully_filled', confirmedMain: 6 });
    const onOpenEntry = vi.fn();
    const onAction = vi.fn();
    render(<AgendaLens entries={[e]} onOpenEntry={onOpenEntry} onAction={onAction} />);

    fireEvent.click(screen.getByTestId('agenda-action-pd-3'));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onOpenEntry).not.toHaveBeenCalled();
  });

  it('renders the fill meter + "confirmedMain/mainSlots main" label for a row', () => {
    const e = entry({ id: 'pd-1', mainSlots: 6, confirmedMain: 3 });
    render(<AgendaLens entries={[e]} onOpenEntry={vi.fn()} onAction={vi.fn()} />);
    expect(screen.getByTestId('fill-meter')).toBeInTheDocument();
    expect(screen.getByText('3/6 main')).toBeInTheDocument();
  });

  it('renders the status badge for a row', () => {
    const e = entry({ id: 'pd-1', status: 'partially_filled' });
    render(<AgendaLens entries={[e]} onOpenEntry={vi.fn()} onAction={vi.fn()} />);
    expect(screen.getByText('Casting')).toBeInTheDocument();
  });

  it('disables the "Confirm holds" action button and exposes its title when actionGates.confirmHolds is gated', () => {
    const e = entry({ id: 'pd-1', status: 'partially_filled' });
    const onAction = vi.fn();
    render(
      <AgendaLens
        entries={[e]}
        onOpenEntry={vi.fn()}
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
        onOpenEntry={vi.fn()}
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
        onOpenEntry={vi.fn()}
        onAction={vi.fn()}
        actionGates={{ openCasting: { disabled: true, title: 'Nope' } }}
      />
    );
    const btn = screen.getByTestId('agenda-action-pd-b');
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('title', 'Nope');
  });

  it('a row stacks single-column by default (mobile) with md: classes restoring the desktop single-line row', () => {
    const e = entry({ id: 'pd-1' });
    render(<AgendaLens entries={[e]} onOpenEntry={vi.fn()} onAction={vi.fn()} />);

    const row = screen.getByTestId('agenda-row-pd-1');
    // Mobile-first: the row is a vertical stack (no side-by-side columns);
    // `md:` restores the desktop single-line row exactly at >=768px.
    expect(row.className).toMatch(/\bflex-col\b/);
    expect(row.className).toMatch(/\bmd:flex-row\b/);
    // The content block (title/venue) is full width on mobile, restoring
    // its flexible desktop sizing only at md:.
    const title = screen.getByText('Cirque Noir');
    expect(title.parentElement?.className).toMatch(/\bw-full\b/);
    expect(title.parentElement?.className).toMatch(/\bmd:flex-1\b/);
  });

  describe('grouping toggle (per-date / per-show)', () => {
    it('defaults to per-date: a multi-session entry renders as one row with HH:MM time and a +1 badge', () => {
      const e = entry({ id: 'pd-1', session1: '18:00:00', session2: '21:00:00', session3: null });
      renderWithProviders(<AgendaLens entries={[e]} onOpenEntry={vi.fn()} onAction={vi.fn()} />);

      expect(screen.getByTestId('agenda-row-pd-1')).toBeInTheDocument();
      expect(screen.queryByTestId('agenda-row-pd-1-s1')).not.toBeInTheDocument();
      expect(screen.getByText('18:00')).toBeInTheDocument();
      expect(screen.queryByText('18:00:00')).not.toBeInTheDocument();
      expect(screen.getByText('+1')).toBeInTheDocument();
    });

    it('clicking "Per show" expands a multi-session entry into one row per performance, with no +N badge and no action on the follow-on row', () => {
      const e = entry({
        id: 'pd-1',
        session1: '18:00:00',
        session2: '21:00:00',
        session3: null,
        status: 'open',
      });
      renderWithProviders(<AgendaLens entries={[e]} onOpenEntry={vi.fn()} onAction={vi.fn()} />);

      fireEvent.click(screen.getByTestId('agenda-grouping-per-show'));

      expect(screen.queryByTestId('agenda-row-pd-1')).not.toBeInTheDocument();
      const row1 = screen.getByTestId('agenda-row-pd-1-s1');
      const row2 = screen.getByTestId('agenda-row-pd-1-s2');
      expect(row1).toHaveTextContent('18:00');
      expect(row2).toHaveTextContent('21:00');
      expect(screen.queryByText('+1')).not.toBeInTheDocument();
      // Only the first performance row carries the row action.
      expect(screen.getByTestId('agenda-action-pd-1')).toBeInTheDocument();
      expect(row2.querySelector('button')).toBeNull();
    });

    it('toggles aria-pressed and active styling between the two grouping buttons', () => {
      const e = entry({ id: 'pd-1' });
      renderWithProviders(<AgendaLens entries={[e]} onOpenEntry={vi.fn()} onAction={vi.fn()} />);

      const perDateBtn = screen.getByTestId('agenda-grouping-per-date');
      const perShowBtn = screen.getByTestId('agenda-grouping-per-show');
      expect(perDateBtn).toHaveAttribute('aria-pressed', 'true');
      expect(perShowBtn).toHaveAttribute('aria-pressed', 'false');

      fireEvent.click(perShowBtn);

      expect(perDateBtn).toHaveAttribute('aria-pressed', 'false');
      expect(perShowBtn).toHaveAttribute('aria-pressed', 'true');
    });

    it('persists the grouping choice to localStorage and restores it on the next mount', () => {
      const e = entry({ id: 'pd-1', session1: '18:00:00', session2: '21:00:00', session3: null });
      const { unmount } = renderWithProviders(<AgendaLens entries={[e]} onOpenEntry={vi.fn()} onAction={vi.fn()} />);

      fireEvent.click(screen.getByTestId('agenda-grouping-per-show'));
      expect(localStorage.getItem('showflow.calendar.agendaGrouping')).toBe('per-show');
      unmount();

      renderWithProviders(<AgendaLens entries={[e]} onOpenEntry={vi.fn()} onAction={vi.fn()} />);
      expect(screen.getByTestId('agenda-grouping-per-show')).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByTestId('agenda-row-pd-1-s1')).toBeInTheDocument();
    });
  });

  it('leaves the action button enabled when its gate is absent or not disabled', () => {
    const e = entry({ id: 'pd-1', status: 'partially_filled' });
    render(
      <AgendaLens
        entries={[e]}
        onOpenEntry={vi.fn()}
        onAction={vi.fn()}
        actionGates={{ generateHireOrder: { disabled: true, title: 'Nope' } }}
      />
    );
    const btn = screen.getByTestId('agenda-action-pd-1');
    expect(btn).not.toBeDisabled();
    expect(btn).not.toHaveAttribute('title');
  });
});
