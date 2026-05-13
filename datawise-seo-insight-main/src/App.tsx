import { useState, useEffect } from 'react';
import { Toaster } from '@/components/ui/toaster';
import { Toaster as Sonner } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { PropertyProvider } from './contexts/PropertyContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import { Layout } from '@/components/Layout';
import { OutOfCreditsDialog } from '@/components/OutOfCreditsDialog';
import { outOfCreditsEvent } from '@/lib/api';
import { initAttribution } from '@/lib/attribution';
import { trackPageview } from '@/lib/pageview';

// Capture first-touch UTM/referrer once at app boot, before any navigation.
initAttribution();

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
import ContentPlanner from './pages/ContentPlanner';
import ContentWriter from './pages/ContentWriter';
import SiteAudit from './pages/SiteAudit';
import Backlinks from './pages/Backlinks';
import SettingsPage from './pages/SettingsPage';
import NotFound from './pages/NotFound';
import AdminMembers from './pages/AdminMembers';
import AdminFeedback from './pages/AdminFeedback';
import AdminPromoCodes from './pages/AdminPromoCodes';
import AdminAnalytics from './pages/AdminAnalytics';
import AdminContentWriterPrompts from './pages/AdminContentWriterPrompts';

const queryClient = new QueryClient();

function ProtectedPage({ children }: { children: React.ReactNode }) {
  return (
    <ProtectedRoute>
      <Layout>{children}</Layout>
    </ProtectedRoute>
  );
}

// Fires a pageview beacon to the worker on every route change. Lives inside
// the Router so useLocation works, and inside AuthProvider so it can stamp the
// authenticated user_id when known. Failures are swallowed by trackPageview.
function AnalyticsTracker() {
  const location = useLocation();
  const { user } = useAuth();
  useEffect(() => {
    trackPageview(location.pathname + location.search, user?.id);
  }, [location.pathname, location.search, user?.id]);
  return null;
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
          <AnalyticsTracker />
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
            <Route path="/content-planner" element={<ProtectedPage><ContentPlanner /></ProtectedPage>} />
            <Route path="/content-writer" element={<ProtectedPage><ContentWriter /></ProtectedPage>} />
            <Route path="/site-audit" element={<ProtectedPage><SiteAudit /></ProtectedPage>} />
            <Route path="/backlinks" element={<ProtectedPage><Backlinks /></ProtectedPage>} />
            <Route path="/settings" element={<ProtectedPage><SettingsPage /></ProtectedPage>} />
            <Route path="/admin/members" element={<ProtectedPage><AdminMembers /></ProtectedPage>} />
            <Route path="/admin/feedback" element={<ProtectedPage><AdminFeedback /></ProtectedPage>} />
            <Route path="/admin/promo-codes" element={<ProtectedPage><AdminPromoCodes /></ProtectedPage>} />
            <Route path="/admin/analytics" element={<ProtectedPage><AdminAnalytics /></ProtectedPage>} />
            <Route path="/admin/content-writer-prompts" element={<ProtectedPage><AdminContentWriterPrompts /></ProtectedPage>} />

            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
        </PropertyProvider>
      </AuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
