import { Component, type ErrorInfo, type PropsWithChildren } from 'react';
import posthog from 'posthog-js';
import { useConsent, type ConsentChoices } from '@/features/consent/ConsentContext';
import { captureException, type AnalyticsClient } from './posthog';

interface BoundaryProps extends PropsWithChildren {
  consent: ConsentChoices;
  onReload: () => void;
}

interface BoundaryState {
  hasError: boolean;
}

class Boundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { hasError: false };

  static getDerivedStateFromError(): BoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, _info: ErrorInfo): void {
    captureException(posthog as unknown as AnalyticsClient, this.props.consent, error);
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <main className="flex min-h-screen items-center justify-center p-6 text-center">
        <div className="max-w-md space-y-4">
          <h1 className="text-xl font-semibold">Something went wrong</h1>
          <p className="text-sm text-muted-foreground">Reload the application to try again.</p>
          <button className="rounded bg-primary px-4 py-2 text-primary-foreground" onClick={this.props.onReload}>
            Reload application
          </button>
        </div>
      </main>
    );
  }
}

export function AppErrorBoundary({ children, onReload = () => window.location.reload() }: PropsWithChildren<{ onReload?: () => void }>): JSX.Element {
  const { consent } = useConsent();
  return <Boundary consent={consent} onReload={onReload}>{children}</Boundary>;
}
