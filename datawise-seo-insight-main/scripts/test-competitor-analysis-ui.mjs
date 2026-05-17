#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(scriptDir, '..');

async function source(relativePath) {
  return readFile(path.join(appRoot, relativePath), 'utf8');
}

function includes(haystack, needle, label) {
  assert.equal(haystack.includes(needle), true, `${label} missing: ${needle}`);
}

const competitorPage = await source('src/pages/CompetitorAnalysis.tsx');
includes(competitorPage, "import { useSearchParams } from 'react-router-dom';", 'Competitor tab URL sync');
includes(competitorPage, '<Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">', 'Competitor controlled tabs');
includes(competitorPage, 'inline-flex h-auto max-w-full flex-wrap justify-start', 'Competitor compact tab list');

for (const tab of ['domain-rank', 'ranked-keywords', 'gap-analysis', 'traffic', 'competitors']) {
  includes(
    competitorPage,
    `<TabsContent forceMount value="${tab}" className="mt-6">`,
    `Competitor tab ${tab} preserves mounted state`,
  );
}

const trafficPage = await source('src/pages/BulkTrafficEstimation.tsx');
includes(trafficPage, 'metricMode="traffic-estimation"', 'Traffic table metric definitions');

const dataTable = await source('src/components/DataTable.tsx');
includes(dataTable, "'traffic-estimation'", 'DataTable traffic metric mode');
includes(dataTable, 'TrafficMetricLabel', 'DataTable traffic metric labels');

const trafficMetrics = await source('src/lib/traffic-metrics.ts');
for (const metric of ['organic_etv', 'organic_count', 'paid_etv', 'paid_count', 'total_count']) {
  includes(trafficMetrics, metric, `Traffic metric definition for ${metric}`);
}

const domainRankPage = await source('src/pages/DomainRankOverview.tsx');
includes(domainRankPage, 'WRITER_PROMPT_SECONDARY_COLORS', 'Domain rank Writer Prompts palette');
for (const color of ['#38bdf8', '#22d3ee', '#2dd4bf', '#818cf8', '#34d399']) {
  includes(domainRankPage, color, `Domain rank chart color ${color}`);
}

const competitorsRoute = await source('workers/src/routes/competitors.ts');
includes(competitorsRoute, 'function normalizeGapKeyword', 'Keyword gap normalized matching');
includes(competitorsRoute, 'const normalized = normalizeGapKeyword(kw);', 'Keyword gap normalized keyword key');
includes(competitorsRoute, 'map.set(normalized,', 'Keyword gap uses normalized map key');

const workerIndex = await source('workers/src/index.ts');
includes(workerIndex, 'isAllowedFrontendOrigin(requestOrigin, env)', 'Worker shared frontend-origin CORS allowlist');

const googleAuth = await source('workers/src/auth/google.ts');
includes(googleAuth, 'oauth_frontend_origin:', 'Google OAuth preview origin state');
includes(googleAuth, 'getAllowedFrontendOrigin', 'Google OAuth allowed callback destination');

const authOrigins = await source('workers/src/auth/origins.ts');
includes(authOrigins, 'datawise-118\\.pages\\.dev', 'DataWise Cloudflare Pages preview origin allowlist');

console.log('Competitor analysis UI regression checks passed.');
