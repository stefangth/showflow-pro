import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BookingRow } from './BookingRow';
import { aBooking, anArtist } from '@/test/fixtures';

function makeBooking(overrides: Parameters<typeof aBooking>[0] = {}) {
  const artist = anArtist({ name: 'Jane Doe' });
  return {
    ...aBooking(overrides),
    artist: { id: artist.id, name: artist.name },
  };
}

describe('BookingRow', () => {
  it('renders the artist name and humanized status', () => {
    render(
      <BookingRow booking={makeBooking({ status: 'soft_booked' })} canManage={false} showConfirm onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(screen.getByText('Jane Doe')).toBeInTheDocument();
    expect(screen.getByText('soft booked')).toBeInTheDocument();
  });

  it('hides action buttons when the caller cannot manage', () => {
    render(
      <BookingRow booking={makeBooking({ status: 'soft_booked' })} canManage={false} showConfirm onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(screen.queryByRole('button', { name: 'Confirm' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
  });

  it('shows Confirm only for soft_booked and invokes onConfirm with the booking id', () => {
    const booking = makeBooking({ status: 'soft_booked' });
    const onConfirm = vi.fn();
    render(<BookingRow booking={booking} canManage showConfirm onConfirm={onConfirm} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(onConfirm).toHaveBeenCalledWith(booking.id);
  });

  it('omits Confirm for a confirmed booking but still allows Cancel', () => {
    const booking = makeBooking({ status: 'confirmed' });
    const onCancel = vi.fn();
    render(<BookingRow booking={booking} canManage showConfirm onConfirm={vi.fn()} onCancel={onCancel} />);
    expect(screen.queryByRole('button', { name: 'Confirm' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledWith(booking.id);
  });
});

describe('BookingRow confirm gate', () => {
  const artistBooking = { ...aBooking({ status: 'soft_booked' }), artist: { id: 'a1', name: 'Lena' } };

  it('shows Confirm for soft_booked when showConfirm is true', () => {
    render(
      <BookingRow booking={artistBooking} canManage showConfirm onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeInTheDocument();
  });

  it('hides Confirm when showConfirm is false (auto-confirm flow)', () => {
    render(
      <BookingRow booking={artistBooking} canManage showConfirm={false} onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(screen.queryByRole('button', { name: 'Confirm' })).toBeNull();
  });
});
