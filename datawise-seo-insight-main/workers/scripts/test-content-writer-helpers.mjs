import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const workersDir = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const outDir = mkdtempSync(path.join(tmpdir(), 'cw-helper-tests-'));

execFileSync(
  path.join(workersDir, 'node_modules/.bin/tsc'),
  [
    'src/content-writer/quality.ts',
    'src/content-writer/prompt-registry.ts',
    'src/content-writer/prompt-template.ts',
    'src/content-writer/page-discovery.ts',
    'src/content-writer/source-filter.ts',
    'src/content-writer/post-step-persistence.ts',
    'src/llm/openrouter-options.ts',
    '--target', 'ES2022',
    '--module', 'CommonJS',
    '--moduleResolution', 'node',
    '--rootDir', 'src',
    '--outDir', outDir,
    '--skipLibCheck',
    '--types', '@cloudflare/workers-types',
  ],
  { cwd: workersDir, stdio: 'inherit' },
);

const require = createRequire(import.meta.url);
const quality = require(path.join(outDir, 'content-writer/quality.js'));
const promptBuilders = require(path.join(outDir, 'content-writer/prompts.js'));
const prompts = require(path.join(outDir, 'content-writer/prompt-registry.js'));
const template = require(path.join(outDir, 'content-writer/prompt-template.js'));
const pageDiscovery = require(path.join(outDir, 'content-writer/page-discovery.js'));
const sourceFilter = require(path.join(outDir, 'content-writer/source-filter.js'));
const postStepPersistence = require(path.join(outDir, 'content-writer/post-step-persistence.js'));
const openrouterOptions = require(path.join(outDir, 'llm/openrouter-options.js'));

{
  const promptContext = template.buildWriterPromptContext({
    workspace: { name: 'DataWise SEO', website_url: 'https://datawiseseo.com' },
    brief: {
      topic: 'does google penalise ai content',
      target_keyword: 'google penalise ai content',
      secondary_keywords: 'ai written content, ai content',
      takeaway: 'It is about content quality, not whether AI helped write it.',
    },
    kb: {
      service_details: 'OFFER LIST\n- Keyword research\n- AI visibility\n- Content tools',
      brand_guidelines: 'Never cite as a research source: Example Competitor',
    },
  });
  const researchUserMessage = promptBuilders.buildPostStepUserMessage(
    {
      topic: 'does google penalise ai content',
      target_keyword: 'google penalise ai content',
      secondary_keywords: 'ai written content, ai content',
      takeaway: 'It is about content quality, not whether AI helped write it.',
    },
    'research',
    undefined,
    undefined,
    promptContext,
  );

  assert.match(researchUserMessage, /Source candidates/i);
  assert.match(researchUserMessage, /markdown link/i);
  assert.match(researchUserMessage, /5 to 8/i);
  assert.match(researchUserMessage, /Example Competitor/);
}

