// This module is a routing config file, not a component module: it exports a
// route-list factory (not a component) alongside a small private redirect
// component, so it is never a candidate for React Fast Refresh either way.
/* eslint-disable react-refresh/only-export-components */
import { Route, Navigate, useParams } from 'react-router-dom';
import { ROUTES } from '@/config/app.config';

/**
 * Param-preserving redirect for a legacy hire-order deep-link, so a stale
 * `/hire-orders/<id>` link (e.g. from an already-sent contract email) lands
 * on that specific contract, not the list.
 */
function LegacyContractRedirect({ edit = false }: { edit?: boolean }) {
  const { id } = useParams();
  const to = (edit ? ROUTES.HIRE_ORDER_EDIT : ROUTES.HIRE_ORDER_DETAIL).replace(':id', id ?? '');
  return <Navigate to={to} replace />;
}

/**
 * Legacy slug redirects (renamed in the today/dates/contracts slug pass).
 * Kept indefinitely: bookmarks, already-sent emails, and the marketing site
 * still point at the old paths. Exported as `<Route>` elements so App.tsx
 * renders them and the redirect-guard test exercises the SAME routes.
 */
export function legacyRedirectRoutes() {
  return [
    <Route key="lr-dashboard" path="/dashboard" element={<Navigate to={ROUTES.DASHBOARD} replace />} />,
    <Route key="lr-bookings" path="/bookings" element={<Navigate to={ROUTES.BOOKINGS} replace />} />,
    <Route key="lr-hire-orders" path="/hire-orders" element={<Navigate to={ROUTES.HIRE_ORDERS} replace />} />,
    <Route key="lr-hire-order-detail" path="/hire-orders/:id" element={<LegacyContractRedirect />} />,
    <Route key="lr-hire-order-edit" path="/hire-orders/:id/edit" element={<LegacyContractRedirect edit />} />,
    <Route key="lr-template" path="/settings/hire-orders/template" element={<Navigate to={ROUTES.HIRE_ORDER_TEMPLATE} replace />} />,
  ];
}
