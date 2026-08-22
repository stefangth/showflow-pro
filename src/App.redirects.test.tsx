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

function LocationSearchProbe() {
  const location = useLocation();
  return <div data-testid="resolved-path-search">{location.pathname + location.search}</div>;
}

function LegacyRedirects() {
  return (
    <Routes>
      {legacyRedirectRoutes()}
      <Route
        path={ROUTES.DASHBOARD}
        element={
          <>
            <div>today-page</div>
            <LocationSearchProbe />
          </>
        }
      />
      <Route
        path={ROUTES.BOOKINGS}
        element={
          <>
            <div>dates-page</div>
            <LocationSearchProbe />
          </>
        }
      />
      <Route path={ROUTES.HIRE_ORDERS} element={<div>contracts-list-page</div>} />
      <Route
        path={ROUTES.HIRE_ORDER_DETAIL}
        element={
          <>
            <div>contract-detail-page</div>
            <LocationProbe />
            <LocationSearchProbe />
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

  it('preserves the query string on a bare legacy redirect', () => {
    render(<MemoryRouter initialEntries={['/bookings?date=d1&tab=offers']}><LegacyRedirects /></MemoryRouter>);
    expect(screen.getByTestId('resolved-path-search')).toHaveTextContent('/dates?date=d1&tab=offers');
  });

  it('preserves the query string on the dashboard legacy redirect', () => {
    render(<MemoryRouter initialEntries={['/dashboard?foo=bar']}><LegacyRedirects /></MemoryRouter>);
    expect(screen.getByTestId('resolved-path-search')).toHaveTextContent('/today?foo=bar');
  });

  it('preserves the query string on a param-preserving legacy hire-order redirect', () => {
    render(<MemoryRouter initialEntries={['/hire-orders/abc?x=1']}><LegacyRedirects /></MemoryRouter>);
    expect(screen.getByTestId('resolved-path-search')).toHaveTextContent('/contracts/abc?x=1');
  });

  it('does not mangle a legacy hire-order id containing a $-replacement sequence', () => {
    // A string-form `String.prototype.replace` interprets $&, $`, $', $$ in
    // the replacement text; the function-form fix must pass the id through
    // verbatim. `$&` is URL-safe and survives MemoryRouter path decoding
    // unmodified, unlike `$'` which gets percent-decoded oddly across
    // history implementations.
    render(<MemoryRouter initialEntries={['/hire-orders/a$&b']}><LegacyRedirects /></MemoryRouter>);
    expect(screen.getByTestId('resolved-path')).toHaveTextContent('/contracts/a$&b');
  });
});
