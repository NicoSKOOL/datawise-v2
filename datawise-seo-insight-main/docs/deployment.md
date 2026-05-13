# DataWise Production Deployment Safety

Production deploys must use the `production` branch as the source of truth.
Do not deploy from `main`, temporary worktrees, reconstructed local folders, or a raw `dist` directory.

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

After review, merge the feature branch into `production`, push it, and run the
manual GitHub Actions workflow named `Deploy DataWise Pages Production`.

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
