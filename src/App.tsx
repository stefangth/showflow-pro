import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/features/auth/AuthContext";
import { ProtectedRoute } from "@/features/auth/ProtectedRoute";
import AppLayout from "@/components/layout/AppLayout";
import { ROUTES } from "@/config/app.config";
import Index from "./pages/Index";
import LoginPage from "./pages/LoginPage";
import DashboardPage from "./pages/DashboardPage";
import ShowsBookingsPage from "./pages/ShowsBookingsPage";
import ShowDetailPage from "./pages/ShowDetailPage";
import ArtistsPage from "./pages/ArtistsPage";
import AvailabilityPage from "./pages/AvailabilityPage";
import AdminPage from "./pages/AdminPage";
import SettingsPage from "./pages/SettingsPage";
import ChatsListPage from "./pages/ChatsListPage";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path={ROUTES.LOGIN} element={<LoginPage />} />
            <Route path="/signup" element={<Navigate to={ROUTES.LOGIN} replace />} />
            <Route path={ROUTES.DASHBOARD} element={<ProtectedRoute><AppLayout><DashboardPage /></AppLayout></ProtectedRoute>} />
            <Route path={ROUTES.SHOWS} element={<Navigate to={ROUTES.BOOKINGS} replace />} />
            <Route path="/shows/:id" element={<ProtectedRoute><AppLayout><ShowDetailPage /></AppLayout></ProtectedRoute>} />
            <Route path={ROUTES.ARTISTS} element={<ProtectedRoute requiredRoles={['admin', 'producer']}><AppLayout><ArtistsPage /></AppLayout></ProtectedRoute>} />
            <Route path={ROUTES.BOOKINGS} element={<ProtectedRoute><AppLayout><ShowsBookingsPage /></AppLayout></ProtectedRoute>} />
            <Route path={ROUTES.AVAILABILITY} element={<ProtectedRoute><AppLayout><AvailabilityPage /></AppLayout></ProtectedRoute>} />
            <Route path={ROUTES.ADMIN} element={<ProtectedRoute requiredRoles={['admin']}><AppLayout><AdminPage /></AppLayout></ProtectedRoute>} />
            <Route path={ROUTES.SETTINGS} element={<ProtectedRoute requiredRoles={['admin', 'producer']}><AppLayout><SettingsPage /></AppLayout></ProtectedRoute>} />
            <Route path={ROUTES.CHATS} element={<ProtectedRoute><AppLayout><ChatsListPage /></AppLayout></ProtectedRoute>} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </Routes>
    </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