{
  const sitemapXml = [
    '<urlset>',
    '<url><loc>https://example.com/</loc></url>',
    '<url><loc>https://example.com/services/leak-detection/</loc></url>',
    '<url><loc>https://example.com/service-areas/austin/</loc></url>',
    '<url><loc>https://example.com/about-us/</loc></url>',
    '<url><loc>https://example.com/contact/</loc></url>',
    '<url><loc>https://example.com/blog/leak-detection-guide/</loc></url>',
    '<url><loc>https://example.com/privacy-policy/</loc></url>',
    '<url><loc>https://example.com/tag/plumbing/</loc></url>',
    '<url><loc>https://example.com/cart/</loc></url>',
    '</urlset>',
  ].join('');
  const pages = pageDiscovery.parseSitemapUrls(sitemapXml);
  const selected = pageDiscovery.rankAndFilterPages(pages, 'https://example.com', 50);

  assert.deepEqual(
    selected.map((page) => page.url),
    [
      'https://example.com/',
      'https://example.com/services/leak-detection/',
      'https://example.com/service-areas/austin/',
      'https://example.com/about-us/',
      'https://example.com/contact/',
      'https://example.com/blog/leak-detection-guide/',
    ],
  );
  assert.equal(selected[0].page_type, 'Home');
  assert.equal(selected[1].page_type, 'Service');
  assert.equal(selected[2].page_type, 'Location');
  assert.equal(selected[3].page_type, 'About');
  assert.equal(selected[4].page_type, 'Contact');
  assert.equal(selected[5].page_type, 'Blog Post');
  assert.equal(selected[1].link_worthy, 'yes');

  const evidence = pageDiscovery.extractPageEvidence(
    'https://example.com/services/leak-detection/',
    '<html><head><title>Leak Detection Austin</title><meta name="description" content="Find hidden leaks fast."><link rel="canonical" href="https://example.com/services/leak-detection/"></head><body><h1>Leak Detection</h1><h2>Slab leak testing</h2><main>We locate water leaks under slabs and behind walls before damage spreads.</main></body></html>',
    'sitemap',
  );
  assert.equal(evidence.title, 'Leak Detection Austin');
  assert.equal(evidence.meta_description, 'Find hidden leaks fast.');
  assert.equal(evidence.h1[0], 'Leak Detection');
  assert.equal(evidence.canonical_url, 'https://example.com/services/leak-detection/');

  const doc = pageDiscovery.formatWebsitePagesDocument([
    {
      ...selected[1],
      title: evidence.title,
      description: 'Leak detection service page for homeowners in Austin.',
      confidence: 'high',
    },
  ]);
  assert.ok(doc.includes('https://example.com/services/leak-detection/'));
  assert.ok(doc.includes('Page type: Service'));
  assert.ok(doc.includes('Link-worthy from blog: yes'));
}

{
  const dataWiseSitemapXml = [
    '<urlset>',
    '<url><loc>https://www.datawiseseo.com/</loc></url>',
    '<url><loc>https://www.datawiseseo.com/about/</loc></url>',
    '<url><loc>https://www.datawiseseo.com/blog/complete-guide-keyword-research/</loc></url>',
    '<url><loc>https://www.datawiseseo.com/blog/query-fan-out-ai-search/</loc></url>',
    '<url><loc>https://www.datawiseseo.com/features/</loc></url>',
    '<url><loc>https://www.datawiseseo.com/features/ai-visibility/</loc></url>',
    '<url><loc>https://www.datawiseseo.com/features/keyword-research/</loc></url>',
    '<url><loc>https://www.datawiseseo.com/features/rank-tracking/</loc></url>',
    '<url><loc>https://www.datawiseseo.com/free-tools/keyword-difficulty/</loc></url>',
    '<url><loc>https://www.datawiseseo.com/pricing/</loc></url>',
    '</urlset>',
  ].join('');
  const pages = pageDiscovery.parseSitemapUrls(dataWiseSitemapXml);
  const siteArchetype = pageDiscovery.inferSiteArchetype(pages);
  const selected = pageDiscovery.rankAndFilterPages(pages, 'https://www.datawiseseo.com', 20, { siteArchetype });
  const featureUrls = selected.filter((page) => page.page_type === 'Feature').map((page) => page.url);
  const firstBlogIndex = selected.findIndex((page) => page.page_type === 'Blog Post');
  const lastFeatureIndex = selected.map((page) => page.page_type).lastIndexOf('Feature');

  assert.equal(siteArchetype, 'saas');
  assert.ok(featureUrls.includes('https://www.datawiseseo.com/features/keyword-research/'));
  assert.ok(featureUrls.includes('https://www.datawiseseo.com/features/ai-visibility/'));
  assert.equal(selected.find((page) => page.url === 'https://www.datawiseseo.com/pricing/')?.page_type, 'Pricing');
  assert.equal(selected.find((page) => page.url === 'https://www.datawiseseo.com/free-tools/keyword-difficulty/')?.page_type, 'Tool');
  assert.ok(firstBlogIndex === -1 || lastFeatureIndex < firstBlogIndex);
}

