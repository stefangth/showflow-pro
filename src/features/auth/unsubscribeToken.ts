/**
 * Keep an unsubscribe credential available to the page without leaving it in
 * the URL, where browser telemetry or referrer headers could expose it.
 */
export function captureUnsubscribeToken(
  location: Pick<Location, 'href'>,
  history: Pick<History, 'replaceState'> & Partial<Pick<History, 'state'>>,
): string | null {
  const url = new URL(location.href);
  const token = url.searchParams.get('token')?.trim() || null;

  if (url.searchParams.has('token')) {
    url.searchParams.delete('token');
    try {
      history.replaceState(history.state, '', `${url.pathname}${url.search}${url.hash}`);
    } catch {
      // The page can still finish unsubscribing if History is unavailable.
    }
  }

  return token;
}
