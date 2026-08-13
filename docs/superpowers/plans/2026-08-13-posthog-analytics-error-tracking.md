# PostHog Analytics and Error Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make PostHog the only consent-gated browser analytics and client-side error-tracking provider, with SPA pageviews, authenticated email identity, React render-error capture, and symbolicated production stack traces.

**Architecture:** Extend the existing injected PostHog state machine rather than adding another provider. Keep telemetry activation in `AnalyticsBridge`, put authenticated identity in a separate bridge under `AuthProvider`, wrap the application tree with a consent-aware React error boundary, and conditionally add PostHog's Rollup source-map uploader to production Vite builds.

**Tech Stack:** React 18, TypeScript 5, Vite 5/Rollup, Vitest + Testing Library, Supabase Auth, `posthog-js`, `@posthog/rollup-plugin`, Vercel.

## Global Constraints

- PostHog organization is `SSV`; project is `Default project` with ID `246246`.
- PostHog remains uninitialized until analytics or error-tracking consent is granted.
- Identify with the stable Supabase user UUID and `$email`; do not send names or other profile fields.
- Reset identity on sign-out or user change; withdrawing all telemetry consent remains owned by the consent state machine.
- The personal source-map API key is server-only and must never use a `VITE_` prefix.
- PostHog is the only browser analytics provider; remove `@vercel/analytics`.
- Keep the existing EU runtime and management hosts as defaults unless deployment explicitly selects the US region.
- Source-map upload must be optional for local/unconfigured builds and uploaded maps must not remain in the public build artifact.
- Preserve the existing legal basis of explicit consent and 12-month PostHog event retention.

## File Map

- Modify `src/features/analytics/posthog.ts`: typed client surface, SPA pageview configuration, and safe explicit exception capture.
- Modify `src/features/analytics/posthog.test.ts`: state-machine and exception-capture regression tests.
- Create `src/features/analytics/identity.ts`: pure authenticated identity reconciliation.
- Create `src/features/analytics/identity.test.ts`: identity transition tests.
- Create `src/features/analytics/AnalyticsIdentityBridge.tsx`: React wiring from auth + consent to identity reconciliation.
- Create `src/features/analytics/AnalyticsIdentityBridge.test.tsx`: bridge integration tests.
- Create `src/features/analytics/AppErrorBoundary.tsx`: consent-aware React error boundary and recovery UI.
- Create `src/features/analytics/AppErrorBoundary.test.tsx`: render-error and consent tests.
- Modify `src/App.tsx`: mount identity bridge and error boundary; remove Vercel Analytics.
- Create `scripts/posthogSourceMaps.ts`: pure source-map upload environment parser.
- Create `scripts/posthogSourceMaps.test.ts`: conditional build configuration tests.
- Modify `vite.config.ts`: conditionally register PostHog's Rollup plugin.
- Modify `package.json`, `package-lock.json`, and `bun.lock`: add source-map plugin and remove Vercel Analytics.
- Modify `.env.example` and `CLAUDE.md`: document public runtime and server-only build variables.
- Modify `docs/legal/privacy-policy.en.md` and `docs/legal/privacy-policy.de.md`: disclose email identification.
- Modify `src/lib/trust/facts.privacy.test.ts`: enforce the disclosure.

---

### Task 1: Consent-safe SPA pageviews and explicit exceptions

**Files:**
- Modify: `src/features/analytics/posthog.ts`
- Test: `src/features/analytics/posthog.test.ts`

**Interfaces:**
- Consumes: existing `ConsentChoices`, `AnalyticsConfig`, and module-level initialization latch.
- Produces: `AnalyticsClient.captureException(error: unknown): void` and `captureException(client, choices, error): boolean` for the error boundary.

- [ ] **Step 1: Add failing tests for history-change pageviews**

Change analytics-enabled expectations in `posthog.test.ts` to require:

```ts
expect(opts).toMatchObject({
  autocapture: true,
  capture_pageview: 'history_change',
  capture_exceptions: false,
});
```

Add a transition assertion that `set_config` receives `capture_pageview: false` after analytics consent is withdrawn while error tracking remains enabled.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npx vitest run src/features/analytics/posthog.test.ts`

Expected: FAIL because the implementation still emits boolean `capture_pageview` values.

- [ ] **Step 3: Implement SPA pageview configuration**

In both `init` and `set_config`, map analytics consent exactly as:

```ts
capture_pageview: choices.analytics ? 'history_change' : false,
```

Keep `autocapture`, `capture_exceptions`, and the single-init latch unchanged.

- [ ] **Step 4: Add failing tests for consent-safe explicit exception capture**

Extend the fake client with `captureException: vi.fn()` and add three cases:

```ts
expect(captureException(client, choices({ errorTracking: true }), new Error('boom'))).toBe(false);