{
  const dataWiseSitemapXml = [
    '<urlset>',
    '<url><loc>https://www.datawiseseo.com/</loc></url>',
    '<url><loc>https://www.datawiseseo.com/about/</loc></url>',
    '<url><loc>https://www.datawiseseo.com/community/</loc></url>',
    '<url><loc>https://www.datawiseseo.com/compare/</loc></url>',
    '<url><loc>https://www.datawiseseo.com/features/</loc></url>',
    '<url><loc>https://www.datawiseseo.com/features/ai-visibility/</loc></url>',
    '<url><loc>https://www.datawiseseo.com/features/backlinks/</loc></url>',
    '<url><loc>https://www.datawiseseo.com/features/competitor-analysis/</loc></url>',
    '<url><loc>https://www.datawiseseo.com/features/content-tools/</loc></url>',
    '<url><loc>https://www.datawiseseo.com/features/keyword-research/</loc></url>',
    '<url><loc>https://www.datawiseseo.com/features/rank-tracking/</loc></url>',
    '<url><loc>https://www.datawiseseo.com/features/seo-assistant/</loc></url>',
    '<url><loc>https://www.datawiseseo.com/free-tools/</loc></url>',
    '<url><loc>https://www.datawiseseo.com/free-tools/business-categories/</loc></url>',
    '<url><loc>https://www.datawiseseo.com/free-tools/fan-out-queries/</loc></url>',
    '<url><loc>https://www.datawiseseo.com/free-tools/keyword-difficulty/</loc></url>',
    '<url><loc>https://www.datawiseseo.com/free-tools/local-business-schema/</loc></url>',
    '<url><loc>https://www.datawiseseo.com/free-tools/related-keywords/</loc></url>',
    '<url><loc>https://www.datawiseseo.com/pricing/</loc></url>',
    '<url><loc>https://www.datawiseseo.com/blog/ai-seo-assistant-playbook/</loc></url>',
    '<url><loc>https://www.datawiseseo.com/blog/backlink-analysis-playbook/</loc></url>',
    '<url><loc>https://www.datawiseseo.com/blog/complete-guide-ai-search-visibility/</loc></url>',
    '<url><loc>https://www.datawiseseo.com/blog/complete-guide-keyword-research/</loc></url>',
    '<url><loc>https://www.datawiseseo.com/blog/complete-guide-rank-tracking/</loc></url>',
    '<url><loc>https://www.datawiseseo.com/blog/content-decay-refresh-playbook/</loc></url>',
    '<url><loc>https://www.datawiseseo.com/blog/how-to-track-ai-visibility/</loc></url>',
    '<url><loc>https://www.datawiseseo.com/blog/keyword-research-for-small-business/</loc></url>',
    '<url><loc>https://www.datawiseseo.com/blog/query-fan-out-ai-search/</loc></url>',
    '<url><loc>https://www.datawiseseo.com/blog/seo-competitor-analysis-framework/</loc></url>',
    '<url><loc>https://www.datawiseseo.com/blog/what-is-ai-visibility-seo/</loc></url>',
    '</urlset>',
  ].join('');
  const pages = pageDiscovery.parseSitemapUrls(dataWiseSitemapXml);
  const siteArchetype = pageDiscovery.inferSiteArchetype(pages);
  const selected = pageDiscovery.selectBalancedWebsitePages(pages, 'https://www.datawiseseo.com', {
    siteArchetype,
    reviewLimit: 40,
    blogLimit: 10,
  });
  const urls = selected.map((page) => page.url);
  const blogCount = selected.filter((page) => page.page_type === 'Blog Post').length;
  const featureCount = selected.filter((page) => page.page_type === 'Feature').length;

  assert.equal(siteArchetype, 'saas');
  assert.ok(selected.length > 16);
  assert.ok(featureCount >= 7);
  assert.ok(blogCount >= 8);
  assert.ok(urls.includes('https://www.datawiseseo.com/features/keyword-research/'));
  assert.ok(urls.includes('https://www.datawiseseo.com/pricing/'));
  assert.ok(urls.includes('https://www.datawiseseo.com/free-tools/fan-out-queries/'));
  assert.ok(urls.includes('https://www.datawiseseo.com/blog/complete-guide-keyword-research/'));
}

