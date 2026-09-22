# DataWise MCP: GBP profile + site pages for any business

Date: 2026-09-22
Status: approved in conversation, awaiting Nico's review of this document
Branch: to be created off `production`

## 1. Goal

A member connects the DataWise MCP in claude.ai, ChatGPT or Claude Code, pastes a
Google Maps link and a website URL, and asks for a Google Business Profile (GBP)
audit plus a GBP-to-website alignment check. The MCP supplies data. The client model
does the analysis.

Two tools are added. Both are read-only and work for any business, not only
businesses the member tracks as a DataWise project.

- `datawise_gbp_profile`: everything DataForSEO knows about a profile, plus a review
  sample and recent Google posts, from one identifier.
- `datawise_site_pages`: the website's relevant pages as structured data, from one
  URL.

Member-facing prompt the design must support end to end:

> Audit this business with DataWise: GBP <maps link>, website <url>. Check profile
> completeness, NAP consistency, hours, categories versus services on the site, and
> reviews.

## 2. Non-goals

- No audit scoring or fix text inside the tools. The existing project-scoped
  `datawise_gbp_audit` keeps its six checks; these tools return data only.
- No owner-side GBP data (products, post insights, messaging, service descriptions
  that are hidden from the public profile). DataForSEO cannot read it. That is the
  future GBP API OAuth integration ([[project_gbp_integration_plan]]). The public
  services list IS returned by `my_business_info` and is included.
- No SPA changes. The app's GBP card keeps reading the fields it uses today.
- No change to access rules, rate limits or the $4/day budget model.

## 3. Tool 1: `datawise_gbp_profile`

### 3.1 Input

```
gbp: string (required)
  A Google Maps link (google.com/maps/place/..., maps.app.goo.gl/..., goo.gl/maps/...),
  a place_id (starts with ChIJ), a CID (digits only, or cid:digits),
  or "business name, city".
include_reviews: boolean, default true
reviews_depth: 10 | 20 | 50, default 20
include_posts: boolean, default true
response_format: concise | detailed, default concise
```

No location or language codes. They are inferred (section 3.3).

### 3.2 Identifier detection

Applied in order to the trimmed `gbp` string:

1. Contains `maps.app.goo.gl`, `goo.gl/maps`, or `google.` + `/maps` → Maps URL. Resolved
   with the existing `handleResolveGBPUrl` logic in `workers/src/routes/local-seo.ts`
   (follows short-link redirects, reads `ftid`, the `!1s0x...:0x...` data token, and
   `place_id`). The resolver is refactored so its URL-to-identifier step is an exported
   pure function `parseMapsUrl(url, fetchImpl)` that the route and the tool both call.
2. Matches `^cid:?\d{10,25}$` → CID.
3. Matches `^ChIJ[A-Za-z0-9_-]{10,}$` → place_id.
4. Otherwise → name search. The string is passed whole to DataForSEO Maps SERP
   (`/serp/google/maps/live/advanced`, depth 10) at the account default location.
   Google resolves "Joe's Plumbing, Melbourne" correctly from the keyword alone, so no
   location parsing is attempted.

### 3.3 Candidate handling for name search

- If exactly one `maps_search` item is returned, or the first item's title contains
  every word of the name part, use it.
- Otherwise return `candidates` (up to 5: title, address, category, rating,
  reviews_count, website, place_id, cid) with `profile: null` and a summary line
  telling the model to call again with the chosen `place_id`. No DataForSEO
  `my_business_info` call is spent on an ambiguous match.

### 3.4 Profile fetch

`/business_data/google/my_business_info/live` with `keyword` = `place_id:<id>` or
`cid:<id>`, through `dataforseoRequestCached` with the existing 24h TTL. Location and
language for the call: the account default on the first attempt. After the profile
returns, if the address country differs from the default location's country, the tool
does not refetch (the profile is the same); it only records `inferred_location_code`
for the reviews and posts calls, using a small country-name → DataForSEO location
code map (US 2840, GB 2826, CA 2124, AU 2036, ES 2724, MX 2484, IE 2372, NZ 2554,
DE 2276, FR 2250; anything else falls back to the account default).

Fallback when `my_business_info` returns no title: the Maps SERP search by name,
matching `place_id` or `cid` when known (existing behaviour in `handleGBPProfile`).

### 3.5 Full profile shape

`normalizeGbpProfile(item)` in a new file `workers/src/routes/local-seo/gbp-profile.ts`
(pure, unit-tested) maps the DataForSEO item to:

```
identity:      title, place_id, cid, feature_id, is_claimed, is_directory_item
address:       full, street, city, region, postcode, country, latitude, longitude
contact:       phone, website, contact_url, book_online_url, menu_url, order_url,
               reservation_url, contributor_url
categories:    primary, additional[]
description:   text, length
hours:         { monday: [{open, close}], ... }, timezone if present, special_hours[]
attributes:    available[] ({group, name}), unavailable[] ({group, name})
media:         total_photos, logo_url, main_image_url
reputation:    rating, reviews_count, rating_distribution {1..5}, questions_count
services:      [] of { category, title, description, price } (the public services list)
links:         local_business_links[] ({ type, title, url }) for menus, ordering, delivery
signals:       price_level, place_topics[] (topic + count), people_also_search[]
               ({title, rating, reviews_count, cid}), popular_times (detailed only)
raw_keys:      list of item keys not mapped above (so nothing is silently lost)
```