applyConsent(client, configured, choices({ errorTracking: true }));
expect(captureException(client, choices({ errorTracking: false }), new Error('boom'))).toBe(false);

const error = new Error('boom');
expect(captureException(client, choices({ errorTracking: true }), error)).toBe(true);
expect(client.captureException).toHaveBeenCalledWith(error);
```

Reset the initialization latch between the three cases so each proves one gate independently.

- [ ] **Step 5: Run the focused test and verify RED**

Run: `npx vitest run src/features/analytics/posthog.test.ts`

Expected: FAIL because `captureException` and the client method do not exist.

- [ ] **Step 6: Implement the explicit exception gate**

Add to `AnalyticsClient`:

```ts
captureException(error: unknown): void;
```

Export:

```ts
export function captureException(
  client: AnalyticsClient,
  choices: ConsentChoices,
  error: unknown,
): boolean {
  if (!initialized || !choices.errorTracking) return false;
  client.captureException(error);
  return true;
}
```

This deliberately drops pre-initialization errors instead of queuing data captured before consent.

- [ ] **Step 7: Run the focused test and verify GREEN**

Run: `npx vitest run src/features/analytics/posthog.test.ts`

Expected: all tests PASS.

- [ ] **Step 8: Commit Task 1**

```bash
git add src/features/analytics/posthog.ts src/features/analytics/posthog.test.ts
git commit -m "complete posthog capture controls"
```

### Task 2: Consent-gated authenticated identity

**Files:**
- Create: `src/features/analytics/identity.ts`
- Create: `src/features/analytics/identity.test.ts`
- Create: `src/features/analytics/AnalyticsIdentityBridge.tsx`
- Create: `src/features/analytics/AnalyticsIdentityBridge.test.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `useAuth().user`, `useConsent().consent`, and the `posthog-js` singleton.
- Produces: `reconcileIdentity(client, previousUserId, user, active): string | null` and a zero-UI `AnalyticsIdentityBridge`.

- [ ] **Step 1: Write failing pure identity transition tests**

Define the intended interface in `identity.test.ts` and cover:

```ts
const client = { identify: vi.fn(), reset: vi.fn() };

expect(reconcileIdentity(client, null, { id: 'u1', email: 'a@example.com' }, true)).toBe('u1');
expect(client.identify).toHaveBeenCalledWith('u1', { $email: 'a@example.com' });

expect(reconcileIdentity(client, null, { id: 'u1', email: 'a@example.com' }, false)).toBeNull();
expect(client.identify).not.toHaveBeenCalled();

expect(reconcileIdentity(client, 'u1', null, true)).toBeNull();
expect(client.reset).toHaveBeenCalledTimes(1);

expect(reconcileIdentity(client, 'u1', { id: 'u2', email: 'b@example.com' }, true)).toBe('u2');
expect(client.reset.mock.invocationCallOrder[0])
  .toBeLessThan(client.identify.mock.invocationCallOrder[0]);
```

Also assert that the same UUID with a changed email calls `identify` again to update `$email`, without resetting first.

- [ ] **Step 2: Run the pure identity test and verify RED**

Run: `npx vitest run src/features/analytics/identity.test.ts`

Expected: FAIL because `identity.ts` does not exist.

- [ ] **Step 3: Implement identity reconciliation**

Create these types and behavior:

```ts
export interface IdentityClient {
  identify(distinctId: string, properties: { $email: string }): void;
  reset(): void;
}

export interface AnalyticsUser {
  id: string;
  email: string;
}
```

`reconcileIdentity` must:

1. Return `null` without calling the client when `active` is false; `applyConsent` owns full-consent withdrawal reset.
2. Reset and return `null` when a previously identified user becomes absent.
3. Reset before identifying when the UUID changes.
4. Identify using only `{ $email: user.email }` and return the current UUID.

- [ ] **Step 4: Run the pure identity test and verify GREEN**

Run: `npx vitest run src/features/analytics/identity.test.ts`

Expected: all tests PASS.

- [ ] **Step 5: Write failing bridge tests**

Mock `useAuth`, `useConsent`, and `posthog-js`. Render `AnalyticsIdentityBridge`, then rerender mutable auth/consent values to prove:

- no identify call without telemetry consent;
- `{ id: 'u1', email: 'a@example.com' }` identifies after analytics consent;
- error-tracking-only consent also identifies;
- sign-out resets;
- withdrawing all relevant consent clears bridge state without issuing an extra reset beyond the consent state machine.

