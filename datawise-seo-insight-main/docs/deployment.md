# DataWise Production Deployment Safety

Production deploys must use the `production` branch as the source of truth.
Do not deploy from `main`, temporary worktrees, reconstructed local folders, or a raw `dist` directory.

Production is last in the promotion order:

1. Build and test locally.
2. Deploy and verify a Cloudflare Pages preview/staging URL.
3. Deploy production last.

Never use `https://datawiseseo.com` as the first test target for a change.

## Current Rollback Target

- Deployment ID: `079cdbe3-cef8-4df0-b7ed-c429f4f27c55`
- Deployment URL: `https://079cdbe3.datawise-118.pages.dev`
- Custom domain: `https://datawiseseo.com`

## Required Production Markers

Every production build must include:

- `/content-writer`
- `Content Writer`
- `People Also Ask`
- `Fan-out Queries`
- `Content Planner`
- `Content Tools`
- `https://datawise-api.nico-510.workers.dev`

Every production build must exclude:

- `http://localhost:8787`

## Standard Flow

Run feature work from a branch created off `production`.

```sh
git switch production
git pull origin production
git switch -c codex/<feature-name>
```

Check the deployable bundle:

```sh
cd datawise-seo-insight-main
npm run deploy:pages:check
```

Open a PR into `production`. The preview workflow deploys a Cloudflare Pages
preview URL for the PR after the guard passes. Verify that preview URL before
merging.

The preview and production workflows require a GitHub repo secret named
`CLOUDFLARE_API_TOKEN`. It must be a Cloudflare API token that can deploy the
`datawise` Pages project.

The API Worker must allow Cloudflare Pages preview origins matching
`https://*.datawise-118.pages.dev`; otherwise preview builds can load while
browser API calls are blocked by CORS.

For day-to-day preview testing, use the staging-only protected test login
instead of Google OAuth. It requires a staging Worker with
`ENVIRONMENT=staging` and `STAGING_LOGIN_SECRET` configured, then visit
`/auth/test-login#token=<secret>` on the preview site.

Preview Pages builds use `VITE_API_URL=https://datawise-api-staging.nico-510.workers.dev`;
production Pages builds use `VITE_API_URL=https://datawise-api.nico-510.workers.dev`.

After preview verification and review, merge the feature branch into
`production`, push it, and run the manual GitHub Actions workflow named
`Deploy DataWise Pages Production`. The production workflow requires typing
`PREVIEW_VERIFIED` to confirm production is not being used as the first test
target.

## Local Emergency Rollback

If a bad deployment reaches production, redeploy the rollback target archive or
use Cloudflare Pages deployment history to restore `079cdbe3`.

Then verify:

```sh
curl -s -o /dev/null -w "%{http_code}\n" https://datawiseseo.com/
curl -s -o /dev/null -w "%{http_code}\n" https://datawiseseo.com/auth
curl -s -o /dev/null -w "%{http_code}\n" https://datawiseseo.com/content-writer
curl -s -o /dev/null -w "%{http_code}\n" https://datawiseseo.com/keyword-research
curl -s -X POST https://datawise-api.nico-510.workers.dev/auth/google \
  -H "Origin: https://datawiseseo.com" \
  -H "content-type: application/json" \
  -d "{}"
```