The tool calls `dataforseoRequestCached` for `my_business_info` directly (24h TTL, the
client's own KV cache, shared with the SPA when the request body matches) and runs
`normalizeGbpProfile` on `pickMyBusinessInfo(data)`. `handleGBPProfile` and the SPA
card are not touched.

### 3.6 Reviews

Reuses the reviews task flow already in `handleGetReviews` (`local-seo.ts`, task_post
then polling task_get). Refactored into `fetchGoogleReviews(env, { keyword, depth,
location_code, language_code })` used by both the route and the tool. Output per review:
rating, text, date, owner_reply, owner_reply_date, author. Plus `reply_rate_pct`,
`avg_days_to_reply` when computable, and `service_mentions_hint`: the 15 most frequent
nouns of 4+ letters across review text (cheap, no LLM) so the model has a starting point
for "services customers mention".

On timeout or DataForSEO error: `reviews: null`, `reviews_error: <message>`. The rest
of the response still returns.

### 3.7 Posts

New DataForSEO call to `my_business_updates` (async only: `task_post` then poll
`task_get`, same pattern as reviews, depth 10). Output per post: date, text, url,
image_url, links[]. Plus `posts_count`, `last_post_date`, `days_since_last_post`. Same
null + error pattern on failure. KV-cached 24h.

### 3.8 Output

```
{
  resolved_from: 'maps_url' | 'place_id' | 'cid' | 'name_search',
  candidates?: [...],
  profile: <section 3.5> | null,
  reviews: {...} | null, reviews_error?,
  posts: {...} | null, posts_error?,
  inferred_location_code, language_code,
  fetched_at
}
```

Summary line: "<title>, <category>, <rating> stars from <n> reviews, <k> attributes,
<p> posts, last post <d> days ago." The `compact()` shaping applies (`CONCISE` 25 items
/ 300 chars, `DETAILED` 100 / 2000). Review text is capped at 600 chars each in both
modes so a 50-review sample stays under ~12k tokens.

### 3.9 Cost

`estimateCostUsd` gets: `0.006 + (include_reviews ? 0.001 * reviews_depth : 0) +
(include_posts ? 0.01 : 0)`. Default call ≈ $0.036 pre-check. Actual cost from the
DataForSEO response is recorded by the existing `dfsMeter`. Profile is KV-cached 24h;
reviews and posts are KV-cached 24h keyed by identifier + depth.

## 4. Tool 2: `datawise_site_pages`

### 4.1 Input

```
url: string (required)   Any URL on the site. Reduced to scheme + host.
urls: string[] optional  Explicit pages to include (max 25). Always fetched first.
max_pages: int 1..25, default 15
response_format: concise | detailed, default concise
```

### 4.2 Discovery

1. Direct Worker `fetch` (free) of `/robots.txt`; collect `Sitemap:` lines. Default to
   `/sitemap.xml` and `/sitemap_index.xml`. Follow one level of sitemap index. Cap at
   500 URLs read. 5s timeout per fetch.
2. Homepage through the same page fetcher as every other page (section 4.3). Collect
   internal link URLs and anchors from its nav, header and footer. This also becomes
   page 1 of the result.
3. Merge and deduplicate (strip fragments, trailing slashes, utm params; same-host
   only; drop `.pdf`, `.jpg`, feeds, `/wp-json`, `/tag/`, `/category/`, `/page/N`).
4. Score each URL. Highest first:
   - homepage: 100
   - path or anchor matches contact|contact-us|about|about-us: 90
   - matches service|services|what-we-do|treatments|repairs|pricing|prices|menu: 80
   - matches location|locations|areas|service-area|near: 70
   - depth-1 pages linked from the homepage navigation: 60
   - everything else from the sitemap: 10, with blog-looking paths (blog|news|post|
     article|20\d\d) at 5
5. Take explicit `urls` first, then by score until `max_pages`.

The scoring lives in a pure function `rankSiteUrls(candidates, { host })` with unit
tests.

### 4.3 Extraction per page

Primary: a direct Worker `fetch` of the page (free, 8s timeout, browser-like
User-Agent). DataForSEO instant pages does not return page text or raw HTML in the
live response (raw HTML needs a second call), so it is not used. Fallback when the
direct fetch fails, returns 403/429/5xx, or trips the bot-challenge detector:
DataForSEO `/on_page/content_parsing/live` (the call Blueprint already makes in
`workers/src/blueprint/providers/dataforseo/content-parsing.ts`), which yields
headings and text blocks but no JSON-LD. Up to 5 concurrent. A pure
`extractPageFacts(html, url, statusCode)` produces:

