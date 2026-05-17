import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadTs(file, mocks, cache = new Map()) {
  const abs = path.resolve(root, file);
  if (cache.has(abs)) return cache.get(abs).exports;

  const source = fs.readFileSync(abs, 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
      isolatedModules: false,
    },
    fileName: abs,
  });

  const mod = { exports: {} };
  cache.set(abs, mod);
  const dirname = path.dirname(abs);
  const localRequire = (specifier) => {
    if (mocks[specifier]) return mocks[specifier];
    if (specifier.startsWith('.')) {
      const target = path.resolve(dirname, specifier) + '.ts';
      return loadTs(path.relative(root, target), mocks, cache);
    }
    return require(specifier);
  };

  const wrapped = new vm.Script(
    `(function(require, module, exports, __dirname, __filename) { ${outputText}\n })`,
    { filename: abs }
  ).runInThisContext();
  wrapped(localRequire, mod, mod.exports, dirname, abs);
  return mod.exports;
}

function minutesAgo(minutes) {
  return new Date(Date.now() - minutes * 60_000).toISOString().slice(0, 19).replace('T', ' ');
}

class FakeStatement {
  constructor(db, sql, params = []) {
    this.db = db;
    this.sql = sql;
    this.params = params;
  }

  bind(...params) {
    return new FakeStatement(this.db, this.sql, params);
  }

  async all() {
    const sql = this.sql;
    if (sql.includes("created_at < datetime('now', '-45 minutes')")) {
      return {
        results: this.db.audits.filter((audit) =>
          ['pending', 'running', 'analyzing'].includes(audit.status) &&
          Date.parse(`${audit.created_at.replace(' ', 'T')}Z`) < Date.now() - 45 * 60_000
        ),
      };
    }
    if (sql.includes('ORDER BY COALESCE(next_poll_at, created_at)')) {
      const limit = Number(this.params.at(-1) || 5);
      return {
        results: this.db.audits
          .filter((audit) => ['pending', 'running', 'analyzing'].includes(audit.status))
          .filter((audit) => Date.parse(`${audit.created_at.replace(' ', 'T')}Z`) >= Date.now() - 45 * 60_000)
          .filter((audit) => !audit.next_poll_at || Date.parse(`${audit.next_poll_at.replace(' ', 'T')}Z`) <= Date.now())
          .filter((audit) => !audit.processing_locked_until || Date.parse(`${audit.processing_locked_until.replace(' ', 'T')}Z`) < Date.now())
          .slice(0, limit),
      };
    }
    return { results: [] };
  }

  async first() {
    if (this.sql.includes('SELECT * FROM site_audits WHERE id = ?')) {
      return this.db.audits.find((audit) => audit.id === this.params[0]) || null;
    }
    return null;
  }

  async run() {
    const sql = this.sql;
    if (sql.includes('SET processing_locked_until = datetime')) {
      const audit = this.db.findAudit(this.params[1]);
      if (!audit) return { meta: { changes: 0 } };
      audit.processing_locked_until = minutesAgo(-1);
      return { meta: { changes: 1 } };
    }
    if (sql.includes("SET retry_count = ?")) {
      const audit = this.db.findAudit(this.params[3]);
      Object.assign(audit, {
        retry_count: this.params[0],
        next_poll_at: minutesAgo(-2),
        processing_locked_until: null,
        crawl_diagnostics: this.params[2],
        last_polled_at: minutesAgo(0),
      });
      return { meta: { changes: 1 } };
    }
    if (sql.includes("SET status = 'running'")) {
      const audit = this.db.findAudit(this.params[3]);
      Object.assign(audit, {
        status: 'running',
        pages_crawled: this.params[0],
        retry_count: 0,
        next_poll_at: minutesAgo(-2),
        processing_locked_until: null,
        crawl_diagnostics: this.params[2],
        last_polled_at: minutesAgo(0),
      });
      return { meta: { changes: 1 } };
    }
    if (sql.includes("SET status = 'failed'")) {
      const audit = this.db.findAudit(this.params[2]);
      Object.assign(audit, {
        status: 'failed',
        error_message: this.params[0],
        crawl_diagnostics: this.params[1],
        next_poll_at: null,
        processing_locked_until: null,
        completed_at: minutesAgo(0),
        last_polled_at: minutesAgo(0),
      });
      return { meta: { changes: 1 } };
    }
    if (sql.includes("SET status = 'analyzing'")) {
      const audit = this.db.findAudit(this.params[1]);
      audit.status = 'analyzing';
      audit.crawl_diagnostics = this.params[0];
      audit.last_polled_at = minutesAgo(0);
      return { meta: { changes: 1 } };
    }
    if (sql.includes("SET status = 'completed'")) {
      const audit = this.db.findAudit(this.params.at(-1));
      Object.assign(audit, {
        status: 'completed',
        score: this.params[0],
        perf_score: this.params[1],
        seo_score: this.params[2],
        a11y_score: this.params[3],
        best_practices_score: this.params[4],
        lighthouse_data: this.params[5],
        seo_analysis: this.params[6],
        pages_crawled: this.params[7],
        error_message: null,
        crawl_diagnostics: this.params[8],
        retry_count: 0,
        next_poll_at: null,
        processing_locked_until: null,
        completed_at: minutesAgo(0),
      });
      return { meta: { changes: 1 } };
    }
    if (sql.startsWith('DELETE FROM audit_action_items')) {
      this.db.actionItems = [];
      return { meta: { changes: 1 } };
    }
    if (sql.startsWith('DELETE FROM audit_findings')) {
      this.db.findings = [];
      return { meta: { changes: 1 } };
    }
    if (sql.startsWith('INSERT INTO audit_findings')) {
      this.db.findings.push(this.params);
      return { meta: { changes: 1 } };
    }
    if (sql.startsWith('INSERT INTO audit_action_items')) {
      this.db.actionItems.push(this.params);
      return { meta: { changes: 1 } };
    }
    return { meta: { changes: 1 } };
  }
}

