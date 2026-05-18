# How we publish DataWise (plain English)

This is the non-technical guide to changing the live app at
**datawiseseo.com** without ever losing features. If you read nothing else,
read "The one rule" and "Why the app used to revert".

---

## Why the app used to "revert and lose features"

Publishing this app is **a full replacement, not a patch**. Every publish
throws away the entire live app and puts in its place whatever copy was used
to build it.

So if someone fixed one bug on an **old copy** of the app (made weeks ago,
before some features existed) and published it, they did not push "just the
bug fix". They replaced the whole live app with that old copy. Everything
added since then disappeared.

It looked like a bug fix broke the app. It didn't. An old copy was published.

**The cure: never build from an old copy, and always fold every finished
change back into the one official copy so the next change builds on top of
it.**

---

## The one rule

> We never publish a copy that didn't start as a fresh pull of what is live
> right now, and every finished change is folded back into `production`
> before the next change begins.

`production` is the single official copy. The live site is always an exact
mirror of it. Nothing is live unless it went through `production`.

---

## The three safety layers

1. **Always start from live.** Before any change, big or small, we refresh
   the official copy and branch off it. One command does this:
   `scripts/start-change.sh fix/short-name`. This alone removes the
   "lost features" problem.
2. **Staging, try before you replace.** A permanent test site at
   **https://staging.datawise-118.pages.dev** runs the proposed change for real
   (against the live API and data) so it can be clicked through and approved
   before the live site is touched. If it's wrong, the live site never saw it.
3. **The automatic guard.** Right before anything is published, an automatic
   checklist confirms the new version still contains every major feature
   (Content Writer, AI Visibility, Brand Tracker, People Also Ask, Fan-out
   Queries, Content Planner, Content Tools, keyword badges, the dashboard
   chart, admin-unlimited credits, and more). If anything is missing, or a
   known-stale marker is present, it **refuses to publish**. Staging runs
   the exact same checklist, so problems surface before production.

The only way to bypass the guard is the raw `wrangler pages deploy` command.
**Never use it.** Using it from an old copy is what caused the May 2026
outage.

---

## The two workflows

### A) New feature (test on staging first)

1. `scripts/start-change.sh feat/short-name`
2. Build the feature, commit, push, open a Pull Request into `production`.
3. Push the branch to `staging` (or run the "Deploy DataWise Pages Staging"
   workflow on your branch). Open https://staging.datawise-118.pages.dev and
   try it.
4. When it's right: merge the PR into `production`.
5. Production publishes from `production` (see "Publishing", below).

### B) Quick bug fix on the live app

Same backbone, just faster. The important part is step 1: starting from
the *current* live copy is what carries every existing feature forward.

1. `scripts/start-change.sh fix/short-name`
2. Make the small fix, commit, push, open a PR into `production`.
3. (Recommended even for one-liners) push to `staging` and eyeball it at
   https://staging.datawise-118.pages.dev (at minimum, the guard runs).
4. Merge the PR into `production`. **`production` now contains the fix, so it
   is the new source of truth. The next change starts from here.**

That last sentence is the whole point: because the fix is folded back into
`production`, it can never be silently lost by the next change.

---

## Publishing

Production builds happen **on GitHub**, from the `production` branch itself,
never from a laptop. That is what structurally prevents a stale local copy
from ever reaching the live site.

- **Frontend (the app at datawiseseo.com):** the "Deploy DataWise Pages
  Production" GitHub workflow checks out `production`, runs the guard, and
  publishes. Trigger it after a PR is merged into `production`.
- **Staging:** push to the `staging` branch, or run the "Deploy DataWise
  Pages Staging" workflow. Result appears at
  https://staging.datawise-118.pages.dev.
- **API (the Worker):** separate and independent. Deployed from
  `datawise-seo-insight-main/workers/` with `npm run deploy`. Most app fixes
  are frontend-only and do not need an API deploy.

If you ever must publish from a laptop instead of GitHub: only
`npm run deploy:pages:production`, only from a clean `production` checkout
that is fully caught up with GitHub. Never the raw `wrangler` command.

---

## Rollback

Every publish archives the exact build it shipped, and the live host keeps
the last good deployment. If a publish is bad, the previous deployment can
be restored from the Cloudflare Pages dashboard (or by re-publishing the
archived build). Because `production` always holds the real source of truth,
the safest recovery is usually: fix forward on a fresh branch off
`production` and publish again.

---

## What never to do

- Never publish from an old or behind copy. Always `scripts/start-change.sh`.
- Never use raw `wrangler pages deploy`. It skips every safety check.
- Never publish straight to the live site without seeing it on staging.
- Never fix a bug and forget to merge it into `production`. That's how a
  fixed bug comes back later.
