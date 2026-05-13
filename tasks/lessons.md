# Lessons Learned

## DataForSEO LLM Mentions traps
- **ChatGPT data is US + English only.** Any call with `platform: 'chat_gpt'` MUST use `location_code: 2840, language_code: 'en'`. Any other combo returns zero rows silently (no error). Never pass through the user's default location/language when platform is chat_gpt — hardcode the override and show a visible notice so users understand why their market setting is ignored. Incident 2026-04-14: Fan-out Queries returned no data for an AU user because `default_location_code=2036` got forwarded unchanged.
- Fan-out queries (`fan_out_queries[]`) populate on ~15% of ChatGPT rows, not all of them. Google AI Overview rows never populate this field.
- Fetch helpers in `src/lib/llm-mentions.ts` and `src/lib/backlinks.ts` must coerce `null` to empty shapes (`{ items: null }`) because DFS's `extractResult()` returns null when there's no task result. Callers use `result.items || []`, which crashes on `null.items`.

## Deploy traps
- **Never name a Vite env override `.env.local`** — Vite loads it in EVERY mode including production builds. Use `.env.development.local` for dev-only overrides. Incident 2026-04-14: a `.env.local` with `VITE_API_URL=http://localhost:8787` (for testing dev-login) got baked into the production bundle, breaking Google sign-in for every user until the site was rebuilt + redeployed without the file.
- Always grep the production bundle for `localhost` before pushing: `grep -o "localhost" dist/assets/index-*.js`
- Do not verify feature preservation with global bundle text alone. For Keyword Research specifically, the production deploy guard must verify `src/pages/KeywordResearch.tsx` renders the `People Also Ask` and `Fan-out Queries` tabs/panels and syncs sidebar `?tab=` links before deploy.

## Architecture
- Project lives in `datawise-seo-insight-main/` subdirectory
- Current frontend: React 18 + Vite + TypeScript + Tailwind + shadcn/ui + Radix
- Current backend: Supabase (auth, edge functions, postgres)
- 23 pages, heavy sidebar with 4 groups of nav items
- Uses `@` path alias for `./src/`

## Content Writer
- Writer format controls (TL;DR, tables, FAQ, Content Capsule percentage) must be rendered through prompt placeholders, not hard-coded into the master/system prompts. Keep `brief_json`, `outline_json.settings`, `WriterPromptContext`, and prompt defaults in sync so admin previews match generation.