- [ ] **Step 6: Run the bridge test and verify RED**

Run: `npx vitest run src/features/analytics/AnalyticsIdentityBridge.test.tsx`

Expected: FAIL because `AnalyticsIdentityBridge.tsx` does not exist.

- [ ] **Step 7: Implement and mount the bridge**

The component keeps the previous UUID in a ref and reconciles on ID, email, analytics consent, or error-tracking consent changes:

```tsx
export function AnalyticsIdentityBridge(): null {
  const { user } = useAuth();
  const { consent } = useConsent();
  const previousUserId = useRef<string | null>(null);
  const active = consent.analytics || consent.errorTracking;

  useEffect(() => {
    previousUserId.current = reconcileIdentity(
      posthog,
      previousUserId.current,
      user?.email ? { id: user.id, email: user.email } : null,
      active,
    );
  }, [active, user?.id, user?.email]);

  return null;
}
```

Mount it as the first child of `AuthProvider` in `App.tsx`, before `EditorProvider`, so both auth and consent contexts are available.

- [ ] **Step 8: Run identity and existing auth tests**

Run: `npx vitest run src/features/analytics/identity.test.ts src/features/analytics/AnalyticsIdentityBridge.test.tsx src/features/auth/AuthContext.bootstrapResilience.test.tsx src/features/auth/AuthContext.switchOrg.test.tsx`

Expected: all tests PASS.

- [ ] **Step 9: Commit Task 2**

```bash
git add src/features/analytics/identity.ts src/features/analytics/identity.test.ts src/features/analytics/AnalyticsIdentityBridge.tsx src/features/analytics/AnalyticsIdentityBridge.test.tsx src/App.tsx
git commit -m "identify consented posthog users"
```

### Task 3: React render-error capture and recovery UI

**Files:**
- Create: `src/features/analytics/AppErrorBoundary.tsx`
- Create: `src/features/analytics/AppErrorBoundary.test.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `useConsent`, `captureException`, and the `posthog-js` singleton.
- Produces: `AppErrorBoundary({ children }: PropsWithChildren)` wrapping the authenticated application tree.

- [ ] **Step 1: Write failing error-boundary tests**

Create a component that throws during render and assert:

```tsx
render(
  <ConsentHarness errorTracking>
    <AppErrorBoundary><ThrowOnRender /></AppErrorBoundary>
  </ConsentHarness>,
);

