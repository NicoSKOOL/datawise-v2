import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const workersDir = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const rootDir = path.resolve(workersDir, '..');
const outDir = mkdtempSync(path.join(tmpdir(), 'cw-model-tests-'));
const require = createRequire(import.meta.url);

const args = parseArgs(process.argv.slice(2));
const postId = String(args.post || 'e624d53a70174293acff5161077d88ab');
const outlineMaxTokens = Number(args['outline-max-tokens'] || 4096);
const draftMaxTokens = Number(args['draft-max-tokens'] || 12000);
const timeoutMs = Number(args.timeout || 180000);
const onlyModels = args.models ? String(args.models).split(',').map((s) => s.trim()).filter(Boolean) : null;
const dryRun = Boolean(args['dry-run']);

compileLocalModules();

const prompts = require(path.join(outDir, 'workers/src/content-writer/prompts.js'));
const template = require(path.join(outDir, 'workers/src/content-writer/prompt-template.js'));
const quality = require(path.join(outDir, 'workers/src/content-writer/quality.js'));
const openrouterOptions = require(path.join(outDir, 'workers/src/llm/openrouter-options.js'));
const aiModels = require(path.join(outDir, 'src/lib/ai-models.js'));

const modelIds = onlyModels || aiModels.OPENROUTER_MODEL_IDS;
const apiKey = process.env.OPENROUTER_API_KEY || readDevVar('OPENROUTER_API_KEY');
if (!apiKey && !dryRun) {
  throw new Error('OPENROUTER_API_KEY is required. Set it in env or workers/.dev.vars.');
}

const dbPath = args.db ? path.resolve(String(args.db)) : findLocalD1Database();
const loaded = loadPostFixture(dbPath, postId);
const fixture = buildPromptFixture(loaded);
const reportDir = path.join(rootDir, 'tmp', 'content-writer-model-tests', timestamp());
mkdirSync(reportDir, { recursive: true });

const catalog = dryRun ? new Set(modelIds) : await fetchOpenRouterCatalog(apiKey, timeoutMs).catch((err) => {
  console.warn(`Catalog lookup failed: ${err.message}`);
  return null;
});

const results = [];
for (const model of modelIds) {
  const modelDir = path.join(reportDir, safeFileName(model));
  mkdirSync(modelDir, { recursive: true });

  if (catalog && !catalog.has(model)) {
    results.push({
      model,
      status: 'fail',
      catalog: 'missing',
      errors: ['Model ID was not found in the OpenRouter catalog.'],
      warnings: [],
      outline: null,
      draft: null,
    });
    continue;
  }

  if (dryRun) {
    results.push({
      model,
      status: 'dry-run',
      catalog: catalog ? 'found' : 'not_checked',
      errors: [],
      warnings: [],
      outline: null,
      draft: null,
    });
    continue;
  }

  console.log(`\nTesting ${model}`);
  const startedAt = Date.now();
  try {
    const outlineMessages = fixture.messagesFor('outline', {});
    const outlineRes = await openRouterChat({
      apiKey,
      model,
      messages: outlineMessages,
      maxTokens: outlineMaxTokens,
      timeoutMs,
      rawPath: path.join(modelDir, 'outline.raw.json'),
    });
    writeFileSync(path.join(modelDir, 'outline.md'), outlineRes.text);
    const outlineChecks = validateOutline(outlineRes.text);

    const draftMessages = fixture.messagesFor('draft', { outline: outlineRes.text });
    const draftRes = await openRouterChat({
      apiKey,
      model,
      messages: draftMessages,
      maxTokens: draftMaxTokens,
      timeoutMs,
      rawPath: path.join(modelDir, 'draft.raw.json'),
    });
    writeFileSync(path.join(modelDir, 'draft.md'), draftRes.text);
    const draftChecks = validateDraft(draftRes.text, fixture);

    const errors = [
      ...outlineChecks.errors.map((message) => `outline: ${message}`),
      ...draftChecks.errors.map((message) => `draft: ${message}`),
    ];
    const warnings = [
      ...outlineChecks.warnings.map((message) => `outline: ${message}`),
      ...draftChecks.warnings.map((message) => `draft: ${message}`),
    ];

    results.push({
      model,
      status: errors.length ? 'fail' : 'pass',
      catalog: catalog ? 'found' : 'not_checked',
      errors,
      warnings,
      outline: {
        finish_reason: outlineRes.finishReason,
        usage: outlineRes.usage,
        chars: outlineRes.text.length,
        h2_count: outlineChecks.metrics.h2_count,
        section_count: outlineChecks.metrics.section_count,
      },
      draft: {
        finish_reason: draftRes.finishReason,
        usage: draftRes.usage,
        chars: draftRes.text.length,
        words: draftChecks.metrics.words,
        h2_count: draftChecks.metrics.h2_count,
        has_tldr: draftChecks.metrics.has_tldr,
        has_faq: draftChecks.metrics.has_faq,
        has_table: draftChecks.metrics.has_table,
        artifact_count: draftChecks.metrics.artifact_count,
      },
      duration_ms: Date.now() - startedAt,
    });
  } catch (err) {
    results.push({
      model,
      status: 'fail',
      catalog: catalog ? 'found' : 'not_checked',
      errors: [err instanceof Error ? err.message : String(err)],
      warnings: [],
      outline: null,
      draft: null,
      duration_ms: Date.now() - startedAt,
    });
  }
}

