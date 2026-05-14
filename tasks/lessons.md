# Lessons Learned

## DataForSEO LLM Mentions traps
- **ChatGPT data is US + English only.** Any call with `platform: 'chat_gpt'` MUST use `location_code: 2840, language_code: 'en'`. Any other combo returns zero rows silently (no error). Never pass through the user's default location/language when platform is chat_gpt — hardcode the override and show a visible notice so users understand why their market setting is ignored. Incident 2026-04-14: Fan-out Queries returned no data for an AU user because `default_location_code=2036` got forwarded unchanged.
- Fan-out queries (`fan_out_queries[]`) populate on ~15% of ChatGPT rows, not all of them. Google AI Overview rows never populate this field.
- Fetch helpers in `src/lib/llm-mentions.ts` and `src/lib/backlinks.ts` must coerce `null` to empty shapes (`{ items: null }`) because DFS's `extractResult()` returns null when there's no task result. Callers use `result.items || []`, which crashes on `null.items`.

## Deploy traps
- **Never name a Vite env override `.env.local`** — Vite loads it in EVERY mode including production builds. Use `.env.development.local` for dev-only overrides. Incident 2026-04-14: a `.env.local` with `VITE_API_URL=http://localhost:8787` (for testing dev-login) got baked into the production bundle, breaking Google sign-in for every user until the site was rebuilt + redeployed without the file.
- Always grep the production bundle for `localhost` before pushing: `grep -o "localhost" dist/assets/index-*.js`
- Do not verify feature preservation with global bundle text alone. For Keyword Research specifically, the production deploy guard must verify `src/pages/KeywordResearch.tsx` renders the `People Also Ask` and `Fan-out Queries` tabs/panels and syncs sidebar `?tab=` links before deploy.
- When adding tabs to Keyword Research, keep the tab list inline-sized (`inline-flex`), not row-filling (`flex`), or the muted tab background stretches across the whole content area. The deploy guard should check this class.
- Dashboard must keep the GSC indexation chart (`Search-visible pages` / `Sitemap-only`) in the main chart row, not the rank-tracking `Position Distribution` chart. The deploy guard should block `RankDistributionChart` in `src/pages/Dashboard.tsx`.
- AI Visibility must keep the newer Brand Tracker surface wired into `/ai-visibility?tab=brand-tracker`. The deploy guard must verify `AIVisibility.tsx` imports `BrandTracker`, renders the `brand-tracker` tab/panel, and syncs tab state with `useTabParam`; sidebar labels alone are not proof the page still renders the feature.
- Site Audit running states should keep the bundled `/loading.lottie` animation visible. When changing async audit copy, avoid exposing implementation phrases such as "browser polling" in user-facing text, and guard both the Lottie loader and forbidden wording before deploy.
- After a Pages deploy, an already-open SPA tab can keep running the old hashed JS bundle even when live HTML points at the new bundle. Keep the deploy refresh guard in `App.tsx`, and if a user is checking immediately after deploy, tell them to hard refresh or open the cache-busted URL before assuming production still has old copy.
- Admin access must bypass the free credit gate in both places: Worker `checkAndDeductCredit` and frontend `AuthContext` credit display. An admin row can still have `subscription_tier='free'` and `credits_used >= 5`, so checking only pro/community status will incorrectly block admin tools.
- Production must be last in the promotion order: build/test locally, deploy and verify a Cloudflare Pages preview or staging URL, then deploy production. Never use `datawiseseo.com` as the first test target.
- Staging-only protected test login makes preview testing practical when Google OAuth is not configured for a preview origin, but the real `STAGING_LOGIN_SECRET` and full test-login URL must never be committed.
- Google OAuth on preview requires the preview origin to be authorized in Google Cloud. If that is not set up, use the protected staging test login instead of weakening auth for production.
- The 2026-05-14 keyword tab-state fix proved the safe promotion flow: verify on `https://preview-1.datawise-118.pages.dev`, then promote only the tested two-file production hotfix from current `production`.
- Production hotfixes should branch from the current `production` commit and include only the verified scope. Do not promote an entire staging/setup branch just because one fix inside it passed.
- After production deploys, verify the live HTML asset hash and inspect the JS bundle for the expected API URL. Open SPA tabs may keep old bundles until refresh.

## Architecture
- Project lives in `datawise-seo-insight-main/` subdirectory
- Current frontend: React 18 + Vite + TypeScript + Tailwind + shadcn/ui + Radix
- Current backend: Supabase (auth, edge functions, postgres)
- 23 pages, heavy sidebar with 4 groups of nav items
- Uses `@` path alias for `./src/`

## Content Writer
- Writer format controls (TL;DR, tables, FAQ, Content Capsule percentage) must be rendered through prompt placeholders, not hard-coded into the master/system prompts. Keep `brief_json`, `outline_json.settings`, `WriterPromptContext`, and prompt defaults in sync so admin previews match generation.
