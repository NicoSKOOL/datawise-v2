export interface Env {
  DB: D1Database;
  KV: KVNamespace;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  ENCRYPTION_KEY: string;
  FRONTEND_URL: string;
  ENVIRONMENT: string;
  DATAFORSEO_EMAIL: string;
  DATAFORSEO_PASSWORD: string;
  RESEND_API_KEY: string;
  // LLM config
  LLM_PROVIDER: string;
  LLM_MODEL: string;
  LLM_BASE_URL: string;
  OPENAI_API_KEY: string;
  ANTHROPIC_API_KEY: string;
  KIMI_API_KEY: string;
}

import { handleGoogleAuth, handleGoogleCallback, handleLogout, handleMe } from './auth/google';
import { handleEmailSignup, handleEmailLogin, handleForgotPassword, handleResetPassword } from './auth/email';
import { authMiddleware } from './middleware/auth';
import { handleGSCConnect, handleGSCCallback, handleGSCProperties, handleGSCDisconnect, handleGSCPropertyUpdate } from './gsc/oauth';
import { handleGSCSync, handleGSCData, handleGSCQueries } from './gsc/sync';
import { handleChat, handleListConversations, handleGetConversation } from './chat/handler';
import {
  handleRelatedKeywords, handleKeywordSuggestions, handleKeywordIdeas,
  handleKeywordDifficulty, handleKeywordOverview,
} from './routes/keywords';
import {
  handleRankedKeywords, handleDomainRankOverview, handleKeywordGapAnalysis,
  handleBulkTrafficEstimation, handleCompetitorsDomain,
} from './routes/competitors';
import {
  handleGoogleAIMode, handleChatGPTSearch, handlePerplexitySearch,
  handlePeopleAlsoAsk, handleLighthouseSEO, handleGeoAnalyzer,
  handleVisibilitySummary, handleVisibilityCheck,
} from './routes/ai';
import {
  handleListProjects, handleCreateProject, handleDeleteProject,
  handleListKeywords, handleAddKeywords, handleDeleteKeyword,
  handleCheckRankings, handleKeywordHistory,
  handleProjectReport, handleDashboardSummary,
} from './routes/rank-tracking';
import {
  handleBusinessSearch, handleCreateLocalProject, handleLocalKeywords,
  handleLocalRankCheck, handleLocalProjectReport,
  handleGBPProfile, handleReviews, handleLocalCompetitors, handleLocalKeywordSuggestions,
  handleResolveGBPUrl,
  handleGeoGridScan, handleGeoGridHistory, handleGeoGridScanDetail, handleGeoGridInsights,
} from './routes/local-seo';
import {
  handleFetchPost, handleDiscoverSitemap, handleAnalyzePost, handleRewritePost,
  handleFetchServicePage, handleAnalyzeServicePage, handleGenerateSection,
} from './routes/content-tools';
import {
  handleUploadMembers, handleCrossReference, handleRevokeAccess,
  handleSendInvites, handleToggleMember, handleAddMember, handleListUsers, handleDeleteUser,
} from './routes/admin';
import {
  handleSubmitFeedback, handleListMyFeedback, handleGetScreenshot,
  handleListAllFeedback, handleUpdateFeedback, handleDeleteFeedback,
} from './routes/feedback';
import { checkAndDeductCredit } from './middleware/credits';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': env.FRONTEND_URL,
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Expose-Headers': 'X-Conversation-ID',
      'Access-Control-Allow-Credentials': 'true',
    };

    if (method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const addCors = (response: Response): Response => {
      const newHeaders = new Headers(response.headers);
      Object.entries(corsHeaders).forEach(([k, v]) => newHeaders.set(k, v));
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: newHeaders,
      });
    };

    const json = (data: unknown, status = 200) =>
      new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

    try {
      // --- Public routes ---
      if (path === '/auth/google' && method === 'POST') {
        return addCors(await handleGoogleAuth(request, env));
      }
      if (path === '/auth/google/callback' && method === 'GET') {
        return addCors(await handleGoogleCallback(request, env));
      }
      if (path === '/auth/email/signup' && method === 'POST') {
        return addCors(await handleEmailSignup(request, env));
      }
      if (path === '/auth/email/login' && method === 'POST') {
        return addCors(await handleEmailLogin(request, env));
      }
      if (path === '/auth/forgot-password' && method === 'POST') {
        return addCors(await handleForgotPassword(request, env));
      }
      if (path === '/auth/reset-password' && method === 'POST') {
        return addCors(await handleResetPassword(request, env));
      }
      if (path === '/health') {
        return addCors(json({ status: 'ok', environment: env.ENVIRONMENT }));
      }
      // GSC callback is a public redirect from Google (uses state param for auth)
      if (path === '/gsc/callback' && method === 'GET') {
        return addCors(await handleGSCCallback(request, env));
      }
      // DEV ONLY: PAA bypass auth for local testing
      if (path === '/api/ai/people-also-ask' && method === 'POST') {
        return addCors(await handlePeopleAlsoAsk(request, env));
      }

      // --- Auth-required routes ---
      const user = await authMiddleware(request, env);
      if (path === '/auth/logout' && method === 'POST') {
        if (!user) return addCors(json({ error: 'Unauthorized' }, 401));
        return addCors(await handleLogout(request, env));
      }
      if (path === '/auth/me' && method === 'GET') {
        if (!user) return addCors(json({ error: 'Unauthorized' }, 401));
        return addCors(await handleMe(user));
      }

      // All API routes require auth
      if (!user) return addCors(json({ error: 'Unauthorized' }, 401));

      // Credit-gated handler: checks and deducts a credit before calling the handler
      const withCredit = async (handler: () => Promise<Response>): Promise<Response> => {
        const result = await checkAndDeductCredit(env, user.id);
        if (!result.allowed) {
          return addCors(json({
            error: 'out_of_credits',
            credits_used: result.credits_used,
            credits_limit: result.credits_limit,
          }, 403));
        }
        const response = await handler();
        // Append credit info to successful JSON responses
        if (response.headers.get('Content-Type')?.includes('application/json')) {
          const body = await response.json() as Record<string, unknown>;
          body._credits = {
            credits_used: result.credits_used,
            credits_limit: result.credits_limit,
            unlimited: result.unlimited,
          };
          return addCors(new Response(JSON.stringify(body), {
            status: response.status,
            headers: { 'Content-Type': 'application/json' },
          }));
        }
        return addCors(response);
      };

      // --- Keyword Research (credit-gated) ---
      if (path === '/api/keywords/related' && method === 'POST') {
        return await withCredit(() => handleRelatedKeywords(request, env));
      }
      if (path === '/api/keywords/suggestions' && method === 'POST') {
        return await withCredit(() => handleKeywordSuggestions(request, env));
      }
      if (path === '/api/keywords/ideas' && method === 'POST') {
        return await withCredit(() => handleKeywordIdeas(request, env));
      }
      if (path === '/api/keywords/difficulty' && method === 'POST') {
        return await withCredit(() => handleKeywordDifficulty(request, env));
      }
      if (path === '/api/keywords/overview' && method === 'POST') {
        return await withCredit(() => handleKeywordOverview(request, env));
      }

      // --- Competitor Analysis (credit-gated) ---
      if (path === '/api/competitors/ranked-keywords' && method === 'POST') {
        return await withCredit(() => handleRankedKeywords(request, env));
      }
      if (path === '/api/competitors/domain-rank' && method === 'POST') {
        return await withCredit(() => handleDomainRankOverview(request, env));
      }
      if (path === '/api/competitors/gap-analysis' && method === 'POST') {
        return await withCredit(() => handleKeywordGapAnalysis(request, env));
      }
      if (path === '/api/competitors/traffic' && method === 'POST') {
        return await withCredit(() => handleBulkTrafficEstimation(request, env));
      }
      if (path === '/api/competitors/domains' && method === 'POST') {
        return await withCredit(() => handleCompetitorsDomain(request, env));
      }

      // --- Rank Tracking ---
      if (path === '/api/rank-tracking/projects' && method === 'GET') {
        return addCors(await handleListProjects(env, user.id));
      }
      if (path === '/api/rank-tracking/projects' && method === 'POST') {
        return addCors(await handleCreateProject(request, env, user.id));
      }
      if (path.match(/^\/api\/rank-tracking\/projects\/[^/]+$/) && method === 'DELETE') {
        const projectId = path.split('/')[4];
        return addCors(await handleDeleteProject(env, user.id, projectId));
      }
      if (path.match(/^\/api\/rank-tracking\/projects\/[^/]+\/keywords$/) && method === 'GET') {
        const projectId = path.split('/')[4];
        return addCors(await handleListKeywords(env, user.id, projectId));
      }
      if (path.match(/^\/api\/rank-tracking\/projects\/[^/]+\/keywords$/) && method === 'POST') {
        const projectId = path.split('/')[4];
        return addCors(await handleAddKeywords(request, env, user.id, projectId));
      }
      if (path.match(/^\/api\/rank-tracking\/keywords\/[^/]+$/) && method === 'DELETE') {
        const keywordId = path.split('/')[4];
        return addCors(await handleDeleteKeyword(env, user.id, keywordId));
      }
      if (path.match(/^\/api\/rank-tracking\/projects\/[^/]+\/check$/) && method === 'POST') {
        const projectId = path.split('/')[4];
        return await withCredit(() => handleCheckRankings(env, user.id, projectId));
      }
      if (path.match(/^\/api\/rank-tracking\/projects\/[^/]+\/report$/) && method === 'GET') {
        const projectId = path.split('/')[4];
        return addCors(await handleProjectReport(request, env, user.id, projectId));
      }
      if (path === '/api/rank-tracking/dashboard-summary' && method === 'GET') {
        return addCors(await handleDashboardSummary(env, user.id));
      }
      if (path.match(/^\/api\/rank-tracking\/keywords\/[^/]+\/history$/) && method === 'GET') {
        const keywordId = path.split('/')[4];
        return addCors(await handleKeywordHistory(env, user.id, keywordId));
      }

      // --- Local SEO ---
      if (path === '/api/local-seo/business-search' && method === 'POST') {
        return await withCredit(() => handleBusinessSearch(request, env));
      }
      if (path === '/api/local-seo/projects' && method === 'POST') {
        return addCors(await handleCreateLocalProject(request, env, user.id));
      }
      if (path.match(/^\/api\/local-seo\/projects\/[^/]+\/keywords$/) && method === 'GET') {
        const projectId = path.split('/')[4];
        return addCors(await handleLocalKeywords(env, user.id, projectId));
      }
      if (path.match(/^\/api\/local-seo\/projects\/[^/]+\/check$/) && method === 'POST') {
        const projectId = path.split('/')[4];
        return await withCredit(() => handleLocalRankCheck(env, user.id, projectId));
      }
      if (path.match(/^\/api\/local-seo\/projects\/[^/]+\/report$/) && method === 'GET') {
        const projectId = path.split('/')[4];
        return addCors(await handleLocalProjectReport(request, env, user.id, projectId));
      }
      if (path === '/api/local-seo/gbp-profile' && method === 'POST') {
        return await withCredit(() => handleGBPProfile(request, env));
      }
      if (path === '/api/local-seo/reviews' && method === 'POST') {
        return await withCredit(() => handleReviews(request, env));
      }
      if (path === '/api/local-seo/keyword-suggestions' && method === 'POST') {
        return await withCredit(() => handleLocalKeywordSuggestions(request, env));
      }
      if (path === '/api/local-seo/local-competitors' && method === 'POST') {
        return await withCredit(() => handleLocalCompetitors(request, env));
      }
      if (path === '/api/local-seo/resolve-gbp-url' && method === 'POST') {
        return await withCredit(() => handleResolveGBPUrl(request, env));
      }
      if (path.match(/^\/api\/local-seo\/projects\/[^/]+\/geogrid$/) && method === 'POST') {
        const projectId = path.split('/')[4];
        return await withCredit(() => handleGeoGridScan(request, env, user.id, projectId));
      }
      if (path.match(/^\/api\/local-seo\/projects\/[^/]+\/geogrid-history$/) && method === 'GET') {
        const projectId = path.split('/')[4];
        return addCors(await handleGeoGridHistory(env, user.id, projectId));
      }
      if (path.match(/^\/api\/local-seo\/geogrid-scans\/[^/]+$/) && method === 'GET') {
        const scanId = path.split('/')[4];
        return addCors(await handleGeoGridScanDetail(env, user.id, scanId));
      }
      if (path.match(/^\/api\/local-seo\/projects\/[^/]+\/geogrid-insights$/) && method === 'POST') {
        const projectId = path.split('/')[4];
        return addCors(await handleGeoGridInsights(request, env, user.id, projectId));
      }

      // --- AI Visibility (reporting, not credit-gated) ---
      if (path === '/api/ai/visibility-summary' && method === 'GET') {
        return addCors(await handleVisibilitySummary(request, env, user.id));
      }

      // --- AI / SERP Analysis (credit-gated) ---
      if (path === '/api/ai/visibility-check' && method === 'POST') {
        return await withCredit(() => handleVisibilityCheck(request, env, user.id));
      }
      if (path === '/api/ai/google-ai-mode' && method === 'POST') {
        return await withCredit(() => handleGoogleAIMode(request, env));
      }
      if (path === '/api/ai/chatgpt-search' && method === 'POST') {
        return await withCredit(() => handleChatGPTSearch(request, env));
      }
      if (path === '/api/ai/perplexity' && method === 'POST') {
        return await withCredit(() => handlePerplexitySearch(request, env));
      }
      if (path === '/api/ai/people-also-ask' && method === 'POST') {
        return await withCredit(() => handlePeopleAlsoAsk(request, env));
      }
      if (path === '/api/ai/lighthouse-seo' && method === 'POST') {
        return await withCredit(() => handleLighthouseSEO(request, env));
      }
      if (path === '/api/ai/geo-analyzer' && method === 'POST') {
        return await withCredit(() => handleGeoAnalyzer(request, env));
      }

      // --- GSC Integration ---
      if (path === '/gsc/connect' && method === 'POST') {
        return addCors(await handleGSCConnect(request, env, user.id));
      }
      if (path === '/gsc/properties' && method === 'GET') {
        return addCors(await handleGSCProperties(env, user.id));
      }
      if (path.match(/^\/gsc\/properties\/[^/]+$/) && method === 'PATCH') {
        const propertyId = path.split('/')[3];
        return addCors(await handleGSCPropertyUpdate(request, env, user.id, propertyId));
      }
      if (path === '/gsc/disconnect' && method === 'POST') {
        return addCors(await handleGSCDisconnect(env, user.id));
      }
      if (path === '/gsc/sync' && method === 'POST') {
        return addCors(await handleGSCSync(request, env, user.id));
      }
      if (path === '/gsc/data' && method === 'GET') {
        return addCors(await handleGSCData(request, env, user.id));
      }
      if (path === '/gsc/queries' && method === 'GET') {
        return addCors(await handleGSCQueries(request, env, user.id));
      }

      // Debug: test GSC context building
      if (path === '/debug/gsc-context' && method === 'GET') {
        const propertyId = new URL(request.url).searchParams.get('property_id');
        if (!propertyId) return addCors(json({ error: 'property_id required' }, 400));

        const property = await env.DB.prepare(
          'SELECT site_url FROM gsc_properties WHERE id = ? AND user_id = ?'
        ).bind(propertyId, user.id).first();

        const dataCount = await env.DB.prepare(
          'SELECT COUNT(*) as count FROM gsc_search_data WHERE property_id = ?'
        ).bind(propertyId).first();

        // Also test the full context builder
        const { buildGSCContextDebug } = await import('./chat/handler');
        const context = await buildGSCContextDebug(env, user.id, propertyId);

        return addCors(json({
          user_id: user.id,
          property_id: propertyId,
          property_found: !!property,
          property_site_url: property?.site_url || null,
          data_rows: dataCount?.count || 0,
          context_length: context?.length || 0,
          context_preview: context?.substring(0, 500) || null,
        }));
      }

      // --- Content Tools ---
      if (path === '/api/content-tools/fetch-post' && method === 'POST') {
        return addCors(await handleFetchPost(request));
      }
      if (path === '/api/content-tools/discover-sitemap' && method === 'POST') {
        return addCors(await handleDiscoverSitemap(request));
      }
      if (path === '/api/content-tools/analyze-post' && method === 'POST') {
        return addCors(await handleAnalyzePost(request, env));
      }
      if (path === '/api/content-tools/rewrite-post' && method === 'POST') {
        return addCors(await handleRewritePost(request, env));
      }
      if (path === '/api/content-tools/fetch-service-page' && method === 'POST') {
        return addCors(await handleFetchServicePage(request));
      }
      if (path === '/api/content-tools/analyze-service-page' && method === 'POST') {
        return addCors(await handleAnalyzeServicePage(request, env));
      }
      if (path === '/api/content-tools/generate-section' && method === 'POST') {
        return addCors(await handleGenerateSection(request, env));
      }

      // --- Feedback ---
      if (path === '/api/feedback' && method === 'POST') {
        return addCors(await handleSubmitFeedback(request, env, user));
      }
      if (path === '/api/feedback' && method === 'GET') {
        return addCors(await handleListMyFeedback(env, user.id));
      }
      if (path.match(/^\/api\/feedback\/screenshot\/[^/]+$/) && method === 'GET') {
        const reportId = path.split('/')[4];
        return addCors(await handleGetScreenshot(env, reportId));
      }
      if (path === '/api/admin/feedback' && method === 'GET') {
        return addCors(await handleListAllFeedback(request, env, user));
      }
      if (path.match(/^\/api\/admin\/feedback\/[^/]+$/) && method === 'PATCH') {
        const reportId = path.split('/')[4];
        return addCors(await handleUpdateFeedback(request, env, user, reportId));
      }
      if (path.match(/^\/api\/admin\/feedback\/[^/]+$/) && method === 'DELETE') {
        const reportId = path.split('/')[4];
        return addCors(await handleDeleteFeedback(env, user, reportId));
      }

      // --- Admin ---
      if (path === '/api/admin/upload-members' && method === 'POST') {
        return addCors(await handleUploadMembers(request, env, user));
      }
      if (path === '/api/admin/cross-reference' && method === 'GET') {
        return addCors(await handleCrossReference(request, env, user));
      }
      if (path === '/api/admin/revoke-access' && method === 'POST') {
        return addCors(await handleRevokeAccess(request, env, user));
      }
      if (path === '/api/admin/send-invites' && method === 'POST') {
        return addCors(await handleSendInvites(request, env, user));
      }
      if (path === '/api/admin/toggle-member' && method === 'POST') {
        return addCors(await handleToggleMember(request, env, user));
      }
      if (path === '/api/admin/add-member' && method === 'POST') {
        return addCors(await handleAddMember(request, env, user));
      }
      if (path === '/api/admin/users' && method === 'GET') {
        return addCors(await handleListUsers(request, env, user));
      }
      if (path === '/api/admin/delete-user' && method === 'POST') {
        return addCors(await handleDeleteUser(request, env, user));
      }

      // --- Chat ---
      if (path === '/chat' && method === 'POST') {
        return addCors(await handleChat(request, env, user.id));
      }
      if (path === '/chat/conversations' && method === 'GET') {
        return addCors(await handleListConversations(env, user.id));
      }
      if (path.startsWith('/chat/conversations/') && method === 'GET') {
        const convId = path.split('/').pop()!;
        return addCors(await handleGetConversation(env, user.id, convId));
      }

      return addCors(json({ error: 'Not Found' }, 404));
    } catch (error) {
      console.error('Worker error:', error);
      const message = error instanceof Error ? error.message : 'Internal Server Error';
      return addCors(json({ error: message }, 500));
    }
  },
};