const report = {
  generated_at: new Date().toISOString(),
  post_id: postId,
  workspace_id: loaded.post.workspace_id,
  topic: fixture.brief.topic,
  target_keyword: fixture.brief.target_keyword,
  report_dir: reportDir,
  model_count: results.length,
  pass_count: results.filter((result) => result.status === 'pass').length,
  fail_count: results.filter((result) => result.status === 'fail').length,
  results,
};

writeFileSync(path.join(reportDir, 'report.json'), JSON.stringify(report, null, 2));
writeFileSync(path.join(reportDir, 'report.md'), formatMarkdownReport(report));
console.log(formatMarkdownReport(report));
console.log(`\nSaved report: ${path.join(reportDir, 'report.md')}`);

function parseArgs(values) {
  const parsed = {};
  for (const value of values) {
    if (!value.startsWith('--')) continue;
    const [rawKey, ...rawValue] = value.slice(2).split('=');
    parsed[rawKey] = rawValue.length ? rawValue.join('=') : true;
  }
  return parsed;
}

function compileLocalModules() {
  execFileSync(
    path.join(workersDir, 'node_modules/.bin/tsc'),
    [
      'workers/src/content-writer/prompts.ts',
      'workers/src/content-writer/prompt-template.ts',
      'workers/src/content-writer/quality.ts',
      'workers/src/llm/openrouter-options.ts',
      'src/lib/ai-models.ts',
      '--target', 'ES2022',
      '--module', 'CommonJS',
      '--moduleResolution', 'node',
      '--rootDir', '.',
      '--outDir', outDir,
      '--skipLibCheck',
    ],
    { cwd: rootDir, stdio: 'inherit' },
  );
}

function readDevVar(key) {
  const file = path.join(workersDir, '.dev.vars');
  if (!existsSync(file)) return '';
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx < 0) continue;
    if (trimmed.slice(0, idx) === key) return trimmed.slice(idx + 1).trim();
  }
  return '';
}

function findLocalD1Database() {
  const d1Root = path.join(workersDir, '.wrangler', 'state', 'v3', 'd1');
  const found = [];
  walk(d1Root, (file) => {
    if (file.endsWith('.sqlite')) found.push(file);
  });
  if (!found.length) throw new Error(`No local D1 sqlite file found under ${d1Root}`);
  found.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return found[0];
}

function walk(dir, onFile) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, onFile);
    else if (entry.isFile()) onFile(full);
  }
}

function sqliteJson(db, sql) {
  const dbUri = `file:${db}?mode=ro&immutable=1`;
  const out = execFileSync('sqlite3', ['-readonly', '-json', dbUri, sql], {
    cwd: rootDir,
    encoding: 'utf8',
  });
  return out.trim() ? JSON.parse(out) : [];
}

