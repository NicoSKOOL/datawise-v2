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
import StagingTestLogin from './pages/StagingTestLogin';
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

function DeployRefreshGuard() {
  useEffect(() => {
    const currentScript = Array.from(document.scripts).find((script) => {
      return script.type === 'module' && script.src.includes('/assets/index-');
    });
    const currentPath = currentScript ? new URL(currentScript.src).pathname : null;
    if (!currentPath) return;

    let inFlight = false;
    const checkForNewBundle = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const response = await fetch(`/?deploy-check=${Date.now()}`, { cache: 'no-store' });
        if (!response.ok) return;
        const html = await response.text();
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const latestScript = doc.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/index-"]');
        const latestSrc = latestScript?.getAttribute('src');
        if (!latestSrc) return;

        const latestPath = new URL(latestSrc, window.location.origin).pathname;
        if (latestPath !== currentPath) {
          window.location.reload();
        }
      } catch {
        // Ignore update-check failures; they should not affect app usage.
      } finally {
        inFlight = false;
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void checkForNewBundle();
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    const interval = window.setInterval(checkForNewBundle, 5 * 60 * 1000);
    void checkForNewBundle();

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.clearInterval(interval);
    };
  }, []);

  return null;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <AuthProvider>
        <PropertyProvider>
        <Toaster />
        <Sonner />
        <GlobalCreditsDialog />
        <DeployRefreshGuard />
        <BrowserRouter>
          <AnalyticsTracker />
          <Routes>
            {/* Public routes */}
            <Route path="/auth" element={<Auth />} />
            <Route path="/auth/callback" element={<AuthCallback />} />
            <Route path="/auth/test-login" element={<StagingTestLogin />} />
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
