// This module is a routing config file, not a component module: it exports a
// route-list factory (not a component) alongside a small private redirect
// component, so it is never a candidate for React Fast Refresh either way.
/* eslint-disable react-refresh/only-export-components */
import { Route, Navigate, useParams, useLocation } from 'react-router-dom';
import { ROUTES } from '@/config/app.config';

/**
 * Bare legacy redirect that preserves the incoming query string, so a
 * deep link like `/bookings?date=<id>&tab=offers` (built by
 * `TodayPage.openDateSheet`, read by `ShowsBookingsPage` on mount) still
 * opens the right date sheet after landing on the renamed route.
 */
function LegacyRedirect({ to }: { to: string }) {
  const { search } = useLocation();
  return <Navigate to={{ pathname: to, search }} replace />;
}

/**
 * Param- and query-preserving redirect for a legacy hire-order deep-link, so
 * a stale `/hire-orders/<id>` link (e.g. from an already-sent contract
 * email) lands on that specific contract, not the list.
 */
function LegacyContractRedirect({ edit = false }: { edit?: boolean }) {
  const { id } = useParams();
  const { search } = useLocation();
  // Function-form replace: a string replacement would interpret $&/$`/$'/$$
  // sequences inside `id`, mangling the resulting path. The function form
  // returns its string verbatim.
  const pathname = (edit ? ROUTES.HIRE_ORDER_EDIT : ROUTES.HIRE_ORDER_DETAIL).replace(':id', () => id ?? '');
  return <Navigate to={{ pathname, search }} replace />;
}

/**
 * Legacy slug redirects (renamed in the today/dates/contracts slug pass).
 * Kept indefinitely: bookmarks, already-sent emails, and the marketing site
 * still point at the old paths. Exported as `<Route>` elements so App.tsx
 * renders them and the redirect-guard test exercises the SAME routes.
 */
export function legacyRedirectRoutes() {
  return [
    <Route key="lr-dashboard" path="/dashboard" element={<LegacyRedirect to={ROUTES.DASHBOARD} />} />,
    <Route key="lr-bookings" path="/bookings" element={<LegacyRedirect to={ROUTES.BOOKINGS} />} />,
    <Route key="lr-hire-orders" path="/hire-orders" element={<LegacyRedirect to={ROUTES.HIRE_ORDERS} />} />,
    <Route key="lr-hire-order-detail" path="/hire-orders/:id" element={<LegacyContractRedirect />} />,
    <Route key="lr-hire-order-edit" path="/hire-orders/:id/edit" element={<LegacyContractRedirect edit />} />,
    <Route key="lr-template" path="/settings/hire-orders/template" element={<LegacyRedirect to={ROUTES.HIRE_ORDER_TEMPLATE} />} />,
  ];
}
