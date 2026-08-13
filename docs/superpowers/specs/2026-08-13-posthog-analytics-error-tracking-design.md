# PostHog Web Analytics and Error Tracking Design

**Date:** 2026-08-13  
**Status:** Approved for implementation  
**Target:** PostHog organization `SSV`, project `Default project` (`246246`)

## Goal

Make PostHog the application's only browser analytics and client-side error-tracking provider. The integration must capture useful navigation and failure data in production while preserving the repository's existing explicit-consent model.

## Existing State

The application already includes `posthog-js`, a consent state machine, an `AnalyticsBridge`, per-category consent controls, environment-variable documentation, and PostHog disclosures in the English and German privacy policies. The selected PostHog project already has IP anonymization, exception autocapture, Web Vitals, console capture, session replay, and 12-month event retention enabled.

The remaining gaps are:

- SPA navigation after the initial page load is not reliably captured.
- Authenticated users are not identified in PostHog.
- React render errors caught by a boundary are not explicitly reported.
- Production source maps are not uploaded, leaving minified stack traces.
- Vercel Analytics runs alongside PostHog without using the PostHog consent state.
- Production environment and source-map credentials are not defined as a complete deployment contract.

## Architecture

### Consent-gated PostHog client

Keep `src/features/analytics/posthog.ts` as the single state machine controlling the PostHog singleton. PostHog remains uninitialized until either analytics or error-tracking consent is granted.

Consent maps to features as follows:

| Consent | PostHog behavior |
| --- | --- |
| Analytics | Autocapture, Web Analytics, and pageviews on browser history changes |
| Session replay | Recording only while analytics and session-replay consent are both enabled |
| Error tracking | Automatic exception capture and explicit React render-error capture |
| All withdrawn | Stop recording, opt out, reset identity, and send no further events |

Initialization will explicitly configure SPA pageviews using history changes instead of relying on a one-time page-load event. Configuration changes after initialization continue through `set_config`; `posthog.init` remains single-shot.

### Authenticated identity

Add an identity bridge inside `AuthProvider` and `ConsentProvider`. When a signed-in user has granted analytics or error-tracking consent, call `posthog.identify` with:

- the stable Supabase user UUID as the distinct ID;
- the user's email as the `$email` person property.

Do not send names or other profile fields. Reset PostHog identity when the user signs out, when the authenticated user changes, or when all relevant consent is withdrawn. Identification must never initialize or opt in PostHog by itself; the consent state machine remains authoritative.

### Error capture

Keep PostHog exception autocapture enabled for uncaught browser errors and unhandled promise rejections. Add a top-level React error boundary that explicitly calls `posthog.captureException` for render/lifecycle errors that React catches before they reach `window.onerror`.

The boundary will show a small recovery screen with a reload action so a render crash does not leave a blank application. Explicit capture remains safe before consent because the PostHog client is uninitialized or opted out.

### Source maps

Add the PostHog Rollup plugin to the Vite production build. It will:

- generate and upload source maps only when all server-side upload variables are present;
- associate uploads with a stable application release and deployed commit/version;
- delete uploaded source maps from the final public artifact;
- leave local and unconfigured builds working without uploads.

Required server-side build variables:

- `POSTHOG_API_KEY`: personal API key with error-tracking write and organization-read scopes;
- `POSTHOG_PROJECT_ID=246246`;
- `POSTHOG_HOST`: the selected project's management host (`https://eu.posthog.com` for EU Cloud or `https://us.posthog.com` for US Cloud).

The personal API key must never use a `VITE_` prefix and must never be exposed to browser code.

Required public runtime variables:

- `VITE_POSTHOG_KEY`: the selected project's public `phc_...` project token;
- `VITE_POSTHOG_HOST`: the matching ingestion host (`https://eu.i.posthog.com` for EU Cloud or `https://us.i.posthog.com` for US Cloud).

The host pair must target the same PostHog region. The existing EU default remains unless deployment configuration explicitly selects another region.

### PostHog-only analytics

Remove the `@vercel/analytics` package and the `<Analytics />` component. Vercel hosting and access logs remain unaffected; only the duplicate browser analytics client is removed. PostHog becomes the single browser analytics processor and the existing consent controls apply consistently.

### Privacy documentation

Update English and German privacy-policy descriptions of PostHog error and analytics payloads to disclose that authenticated identification includes both user ID and email. Preserve the existing consent basis and 12-month retention statement.

## Data Flow

1. The app loads with all optional telemetry disabled.
2. The visitor chooses analytics, session-replay, and/or error-tracking consent.
3. `AnalyticsBridge` reconciles PostHog capture configuration.
4. If authenticated and telemetry is active, the identity bridge associates the stable user UUID and email.
5. React Router history changes produce pageviews when analytics is enabled.
6. Browser exceptions and React render errors produce `$exception` events when error tracking is enabled.
7. Withdrawing all relevant consent stops capture and clears the PostHog identity.
8. Production builds upload private source maps so PostHog can symbolicate captured errors.

## Testing

Use test-first development for each behavior:

- consent enables history-change pageviews and preserves single initialization;
- identity uses UUID plus email only after consent;
- identity resets on user change, sign-out, and full consent withdrawal;
- the React error boundary captures a thrown render error and renders recovery UI;
- source-map plugin activation is conditional on complete server-side configuration;
- production configuration never exposes the personal PostHog API key;
- Vercel Analytics is absent from the runtime tree and dependency manifest;
- privacy-policy tests cover the email disclosure.

Run the repository's focused tests during development, followed by lint, all TypeScript projects, the complete unit/coverage suite, and a production build.

## Deployment and Verification

Code completion does not by itself make telemetry operational. The deployment must also receive the public runtime variables and server-only source-map variables. After deployment:

1. Accept analytics and error-tracking consent in a non-production test account.
2. Navigate across multiple client-side routes and confirm distinct `$pageview` events.
3. Confirm the PostHog person uses the Supabase UUID and includes `$email`.
4. Trigger a deliberate test exception and confirm a symbolicated stack trace.
5. Withdraw consent and confirm no subsequent events are sent.
6. Confirm no Vercel Analytics browser requests remain.

## Out of Scope

- Server-side Supabase Edge Function error tracking or logs.
- Custom business events beyond PostHog autocapture and pageviews.
- Dashboards, alerts, or feature flags.
- A reverse proxy for ad-blocker resistance; this can be added later after its additional processor and DNS implications are reviewed.
