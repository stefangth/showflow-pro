import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  consent: { analytics: false, sessionReplay: false, errorTracking: false },
  captureException: vi.fn(),
  reload: vi.fn(),
}));

vi.mock('@/features/consent/ConsentContext', () => ({ useConsent: () => ({ consent: state.consent }) }));
vi.mock('posthog-js', () => ({ default: {} }));
vi.mock('./posthog', () => ({ captureException: state.captureException }));

import { AppErrorBoundary } from './AppErrorBoundary';

const error = new Error('render failed');
function ThrowOnRender(): never { throw error; }

describe('AppErrorBoundary', () => {
  beforeEach(() => {
    state.consent = { analytics: false, sessionReplay: false, errorTracking: false };
    state.captureException.mockClear();
    state.reload.mockClear();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('shows recovery UI and sends render errors when error tracking is consented', () => {
    state.consent = { analytics: false, sessionReplay: false, errorTracking: true };

    render(<AppErrorBoundary onReload={state.reload}><ThrowOnRender /></AppErrorBoundary>);

    expect(screen.getByRole('heading', { name: /something went wrong/i })).toBeInTheDocument();
    expect(state.captureException).toHaveBeenCalledWith(expect.anything(), state.consent, error);
  });

  it('shows recovery UI without sending render errors before consent', () => {
    render(<AppErrorBoundary onReload={state.reload}><ThrowOnRender /></AppErrorBoundary>);

    expect(screen.getByRole('heading', { name: /something went wrong/i })).toBeInTheDocument();
    expect(state.captureException).toHaveBeenCalledWith(expect.anything(), state.consent, error);
  });

  it('reloads the application when requested', () => {
    state.consent = { analytics: false, sessionReplay: false, errorTracking: true };
    render(<AppErrorBoundary onReload={state.reload}><ThrowOnRender /></AppErrorBoundary>);

    fireEvent.click(screen.getByRole('button', { name: /reload application/i }));
    expect(state.reload).toHaveBeenCalledTimes(1);
  });
});
