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
import { ConsentProvider } from "@/features/consent/ConsentContext";
import { CookieConsentBanner } from "@/components/consent/CookieConsentBanner";
import { ProtectedRoute, PlatformRoute } from "@/features/auth/ProtectedRoute";
import PlatformPage from "./pages/PlatformPage";
import AppLayout from "@/components/layout/AppLayout";
import { ROUTES } from "@/config/app.config";
import LoginPage from "./pages/LoginPage";
import DashboardPage from "./pages/DashboardPage";
import ShowsBookingsPage from "./pages/ShowsBookingsPage";
import AvailabilityPage from "./pages/AvailabilityPage";
import AdminPage from "./pages/AdminPage";
import SettingsPage from "./pages/SettingsPage";
import ChatsListPage from "./pages/ChatsListPage";
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
import NotFound from "./pages/NotFound";

// DEV-ONLY visual harness for the Show Date Cockpit (see DevCockpitHarness.tsx).
// `import.meta.env.DEV` is statically false in production builds, so both the
// import and the route below are dead-code-eliminated from deployed bundles.
const DevCockpitHarness = import.meta.env.DEV ? lazy(() => import("./pages/DevCockpitHarness")) : null;

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
        <ConsentProvider>
        <AuthProvider>
          <EditorProvider>
          <Routes>
            <Route path={ROUTES.HOME} element={<Navigate to={ROUTES.LOGIN} replace />} />
            <Route path={ROUTES.LOGIN} element={<LoginPage />} />
            {DevCockpitHarness && (
              <Route path="/dev/cockpit" element={<Suspense fallback={null}><DevCockpitHarness /></Suspense>} />
            )}
            <Route path={ROUTES.SIGNUP} element={<Navigate to={ROUTES.LOGIN} replace />} />
            <Route path={ROUTES.DASHBOARD} element={<ProtectedRoute><AppLayout><DashboardPage /></AppLayout></ProtectedRoute>} />
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
            <Route path={ROUTES.ADMIN} element={<ProtectedRoute requiredRoles={['admin']}><AppLayout><AdminPage /></AppLayout></ProtectedRoute>} />
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
            <Route path={ROUTES.PROFILE} element={<ProtectedRoute><AppLayout><ProfilePage /></AppLayout></ProtectedRoute>} />
            <Route path={ROUTES.PLATFORM} element={<PlatformRoute><AppLayout><PlatformPage /></AppLayout></PlatformRoute>} />
            <Route path={ROUTES.ACCEPT_INVITE} element={<AcceptInvitePage />} />
            <Route path={ROUTES.RESET_PASSWORD} element={<ResetPasswordPage />} />
            <Route path={ROUTES.AUTH_CALLBACK} element={<AuthCallbackPage />} />
            <Route path={ROUTES.UNSUBSCRIBE} element={<UnsubscribePage />} />
            <Route path={ROUTES.PRIVACY} element={<PrivacyPage />} />
            <Route path={ROUTES.IMPRESSUM} element={<ImpressumPage />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
          </EditorProvider>
        </AuthProvider>
        <CookieConsentBanner />
        </ConsentProvider>
      </BrowserRouter>
    </TooltipProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
