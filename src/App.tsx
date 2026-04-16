import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/features/auth/AuthContext";
import { ProtectedRoute } from "@/features/auth/ProtectedRoute";
import AppLayout from "@/components/layout/AppLayout";
import { ROUTES } from "@/config/app.config";
import Index from "./pages/Index";
import LoginPage from "./pages/LoginPage";
import SignupPage from "./pages/SignupPage";
import DashboardPage from "./pages/DashboardPage";
import ShowsPage from "./pages/ShowsPage";
import ShowDetailPage from "./pages/ShowDetailPage";
import ArtistsPage from "./pages/ArtistsPage";
import BookingsPage from "./pages/BookingsPage";
import AvailabilityPage from "./pages/AvailabilityPage";
import AdminPage from "./pages/AdminPage";
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
            <Route path={ROUTES.SIGNUP} element={<SignupPage />} />
            <Route path={ROUTES.DASHBOARD} element={<ProtectedRoute><AppLayout><DashboardPage /></AppLayout></ProtectedRoute>} />
            <Route path={ROUTES.SHOWS} element={<ProtectedRoute><AppLayout><ShowsPage /></AppLayout></ProtectedRoute>} />
            <Route path="/shows/:id" element={<ProtectedRoute><AppLayout><ShowDetailPage /></AppLayout></ProtectedRoute>} />
            <Route path={ROUTES.ARTISTS} element={<ProtectedRoute><AppLayout><ArtistsPage /></AppLayout></ProtectedRoute>} />
            <Route path={ROUTES.BOOKINGS} element={<ProtectedRoute><AppLayout><BookingsPage /></AppLayout></ProtectedRoute>} />
            <Route path={ROUTES.AVAILABILITY} element={<ProtectedRoute><AppLayout><AvailabilityPage /></AppLayout></ProtectedRoute>} />
            <Route path={ROUTES.ADMIN} element={<ProtectedRoute requiredRoles={['admin']}><AppLayout><AdminPage /></AppLayout></ProtectedRoute>} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