{
  const manyPages = [
    'https://example.com/',
    'https://example.com/features/a/',
    'https://example.com/features/b/',
    'https://example.com/features/c/',
    'https://example.com/features/d/',
    'https://example.com/pricing/',
    'https://example.com/blog/one/',
    'https://example.com/blog/two/',
    'https://example.com/blog/three/',
    'https://example.com/blog/four/',
    'https://example.com/blog/five/',
  ].map((url) => pageDiscovery.candidateFromUrl(url, 'sitemap')).filter(Boolean);
  const selected = pageDiscovery.selectBalancedWebsitePages(manyPages, 'https://example.com', {
    siteArchetype: 'saas',
    reviewLimit: 10,
    enrichLimit: 3,
    blogLimit: 4,
  });

  assert.ok(selected.length > 3);
  assert.equal(selected.some((page) => page.url.endsWith('/blog/one/')), true);
  assert.equal(selected.some((page) => page.url.endsWith('/features/a/')), true);
}

{
  const ecommerceSitemapXml = [
    '<urlset>',
    '<url><loc>https://shop.example.com/</loc></url>',
    '<url><loc>https://shop.example.com/collections/running-shoes/</loc></url>',
    '<url><loc>https://shop.example.com/products/trail-runner-pro/</loc></url>',
    '<url><loc>https://shop.example.com/category/socks/</loc></url>',
    '<url><loc>https://shop.example.com/blog/how-to-pick-running-shoes/</loc></url>',
    '<url><loc>https://shop.example.com/tag/sale/</loc></url>',
    '</urlset>',
  ].join('');
  const pages = pageDiscovery.parseSitemapUrls(ecommerceSitemapXml);
  const siteArchetype = pageDiscovery.inferSiteArchetype(pages);
  const selected = pageDiscovery.rankAndFilterPages(pages, 'https://shop.example.com', 20, { siteArchetype });

  assert.equal(siteArchetype, 'ecommerce');
  assert.equal(selected.find((page) => page.url.includes('/collections/running-shoes/'))?.page_type, 'Product Category');
  assert.equal(selected.find((page) => page.url.includes('/products/trail-runner-pro/'))?.page_type, 'Product');
  assert.equal(selected.find((page) => page.url.includes('/category/socks/'))?.page_type, 'Product Category');
  assert.equal(selected.some((page) => page.url.includes('/tag/sale/')), false);
}

{
  const corrupted = [
    'A ground microphone pinpoints the loudest14 spot.',
    'This is16 especially useful when16 the leak is16 deep under a16 slab or1616 the16 pipe16 is1605 buried.16 We charge $8016 diagnostic.',
    'The original building code from 2016 still matters, and a 16-inch pipe can cost $1,600.',
    'Acoustic leak detectors listen through concrete.eps',
  ].join(' ');

  const result = quality.repairWriterOutputIfNeeded(corrupted);

  assert.equal(result.repaired, true);
  assert.ok(result.warnings.some((warning) => warning.includes('citation-marker artifacts')));
  assert.equal(result.text.includes('is16'), false);
  assert.equal(result.text.includes('the16'), false);
  assert.equal(result.text.includes('loudest14'), false);
  assert.equal(result.text.includes('concrete.eps'), false);
  assert.ok(result.text.includes('loudest spot'));
  assert.ok(result.text.includes('$80 diagnostic'));
  assert.ok(result.text.includes('2016 still matters'));
  assert.ok(result.text.includes('16-inch pipe'));
  assert.ok(result.text.includes('$1,600'));
}

