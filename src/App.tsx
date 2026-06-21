import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
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
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
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
            <Route path={ROUTES.SIGNUP} element={<Navigate to={ROUTES.LOGIN} replace />} />
            <Route path={ROUTES.DASHBOARD} element={<ProtectedRoute><AppLayout><DashboardPage /></AppLayout></ProtectedRoute>} />
            <Route path={ROUTES.ARTISTS} element={<ProtectedRoute requiredRoles={['admin', 'producer']}><AppLayout><ArtistsPage /></AppLayout></ProtectedRoute>} />
            <Route path={ROUTES.BOOKINGS} element={<ProtectedRoute requiredRoles={['admin', 'producer']}><AppLayout><ShowsBookingsPage /></AppLayout></ProtectedRoute>} />
            <Route path={ROUTES.AVAILABILITY} element={<ProtectedRoute requiredRoles={['artist']}><AppLayout><AvailabilityPage /></AppLayout></ProtectedRoute>} />
            <Route path={ROUTES.ADMIN} element={<ProtectedRoute requiredRoles={['admin']}><AppLayout><AdminPage /></AppLayout></ProtectedRoute>} />
            <Route path={ROUTES.SETTINGS} element={<ProtectedRoute requiredRoles={['admin', 'producer']}><AppLayout><SettingsPage /></AppLayout></ProtectedRoute>} />
            <Route path={ROUTES.CHATS} element={<ProtectedRoute><AppLayout><ChatsListPage /></AppLayout></ProtectedRoute>} />
            <Route path={ROUTES.PROFILE} element={<ProtectedRoute><AppLayout><ProfilePage /></AppLayout></ProtectedRoute>} />
            <Route path={ROUTES.PLATFORM} element={<PlatformRoute><AppLayout><PlatformPage /></AppLayout></PlatformRoute>} />
            <Route path={ROUTES.ACCEPT_INVITE} element={<AcceptInvitePage />} />
            <Route path={ROUTES.RESET_PASSWORD} element={<ResetPasswordPage />} />
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
  </QueryClientProvider>
);

export default App;