```
url, status_code, source: 'direct' | 'dataforseo', blocked: boolean, fetched_at
title, meta_description, canonical
headings: { h1[], h2[], h3[] }
phones[]         from tel: links and E.164 / national number patterns in text
addresses[]      lines matching street-number + street + (city|postcode) patterns,
                 plus schema address objects
hours_text[]     lines containing day names and time ranges
schema[]         every JSON-LD block, filtered to @type in LocalBusiness and its
                 subtypes, Organization, Service, Product, FAQPage, BreadcrumbList,
                 OpeningHoursSpecification (raw object, trimmed)
nav_links[]      { anchor, url } internal links found in <nav>, <header>, <footer>
service_terms[]  H1/H2/H3 text plus nav anchors, deduplicated: the cheapest "what
                 services does this page claim" signal
word_count
body_text        plain text, 3,000 chars concise / 8,000 detailed
```

`blocked` uses `detectBotChallenge` from `workers/src/blueprint/domain/bot-challenge.ts`.
Blocked pages return with `body_text: null` and are listed in `blocked_urls`.

### 4.4 Output

```
{
  site: { url, host, sitemap_found, pages_discovered, pages_returned },
  pages: [ ...section 4.3, ordered by score ],
  blocked_urls[], skipped_urls_count,
  site_facts: {                     // rolled up across pages so the model has one place
    phones: [{ value, pages: n }],   // to compare against the GBP
    addresses: [{ value, pages: n }],
    local_business_schema: <first LocalBusiness block found> | null,
    hours_from_schema: ... | null
  },
  fetched_at
}
```

Summary line: "<host>: <n> pages (<k> service/location, <b> blocked), <p> phone(s),
<a> address(es), LocalBusiness schema <yes|no>."

Cached in KV 24h per host + sorted page set, so re-running the audit the same day costs
nothing.

### 4.5 Cost

`estimateCostUsd`: `0.002 * min(25, max_pages + urls.length)`. Actual from DataForSEO,
which is $0 for every page the direct fetch handled. The homepage counts as one page.

### 4.6 Runtime

Worst case 25 page fetches at 5 concurrent, ~1 to 3s each direct or ~5s via
DataForSEO, plus sitemap fetches: about 15 to 30s wall time. Within the Worker's limits
and the MCP clients' timeouts (claude.ai tolerates 60s+). A page that exceeds 8s on both
paths is dropped and counted in `skipped_urls_count` rather than failing the call.

## 5. Registry, docs, guard

- `workers/src/mcp/tools/registry.ts`: append `gbpProfile`, `sitePages` as positions 15
  and 16. Do not reorder.
- `estimateCostUsd` in `workers/src/mcp/budget.ts`: two new cases.
- Tool descriptions state cost, what to pass, and that the model should call
  `datawise_gbp_profile` first, then `datawise_site_pages`, then compare.
- Settings card copy, community guide (`~/Desktop/DataWise-MCP-Community-Guide.md`),
  and the `/features/mcp` marketing draft say sixteen tools.
- No deploy-guard change: the guard covers the SPA bundle, not the MCP worker.

## 6. Error handling

| Case | Behaviour |
|---|---|
| `gbp` unparseable / business not found | `toolError` with what was tried |
| Ambiguous name | `candidates`, no profile, no cost beyond one Maps SERP |
| Reviews or posts fail | field null + `<field>_error`, profile still returned |
| Site unreachable | `toolError` after homepage + sitemap both fail |
| Some pages blocked/timeout | returned in `blocked_urls` / `skipped_urls_count` |
| Budget exceeded | existing pre-check message, unchanged |

## 7. Testing

- Unit: `parseMapsUrl` (long URL with data token, `ftid`, short link redirect via
  injected fetch, plain place_id, plain CID, name string), `normalizeGbpProfile`
  against a real `my_business_info` fixture (raw_keys empty for the fixture), reviews
  reply-rate maths, `rankSiteUrls` ordering, `extractPageFacts` against fixture HTML
  with JSON-LD, tel: links and a challenge stub.
- Tool tests assert the exact DataForSEO request bodies for profile, Maps search,
  posts task_post and content_parsing, and the exact body passed to `handleReviews`
  (lesson from the `datawise_ai_mentions` bug: never assert against a guessed shape).
- Registry test: 16 tools, first 14 names and order unchanged.
- Live verification after `npm run deploy:mcp`: temporary `dwmcp_` token, call both tools
  for one known business, then run the member prompt in claude.ai and confirm Claude
  produces NAP, hours, categories-vs-services and reviews sections without asking for
  more input. Retry once after ~1 minute if the first call hits the old version.

## 8. Rollout

Standard: PR into `production`, CI deploys Pages (no SPA change, harmless),
`npm run deploy:mcp` from a clean `production` checkout (or a detached
`origin/production` checkout if the worktree holds `production`, see
[[project_mcp_server]]), tag `prod-<date>`. No D1 migration. No new secrets.