{
  const clean = 'A 2016 building code note says a 16-inch pipe can cost $1,600 in rare commercial work.';
  const result = quality.repairWriterOutputIfNeeded(clean);
  assert.equal(result.repaired, false);
  assert.equal(result.text, clean);
  assert.deepEqual(result.warnings, []);
}

{
  const context = template.buildWriterPromptContext({
    workspace: {
      name: 'Pipe Pros Austin',
      website_url: 'https://pipepros.example.com',
    },
    brief: {
      topic: 'How to know if a pipe burst',
      target_keyword: 'how will you know if your pipes burst',
      takeaway: 'Help homeowners decide when to call.',
    },
    kb: {
      brand_guidelines: [
        'BUSINESS NAME AND SPELLING',
        '- Business name: Pipe Pros Austin',
        'FORBIDDEN COMPETITORS',
        '- Never cite as a research source: Roto-Rooter, Mr. Rooter.',
      ].join('\n'),
      service_details: [
        'BUSINESS OVERVIEW',
        '- Business type: emergency plumbing company',
        '- Industry: residential plumbing',
        '- Locations / service area: Austin and Round Rock',
        '- Primary services: burst pipe repair, slab leak detection, drain clearing',
        'PRICING',
        '- $80 diagnostic fee, waived if repair is completed.',
      ].join('\n'),
      tone_of_voice: 'ONE-LINE SUMMARY\nPlainspoken, practical, and calm.',
      experience_notes: 'Credentials: licensed plumbers with 12 years of leak detection experience.',
    },
    priorContext: {
      sources: '- [EPA WaterSense](https://www.epa.gov/watersense): leak guidance',
    },
    metadata: {
      source_search: { structured_citation_count: 3, filtered_source_count: 2 },
      outline_settings: { include_tldr: false, include_tables: false, include_faq: false, capsule_pct: 35 },
    },
  });

  assert.equal(context.values.business_name, 'Pipe Pros Austin');
  assert.equal(context.values.business_type, 'emergency plumbing company');
  assert.equal(context.values.industry, 'residential plumbing');
  assert.equal(context.values.service_area, 'Austin and Round Rock');
  assert.equal(context.values.never_cite_competitors, 'Roto-Rooter, Mr. Rooter');
  assert.equal(context.values.post_topic, 'How to know if a pipe burst');
  assert.equal(context.values.content_capsule_percentage, '35%');
  assert.ok(context.values.content_capsule_target.includes('35%'));
  assert.ok(context.values.tldr_setting.includes('skip'));
  assert.ok(context.values.tables_setting.includes('do not use markdown tables'));
  assert.ok(context.values.faq_setting.includes('skip'));
  assert.ok(context.values.approved_sources_summary.includes('EPA WaterSense'));

  const rendered = template.renderPromptTemplate(
    'Write for {{business_name}}, a {{business_type}} serving {{service_area}} with expertise in {{industry}}. Capsule: {{content_capsule_target}}. Unknown: {{missing_field}}.',
    context,
  );

  assert.equal(rendered.placeholders.includes('business_name'), true);
  assert.equal(rendered.placeholders.includes('missing_field'), true);
  assert.ok(rendered.text.includes('Pipe Pros Austin'));
  assert.ok(rendered.text.includes('emergency plumbing company'));
  assert.ok(rendered.text.includes('Austin and Round Rock'));
  assert.ok(rendered.text.includes('residential plumbing'));
  assert.ok(rendered.text.includes('35%'));
  assert.equal(rendered.text.includes('{{missing_field}}'), false);
  assert.ok(rendered.placeholder_warnings.some((warning) => warning.includes('missing_field')));

  const systemPrompt = promptBuilders.buildPostStepSystemPrompt(context.values, 'draft', {
    master: promptBuilders.MASTER_WRITING_PROMPT_BASE,
    step: promptBuilders.STEP_INSTRUCTIONS.draft,
    context,
  });
  const userPrompt = promptBuilders.buildPostStepUserMessage(
    {
      topic: 'How to know if a pipe burst',
      target_keyword: 'how will you know if your pipes burst',
    },
    'draft',
    { sources: '- [EPA WaterSense](https://www.epa.gov/watersense): leak guidance', outline: '## Signs [CAPSULE]' },
    promptBuilders.POST_STEP_USER_PROMPTS.draft,
    context,
  );
  assert.equal(systemPrompt.includes('{{'), false);
  assert.equal(userPrompt.includes('{{'), false);
  assert.ok(systemPrompt.includes('Pipe Pros Austin'));
  assert.ok(systemPrompt.includes('35% of H2 sections'));
  assert.ok(userPrompt.includes('residential plumbing'));
}

