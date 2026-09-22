# Bing Webmaster Tools integration: status

**Status: parked (2026-09-22).** Do not build Phase 2 until the blocker below is solved.

## Blocker: Bing throttles Cloudflare's IP addresses

Every Bing Webmaster API call made from the `datawise-api` Worker returns:

```
HTTP 400 {"ErrorCode":17,"Message":"ERROR!!! ThrottleIP"}
```

Tested 2026-09-22 with a freshly connected, valid OAuth token: 4 of 4 calls to `GetUserSites` failed over 30 seconds. The same endpoint called from a non-Cloudflare IP gets past the throttle to the auth check (`ErrorCode 3 InvalidApiKey` with no auth, `ErrorCode 18 InvalidToken` with a bad token). Bing is refusing Cloudflare's shared egress addresses, not DataWise or the user's permission. The OAuth connect itself works.

User-visible effect: Settings shows "Connected" with no Bing sites (37 users as of 2026-09-22). One reporter says his site used to be listed, so the throttling may be recent or intermittent. Re-test once before paying for a fix.

### Options

| Option | Fixes it? | Notes |
|---|---|---|
| Relay with a fixed IP outside Cloudflare (Fly.io, Railway, Hetzner; about $5/month) | Yes | Recommended. Secret-locked, forwards only to `ssl.bing.com`. Prove it with one `GetUserSites` call before building Phase 2. |
| Cloudflare dedicated egress IPs | Yes | Enterprise add-on, expensive. |
| "Bing temporarily unavailable" message | No | Honest UX only. |

## Shipped

- **Phase 1A** (PR #160, tag `prod-2026-09-22-2027`). The Bing site sync no longer turns Search Console properties into `kind='bwt'`. Disconnect Bing deletes only never-synced Bing rows that no data references. 88 flipped properties were restored to `kind='gsc'`, with every piece of attached data verified intact; the backup is D1 table `bwt_flip_repair_20260922` and the undo is in `DEPLOY.md`.

## Decided design (Phase 2, not built)

- Bing data lives in its **own table**. Google queries are never touched, and "Combined" is computed at read time.
- Combined sums clicks and impressions. It recomputes CTR as clicks over impressions and position as the impression-weighted average (same math as `workers/src/gsc/metrics-sql.ts`).
- A toggle for **Google / Bing / Combined** on the dashboard charts and the query and page tables. It **opens on Google** every time.
- Keep Bing storage lean (daily totals plus 90-day query and page aggregates): D1 is at about 7 of 10 GB.

## Phase 1B (not built, still valid)

- A `bwt_sites` table for the Bing site list.
- Hide the 699 duplicate, never-synced `kind='bwt'` rows from the site picker. Keep the few with planner, writer or chat data attached.
- `missing_state` on connect: Bing does not always echo `state`. Planned fallback: a SameSite=Lax cookie set on a top-level `/bwt/start` navigation.
- `/bwt/properties` reports "connected" even when the token can no longer refresh.
- Show Bing's error instead of a silent empty list.

Work in progress is on branch `fix/bwt-phase1b`: the OAuth token is sent only in the `Authorization` header (the old code also put it in `?apikey=`), and `/bwt/properties/refresh` returns Bing's error.

## Testing notes

- The Bing app has `https://staging-datawise-api.nico-510.workers.dev/bwt/callback` registered, so connect can be tested on staging (the Worker preview version).
- `wrangler tail` does not show preview-version traffic. Diagnose previews by returning errors in the response.

## Waiting reporters

Axel `7c631c2e` (duplicates), Riccardo `16e7e5a9` (`missing_state`), Gregg `96659d44` (connected, no sites), Matt `f7fa343f` (no data), Yalilee `48a8fef1` (feature request).
