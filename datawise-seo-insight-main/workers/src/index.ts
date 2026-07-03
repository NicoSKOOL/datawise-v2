export interface Env {
  DB: D1Database;
  KV: KVNamespace;
  DFS_CACHE: KVNamespace;
  TASK_ATTACHMENTS: R2Bucket;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  AI: any; // Workers AI binding — env.AI.run(model, { messages })
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  BWT_CLIENT_ID: string;
  BWT_CLIENT_SECRET: string;
  ENCRYPTION_KEY: string;
  FRONTEND_URL: string;
  MARKETING_URL: string;
  WORKER_URL: string;
  ENVIRONMENT: string;
  DATAFORSEO_EMAIL: string;
  DATAFORSEO_PASSWORD: string;
  RESEND_API_KEY: string;
  SKOOL_WEBHOOK_SECRET: string;
  // LLM config (external providers — Workers AI is the free fallback)
  LLM_PROVIDER: string;
  LLM_MODEL: string;
  LLM_BASE_URL: string;
  OPENAI_API_KEY: string;
  ANTHROPIC_API_KEY: string;
  KIMI_API_KEY: string;
  OPENROUTER_API_KEY: string;
}

import { handleGoogleAuth, handleGoogleCallback, handleLogout, handleMe, handleUpdateDefaults } from './auth/google';
import { DataForSeoQuotaError } from './dataforseo/client';
import { handleEmailSignup, handleEmailLogin, handleForgotPassword, handleResetPassword } from './auth/email';
import { handleDevLogin } from './auth/dev';
import { isAllowedFrontendOrigin } from './auth/origins';
import { authMiddleware } from './middleware/auth';
import { recordRequestActivity, pruneAppEvents } from './activity';
import { handleGSCConnect, handleGSCCallback, handleGSCProperties, handleGSCDisconnect, handleGSCPropertyUpdate, handleGSCPropertiesRefresh } from './gsc/oauth';
import { handleBWTConnect, handleBWTCallback, handleBWTProperties, handleBWTPropertiesRefresh, handleBWTDisconnect } from './bwt/oauth';
import { handleGSCSync, handleGSCData, handleGSCQueries, handleGSCSitemaps, syncProperty, purgeDormantGSCData, resyncPurgedProperties } from './gsc/sync';
import { handleChat, handleListConversations, handleGetConversation, handleDeleteConversation, handleRenameConversation } from './chat/handler';
import {
  handleRelatedKeywords, handleKeywordSuggestions, handleKeywordIdeas,
  handleKeywordDifficulty, handleKeywordOverview,
} from './routes/keywords';
import {
  handleRankedKeywords, handleDomainRankOverview, handleKeywordGapAnalysis,
  handleBulkTrafficEstimation, handleCompetitorsDomain, handleGapAnalysisAI,
} from './routes/competitors';
import {
  handleGoogleAIMode, handleChatGPTSearch, handlePerplexitySearch,
  handleClaudeSearch, handleGeminiSearch,
  handlePeopleAlsoAsk, handleLighthouseSEO, handleGeoAnalyzer,
  handleVisibilitySummary, handleVisibilityCheck,
} from './routes/ai';
import {
  handleListProjects, handleCreateProject, handleDeleteProject,
  handleListKeywords, handleAddKeywords, handleDeleteKeyword,
  handleCheckRankings, handleKeywordHistory,
  handleProjectReport, handleDashboardSummary,
  runScheduledRankChecks,
} from './routes/rank-tracking';
import {
  handleListPlannerKeywords, handleAddPlannerKeyword, handleBulkAddPlannerKeywords,
  handleUpdatePlannerKeyword, handleDeletePlannerKeyword,
} from './routes/planner';
import {
  handleListClusters, handleCreateCluster, handleUpdateCluster,
  handleDeleteCluster, handleSetClusterPillar,
} from './routes/planner-clusters';
import {
  handleBusinessSearch, handleCreateLocalProject, handleLinkLocalProjectGBP, handleLocalKeywordDiscovery, handleLocalKeywords,
  handleLocalRankCheck, handleLocalProjectReport, handleLocalPeriodReport,
  handleGBPProfile, handleReviews, handleLocalCompetitors, handleLocalKeywordSuggestions,
  handleResolveGBPUrl,
  handleGeoGridScan, handleGeoGridHistory, handleGeoGridScanDetail, handleGeoGridInsights,
  handleGeoGridCompetitorSeries,
  handleReviewThemes,
} from './routes/local-seo';
import {
  handleFetchPost, handleDiscoverSitemap, handleAnalyzePost, handleRewritePost,
  handleFetchServicePage, handleAnalyzeServicePage, handleGenerateSection,
} from './routes/content-tools';
import {
  handleUploadMembers, handleCrossReference, handleRevokeAccess,
  handleSendInvites, handleToggleMember, handleAddMember, handleListUsers, handleDeleteUser,
  handleListPromoCodes, handleCreatePromoCode, handleTogglePromoCode, handlePromoRedemptions,
  handleConversionAnalytics, handleTrafficAnalytics, handleSignupAnalytics,
} from './routes/admin';
import {
  handleListContentWriterPrompts,
  handleUpdateContentWriterPromptDraft,
  handlePublishContentWriterPrompt,
  handleResetContentWriterPrompt,
  handleRenderContentWriterPrompt,
} from './routes/admin-content-writer-prompts';
import {
  handleActivityOverview, handleActivityFeatures, handleActivityUsers,
  handleActivityFunnel, handleActivityEvents, handleActivityUserDetail,
  handleActivitySummary,
} from './routes/admin-activity';
import { handleRedeemPromo, handlePromoStatus } from './routes/promo';
import {
  handleAggregate, handleCrossAggregate, handleSearch,
  handleTopDomains, handleTopPages, handleKeywordVolume,
} from './routes/llm-mentions';
import {
  handleBacklinksSummary, handleBacklinksTimeseries, handleBacklinksList,
  handleReferringDomains, handleAnchors, handleBacklinksCompetitors,
  handleDomainIntersection, handleBulkRanks,
} from './routes/backlinks';
import {
  handleSubmitFeedback, handleListMyFeedback, handleGetScreenshot,
  handleListAllFeedback, handleUpdateFeedback, handleDeleteFeedback,
  handleRoadmap,
} from './routes/feedback';
import {
  handleListChecklist, handleUpsertChecklist,
  handleListCustom, handleCreateCustom, handleDeleteCustom,
} from './routes/citations';
import {
  handleCreateAudit, handleListAudits, handleGetAudit, handleDeleteAudit,
  handleListActionItems, handleUpdateActionItem, handleDeleteActionItem,
  handleListPropertyTasks, handleCreateTask,
  handleUploadTaskAttachment, handleServeAttachment,
  processSiteAuditQueue,
} from './routes/site-audit';
import { handleMetaCheck, handleFetchSitemap } from './routes/meta-checker';
import {
  handleGetBranding, handleUpdateBranding,
  handleUploadBrandingLogo, handleDeleteBrandingLogo,
} from './routes/branding';
import {
  handleListWorkspaces, handleCreateWorkspace, handleResolveWorkspace, handleGetWorkspace, handleDeleteWorkspace,
  handleGetKBDoc, handleUpdateKBDoc, handleDiscoverWebsitePages, handleAutoDraftKnowledgeBase, handleInterview, handleFinalize,
  handleListPosts, handleCreatePost, handleGetPost, handleUpdatePost, handleDeletePost,
  handlePostStep, handleGenerateSeoMeta,
} from './routes/content-writer';
import { handleMetaRewrite } from './routes/meta-rewrite';
import { handleCreateManualProperty, handleDeleteManualProperty } from './routes/properties';
import { checkAndDeductCredit, creditCostForRoute } from './middleware/credits';
import { processEmailSequences, cancelUserSequences } from './email/sequences';
import { handleSkoolMemberJoined } from './routes/webhooks';
import {
  handleRelatedKeywordsPublic,
  handleKeywordDifficultyPublic,
  handleFanOutQueriesPublic,
  handleBusinessCategoriesPublic,
} from './routes/public-tools';
import { handlePageview, prunePageviews } from './routes/track';
import {
  handleGetAITracking, handleUpdateAISettings, handleAddAIQueries,
  handleDeleteAIQuery, handleRunAICheck, handleAIReport, handleGetAIAnswer,
  runScheduledAIChecks,
} from './routes/ai-tracking';

