import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ROUTES } from '@/config/app.config';

// Mirror of the legacy-redirect entries added to App.tsx, tested in isolation so
// this doesn't need the full provider tree App.tsx mounts.
function LegacyRedirects() {
  return (
    <Routes>
      <Route path="/dashboard" element={<Navigate to={ROUTES.DASHBOARD} replace />} />
      <Route path="/bookings" element={<Navigate to={ROUTES.BOOKINGS} replace />} />
      <Route path="/hire-orders" element={<Navigate to={ROUTES.HIRE_ORDERS} replace />} />
      <Route path="/hire-orders/:id" element={<Navigate to={ROUTES.HIRE_ORDERS} replace />} />
      <Route path="/hire-orders/:id/edit" element={<Navigate to={ROUTES.HIRE_ORDERS} replace />} />
      <Route path={ROUTES.DASHBOARD} element={<div>today-page</div>} />
      <Route path={ROUTES.BOOKINGS} element={<div>dates-page</div>} />
      <Route path={ROUTES.HIRE_ORDERS} element={<div>contracts-page</div>} />
    </Routes>
  );
}

describe('legacy slug redirects', () => {
  it.each([
    ['/dashboard', 'today-page'],
    ['/bookings', 'dates-page'],
    ['/hire-orders', 'contracts-page'],
    ['/hire-orders/abc-uuid', 'contracts-page'],
    ['/hire-orders/abc-uuid/edit', 'contracts-page'],
  ])('%s redirects to the new route', (from, expected) => {
    render(<MemoryRouter initialEntries={[from]}><LegacyRedirects /></MemoryRouter>);
    expect(screen.getByText(expected)).toBeInTheDocument();
  });
});
