import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CalendarSurfaceHeader } from './CalendarSurfaceHeader';

describe('CalendarSurfaceHeader', () => {
  it('renders one row (justify-between): left = eyebrow+title, right = tabs then cta', () => {
    render(
      <CalendarSurfaceHeader
        eyebrow="Bookings"
        eyebrowTone="accent"
        title="Shows & bookings"
        cta={<button data-testid="header-cta">New date</button>}
      >
        <div data-testid="header-tabs">tabs</div>
      </CalendarSurfaceHeader>
    );

    const row = screen.getByTestId('calendar-surface-header-row');
    expect(row.className).toContain('justify-between');

    const left = screen.getByTestId('calendar-surface-header-left');
    const right = screen.getByTestId('calendar-surface-header-right');
    expect(row.contains(left)).toBe(true);
    expect(row.contains(right)).toBe(true);

    const title = screen.getByText('Shows & bookings');
    const eyebrow = screen.getByText('Bookings');
    expect(left.contains(title)).toBe(true);
    expect(left.contains(eyebrow)).toBe(true);

    const tabs = screen.getByTestId('header-tabs');
    const cta = screen.getByTestId('header-cta');
    expect(right.contains(tabs)).toBe(true);
    expect(right.contains(cta)).toBe(true);
    // tabs precede cta in DOM order (right-side layout order)
    expect(tabs.compareDocumentPosition(cta) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('sizes the title at 32px semibold tracking-tight, matching the app page-title convention', () => {
    render(<CalendarSurfaceHeader eyebrow="Bookings" eyebrowTone="accent" title="Shows & bookings" />);
    const title = screen.getByText('Shows & bookings');
    expect(title.className).toContain('text-[32px]');
    expect(title.className).toContain('font-semibold');
    expect(title.className).toContain('tracking-tight');
    expect(title.className).not.toContain('text-2xl');
  });
});
