import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders as render } from '@/test/renderWithProviders';
import { TooltipProvider } from '@/components/ui/tooltip';
import { BookingRow } from './BookingRow';
import i18n from '@/i18n';
import { softBookedMeaning } from '@/lib/bookings/actionCopy';
import { aBooking, anArtist } from '@/test/fixtures';

// BookingRow's Soft-booked badge now carries a Tooltip (Radix requires a TooltipProvider
// ancestor to mount at all, not just to open), so every render here goes through
// renderWithProviders (aliased to `render`, which already every call site below uses)
// instead of a bare @testing-library/react render.

function makeBooking(overrides: Parameters<typeof aBooking>[0] = {}) {
  const artist = anArtist({ name: 'Jane Doe' });
  return {
    ...aBooking(overrides),
    artist: { id: artist.id, name: artist.name },
  };
}

describe('BookingRow', () => {
  it('renders the artist name and a friendly status label', () => {
    render(
      <BookingRow booking={makeBooking({ status: 'soft_booked' })} canManage={false} showConfirm onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(screen.getByText('Jane Doe')).toBeInTheDocument();
    expect(screen.getByText('Soft-booked')).toBeInTheDocument();
  });

  it('labels a suggested booking "Offered", never the raw enum', () => {
    render(
      <BookingRow booking={makeBooking({ status: 'suggested' })} canManage={false} showConfirm onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(screen.getByText('Offered')).toBeInTheDocument();
    expect(screen.queryByText('suggested')).not.toBeInTheDocument();
  });

  it('hides action buttons when the caller cannot manage', () => {
    render(
      <BookingRow booking={makeBooking({ status: 'soft_booked' })} canManage={false} showConfirm onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(screen.queryByRole('button', { name: 'Book' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
  });

  it('shows Confirm only for soft_booked and invokes onConfirm with the booking id', () => {
    const booking = makeBooking({ status: 'soft_booked' });
    const onConfirm = vi.fn();
    render(<BookingRow booking={booking} canManage showConfirm onConfirm={onConfirm} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Book' }));
    expect(onConfirm).toHaveBeenCalledWith(booking.id);
  });

  it('omits Confirm for a confirmed booking but still allows Cancel', () => {
    const booking = makeBooking({ status: 'confirmed' });
    const onCancel = vi.fn();
    render(<BookingRow booking={booking} canManage showConfirm onConfirm={vi.fn()} onCancel={onCancel} />);
    expect(screen.queryByRole('button', { name: 'Book' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledWith(booking.id);
  });

  // P3.3: the module-off Soft-booked badge means the same thing as the cockpit's Accepted
  // badge — accepted, held, not booked until confirmed — so it carries the same tooltip.
  it('carries the soft-booked meaning as a tooltip on the Soft-booked badge', async () => {
    render(
      <TooltipProvider delayDuration={0}>
        <BookingRow booking={makeBooking({ status: 'soft_booked' })} canManage={false} showConfirm onConfirm={vi.fn()} onCancel={vi.fn()} />
      </TooltipProvider>,
    );
    fireEvent.pointerMove(screen.getByText('Soft-booked'), { pointerType: 'mouse' });
    expect(await screen.findAllByText(softBookedMeaning(i18n.getFixedT('en', 'bookingCopy')))).not.toHaveLength(0);
  });

  it('does not carry the tooltip on a non-soft_booked badge', () => {
    render(<BookingRow booking={makeBooking({ status: 'confirmed' })} canManage={false} showConfirm onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.queryByText(softBookedMeaning(i18n.getFixedT('en', 'bookingCopy')))).not.toBeInTheDocument();
  });
});

describe('BookingRow confirm gate', () => {
  const artistBooking = { ...aBooking({ status: 'soft_booked' }), artist: { id: 'a1', name: 'Lena' } };

  it('shows Confirm for soft_booked when showConfirm is true', () => {
    render(
      <BookingRow booking={artistBooking} canManage showConfirm onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(screen.getByRole('button', { name: 'Book' })).toBeInTheDocument();
  });

  it('hides Confirm when showConfirm is false (auto-confirm flow)', () => {
    render(
      <BookingRow booking={artistBooking} canManage showConfirm={false} onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(screen.queryByRole('button', { name: 'Book' })).toBeNull();
  });
});