class FakeD1 {
  constructor(audits) {
    this.audits = audits;
    this.findings = [];
    this.actionItems = [];
  }

  findAudit(id) {
    const audit = this.audits.find((row) => row.id === id);
    if (!audit) throw new Error(`Missing audit ${id}`);
    return audit;
  }

  prepare(sql) {
    return new FakeStatement(this, sql.trim());
  }

  async batch(stmts) {
    for (const stmt of stmts) await stmt.run();
  }
}

function makeAudit(overrides = {}) {
  return {
    id: overrides.id || 'audit_1',
    user_id: 'user_1',
    domain: 'example.com',
    start_url: 'https://example.com/',
    status: 'running',
    dataforseo_task_id: 'dfs_1',
    pages_crawled: 0,
    retry_count: 0,
    next_poll_at: minutesAgo(1),
    processing_locked_until: null,
    created_at: minutesAgo(9),
    completed_at: null,
    ...overrides,
  };
}

function makeHarness(overrides = {}) {
  const state = {
    summary: {
      crawl_progress: 'in_progress',
      crawl_status: { max_crawl_pages: 10, pages_in_queue: 5, pages_crawled: 2 },
      domain_info: { checks: {}, server: 'nginx' },
    },
    summaryError: null,
    pages: [{ url: 'https://example.com/', page_timing: { largest_contentful_paint: 1400 }, checks: {} }],
    resources: [],
    microdata: null,
    lighthouseSample: { ok: false, error: 'DataForSEO Lighthouse timed out after 35000ms', duration_ms: 35000 },
    ...overrides,
  };
  const mocks = {
    '../dataforseo/on-page': {
      taskPost: async () => 'dfs_1',
      getSummary: async () => {
        if (state.summaryError) throw state.summaryError;
        return state.summary;
      },
      getPages: async () => state.pages,
      getResources: async () => state.resources,
      getMicrodata: async () => state.microdata,
      getLighthousePerformanceProbe: async () => state.lighthouseSample,
      LIGHTHOUSE_PERFORMANCE_PROBE_CONFIG: { categories: ['performance'] },
    },
    '../site-audit/on-page-analyzer': {
      analyzeOnPage: () => ({
        score: 91,
        perf_score: 80,
        seo_score: 94,
        a11y_score: 90,
        best_practices_score: 88,
        findings: [],
        action_items: [],
      }),
      buildStructuredSEO: () => ({ data_sources: { lighthouse_ok: false, bot_protection_detected: false } }),
      pickHomepage: (pages) => pages[0] || null,
      summarizeCrawledPages: (pages, startUrl) =>
        pages.map((page) => ({
          url: page.url,
          status_code: page.status_code ?? null,
          title: page.meta?.title || null,
          title_length: page.meta?.title_length ?? page.meta?.title?.length ?? 0,
          title_status: page.meta?.title ? 'ok' : 'missing',
          description: page.meta?.description || null,
          description_length:
            page.meta?.description_length ?? page.meta?.description?.length ?? 0,
          description_status: page.meta?.description ? 'ok' : 'missing',
          h1_count: page.meta?.htags?.h1?.length ?? 0,
          h1_status:
            (page.meta?.htags?.h1?.length ?? 0) === 0
              ? 'missing'
              : (page.meta?.htags?.h1?.length ?? 0) > 1
                ? 'multiple'
                : 'ok',
          load_ms: page.page_timing?.duration_time ?? null,
          internal_links_count: page.meta?.internal_links_count ?? null,
          external_links_count: page.meta?.external_links_count ?? null,
          images_count: page.meta?.images_count ?? null,
          is_homepage: page.url === startUrl,
          issue_count: 0,
        })),
    },
    '../site-audit/performance-stability': {
      collectPerformanceProbeSamples: async (count, runProbe) => {
        const samples = [];
        for (let i = 1; i <= count; i++) samples.push(await runProbe(i));
        return samples;
      },
      summarizePerformanceSamples: (samples, expected) => ({
        expected_sample_count: expected,
        successful_sample_count: samples.filter((sample) => sample.ok).length,
        median_lcp_ms: null,
      }),
    },
  };
  return loadTs('src/routes/site-audit.ts', mocks);
}