{
  const context = template.buildWriterPromptContext({
    workspace: { name: 'Untitled Workspace', website_url: null },
    brief: { topic: 'Leak detection basics' },
    kb: {},
  });
  assert.equal(context.values.content_capsule_percentage, '65%');
  assert.ok(context.values.format_settings.includes('Capsule target: 65%'));
  const rendered = template.renderPromptTemplate(
    'You write for {{business_name}} in {{industry}} serving {{service_area}}.',
    context,
  );

  assert.equal(rendered.text.includes('{{'), false);
  assert.ok(rendered.text.includes('Untitled Workspace'));
  assert.ok(rendered.placeholder_warnings.some((warning) => warning.includes('industry')));
  assert.ok(rendered.placeholder_warnings.some((warning) => warning.includes('service_area')));
}

{
  const researchPrompt = prompts.PROMPT_REGISTRY.find((entry) => entry.key === 'post.step.research.system');
  assert.ok(researchPrompt);
  assert.equal(researchPrompt.editable, true);

  const defaultOnly = prompts.resolvePromptText('Default prompt', null);
  assert.deepEqual(defaultOnly, { text: 'Default prompt', source: 'default', publishedVersion: 0 });

  const draftOnly = prompts.resolvePromptText('Default prompt', {
    draft_text: 'Draft prompt',
    published_text: null,
    published_version: 0,
  });
  assert.deepEqual(draftOnly, { text: 'Default prompt', source: 'default', publishedVersion: 0 });

  const published = prompts.resolvePromptText('Default prompt', {
    draft_text: 'Draft prompt',
    published_text: 'Published prompt',
    published_version: 3,
  });
  assert.deepEqual(published, { text: 'Published prompt', source: 'published', publishedVersion: 3 });

  assert.equal(prompts.nextPromptVersion(null), 1);
  assert.equal(prompts.nextPromptVersion({ published_version: 3 }), 4);

  const autoDraftKeys = [
    'discovery.sitemap.user',
    'auto_draft.tone_of_voice.user',
    'auto_draft.service_details.user',
    'auto_draft.brand_guidelines.user',
  ];
  for (const key of autoDraftKeys) {
    const entry = prompts.PROMPT_REGISTRY.find((item) => item.key === key);
    assert.ok(entry, `missing prompt registry entry: ${key}`);
    assert.equal(entry.editable, true);
    assert.ok(entry.placeholders.includes('website_pages_evidence'));
  }
  assert.ok(promptBuilders.KB_AUTO_DRAFT_PROMPTS.service_details.includes('Do not invent pricing'));
  assert.ok(promptBuilders.KB_AUTO_DRAFT_PROMPTS.service_details.includes('NEEDS CONFIRMATION'));
  assert.equal(promptBuilders.DOC_LABELS.service_details, 'Offer Details');
  assert.ok(promptBuilders.KB_AUTO_DRAFT_PROMPTS.service_details.includes('Offer Details'));
  assert.ok(promptBuilders.KB_AUTO_DRAFT_PROMPTS.service_details.includes('features'));
  assert.ok(promptBuilders.WEBSITE_PAGES_DISCOVERY_PROMPT.includes('Feature'));
  assert.deepEqual(promptBuilders.AUTO_DRAFT_DOC_TYPES, [
    'sitemap',
    'tone_of_voice',
    'service_details',
    'brand_guidelines',
  ]);
}