export default {
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    const auditQueue = await processSiteAuditQueue(env, { batchSize: 5 });
    if (auditQueue.processed || auditQueue.timed_out) {
      console.log(
        `Site audit queue processed: ${auditQueue.processed} processed, ${auditQueue.completed} completed, ${auditQueue.failed} failed, ${auditQueue.timed_out} timed out`
      );
    }

    // Daily GSC re-sync (runs once a day, separate from the 6h email cron).
    if (event.cron === '0 11 * * *') {
      await runDailyGSCSync(env);
      return;
    }

    // Weekly AI visibility tracking run (Monday 06:00 UTC).
    if (event.cron === '0 6 * * 1') {
      await runScheduledAIChecks(env);
      return;
    }

    // Scheduled SERP rank checks for tracked-keyword projects (Tue/Thu/Sat
    // 08:00 UTC). KV key `rank-checks-paused` is the kill switch.
    if (event.cron === '0 8 * * 2,4,6') {
      await runScheduledRankChecks(env);
      return;
    }

    // Default cron (every 6h): email sequences + pageview pruning.
    if (event.cron !== '0 */6 * * *') return;

    const result = await processEmailSequences(env);
    console.log(`Email sequences processed: ${result.sent} sent, ${result.errors} errors`);
    try {
      const pruned = await prunePageviews(env);
      console.log(`Pageviews pruned: ${pruned.deleted}`);
    } catch (err) {
      console.error('prunePageviews failed:', err);
    }
    try {
      const pruned = await pruneAppEvents(env);
      console.log(`App events pruned: ${pruned.deleted}`);
    } catch (err) {
      console.error('pruneAppEvents failed:', err);
    }
    try {
      const purged = await purgeDormantGSCData(env);
      if (purged.properties || purged.rows) {
        console.log(`GSC dormant purge: ${purged.properties} properties, ${purged.rows} rows deleted`);
      }
    } catch (err) {
      console.error('purgeDormantGSCData failed:', err);
    }
  },

  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // Usage/cost telemetry: timestamp the request and remember the authed user so
    // addCors (the universal response finalizer) can log one app_events row per
    // classified action. Logging is fire-and-forget via ctx.waitUntil.
    const startedAtMs = Date.now();
    let loggedUser: Awaited<ReturnType<typeof authMiddleware>> = null;

    // CORS + security headers.
    // Reflect the request Origin when it matches the shared frontend allowlist.
    const requestOrigin = request.headers.get('Origin') || '';
    const isAllowedOrigin = isAllowedFrontendOrigin(requestOrigin, env);

    const corsHeaders: Record<string, string> = {
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Expose-Headers': 'X-Conversation-ID',
      'Vary': 'Origin',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    };
    if (isAllowedOrigin) {
      corsHeaders['Access-Control-Allow-Origin'] = requestOrigin;
    }

    if (method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    // Set by withCredit after a successful deduction so the activity log can
    // attribute the action's credit cost per tool (app_events.credit_cost was
    // otherwise always 0). Recorded for unlimited users too: the column
    // measures what the action costs, not what the free counter consumed.
    let gatedCreditCost = 0;

    const addCors = (response: Response): Response => {
      // Log the action once, after the response is finalized. classifyActivity
      // inside the helper drops unclassified/anonymous routes, so this is cheap.
      if (loggedUser) {
        ctx.waitUntil(recordRequestActivity(env, request, loggedUser, response, startedAtMs, {
          creditCost: gatedCreditCost,
        }));
      }
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
      if (path === '/auth/dev-login' && method === 'POST') {
        return addCors(await handleDevLogin(request, env));
      }

      // Email unsubscribe (public, no auth)
      if (path === '/api/unsubscribe' && method === 'GET') {
        const uid = url.searchParams.get('uid');
        if (uid) {
          await cancelUserSequences(env, uid);
        }
        return new Response(
          '<html><body style="font-family:sans-serif;text-align:center;padding:60px"><h2>Unsubscribed</h2><p>You will no longer receive emails from this sequence.</p></body></html>',
          { status: 200, headers: { 'Content-Type': 'text/html' } }
        );
      }
      if (path === '/health') {
        return addCors(json({ status: 'ok', environment: env.ENVIRONMENT }));
      }

      // Public attachment serve — random keys, no auth
      if (path.startsWith('/api/attachments/') && method === 'GET') {
        const keyParts = path.replace('/api/attachments/', '').split('/');
        return addCors(await handleServeAttachment(env, keyParts));
      }

      // --- Webhooks (Bearer-token auth, no CORS needed) ---
      if (path === '/webhooks/skool-member-joined' && method === 'POST') {
        return await handleSkoolMemberJoined(request, env);
      }
      // GSC callback is a public redirect from Google (uses state param for auth)
      if (path === '/gsc/callback' && method === 'GET') {
        return addCors(await handleGSCCallback(request, env));
      }
      // BWT callback is a public redirect from Bing (uses state param for auth)
      if (path === '/bwt/callback' && method === 'GET') {
        return addCors(await handleBWTCallback(request, env));
      }

      // --- Public free-tools (anonymous, IP-rate-limited, no credits) ---
      // Powers the marketing site's /free-tools section. These run BEFORE
      // authMiddleware so they don't require a session token.
      if (path === '/api/public/related-keywords' && method === 'POST') {
        return addCors(await handleRelatedKeywordsPublic(request, env));
      }
      if (path === '/api/public/keyword-difficulty' && method === 'POST') {
        return addCors(await handleKeywordDifficultyPublic(request, env));
      }
      if (path === '/api/public/fan-out-queries' && method === 'POST') {
        return addCors(await handleFanOutQueriesPublic(request, env));
      }
      if (path === '/api/public/business-categories' && method === 'GET') {
        return addCors(await handleBusinessCategoriesPublic(request, env));
      }

      // Anonymous pageview beacon (public, no auth, bot-filtered, KV-rate-limited).
      if (path === '/api/track/pageview' && method === 'POST') {
        return addCors(await handlePageview(request, env));
      }

      // --- Auth-required routes ---
      const user = await authMiddleware(request, env);
      loggedUser = user;
      if (path === '/auth/logout' && method === 'POST') {
        if (!user) return addCors(json({ error: 'Unauthorized' }, 401));
        return addCors(await handleLogout(request, env));
      }
      if (path === '/auth/me' && method === 'GET') {
        if (!user) return addCors(json({ error: 'Unauthorized' }, 401));
        return addCors(await handleMe(user));
      }
      if (path === '/auth/defaults' && method === 'PATCH') {
        if (!user) return addCors(json({ error: 'Unauthorized' }, 401));
        return addCors(await handleUpdateDefaults(request, env, user));
      }

      // All API routes require auth
      if (!user) return addCors(json({ error: 'Unauthorized' }, 401));

      // --- White-label export branding (auth-required, not credit-gated) ---
      if (path === '/api/branding' && method === 'GET') {
        return addCors(await handleGetBranding(request, env, user.id));
      }
      if (path === '/api/branding' && method === 'PATCH') {
        return addCors(await handleUpdateBranding(request, env, user.id));
      }
      if (path === '/api/branding/logo' && method === 'POST') {
        return addCors(await handleUploadBrandingLogo(request, env, user.id));
      }
      if (path === '/api/branding/logo' && method === 'DELETE') {
        return addCors(await handleDeleteBrandingLogo(env, user.id));
      }

      // --- Promo Codes (auth-required, not credit-gated) ---
      if (path === '/api/promo/redeem' && method === 'POST') {
        return addCors(await handleRedeemPromo(request, env, user.id));
      }
      if (path === '/api/promo/status' && method === 'GET') {
        return addCors(await handlePromoStatus(request, env, user.id));
      }

      // Credit-gated handler: checks and deducts credit(s) before calling the handler.
      // Pass cost explicitly for routes with non-default costs; defaults to 1.
      const withCredit = async (handler: () => Promise<Response>, cost = 1): Promise<Response> => {
        const result = await checkAndDeductCredit(env, user.id, cost);
        if (!result.allowed) {
          return addCors(json({
            error: 'out_of_credits',
            credits_used: result.credits_used,
            credits_limit: result.credits_limit,
          }, 403));
        }
        gatedCreditCost = cost;
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
      if (path === '/api/competitors/gap-analysis-ai' && method === 'POST') {
        return addCors(await handleGapAnalysisAI(request, env));
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
        const domain = url.searchParams.get('domain') || undefined;
        return addCors(await handleDashboardSummary(env, user.id, domain));
      }
      if (path.match(/^\/api\/rank-tracking\/keywords\/[^/]+\/history$/) && method === 'GET') {
        const keywordId = path.split('/')[4];
        return addCors(await handleKeywordHistory(env, user.id, keywordId));
      }

      // --- AI Visibility Tracking (per rank-tracking project) ---
      if (path.match(/^\/api\/rank-tracking\/projects\/[^/]+\/ai$/) && method === 'GET') {
        const projectId = path.split('/')[4];
        return addCors(await handleGetAITracking(env, user.id, projectId));
      }
      if (path.match(/^\/api\/rank-tracking\/projects\/[^/]+\/ai$/) && method === 'PATCH') {
        const projectId = path.split('/')[4];
        return addCors(await handleUpdateAISettings(request, env, user.id, projectId));
      }
      if (path.match(/^\/api\/rank-tracking\/projects\/[^/]+\/ai\/queries$/) && method === 'POST') {
        const projectId = path.split('/')[4];
        return addCors(await handleAddAIQueries(request, env, user.id, projectId));
      }
      if (path.match(/^\/api\/rank-tracking\/ai-queries\/[^/]+$/) && method === 'DELETE') {
        const queryId = path.split('/')[4];
        return addCors(await handleDeleteAIQuery(env, user.id, queryId));
      }
      if (path.match(/^\/api\/rank-tracking\/projects\/[^/]+\/ai\/check$/) && method === 'POST') {
        const projectId = path.split('/')[4];
        return await withCredit(() => handleRunAICheck(env, user.id, projectId));
      }
      if (path.match(/^\/api\/rank-tracking\/projects\/[^/]+\/ai\/report$/) && method === 'GET') {
        const projectId = path.split('/')[4];
        return addCors(await handleAIReport(request, env, user.id, projectId));
      }
      const aiAnswerMatch = path.match(/^\/api\/rank-tracking\/ai\/checks\/(\d+)\/answer$/);
      if (aiAnswerMatch && method === 'GET') {
        return addCors(await handleGetAIAnswer(env, user.id, aiAnswerMatch[1]));
      }

      // --- Content Planner ---
      if (path === '/api/planner/keywords' && method === 'GET') {
        return addCors(await handleListPlannerKeywords(request, env, user.id));
      }
      if (path === '/api/planner/keywords' && method === 'POST') {
        return addCors(await handleAddPlannerKeyword(request, env, user.id));
      }
      if (path === '/api/planner/keywords/bulk' && method === 'POST') {
        return addCors(await handleBulkAddPlannerKeywords(request, env, user.id));
      }
      if (path.match(/^\/api\/planner\/keywords\/[^/]+$/) && method === 'PATCH') {
        const keywordId = path.split('/')[4];
        return addCors(await handleUpdatePlannerKeyword(request, env, user.id, keywordId));
      }
      if (path.match(/^\/api\/planner\/keywords\/[^/]+$/) && method === 'DELETE') {
        const keywordId = path.split('/')[4];
        return addCors(await handleDeletePlannerKeyword(env, user.id, keywordId));
      }
      if (path === '/api/planner/clusters' && method === 'GET') {
        return addCors(await handleListClusters(request, env, user.id));
      }
      if (path === '/api/planner/clusters' && method === 'POST') {
        return addCors(await handleCreateCluster(request, env, user.id));
      }
      if (path.match(/^\/api\/planner\/clusters\/[^/]+$/) && method === 'PATCH') {
        const clusterId = path.split('/')[4];
        return addCors(await handleUpdateCluster(request, env, user.id, clusterId));
      }
      if (path.match(/^\/api\/planner\/clusters\/[^/]+$/) && method === 'DELETE') {
        const clusterId = path.split('/')[4];
        return addCors(await handleDeleteCluster(env, user.id, clusterId));
      }
      if (path.match(/^\/api\/planner\/clusters\/[^/]+\/pillar$/) && method === 'POST') {
        const clusterId = path.split('/')[4];
        return addCors(await handleSetClusterPillar(request, env, user.id, clusterId));
      }

      // --- Local SEO ---
      if (path === '/api/local-seo/business-search' && method === 'POST') {
        return await withCredit(() => handleBusinessSearch(request, env));
      }
      if (path === '/api/local-seo/projects' && method === 'POST') {
        return addCors(await handleCreateLocalProject(request, env, user.id));
      }
      if (path.match(/^\/api\/local-seo\/projects\/[^/]+\/gbp$/) && method === 'PATCH') {
        const projectId = path.split('/')[4];
        return addCors(await handleLinkLocalProjectGBP(request, env, user.id, projectId));
      }
      if (path.match(/^\/api\/local-seo\/projects\/[^/]+\/keyword-discovery$/) && method === 'POST') {
        const projectId = path.split('/')[4];
        return addCors(await handleLocalKeywordDiscovery(env, user.id, projectId));
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
        return await withCredit(() => handleReviews(request, env, user.id));
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
      if (path.match(/^\/api\/local-seo\/projects\/[^/]+\/review-themes$/) && method === 'POST') {
        const projectId = path.split('/')[4];
        return addCors(await handleReviewThemes(request, env, user.id, projectId));
      }
      if (path.match(/^\/api\/local-seo\/projects\/[^/]+\/geogrid-competitors$/) && method === 'GET') {
        const projectId = path.split('/')[4];
        return addCors(await handleGeoGridCompetitorSeries(request, env, user.id, projectId));
      }
      if (path.match(/^\/api\/local-seo\/projects\/[^/]+\/period-report$/) && method === 'GET') {
        const projectId = path.split('/')[4];
        return addCors(await handleLocalPeriodReport(request, env, user.id, projectId));
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
      if (path === '/api/ai/claude-search' && method === 'POST') {
        return await withCredit(() => handleClaudeSearch(request, env));
      }
      if (path === '/api/ai/gemini-search' && method === 'POST') {
        return await withCredit(() => handleGeminiSearch(request, env));
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
        // Returning user whose dormant-account data was purged: repopulate in
        // the background so the dashboard refills without a manual Sync.
        ctx.waitUntil(resyncPurgedProperties(env, user.id));
        return addCors(await handleGSCProperties(env, user.id));
      }
      if (path === '/gsc/properties/refresh' && method === 'POST') {
        return addCors(await handleGSCPropertiesRefresh(env, user.id));
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
      if (path === '/gsc/sitemaps' && method === 'GET') {
        return addCors(await handleGSCSitemaps(request, env, user.id));
      }

      // --- BWT Integration ---
      if (path === '/bwt/connect' && method === 'POST') {
        return addCors(await handleBWTConnect(request, env, user.id));
      }
      if (path === '/bwt/properties' && method === 'GET') {
        return addCors(await handleBWTProperties(env, user.id));
      }
      if (path === '/bwt/properties/refresh' && method === 'POST') {
        return addCors(await handleBWTPropertiesRefresh(env, user.id));
      }
      if (path === '/bwt/disconnect' && method === 'POST') {
        return addCors(await handleBWTDisconnect(env, user.id));
      }

      // Debug: test GSC context building (development only)
      if (path === '/debug/gsc-context' && method === 'GET' && env.ENVIRONMENT === 'development') {
        const propertyId = new URL(request.url).searchParams.get('property_id');
        if (!propertyId) return addCors(json({ error: 'property_id required' }, 400));

        const property = await env.DB.prepare(
          'SELECT site_url FROM gsc_properties WHERE id = ? AND user_id = ?'
        ).bind(propertyId, user.id).first();

        const dataCount = await env.DB.prepare(
          'SELECT COUNT(*) as count FROM gsc_search_data WHERE property_id = ?'
        ).bind(propertyId).first();

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
      if (path === '/api/roadmap' && method === 'GET') {
        return addCors(await handleRoadmap(env));
      }
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
      if (path === '/api/admin/promo-codes' && method === 'GET') {
        return addCors(await handleListPromoCodes(request, env, user));
      }
      if (path === '/api/admin/promo-codes' && method === 'POST') {
        return addCors(await handleCreatePromoCode(request, env, user));
      }
      if (path.match(/^\/api\/admin\/promo-codes\/[^/]+$/) && method === 'PATCH') {
        const codeId = path.split('/')[4];
        return addCors(await handleTogglePromoCode(request, env, user, codeId));
      }
      if (path.match(/^\/api\/admin\/promo-codes\/[^/]+\/redemptions$/) && method === 'GET') {
        const codeId = path.split('/')[4];
        return addCors(await handlePromoRedemptions(request, env, user, codeId));
      }
      if (path === '/api/admin/conversion-analytics' && method === 'GET') {
        return addCors(await handleConversionAnalytics(request, env, user));
      }
      if (path === '/api/admin/analytics/traffic' && method === 'GET') {
        return addCors(await handleTrafficAnalytics(request, env, user));
      }
      if (path === '/api/admin/analytics/signups' && method === 'GET') {
        return addCors(await handleSignupAnalytics(request, env, user));
      }
      if (path === '/api/admin/content-writer-prompts' && method === 'GET') {
        return addCors(await handleListContentWriterPrompts(env, user));
      }
      if (path === '/api/admin/content-writer-prompts/render' && method === 'POST') {
        return addCors(await handleRenderContentWriterPrompt(request, env, user));
      }
      {
        const m = path.match(/^\/api\/admin\/content-writer-prompts\/([^/]+)\/draft$/);
        if (m && method === 'PUT') {
          return addCors(await handleUpdateContentWriterPromptDraft(request, env, user, decodeURIComponent(m[1])));
        }
      }
      {
        const m = path.match(/^\/api\/admin\/content-writer-prompts\/([^/]+)\/publish$/);
        if (m && method === 'POST') {
          return addCors(await handlePublishContentWriterPrompt(env, user, decodeURIComponent(m[1])));
        }
      }
      {
        const m = path.match(/^\/api\/admin\/content-writer-prompts\/([^/]+)\/reset$/);
        if (m && method === 'POST') {
          return addCors(await handleResetContentWriterPrompt(env, user, decodeURIComponent(m[1])));
        }
      }

      // --- Admin: activity dashboard (app_events read side) ---
      if (path === '/api/admin/activity/overview' && method === 'GET') {
        return addCors(await handleActivityOverview(request, env, user));
      }
      if (path === '/api/admin/activity/features' && method === 'GET') {
        return addCors(await handleActivityFeatures(request, env, user));
      }
      if (path === '/api/admin/activity/users' && method === 'GET') {
        return addCors(await handleActivityUsers(request, env, user));
      }
      if (path === '/api/admin/activity/funnel' && method === 'GET') {
        return addCors(await handleActivityFunnel(request, env, user));
      }
      if (path === '/api/admin/activity/events' && method === 'GET') {
        return addCors(await handleActivityEvents(request, env, user));
      }
      if (path === '/api/admin/activity/summary' && method === 'POST') {
        return addCors(await handleActivitySummary(request, env, user));
      }
      {
        const m = path.match(/^\/api\/admin\/activity\/users\/([^/]+)$/);
        if (m && method === 'GET') {
          return addCors(await handleActivityUserDetail(request, env, user, decodeURIComponent(m[1])));
        }
      }

      // --- LLM Mentions (credit-gated) ---
      if (path === '/api/llm-mentions/aggregate' && method === 'POST') {
        return await withCredit(() => handleAggregate(request, env, user.id), creditCostForRoute(path));
      }
      if (path === '/api/llm-mentions/cross-aggregate' && method === 'POST') {
        return await withCredit(() => handleCrossAggregate(request, env, user.id), creditCostForRoute(path));
      }
      if (path === '/api/llm-mentions/search' && method === 'POST') {
        return await withCredit(() => handleSearch(request, env, user.id), creditCostForRoute(path));
      }
      if (path === '/api/llm-mentions/top-domains' && method === 'POST') {
        return await withCredit(() => handleTopDomains(request, env, user.id), creditCostForRoute(path));
      }
      if (path === '/api/llm-mentions/top-pages' && method === 'POST') {
        return await withCredit(() => handleTopPages(request, env, user.id), creditCostForRoute(path));
      }
      if (path === '/api/llm-mentions/keyword-volume' && method === 'POST') {
        return await withCredit(() => handleKeywordVolume(request, env, user.id), creditCostForRoute(path));
      }

      // --- Backlinks (credit-gated) ---
      if (path === '/api/backlinks/summary' && method === 'POST') {
        return await withCredit(() => handleBacklinksSummary(request, env, user.id), creditCostForRoute(path));
      }
      if (path === '/api/backlinks/timeseries' && method === 'POST') {
        return await withCredit(() => handleBacklinksTimeseries(request, env, user.id), creditCostForRoute(path));
      }
      if (path === '/api/backlinks/list' && method === 'POST') {
        return await withCredit(() => handleBacklinksList(request, env, user.id), creditCostForRoute(path));
      }
      if (path === '/api/backlinks/referring-domains' && method === 'POST') {
        return await withCredit(() => handleReferringDomains(request, env, user.id), creditCostForRoute(path));
      }
      if (path === '/api/backlinks/anchors' && method === 'POST') {
        return await withCredit(() => handleAnchors(request, env, user.id), creditCostForRoute(path));
      }
      if (path === '/api/backlinks/competitors' && method === 'POST') {
        return await withCredit(() => handleBacklinksCompetitors(request, env, user.id), creditCostForRoute(path));
      }
      if (path === '/api/backlinks/domain-intersection' && method === 'POST') {
        return await withCredit(() => handleDomainIntersection(request, env, user.id), creditCostForRoute(path));
      }
      if (path === '/api/backlinks/bulk-ranks' && method === 'POST') {
        return await withCredit(() => handleBulkRanks(request, env, user.id), creditCostForRoute(path));
      }

      // --- Local citations checklist (no credit cost — static data + user state) ---
      if (path === '/api/citations/checklist' && method === 'GET') {
        return addCors(await handleListChecklist(env, user));
      }
      if (path === '/api/citations/checklist' && method === 'POST') {
        return addCors(await handleUpsertChecklist(request, env, user));
      }
      if (path === '/api/citations/custom' && method === 'GET') {
        return addCors(await handleListCustom(request, env, user));
      }
      if (path === '/api/citations/custom' && method === 'POST') {
        return addCors(await handleCreateCustom(request, env, user));
      }
      if (path.match(/^\/api\/citations\/custom\/[^/]+$/) && method === 'DELETE') {
        const id = path.split('/')[4];
        return addCors(await handleDeleteCustom(env, user, id));
      }

      // --- Site Audit (7-Day Plan) ---
      if (path === '/api/site-audit/audits' && method === 'POST') {
        return await withCredit(() => handleCreateAudit(request, env, user.id, ctx));
      }
      if (path === '/api/site-audit/audits' && method === 'GET') {
        return addCors(await handleListAudits(env, user.id));
      }
      if (path.match(/^\/api\/site-audit\/audits\/[^/]+$/) && method === 'GET') {
        const auditId = path.split('/')[4];
        return addCors(await handleGetAudit(env, user.id, auditId));
      }
      if (path.match(/^\/api\/site-audit\/audits\/[^/]+$/) && method === 'DELETE') {
        const auditId = path.split('/')[4];
        return addCors(await handleDeleteAudit(env, user.id, auditId));
      }
      if (path.match(/^\/api\/site-audit\/audits\/[^/]+\/action-items$/) && method === 'GET') {
        const auditId = path.split('/')[4];
        return addCors(await handleListActionItems(env, user.id, auditId));
      }
      if (path.match(/^\/api\/site-audit\/properties\/[^/]+\/tasks$/) && method === 'GET') {
        const propertyId = path.split('/')[4];
        return addCors(await handleListPropertyTasks(env, user.id, propertyId, new URL(request.url)));
      }
      if (path === '/api/site-audit/tasks' && method === 'POST') {
        return addCors(await handleCreateTask(request, env, user.id));
      }
      if (path === '/api/site-audit/meta-check' && method === 'POST') {
        return addCors(await handleMetaCheck(request, env));
      }
      if (path === '/api/site-audit/meta-rewrite' && method === 'POST') {
        return await withCredit(() => handleMetaRewrite(request, env));
      }

      // --- Properties (manual / non-GSC websites) ---
      if (path === '/api/properties/manual' && method === 'POST') {
        return addCors(await handleCreateManualProperty(request, env, user.id));
      }
      if (path.match(/^\/api\/properties\/manual\/[^/]+$/) && method === 'DELETE') {
        const propertyId = path.split('/')[4];
        return addCors(await handleDeleteManualProperty(env, user.id, propertyId));
      }
      if (path === '/api/site-audit/fetch-sitemap' && method === 'POST') {
        return addCors(await handleFetchSitemap(request));
      }
      if (path === '/api/site-audit/attachments' && method === 'POST') {
        return addCors(await handleUploadTaskAttachment(request, env, user.id));
      }
      if (path.match(/^\/api\/site-audit\/action-items\/[^/]+$/) && method === 'PATCH') {
        const itemId = path.split('/')[4];
        return addCors(await handleUpdateActionItem(request, env, user.id, itemId));
      }
      if (path.match(/^\/api\/site-audit\/action-items\/[^/]+$/) && method === 'DELETE') {
        const itemId = path.split('/')[4];
        return addCors(await handleDeleteActionItem(env, user.id, itemId));
      }

      // --- Content Writer Builder ---
      if (path === '/api/content-writer/workspaces' && method === 'GET') {
        return addCors(await handleListWorkspaces(env, user.id));
      }
      if (path === '/api/content-writer/workspaces' && method === 'POST') {
        return addCors(await handleCreateWorkspace(request, env, user.id));
      }
      if (path === '/api/content-writer/workspaces/resolve' && method === 'POST') {
        return addCors(await handleResolveWorkspace(request, env, user.id));
      }
      {
        const m = path.match(/^\/api\/content-writer\/workspaces\/([^/]+)$/);
        if (m && method === 'GET') return addCors(await handleGetWorkspace(env, user.id, m[1]));
        if (m && method === 'DELETE') return addCors(await handleDeleteWorkspace(env, user.id, m[1]));
      }
      {
        const m = path.match(/^\/api\/content-writer\/workspaces\/([^/]+)\/kb\/auto-draft$/);
        if (m && method === 'POST') {
          return await withCredit(() => handleAutoDraftKnowledgeBase(request, env, user.id, m[1]), 1);
        }
      }
      {
        const m = path.match(/^\/api\/content-writer\/workspaces\/([^/]+)\/kb\/sitemap\/discover$/);
        if (m && method === 'POST') {
          return await withCredit(() => handleDiscoverWebsitePages(request, env, user.id, m[1]), 1);
        }
      }
      {
        const m = path.match(/^\/api\/content-writer\/workspaces\/([^/]+)\/kb\/([^/]+)$/);
        if (m && method === 'GET') return addCors(await handleGetKBDoc(env, user.id, m[1], m[2]));
        if (m && method === 'PUT') return addCors(await handleUpdateKBDoc(request, env, user.id, m[1], m[2]));
      }
      {
        const m = path.match(/^\/api\/content-writer\/workspaces\/([^/]+)\/kb\/([^/]+)\/interview$/);
        if (m && method === 'POST') {
          return await withCredit(() => handleInterview(request, env, user.id, m[1], m[2]), 1);
        }
      }
      {
        const m = path.match(/^\/api\/content-writer\/workspaces\/([^/]+)\/kb\/([^/]+)\/finalize$/);
        if (m && method === 'POST') {
          return await withCredit(() => handleFinalize(request, env, user.id, m[1], m[2]), 1);
        }
      }
      {
        const m = path.match(/^\/api\/content-writer\/workspaces\/([^/]+)\/posts$/);
        if (m && method === 'GET') return addCors(await handleListPosts(env, user.id, m[1]));
        if (m && method === 'POST') return addCors(await handleCreatePost(request, env, user.id, m[1]));
      }
      {
        const m = path.match(/^\/api\/content-writer\/posts\/([^/]+)$/);
        if (m && method === 'GET') return addCors(await handleGetPost(env, user.id, m[1]));
        if (m && method === 'PUT') return addCors(await handleUpdatePost(request, env, user.id, m[1]));
        if (m && method === 'DELETE') return addCors(await handleDeletePost(env, user.id, m[1]));
      }
      {
        const m = path.match(/^\/api\/content-writer\/posts\/([^/]+)\/step$/);
        if (m && method === 'POST') {
          return await withCredit(() => handlePostStep(request, env, user.id, m[1]), 2);
        }
      }
      {
        const m = path.match(/^\/api\/content-writer\/posts\/([^/]+)\/meta$/);
        if (m && method === 'POST') {
          return await withCredit(() => handleGenerateSeoMeta(request, env, user.id, m[1]), 1);
        }
      }

      // --- Chat ---
      if (path === '/chat' && method === 'POST') {
        return addCors(await handleChat(request, env, user.id));
      }
      if (path === '/chat/conversations' && method === 'GET') {
        return addCors(await handleListConversations(request, env, user.id));
      }
      if (path.startsWith('/chat/conversations/') && method === 'GET') {
        const convId = path.split('/').pop()!;
        return addCors(await handleGetConversation(env, user.id, convId));
      }
      if (path.startsWith('/chat/conversations/') && method === 'PATCH') {
        const convId = path.split('/').pop()!;
        return addCors(await handleRenameConversation(request, env, user.id, convId));
      }
      if (path.startsWith('/chat/conversations/') && method === 'DELETE') {
        const convId = path.split('/').pop()!;
        return addCors(await handleDeleteConversation(env, user.id, convId));
      }

      return addCors(json({ error: 'Not Found' }, 404));
    } catch (error) {
      const requestId = crypto.randomUUID().slice(0, 8);
      console.error(`Worker error [${requestId}]:`, error);
      if (error instanceof DataForSeoQuotaError) {
        const now = new Date();
        const nextUtcMidnight = Date.UTC(
          now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0, 0
        );
        const retryAfterSeconds = Math.max(60, Math.floor((nextUtcMidnight - now.getTime()) / 1000));
        return addCors(json({
          error: 'provider_quota_exhausted',
          provider: 'dataforseo',
          message: 'Our SEO data provider has hit its daily quota. Please try again in a few hours.',
          retry_after_seconds: retryAfterSeconds,
          request_id: requestId,
        }, 503));
      }
      return addCors(json({ error: 'internal_error', request_id: requestId }, 500));
    }
  },
};

// Daily GSC re-sync over enabled properties whose owner has logged in within
// the 30-day session lifetime (a currently-valid session). Properties owned by
// dormant users are skipped: their data is NOT deleted, and the next daily run
// picks them up automatically once they log in again. This avoids rewriting
// 90-day Search Console data that nobody is currently looking at, which is the
// dominant driver of D1 "rows written" cost.
// Skips properties whose refresh token can no longer mint an access token
// (user must reconnect); skipping does not delete the property.
// Processes in small concurrent batches to stay within Worker CPU limits.
async function runDailyGSCSync(env: Env): Promise<void> {
  const startedAt = Date.now();
  // Only re-sync a property if it has not been refreshed in the last few days.
  // Google Search Console data itself lags ~2-3 days, so a daily rewrite of the
  // full 90-day window produced no fresher data while dominating D1 write cost.
  // last_synced_at is set only on a SUCCESSFUL sync, so token-expired properties
  // (which write nothing) stay eligible and are retried each day at ~zero cost.
  // The manual "Sync" button bypasses this and force-refreshes on demand.
  const STALE_AFTER = "-3 days";
  // ORDER BY makes the nightly run self-rotating. The due set (~3,400 props
  // on 2026-06-11) is far larger than one cron window can sync, and without
  // an ORDER BY the same head of the table synced every night while the same
  // tail starved forever: 273 active users' properties were stuck on
  // pre-2026-05-19 data (the single-batchDate format) three weeks after the
  // per-day fix shipped. Oldest-synced first puts last night's survivors at
  // the front tonight; never-synced properties (mostly dormant accounts) go
  // last so they cannot crowd out users who are actually looking at stale
  // dashboards. kind='gsc' excludes manual/bwt rows that can never GSC-sync
  // but were occupying sync slots.
  const props = await env.DB.prepare(
    `SELECT p.id, p.user_id
       FROM gsc_properties p
      WHERE p.is_enabled = 1
        AND p.kind = 'gsc'
        AND (p.last_synced_at IS NULL OR p.last_synced_at < datetime('now', ?))
        AND EXISTS (
          SELECT 1 FROM sessions s
           WHERE s.user_id = p.user_id
             AND s.expires_at > datetime('now')
        )
      ORDER BY (p.last_synced_at IS NULL), p.last_synced_at ASC`
  ).bind(STALE_AFTER).all<{ id: string; user_id: string }>();

  const rows = props.results || [];
  let synced = 0, skipped = 0, failed = 0, processed = 0;
  const concurrency = 4;
  // Scheduled handlers are killed at the 15-minute wall (and the site-audit
  // queue runs first in the same invocation). Stop dispatching in time to
  // finish in-flight syncs and log the summary instead of dying mid-loop.
  const TIME_BUDGET_MS = 10 * 60 * 1000;

  for (let i = 0; i < rows.length; i += concurrency) {
    if (Date.now() - startedAt > TIME_BUDGET_MS) break;
    const batch = rows.slice(i, i + concurrency);
    const results = await Promise.allSettled(
      batch.map(p => syncProperty(env, p.user_id, p.id))
    );
    processed += batch.length;
    for (const r of results) {
      if (r.status === 'fulfilled') {
        if (r.value.ok) synced++;
        else if (r.value.status === 403) skipped++;
        else failed++;
      } else {
        failed++;
        console.error('cron syncProperty rejected:', r.reason);
      }
    }
  }

  console.log(
    `GSC daily sync done (active + due-for-refresh scope): ${synced} synced, ${skipped} skipped (token), ` +
    `${failed} failed, ${processed}/${rows.length} due properties processed, ${Date.now() - startedAt}ms` +
    (processed < rows.length ? ` (time budget reached, ${rows.length - processed} roll to next run)` : '')
  );
}