function quoteSql(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function loadPostFixture(db, id) {
  const post = sqliteJson(db, `SELECT * FROM content_writer_posts WHERE id = ${quoteSql(id)} LIMIT 1;`)[0];
  if (!post) throw new Error(`Post not found in local D1: ${id}`);
  const workspace = sqliteJson(db, `SELECT * FROM content_writer_workspaces WHERE id = ${quoteSql(post.workspace_id)} LIMIT 1;`)[0];
  if (!workspace) throw new Error(`Workspace not found for post: ${post.workspace_id}`);
  const kbRows = sqliteJson(db, `SELECT doc_type, content FROM content_writer_kb_docs WHERE workspace_id = ${quoteSql(post.workspace_id)} AND status = 'ready';`);
  const promptRows = sqliteJson(db, [
    'SELECT prompt_key, draft_text, published_text, published_version, updated_by, updated_at, published_by, published_at',
    'FROM content_writer_prompt_configs;',
  ].join(' '));
  return { post, workspace, kbRows, promptRows };
}

function buildPromptFixture({ post, workspace, kbRows, promptRows }) {
  const kb = {};
  for (const row of kbRows) kb[row.doc_type] = row.content || '';

  const brief = post.brief_json ? JSON.parse(post.brief_json) : { topic: post.topic || '' };
  const priorContext = {};
  let sourceSearchMeta = null;
  if (post.sources_json) {
    try {
      const parsedSources = JSON.parse(post.sources_json);
      priorContext.sources = [
        parsedSources.text || '',
        formatAiQuestions(parsedSources.ai_questions),
      ].filter(Boolean).join('\n\n');
      sourceSearchMeta = parsedSources.source_search || null;
    } catch {
      priorContext.sources = '';
    }
  }

  let outlineSettings = null;
  if (post.outline_json) {
    try {
      const parsedOutline = JSON.parse(post.outline_json);
      outlineSettings = parsedOutline.settings || null;
    } catch {
      outlineSettings = null;
    }
  }

  const effectiveBrief = {
    topic: brief.topic || post.topic || post.title || '',
    target_keyword: brief.target_keyword || post.target_keyword || '',
    secondary_keywords: brief.secondary_keywords || '',
    takeaway: brief.takeaway || '',
    notes: brief.notes || '',
    include_tables: outlineSettings?.include_tables ?? brief.include_tables ?? true,
    include_tldr: outlineSettings?.include_tldr ?? brief.include_tldr ?? true,
    include_faq: outlineSettings?.include_faq ?? brief.include_faq ?? true,
    capsule_pct: outlineSettings?.capsule_pct ?? brief.capsule_pct ?? 65,
  };

  const promptConfigs = new Map(promptRows.map((row) => [row.prompt_key, row]));

  function messagesFor(step, overrides) {
    const promptKeys = postStepPromptKeys(step);
    const masterPrompt = resolvePromptFromMap(promptConfigs, promptKeys.master, '');
    const stepPrompt = resolvePromptFromMap(promptConfigs, promptKeys.system, '');
    const userPrompt = resolvePromptFromMap(promptConfigs, promptKeys.user, '');
    const stepPriorContext = {
      ...priorContext,
      ...overrides,
    };
    const promptContext = template.buildWriterPromptContext({
      workspace,
      brief: effectiveBrief,
      kb,
      priorContext: stepPriorContext,
      metadata: {
        source_search: sourceSearchMeta,
        outline_settings: outlineSettings,
      },
    });
    return [
      {
        role: 'system',
        content: prompts.buildPostStepSystemPrompt(kb, step, {
          master: masterPrompt.source === 'published' ? masterPrompt.text : undefined,
          step: stepPrompt.source === 'published' ? stepPrompt.text : undefined,
          context: promptContext,
        }),
      },
      {
        role: 'user',
        content: prompts.buildPostStepUserMessage(
          effectiveBrief,
          step,
          stepPriorContext,
          userPrompt.source === 'published' ? userPrompt.text : undefined,
          promptContext,
        ),
      },
    ];
  }

  return {
    brief: effectiveBrief,
    kb,
    workspace,
    outlineSettings,
    messagesFor,
  };
}

function resolvePromptFromMap(configs, key, defaultText) {
  const row = configs.get(key);
  const publishedText = row?.published_text?.trim();
  if (publishedText) {
    return {
      text: publishedText,
      source: 'published',
      publishedVersion: row.published_version || 1,
    };
  }
  return { text: defaultText, source: 'default', publishedVersion: 0 };
}

function postStepPromptKeys(step) {
  return {
    master: 'post.master.system',
    system: `post.step.${step}.system`,
    user: `post.step.${step}.user`,
  };
}

function formatAiQuestions(ctx) {
  if (!ctx?.questions?.length) return '';
  return [
    'AI search questions to answer:',
    ...ctx.questions.map((question) => `- ${question}`),
  ].join('\n');
}

async function fetchOpenRouterCatalog(key, timeout) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch('https://openrouter.ai/api/v1/models', {
      headers: { Authorization: `Bearer ${key}` },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`OpenRouter models API failed: ${response.status}`);
    const data = await response.json();
    return new Set((data.data || []).map((model) => model.id));
  } finally {
    clearTimeout(timer);
  }
}

