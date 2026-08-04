import { useState, useEffect, lazy, Suspense } from 'react';
import { Toaster } from '@/components/ui/toaster';
import { Toaster as Sonner } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { PropertyProvider } from './contexts/PropertyContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import { Layout } from '@/components/Layout';
import { AppErrorBoundary, RouteLoadingFallback } from '@/components/AppErrorBoundary';
import { OutOfCreditsDialog } from '@/components/OutOfCreditsDialog';
import { outOfCreditsEvent } from '@/lib/api';
import { initAttribution } from '@/lib/attribution';
import { trackPageview } from '@/lib/pageview';

// Capture first-touch UTM/referrer once at app boot, before any navigation.
initAttribution();

// Pages on the login critical path stay eager: they are small (no charts,
// editors or maps) and an extra chunk round-trip during the OAuth redirect
// would add latency and a new failure mode.
import Auth from './pages/Auth';
import AuthCallback from './pages/AuthCallback';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import NotFound from './pages/NotFound';

// Everything behind auth is lazy: each page ships as its own chunk so the
// entry bundle stays small. Stale-chunk failures after a deploy are handled
// by AppErrorBoundary (reload once, then show a refresh prompt).
const Dashboard = lazy(() => import('./pages/Dashboard'));
const SEOAssistant = lazy(() => import('./pages/SEOAssistant'));
const KeywordResearch = lazy(() => import('./pages/KeywordResearch'));
const CompetitorAnalysis = lazy(() => import('./pages/CompetitorAnalysis'));
const AIVisibility = lazy(() => import('./pages/AIVisibility'));
const RankTracking = lazy(() => import('./pages/RankTracking'));
const ContentTools = lazy(() => import('./pages/ContentTools'));
const ContentPlanner = lazy(() => import('./pages/ContentPlanner'));
const ContentWriter = lazy(() => import('./pages/ContentWriter'));
const SiteAudit = lazy(() => import('./pages/SiteAudit'));
const Backlinks = lazy(() => import('./pages/Backlinks'));
const Tasks = lazy(() => import('./pages/Tasks'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const Roadmap = lazy(() => import('./pages/Roadmap'));
const AdminMembers = lazy(() => import('./pages/AdminMembers'));
const AdminFeedback = lazy(() => import('./pages/AdminFeedback'));
const AdminPromoCodes = lazy(() => import('./pages/AdminPromoCodes'));
const AdminAnalytics = lazy(() => import('./pages/AdminAnalytics'));
const AdminActivity = lazy(() => import('./pages/AdminActivity'));
const AdminContentWriterPrompts = lazy(() => import('./pages/AdminContentWriterPrompts'));
const BlueprintHome = lazy(() => import('./pages/blueprint/BlueprintHome'));
const BlueprintCanvas = lazy(() => import('./pages/blueprint/BlueprintCanvas'));

const queryClient = new QueryClient();

function ProtectedPage({ children, requireAdmin = false }: { children: React.ReactNode; requireAdmin?: boolean }) {
  // key resets the boundary on navigation so a crash on one page does not
  // leave the next page stuck on the fallback. Sidebar and header live in
  // Layout, outside the boundary, so they survive page crashes.
  const location = useLocation();
  return (
    <ProtectedRoute requireAdmin={requireAdmin}>
      <Layout>
        <AppErrorBoundary variant="route" key={location.pathname}>
          <Suspense fallback={<RouteLoadingFallback />}>{children}</Suspense>
        </AppErrorBoundary>
      </Layout>
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
  <AppErrorBoundary variant="app">
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
            <Route path="/tasks" element={<ProtectedPage><Tasks /></ProtectedPage>} />
            <Route path="/roadmap" element={<ProtectedPage><Roadmap /></ProtectedPage>} />
            <Route path="/settings" element={<ProtectedPage><SettingsPage /></ProtectedPage>} />
            <Route path="/admin/members" element={<ProtectedPage><AdminMembers /></ProtectedPage>} />
            <Route path="/admin/feedback" element={<ProtectedPage><AdminFeedback /></ProtectedPage>} />
            <Route path="/admin/promo-codes" element={<ProtectedPage><AdminPromoCodes /></ProtectedPage>} />
            <Route path="/admin/analytics" element={<ProtectedPage><AdminAnalytics /></ProtectedPage>} />
            <Route path="/admin/activity" element={<ProtectedPage><AdminActivity /></ProtectedPage>} />
            <Route path="/admin/content-writer-prompts" element={<ProtectedPage><AdminContentWriterPrompts /></ProtectedPage>} />
            <Route path="/blueprint" element={<ProtectedPage requireAdmin><BlueprintHome /></ProtectedPage>} />
            <Route path="/blueprint/:projectId" element={<ProtectedPage requireAdmin><BlueprintCanvas /></ProtectedPage>} />

            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
        </PropertyProvider>
      </AuthProvider>
    </TooltipProvider>
    </QueryClientProvider>
  </AppErrorBoundary>
);

export default App;