expect(screen.getByRole('heading', { name: /something went wrong/i })).toBeInTheDocument();
expect(captureException).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ errorTracking: true }), error);
```

Add a no-consent case that renders the same fallback but verifies the helper returns without client capture. Add a reload-button case by injecting an optional `onReload` test seam, defaulting to `window.location.reload`.

- [ ] **Step 2: Run the boundary test and verify RED**

Run: `npx vitest run src/features/analytics/AppErrorBoundary.test.tsx`

Expected: FAIL because the boundary does not exist.

- [ ] **Step 3: Implement the boundary**

Use a small class boundary for `getDerivedStateFromError` and `componentDidCatch`, wrapped by a function that reads consent. The class receives `errorTrackingEnabled`, calls the gated helper with PostHog, and renders accessible recovery copy plus a `Reload application` button. Do not include error messages or stack traces in the DOM.

- [ ] **Step 4: Mount the boundary**

In `App.tsx`, place `AppErrorBoundary` inside `ConsentProvider`, after `AnalyticsBridge`, around `AuthProvider` and its route tree. Keep the cookie-consent banner outside the boundary so preferences remain reachable if the app tree crashes.

- [ ] **Step 5: Run boundary and analytics tests**

Run: `npx vitest run src/features/analytics/AppErrorBoundary.test.tsx src/features/analytics/posthog.test.ts`

Expected: all tests PASS.

- [ ] **Step 6: Commit Task 3**

```bash
git add src/features/analytics/AppErrorBoundary.tsx src/features/analytics/AppErrorBoundary.test.tsx src/App.tsx
git commit -m "capture react render errors"
```

### Task 4: Conditional production source-map uploads

**Files:**
- Create: `scripts/posthogSourceMaps.ts`
- Create: `scripts/posthogSourceMaps.test.ts`
- Modify: `vite.config.ts`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `bun.lock`

**Interfaces:**
- Consumes: Vite mode plus `POSTHOG_API_KEY`, `POSTHOG_PROJECT_ID`, `POSTHOG_HOST`, `VERCEL_GIT_COMMIT_SHA`, and `npm_package_version`.
- Produces: `readPostHogSourceMapOptions(mode, env): PostHogSourceMapOptions | null` for `@posthog/rollup-plugin`.

- [ ] **Step 1: Install the uploader and remove duplicate analytics dependencies**

Run:

```bash
npm install --save-dev @posthog/rollup-plugin
npm uninstall @vercel/analytics
bun install --lockfile-only
```

Expected: `@posthog/rollup-plugin` is in `devDependencies`, `@vercel/analytics` is absent, and both lockfiles are synchronized.

- [ ] **Step 2: Write failing source-map option tests**

In `scripts/posthogSourceMaps.test.ts`, assert:

```ts
expect(readPostHogSourceMapOptions('development', completeEnv)).toBeNull();
expect(readPostHogSourceMapOptions('production', { ...completeEnv, POSTHOG_API_KEY: '' })).toBeNull();
expect(readPostHogSourceMapOptions('production', completeEnv)).toEqual({
  personalApiKey: 'phx_secret',
  projectId: '246246',
  host: 'https://eu.posthog.com',
  sourcemaps: {
    enabled: true,
    releaseName: 'showflow-pro',
    releaseVersion: 'commit-sha',
    deleteAfterUpload: true,
  },
});
```

Also stringify the returned object and assert it does not contain `VITE_POSTHOG_KEY` or any browser runtime value.

- [ ] **Step 3: Run the helper test and verify RED**

Run: `npx vitest run scripts/posthogSourceMaps.test.ts`

Expected: FAIL because the helper does not exist.

- [ ] **Step 4: Implement the pure environment parser**

Export a local `PostHogSourceMapOptions` interface matching the Rollup plugin input. Return `null` unless mode is `production` and the API key, project ID, management host, and release version are non-empty. Choose release version as `VERCEL_GIT_COMMIT_SHA || npm_package_version`; use `releaseName: 'showflow-pro'` and `deleteAfterUpload: true`.

- [ ] **Step 5: Run the helper test and verify GREEN**

Run: `npx vitest run scripts/posthogSourceMaps.test.ts`

Expected: all tests PASS.

- [ ] **Step 6: Register the Rollup plugin conditionally**

In `vite.config.ts`, read build values from `{ ...loadEnv(mode, process.cwd(), ''), ...process.env }`, call `readPostHogSourceMapOptions`, and append `posthog(options)` only when the helper returns a value:

```ts
const sourceMapOptions = readPostHogSourceMapOptions(mode, buildEnv);

plugins: [
  react(),
  supabaseTargetBanner(buildEnv.VITE_SUPABASE_URL),
  ...(sourceMapOptions ? [posthog(sourceMapOptions)] : []),
],
```

Do not turn on unconditional `build.sourcemap`; the plugin owns generation, upload, and deletion.

- [ ] **Step 7: Remove Vercel Analytics from the app tree**

Delete the `@vercel/analytics/react` import and `<Analytics />` element from `src/App.tsx`. Confirm no source reference remains:

Run: `rg -n "@vercel/analytics|<Analytics" src package.json package-lock.json bun.lock`

Expected: no matches.

- [ ] **Step 8: Type-check configuration and build without upload credentials**

Run:

```bash
npx tsc -p tsconfig.tools.json --noEmit
npm run build
```

Expected: both commands exit 0; the unconfigured local build skips source-map upload.

- [ ] **Step 9: Commit Task 4**

```bash
git add scripts/posthogSourceMaps.ts scripts/posthogSourceMaps.test.ts vite.config.ts src/App.tsx package.json package-lock.json bun.lock
git commit -m "upload posthog production source maps"
```

### Task 5: Deployment contract and privacy disclosures

**Files:**
- Modify: `.env.example`
- Modify: `CLAUDE.md`
- Modify: `docs/legal/privacy-policy.en.md`
- Modify: `docs/legal/privacy-policy.de.md`
- Modify: `src/lib/trust/facts.privacy.test.ts`

**Interfaces:**
- Consumes: the implemented runtime/build environment names and identity payload.
- Produces: an exact operator checklist and tested legal disclosure.

- [ ] **Step 1: Add failing privacy-policy assertions**

Extend `facts.privacy.test.ts` to require English and German policy text to mention authenticated PostHog identity using user ID and email. Use case-insensitive regexes anchored to the PostHog payload paragraph so unrelated email wording cannot satisfy the test.

- [ ] **Step 2: Run the privacy test and verify RED**

Run: `npx vitest run src/lib/trust/facts.privacy.test.ts`

Expected: FAIL because the current payload disclosure names only user ID.

- [ ] **Step 3: Update English and German disclosures**

Change the PostHog client-side payload sentence to disclose:

- English: `user ID and email address`
- German: `Nutzer-ID und E-Mail-Adresse`

Keep consent, session replay, international transfer, and 12-month retention language unchanged.

- [ ] **Step 4: Run the privacy test and verify GREEN**

Run: `npx vitest run src/lib/trust/facts.privacy.test.ts`

Expected: all tests PASS.

- [ ] **Step 5: Document the complete deployment environment**

Add commented examples to `.env.example`:

```dotenv
# Public browser configuration
# VITE_POSTHOG_KEY=phc_<project-api-key>
# VITE_POSTHOG_HOST=https://eu.i.posthog.com