async function openRouterChat({ apiKey, model, messages, maxTokens, timeoutMs, rawPath }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'http://localhost:8080',
        'X-Title': 'DataWise Content Writer Compatibility Test',
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: maxTokens,
        ...(openrouterOptions.getOpenRouterReasoningConfig(model)
          ? { reasoning: openrouterOptions.getOpenRouterReasoningConfig(model) }
          : {}),
      }),
      signal: controller.signal,
    });
    const text = await response.text();
    if (rawPath) writeFileSync(rawPath, text);
    if (!response.ok) {
      let message = text;
      try { message = JSON.parse(text).error?.message || text; } catch { /* keep text */ }
      throw new Error(`OpenRouter ${response.status}: ${message.slice(0, 500)}`);
    }
    const data = JSON.parse(text);
    const choice = data.choices?.[0];
    const content = openrouterOptions.extractOpenRouterMessageText(choice?.message);
    if (!content.trim()) throw new Error('OpenRouter returned an empty message.');
    return {
      text: stripWrappingCodeFence(content.trim()),
      finishReason: choice?.finish_reason || null,
      usage: data.usage || null,
    };
  } finally {
    clearTimeout(timer);
  }
}

function validateOutline(text) {
  const errors = [];
  const warnings = [];
  const h2Count = (text.match(/^##\s+/gm) || []).length;
  const markerCount = (text.match(/\[(?:CAPSULE|TABLE|NARRATIVE)\]/gi) || []).length;
  if (text.length < 600) errors.push('too short to be a usable article outline');
  if (h2Count < 5) errors.push(`expected at least 5 H2 sections, found ${h2Count}`);
  if (/\{\{\s*[a-z_]+\s*\}\}/i.test(text)) errors.push('contains unresolved {{placeholder}} token');
  if (/as an ai language model/i.test(text)) errors.push('contains AI-disclaimer phrasing');
  if (markerCount < 3) warnings.push(`only ${markerCount} section format marker(s) found`);
  return {
    errors,
    warnings,
    metrics: {
      h2_count: h2Count,
      section_count: h2Count,
      marker_count: markerCount,
    },
  };
}

function validateDraft(text, fixture) {
  const errors = [];
  const warnings = [];
  const words = countWords(text);
  const h2Count = (text.match(/^##\s+/gm) || []).length;
  const hasTldr = /\bTL;DR\b|too long; didn'?t read/i.test(text);
  const hasFaq = /frequently asked questions|^##\s+faq\b/im.test(text);
  const hasTable = /^\|.+\|\s*$/m.test(text) && /^\|[-:\s|]+\|\s*$/m.test(text);
  const qualityAnalysis = quality.analyzeWriterQuality(text);
  const keyword = fixture.brief.target_keyword;

  if (words < 900) errors.push(`draft is too short (${words} words)`);
  if (h2Count < 5) errors.push(`expected at least 5 H2 sections, found ${h2Count}`);
  if (/\{\{\s*[a-z_]+\s*\}\}/i.test(text)) errors.push('contains unresolved {{placeholder}} token');
  if (/as an ai language model/i.test(text)) errors.push('contains AI-disclaimer phrasing');
  if (/let'?s dive in/i.test(text)) errors.push('contains banned phrase "let\'s dive in"');
  if (/[—–]/.test(text)) warnings.push('contains em/en dash; worker cleanup would normalize this before save');
  if (/\[\d{1,3}\]|<sup>\s*\d{1,3}\s*<\/sup>|\^\d{1,3}\b/i.test(text)) errors.push('contains footnote/citation marker artifacts');
  if (quality.shouldRepairWriterOutput(qualityAnalysis)) errors.push(`high citation artifact density (${qualityAnalysis.artifact_count} matches)`);
  if (fixture.brief.include_tldr !== false && !hasTldr) errors.push('missing requested TL;DR block');
  if (fixture.brief.include_faq !== false && !hasFaq) errors.push('missing requested FAQ section');
  if (fixture.brief.include_tables !== false && !hasTable) warnings.push('no markdown table found even though tables are allowed');
  if (keyword && !containsKeyword(text, keyword)) warnings.push(`target keyword not found verbatim: ${keyword}`);
  if (fixture.workspace.name && !text.toLowerCase().includes(String(fixture.workspace.name).toLowerCase().split(' ')[0])) {
    warnings.push(`business/workspace name not clearly referenced: ${fixture.workspace.name}`);
  }

  return {
    errors,
    warnings,
    metrics: {
      words,
      h2_count: h2Count,
      has_tldr: hasTldr,
      has_faq: hasFaq,
      has_table: hasTable,
      artifact_count: qualityAnalysis.artifact_count,
      artifact_density_per_1000_chars: qualityAnalysis.artifact_density_per_1000_chars,
    },
  };
}

function stripWrappingCodeFence(s) {
  const trimmed = s.trim();
  const match = trimmed.match(/^```(?:[a-zA-Z0-9]+)?\n([\s\S]*?)\n```$/);
  return match ? match[1].trim() : s;
}

function countWords(text) {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[#>*_`~|-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function containsKeyword(text, keyword) {
  const normalize = (value) => value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return normalize(text).includes(normalize(keyword));
}

function safeFileName(value) {
  return value.replace(/[^a-z0-9._-]+/gi, '_');
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function formatMarkdownReport(report) {
  const lines = [
    '# Content Writer Model Compatibility Report',
    '',
    `Generated: ${report.generated_at}`,
    `Post: ${report.post_id}`,
    `Topic: ${report.topic}`,
    `Target keyword: ${report.target_keyword || '(none)'}`,
    `Pass/fail: ${report.pass_count}/${report.model_count} passed`,
    '',
    '| Model | Status | Draft words | H2s | TL;DR | FAQ | Table | Main issues |',
    '|---|---:|---:|---:|---:|---:|---:|---|',
  ];
  for (const result of report.results) {
    const issueText = result.errors.length
      ? result.errors.join('<br>')
      : result.warnings.slice(0, 3).join('<br>');
    lines.push([
      `\`${result.model}\``,
      result.status,
      result.draft?.words ?? '',
      result.draft?.h2_count ?? '',
      boolLabel(result.draft?.has_tldr),
      boolLabel(result.draft?.has_faq),
      boolLabel(result.draft?.has_table),
      issueText || 'None',
    ].join(' | '));
  }
  lines.push('', `Raw outlines/drafts saved in: \`${report.report_dir}\``);
  return lines.join('\n');
}

function boolLabel(value) {
  if (value === true) return 'yes';
  if (value === false) return 'no';
  return '';
}
