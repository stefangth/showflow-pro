import { lazy, Suspense } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { ThemeProvider } from "next-themes";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import { AuthProvider } from "@/features/auth/AuthContext";
import { EditorProvider } from "@/features/editor/EditorContext";
import { DemoProvider } from "@/features/demo/DemoContext";
import { ConsentProvider } from "@/features/consent/ConsentContext";
import { LanguageProvider } from "@/features/i18n/LanguageContext";
import "@/i18n";
import { CookieConsentBanner } from "@/components/consent/CookieConsentBanner";
import { AnalyticsBridge } from "@/features/analytics/AnalyticsBridge";
import { AnalyticsIdentityBridge } from "@/features/analytics/AnalyticsIdentityBridge";
import { AppErrorBoundary } from "@/features/analytics/AppErrorBoundary";
import { ProtectedRoute, PlatformRoute } from "@/features/auth/ProtectedRoute";
import HomeLanding from "@/features/auth/HomeLanding";
import { legacyRedirectRoutes } from "@/features/auth/legacyRedirects";
import PlatformPage from "./pages/PlatformPage";
import AppLayout from "@/components/layout/AppLayout";
import { ROUTES } from "@/config/app.config";
import LoginPage from "./pages/LoginPage";
import DashboardPage from "./pages/DashboardPage";
import ShowsBookingsPage from "./pages/ShowsBookingsPage";
import AvailabilityPage from "./pages/AvailabilityPage";
import SettingsPage from "./pages/SettingsPage";
import ChatsListPage from "./pages/ChatsListPage";
import HelpPage from "./pages/HelpPage";
import ProfilePage from "./pages/ProfilePage";
import ArtistsPage from "./pages/ArtistsPage";
import UnsubscribePage from "./pages/UnsubscribePage";
import PrivacyPage from "./pages/PrivacyPage";
import ImpressumPage from "./pages/ImpressumPage";
import AcceptInvitePage from "./pages/AcceptInvitePage";
import ResetPasswordPage from "./pages/ResetPasswordPage";
import AuthCallbackPage from "./pages/AuthCallbackPage";
import ProductionsPage from "./pages/ProductionsPage";
import HireOrdersPage from "./pages/HireOrdersPage";
import HireOrderDetailPage from "./pages/HireOrderDetailPage";
import HireOrderEditPage from "./pages/HireOrderEditPage";
import SandboxViewerPage from "./pages/SandboxViewerPage";
import GetRunningPage from "./pages/GetRunningPage";
import NotFound from "./pages/NotFound";

// DEV-ONLY visual harness for the Show Date Cockpit (see DevCockpitHarness.tsx).
// `import.meta.env.DEV` is statically false in production builds, so both the
// import and the route below are dead-code-eliminated from deployed bundles.
const DevCockpitHarness = import.meta.env.DEV ? lazy(() => import("./pages/DevCockpitHarness")) : null;
const DevGetRunningHarness = import.meta.env.DEV ? lazy(() => import("./pages/DevGetRunningHarness")) : null;

