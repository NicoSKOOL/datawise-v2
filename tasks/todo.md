# DataWise V2 Modernization

## Phase 1: Cloudflare Foundation + Google Auth
- [x] Initialize Workers project structure
- [x] Create wrangler.toml with D1 + KV bindings
- [x] D1 database schema (schema.sql)
- [x] Main worker entry with router (index.ts)
- [x] Google OAuth handlers (auth/google.ts)
- [x] Auth middleware (middleware/auth.ts)
- [x] Frontend AuthContext rewrite (remove Supabase)
- [x] Frontend API client (replaces supabase.functions.invoke)
- [x] New Layout + AppSidebar (5 sections)
- [x] Updated App.tsx routing
- [x] Auth page with Google Sign-In
- [x] ProtectedRoute update
- [ ] Deploy hello-world worker to verify setup
- [ ] Test Google login end-to-end

## Phase 2: GSC + LLM Chat (Hero Feature)
- [ ] GSC OAuth worker routes
- [ ] GSC data sync
- [ ] LLM abstraction layer
- [ ] Chat worker routes
- [ ] SEO Assistant page
- [ ] Tasks page
- [ ] Task CRUD worker routes

## Phase 2b: Local SEO Module
- [x] DB schema: local_rank_history table + seo_projects local columns
- [x] Backend: local-seo.ts route handlers (business search, rank check, report, GBP profile, reviews, competitors)
- [x] Frontend types: local-seo.ts
- [x] Frontend API: lib/local-seo.ts
- [x] Frontend components: CreateLocalProjectDialog, LocalProjectListView, LocalStatsCards, LocalRankTable, GBPProfileCard, ReviewsSection, LocalCompetitorGrid
- [x] Routes wired in index.ts (8 new endpoints)
- [x] Local Pack tab integrated in RankTracking page
- [x] TypeScript + build passing
- [ ] Run DB migration on D1
- [ ] Deploy worker + frontend
- [ ] E2E test: create local project, add keywords, check rankings, verify GBP + reviews + competitors

## Phase 3: DataForSEO Migration
- [ ] DataForSEO client module
- [ ] Keyword API workers
- [ ] Competitor API workers
- [ ] SERP/AI API workers
- [ ] AI Optimization API workers
- [ ] Rank tracking workers
- [ ] Unified KeywordResearch page
- [ ] Unified CompetitorAnalysis page
- [ ] Enhanced AIVisibility page

## Phase 4: Design Refresh
## Phase 5: Payments + Access Control