{
  const guidelines = [
    'COMPETITOR HANDLING',
    '- Never name: Roto-Rooter, Mr. Rooter, ARS/Rescue Rooter (national franchises).',
    '- Never cite as a research source: any blog from the above competitors.',
  ].join('\n');
  const terms = sourceFilter.extractNeverCiteTerms(guidelines);
  const filtered = sourceFilter.filterExcludedSources([
    { url: 'https://www.rotorooter.com/blog/pipes/why-do-pipes-burst/', title: 'Why Pipes Burst' },
    { url: 'https://www.epa.gov/watersense/fix-leak-week', title: 'EPA WaterSense' },
    { url: 'https://www.mrrooter.com/about/blog/leaks/', title: 'Leak guide' },
  ], terms);

  assert.equal(filtered.filteredCount, 2);
  assert.deepEqual(filtered.sources.map((source) => source.url), ['https://www.epa.gov/watersense/fix-leak-week']);
}

{
  assert.deepEqual(openrouterOptions.getOpenRouterReasoningConfig('openai/gpt-5.5-pro'), {
    effort: 'minimal',
    exclude: true,
  });
  assert.deepEqual(openrouterOptions.getOpenRouterReasoningConfig('moonshotai/kimi-k2.6'), {
    effort: 'none',
    exclude: true,
  });
  assert.deepEqual(openrouterOptions.getOpenRouterReasoningConfig('deepseek/deepseek-v4-pro'), {
    effort: 'minimal',
    exclude: true,
  });
  assert.equal(openrouterOptions.getOpenRouterReasoningConfig('perplexity/sonar-pro'), undefined);
  assert.equal(openrouterOptions.extractOpenRouterMessageText({ content: [{ type: 'text', text: 'Hello' }, { text: 'world' }] }), 'Hello\nworld');
}

{
  const researchUpdate = postStepPersistence.buildPostStepPersistenceUpdate('research', 'research-json', 'post-1');
  assert.match(researchUpdate.sql, /sources_json = \?/);
  assert.match(researchUpdate.sql, /outline_json = NULL/);
  assert.match(researchUpdate.sql, /body_md = NULL/);
  assert.match(researchUpdate.sql, /body_html = NULL/);
  assert.deepEqual(researchUpdate.params, ['research-json', 'post-1']);

  const outlineUpdate = postStepPersistence.buildPostStepPersistenceUpdate('outline', 'outline-json', 'post-2');
  assert.match(outlineUpdate.sql, /outline_json = \?/);
  assert.match(outlineUpdate.sql, /body_md = NULL/);
  assert.match(outlineUpdate.sql, /body_html = NULL/);
  assert.deepEqual(outlineUpdate.params, ['outline-json', 'post-2']);

  const draftUpdate = postStepPersistence.buildPostStepPersistenceUpdate('draft', 'draft-md', 'post-3');
  assert.match(draftUpdate.sql, /body_md = \?/);
  assert.match(draftUpdate.sql, /body_html = NULL/);
  assert.deepEqual(draftUpdate.params, ['draft-md', 'post-3']);

  const usage = {
    research: { model: 'sonar' },
    outline: { model: 'deepseek' },
    draft: { model: 'deepseek' },
    review: { model: 'deepseek' },
  };
  assert.deepEqual(postStepPersistence.pruneDownstreamStepUsage('research', usage), {
    research: { model: 'sonar' },
  });
  assert.deepEqual(postStepPersistence.pruneDownstreamStepUsage('outline', usage), {
    research: { model: 'sonar' },
    outline: { model: 'deepseek' },
  });
  assert.deepEqual(postStepPersistence.pruneDownstreamStepUsage('draft', usage), {
    research: { model: 'sonar' },
    outline: { model: 'deepseek' },
    draft: { model: 'deepseek' },
  });
}

console.log('content-writer helper tests passed');