# Server-only production build configuration for source-map upload
# POSTHOG_API_KEY=phx_<personal-api-key>
# POSTHOG_PROJECT_ID=246246
# POSTHOG_HOST=https://eu.posthog.com
```

In `CLAUDE.md`, state that the runtime and management hosts must use the same region, source-map upload skips safely when server values are absent, and Vercel must provide `VERCEL_GIT_COMMIT_SHA` (already built in) or the package version is used as fallback.

- [ ] **Step 6: Run documentation/trust checks**

Run:

```bash
npx vitest run src/lib/trust/facts.privacy.test.ts src/lib/trust/retentionBasis.test.ts src/lib/trust/publishedClaims.test.ts
npm run scan:secrets
```

Expected: all tests PASS and the secret scan reports no committed credential.

- [ ] **Step 7: Commit Task 5**

```bash
git add .env.example CLAUDE.md docs/legal/privacy-policy.en.md docs/legal/privacy-policy.de.md src/lib/trust/facts.privacy.test.ts
git commit -m "document posthog identity and deployment"
```

### Task 6: Full verification and live activation handoff

**Files:**
- Modify only files required to fix verification failures caused by Tasks 1-5.

**Interfaces:**
- Consumes: all earlier tasks.
- Produces: a verified production build and an exact list of remaining Vercel secret configuration.

- [ ] **Step 1: Run focused analytics tests together**

Run:

```bash
npx vitest run src/features/analytics/posthog.test.ts src/features/analytics/identity.test.ts src/features/analytics/AnalyticsIdentityBridge.test.tsx src/features/analytics/AppErrorBoundary.test.tsx scripts/posthogSourceMaps.test.ts
```

Expected: all focused tests PASS with no unhandled errors.

- [ ] **Step 2: Run the repository fast verification gate**

Run: `npm run verify:fast`

Expected: lint, app/tools typechecks, production build, unit coverage, Deno checks, mirror checks, and secret scan all exit 0.

- [ ] **Step 3: Inspect the final diff and dependency graph**

Run:

```bash
git diff HEAD~5 --check
npm ls posthog-js @posthog/rollup-plugin @vercel/analytics
rg -n "@vercel/analytics|VITE_POSTHOG.*phx_|POSTHOG_API_KEY.*import\.meta" src package.json vite.config.ts
```

Expected: clean diff; PostHog packages present; Vercel Analytics absent; no server secret referenced from browser code.

- [ ] **Step 4: Configure deployment variables or report the exact blocker**

If the repository is already linked to its Vercel project and credentials are available, set these for Production and Preview without echoing values:

- `VITE_POSTHOG_KEY` — selected project's public token.
- `VITE_POSTHOG_HOST` — matching ingestion host.
- `POSTHOG_API_KEY` — personal key with error-tracking write and organization-read scopes.
- `POSTHOG_PROJECT_ID=246246`.
- `POSTHOG_HOST` — matching management host.

If Vercel is not linked or the personal API key is unavailable, stop external mutation and report these exact operator actions. Never invent or repurpose the connected app's OAuth token as `POSTHOG_API_KEY`.

- [ ] **Step 5: Perform post-deployment smoke verification when a deployment is available**

Using a non-production test account: grant analytics/error consent, navigate across two React Router routes, verify `$pageview`; confirm the person UUID and `$email`; trigger a deliberate test exception and confirm a symbolicated stack; withdraw consent and confirm capture stops; verify no Vercel Analytics browser request remains.

- [ ] **Step 6: Record verification evidence**

Record the exit code and failure count for the focused test command and `npm run verify:fast`. If either command fails, Task 6 remains incomplete: return to the task that owns the failing file, add a regression test for the observed failure, make it pass, rerun the full verification gate, and commit that owning task's exact files with its listed commit command. Do not create an empty verification commit.
