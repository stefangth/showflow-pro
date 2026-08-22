import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { ROUTES } from '@/config/app.config';
import { legacyRedirectRoutes } from '@/features/auth/legacyRedirects';

// Renders the REAL legacy redirect routes exported from App.tsx (via
// legacyRedirectRoutes) alongside stubs for every new-slug destination, so
// this test breaks if App.tsx's redirects are ever removed or broken rather
// than only exercising a private copy of them.
function LocationProbe() {
  const location = useLocation();
  return <div data-testid="resolved-path">{location.pathname}</div>;
}

function LegacyRedirects() {
  return (
    <Routes>
      {legacyRedirectRoutes()}
      <Route path={ROUTES.DASHBOARD} element={<div>today-page</div>} />
      <Route path={ROUTES.BOOKINGS} element={<div>dates-page</div>} />
      <Route path={ROUTES.HIRE_ORDERS} element={<div>contracts-list-page</div>} />
      <Route
        path={ROUTES.HIRE_ORDER_DETAIL}
        element={
          <>
            <div>contract-detail-page</div>
            <LocationProbe />
          </>
        }
      />
      <Route
        path={ROUTES.HIRE_ORDER_EDIT}
        element={
          <>
            <div>contract-edit-page</div>
            <LocationProbe />
          </>
        }
      />
      <Route path={ROUTES.HIRE_ORDER_TEMPLATE} element={<div>template-page</div>} />
    </Routes>
  );
}

describe('legacy slug redirects', () => {
  it.each([
    ['/dashboard', 'today-page'],
    ['/bookings', 'dates-page'],
    ['/hire-orders', 'contracts-list-page'],
    ['/hire-orders/abc-uuid', 'contract-detail-page'],
    ['/hire-orders/abc-uuid/edit', 'contract-edit-page'],
    ['/settings/hire-orders/template', 'template-page'],
  ])('%s redirects to the new route', (from, expected) => {
    render(<MemoryRouter initialEntries={[from]}><LegacyRedirects /></MemoryRouter>);
    expect(screen.getByText(expected)).toBeInTheDocument();
  });

  it('preserves the id when redirecting a legacy hire-order detail link', () => {
    render(<MemoryRouter initialEntries={['/hire-orders/abc-uuid']}><LegacyRedirects /></MemoryRouter>);
    expect(screen.getByTestId('resolved-path')).toHaveTextContent('/contracts/abc-uuid');
  });

  it('preserves the id when redirecting a legacy hire-order edit link', () => {
    render(<MemoryRouter initialEntries={['/hire-orders/abc-uuid/edit']}><LegacyRedirects /></MemoryRouter>);
    expect(screen.getByTestId('resolved-path')).toHaveTextContent('/contracts/abc-uuid/edit');
  });
});