async function runQueue(module, audit) {
  const db = new FakeD1([audit]);
  const result = await module.processSiteAuditQueue({ DB: db }, { batchSize: 1 });
  return { db, result, audit };
}

{
  const analyzer = loadTs('src/site-audit/on-page-analyzer.ts', {});
  const pages = analyzer.summarizeCrawledPages(
    [
      {
        url: 'https://example.com/services',
        status_code: 200,
        meta: { title: '', description: '', htags: { h1: [] } },
        page_timing: { duration_time: 4200 },
      },
      {
        url: 'https://example.com/',
        status_code: 200,
        meta: {
          title: 'A Complete Example Homepage Title',
          description: 'A useful page description that is long enough to pass the site audit summary check.',
          htags: { h1: ['Example'] },
        },
        page_timing: { duration_time: 900 },
      },
    ],
    'https://example.com/'
  );
  assert.equal(pages.length, 2);
  assert.equal(pages[0].url, 'https://example.com/');
  assert.equal(pages[0].is_homepage, true);
  assert.equal(pages[1].title_status, 'missing');
  assert.equal(pages[1].description_status, 'missing');
  assert.equal(pages[1].h1_status, 'missing');
  assert.equal(pages[1].issue_count, 4);
}

{
  const module = makeHarness();
  const { audit, result } = await runQueue(module, makeAudit({ created_at: minutesAgo(9) }));
  assert.equal(result.timed_out, 0);
  assert.equal(audit.status, 'running');
  assert.equal(audit.pages_crawled, 2);
}

{
  const module = makeHarness({
    summary: {
      crawl_progress: 'finished',
      crawl_status: { max_crawl_pages: 10, pages_in_queue: 0, pages_crawled: 2 },
      domain_info: { checks: {}, extended_crawl_status: 'completed' },
    },
    pages: [
      {
        url: 'https://example.com/',
        status_code: 200,
        meta: {
          title: 'Example Home',
          description: 'Homepage description',
          htags: { h1: ['Example Home'] },
        },
        page_timing: { duration_time: 1400 },
        checks: {},
      },
      {
        url: 'https://example.com/services',
        status_code: 200,
        meta: {
          title: '',
          description: '',
          htags: { h1: [] },
        },
        page_timing: { duration_time: 2300 },
        checks: { duplicate_title: true },
      },
    ],
  });
  const { audit } = await runQueue(module, makeAudit({ created_at: minutesAgo(2) }));
  assert.equal(audit.status, 'completed');
  assert.equal(audit.score, 91);
  const seo = JSON.parse(audit.seo_analysis);
  assert.equal(seo.crawled_pages.length, 2);
  assert.equal(seo.crawled_pages[0].url, 'https://example.com/');
  assert.equal(seo.crawled_pages[0].is_homepage, true);
  assert.equal(seo.crawled_pages[1].title_status, 'missing');
  assert.equal(seo.crawled_pages[1].h1_status, 'missing');
}

{
  const module = makeHarness({
    summary: {
      crawl_progress: 'finished',
      crawl_status: { max_crawl_pages: 10, pages_in_queue: 0, pages_crawled: 0 },
      domain_info: { checks: { forbidden_robots: true }, extended_crawl_status: 'forbidden_robots' },
    },
  });
  const { audit } = await runQueue(module, makeAudit({ created_at: minutesAgo(2) }));
  const diagnostics = JSON.parse(audit.crawl_diagnostics);
  assert.equal(audit.status, 'failed');
  assert.equal(diagnostics.reason_code, 'forbidden_robots');
  assert.match(audit.error_message, /robots\.txt/i);
}

{
  const module = makeHarness({ summaryError: new Error('DataForSEO summary timed out') });
  const { audit } = await runQueue(module, makeAudit({ created_at: minutesAgo(2), retry_count: 0 }));
  assert.equal(audit.status, 'running');
  assert.equal(audit.retry_count, 1);
  assert.equal(module.getAuditPollDelaySeconds(1), 90);
}

{
  const module = makeHarness({
    summary: {
      crawl_progress: 'finished',
      crawl_status: { max_crawl_pages: 10, pages_in_queue: 0, pages_crawled: 1 },
      domain_info: { checks: {}, extended_crawl_status: 'completed' },
    },
    lighthouseSample: { ok: false, error: 'Lighthouse timeout', duration_ms: 35000 },
  });
  const { audit } = await runQueue(module, makeAudit({ created_at: minutesAgo(2) }));
  assert.equal(audit.status, 'completed');
  assert.equal(JSON.parse(audit.lighthouse_data).summary.successful_sample_count, 0);
}

console.log('site-audit queue tests passed');
