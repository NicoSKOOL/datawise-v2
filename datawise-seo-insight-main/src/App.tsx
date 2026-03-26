import { useState, useEffect } from 'react';
import { Toaster } from '@/components/ui/toaster';
import { Toaster as Sonner } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { PropertyProvider } from './contexts/PropertyContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import { Layout } from '@/components/Layout';
import { OutOfCreditsDialog } from '@/components/OutOfCreditsDialog';
import { outOfCreditsEvent } from '@/lib/api';

// Pages
import Dashboard from './pages/Dashboard';
import Auth from './pages/Auth';
import AuthCallback from './pages/AuthCallback';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import SEOAssistant from './pages/SEOAssistant';
import KeywordResearch from './pages/KeywordResearch';
import CompetitorAnalysis from './pages/CompetitorAnalysis';
import AIVisibility from './pages/AIVisibility';
import RankTracking from './pages/RankTracking';
import ContentTools from './pages/ContentTools';
import Tasks from './pages/Tasks';
import SettingsPage from './pages/SettingsPage';
import NotFound from './pages/NotFound';
import AdminMembers from './pages/AdminMembers';
import AdminFeedback from './pages/AdminFeedback';

const queryClient = new QueryClient();

function ProtectedPage({ children }: { children: React.ReactNode }) {
  return (
    <ProtectedRoute>
      <Layout>{children}</Layout>
    </ProtectedRoute>
  );
}

function GlobalCreditsDialog() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handler = () => setOpen(true);
    outOfCreditsEvent.addEventListener('out_of_credits', handler);
    return () => outOfCreditsEvent.removeEventListener('out_of_credits', handler);
  }, []);

  return <OutOfCreditsDialog open={open} onOpenChange={setOpen} />;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <AuthProvider>
        <PropertyProvider>
        <Toaster />
        <Sonner />
        <GlobalCreditsDialog />
        <BrowserRouter>
          <Routes>
            {/* Public routes */}
            <Route path="/auth" element={<Auth />} />
            <Route path="/auth/callback" element={<AuthCallback />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password" element={<ResetPassword />} />

            {/* Protected routes */}
            <Route path="/" element={<ProtectedPage><Dashboard /></ProtectedPage>} />
            <Route path="/seo-assistant" element={<ProtectedPage><SEOAssistant /></ProtectedPage>} />
            <Route path="/keyword-research" element={<ProtectedPage><KeywordResearch /></ProtectedPage>} />
            <Route path="/competitor-analysis" element={<ProtectedPage><CompetitorAnalysis /></ProtectedPage>} />
            <Route path="/ai-visibility" element={<ProtectedPage><AIVisibility /></ProtectedPage>} />
            <Route path="/rank-tracking" element={<ProtectedPage><RankTracking /></ProtectedPage>} />
            <Route path="/content-tools" element={<ProtectedPage><ContentTools /></ProtectedPage>} />
            <Route path="/tasks" element={<ProtectedPage><Tasks /></ProtectedPage>} />
            <Route path="/settings" element={<ProtectedPage><SettingsPage /></ProtectedPage>} />
            <Route path="/admin/members" element={<ProtectedPage><AdminMembers /></ProtectedPage>} />
            <Route path="/admin/feedback" element={<ProtectedPage><AdminFeedback /></ProtectedPage>} />

            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
        </PropertyProvider>
      </AuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