// Lazy-loaded so @react-pdf/renderer (the browser PDF preview it drives) stays
// out of the main bundle — it only loads when an admin/producer actually opens
// the template editor. Same pattern as DocumentationTab's System Map tabs.
const TemplateEditorPage = lazy(() => import("@/components/settings/hireOrders/template/TemplateEditorPage"));
const EmailTemplateEditorPage = lazy(() => import("@/pages/EmailTemplateEditorPage"));

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <LanguageProvider>
        <ConsentProvider>
        <AnalyticsBridge />
        <AppErrorBoundary>
          <AuthProvider>
            <AnalyticsIdentityBridge />
            <EditorProvider>
            <DemoProvider>
          <Routes>
            {/* Wrapped in ProtectedRoute so the no-org / suspended-org gates run
                BEFORE HomeLanding fires any org-scoped reads — post-auth redirects
                default here, so this path runs on essentially every login. */}
            <Route path={ROUTES.HOME} element={<ProtectedRoute><HomeLanding /></ProtectedRoute>} />
            <Route path={ROUTES.LOGIN} element={<LoginPage />} />
            {DevCockpitHarness && (
              <Route path="/dev/cockpit" element={<Suspense fallback={null}><DevCockpitHarness /></Suspense>} />
            )}
            {DevGetRunningHarness && (
              <Route path="/dev/get-running" element={<Suspense fallback={null}><DevGetRunningHarness /></Suspense>} />
            )}
            <Route path={ROUTES.SIGNUP} element={<Navigate to={ROUTES.LOGIN} replace />} />
            <Route path={ROUTES.DASHBOARD} element={<ProtectedRoute><AppLayout><DashboardPage /></AppLayout></ProtectedRoute>} />
            {/* All roles for now: role branching happens inside the page. Artists get a
                later-phase bounce (nav already hides the link for them). */}
            <Route path={ROUTES.GET_RUNNING} element={<ProtectedRoute><AppLayout><GetRunningPage /></AppLayout></ProtectedRoute>} />
            <Route path={ROUTES.ARTISTS} element={<ProtectedRoute requiredRoles={['admin', 'producer']}><AppLayout><ArtistsPage /></AppLayout></ProtectedRoute>} />
            <Route path={ROUTES.BOOKINGS} element={<ProtectedRoute requiredRoles={['admin', 'producer']}><AppLayout><ShowsBookingsPage /></AppLayout></ProtectedRoute>} />
            <Route path={ROUTES.PRODUCTIONS} element={<ProtectedRoute requiredRoles={['admin', 'producer']}><AppLayout><ProductionsPage /></AppLayout></ProtectedRoute>} />
            <Route path={ROUTES.HIRE_ORDERS} element={<ProtectedRoute requiredRoles={['admin', 'producer']}><AppLayout><HireOrdersPage /></AppLayout></ProtectedRoute>} />
            <Route path={ROUTES.HIRE_ORDER_DETAIL} element={<ProtectedRoute requiredRoles={['admin', 'producer', 'artist']}><AppLayout><HireOrderDetailPage /></AppLayout></ProtectedRoute>} />
            <Route path={ROUTES.HIRE_ORDER_EDIT} element={<ProtectedRoute requiredRoles={['admin', 'producer']}><AppLayout><HireOrderEditPage /></AppLayout></ProtectedRoute>} />
            <Route
              path={ROUTES.HIRE_ORDER_TEMPLATE}
              element={
                <ProtectedRoute requiredRoles={['admin', 'producer']}>
                  <AppLayout>
                    <Suspense fallback={<Skeleton className="h-[80vh] w-full" />}>
                      <TemplateEditorPage />
                    </Suspense>
                  </AppLayout>
                </ProtectedRoute>
              }
            />
            <Route path={ROUTES.AVAILABILITY} element={<ProtectedRoute requiredRoles={['artist']}><AppLayout><AvailabilityPage /></AppLayout></ProtectedRoute>} />
            {/* Admin folded into Settings as an admin-only "People & access" nav group.
                Stays behind ProtectedRoute (not a bare Navigate) so the Editor's
                DEFAULT_PAGE_ACCESS override for '/admin' still means something: if an
                org admin ever broadens it beyond ['admin'], the redirect target itself
                (Settings) still gates the People/Activity/Sync-log tabs to isAdmin, so a
                producer let through here resolves onto Settings' own default tab instead
                of a blank pane. */}
            <Route path={ROUTES.ADMIN} element={<ProtectedRoute requiredRoles={['admin']}><Navigate to={`${ROUTES.SETTINGS}?tab=people`} replace /></ProtectedRoute>} />
            <Route path={ROUTES.SETTINGS} element={<ProtectedRoute requiredRoles={['admin', 'producer']}><AppLayout><SettingsPage /></AppLayout></ProtectedRoute>} />
            <Route
              path={ROUTES.EMAIL_TEMPLATE}
              element={
                <ProtectedRoute requiredRoles={['admin', 'producer']}>
                  <AppLayout>
                    <Suspense fallback={<Skeleton className="h-[80vh] w-full" />}>
                      <EmailTemplateEditorPage />
                    </Suspense>
                  </AppLayout>
                </ProtectedRoute>
              }
            />
            <Route path={ROUTES.CHATS} element={<ProtectedRoute><AppLayout><ChatsListPage /></AppLayout></ProtectedRoute>} />
            <Route path={ROUTES.HELP} element={<ProtectedRoute><AppLayout><HelpPage /></AppLayout></ProtectedRoute>} />
            <Route path={ROUTES.PROFILE} element={<ProtectedRoute><AppLayout><ProfilePage /></AppLayout></ProtectedRoute>} />
            <Route path={ROUTES.PLATFORM} element={<PlatformRoute><AppLayout><PlatformPage /></AppLayout></PlatformRoute>} />
            <Route path={ROUTES.ACCEPT_INVITE} element={<AcceptInvitePage />} />
            <Route path={ROUTES.RESET_PASSWORD} element={<ResetPasswordPage />} />
            <Route path={ROUTES.AUTH_CALLBACK} element={<AuthCallbackPage />} />
            <Route path={ROUTES.UNSUBSCRIBE} element={<UnsubscribePage />} />
            <Route path={ROUTES.SANDBOX} element={<SandboxViewerPage />} />
            <Route path={ROUTES.PRIVACY} element={<PrivacyPage />} />
            <Route path={ROUTES.IMPRESSUM} element={<ImpressumPage />} />
            {/* Legacy slug redirects (renamed in the today/dates/contracts slug pass).
                Keep indefinitely: bookmarks, already-sent emails, and the marketing site
                still point at the old paths. See src/features/auth/legacyRedirects.tsx. */}
            {legacyRedirectRoutes()}
            <Route path="*" element={<NotFound />} />
          </Routes>
            </DemoProvider>
            </EditorProvider>
          </AuthProvider>
        </AppErrorBoundary>
        <CookieConsentBanner />
        </ConsentProvider>
        </LanguageProvider>
      </BrowserRouter>
    </TooltipProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
