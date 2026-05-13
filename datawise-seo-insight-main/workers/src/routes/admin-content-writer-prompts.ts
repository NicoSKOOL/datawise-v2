import type { Env } from '../index';
import type { AuthUser } from '../auth/google';
import { isAdmin } from './admin';
import {
  DOC_TYPES,
  AUTO_DRAFT_DOC_TYPES,
  INTERVIEW_PROMPTS,
  FINALIZE_PROMPTS,
  KB_AUTO_DRAFT_PROMPTS,
  MASTER_WRITING_PROMPT_BASE,
  STEP_INSTRUCTIONS,
  POST_STEP_USER_PROMPTS,
  WEBSITE_PAGES_DISCOVERY_PROMPT,
  buildPostStepSystemPrompt,
  buildPostStepUserMessage,
  type DocType,
  type AutoDraftDocType,
  type KBContext,
  type PostStep,
} from '../content-writer/prompts';
import {
  buildWriterPromptContext,
  detectPromptPlaceholders,
  renderPromptTemplate,
  type WriterPromptContext,
} from '../content-writer/prompt-template';
import {
  PROMPT_REGISTRY,
  finalizePromptKey,
  getPromptEntry,
  interviewPromptKey,
  loadPromptConfigs,
  nextPromptVersion,
  postStepPromptKeys,
  resolvePromptFromMap,
  resolvePromptText,
  type PromptConfigRow,
  type PromptVersionRow,
} from '../content-writer/prompt-registry';

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

function newId(): string {
  return crypto.randomUUID().replace(/-/g, '');
}

function forbidden() {
  return json({ error: 'Forbidden' }, 403);
}

function isPostStep(value: unknown): value is PostStep {
  return typeof value === 'string' && ['research', 'outline', 'draft', 'review'].includes(value);
}

function isDocType(value: unknown): value is DocType {
  return typeof value === 'string' && (DOC_TYPES as string[]).includes(value);
}

function isAutoDraftDocType(value: unknown): value is AutoDraftDocType {
  return typeof value === 'string' && (AUTO_DRAFT_DOC_TYPES as string[]).includes(value);
}

export async function handleListContentWriterPrompts(env: Env, user: AuthUser): Promise<Response> {
  if (!isAdmin(user)) return forbidden();

  const configs = await env.DB.prepare(
    `SELECT prompt_key, draft_text, published_text, published_version,
            updated_by, updated_at, published_by, published_at
     FROM content_writer_prompt_configs`
  ).all<PromptConfigRow>();

  const versions = await env.DB.prepare(
    `SELECT id, prompt_key, version, prompt_text, published_by, published_at
     FROM content_writer_prompt_versions
     ORDER BY prompt_key ASC, version DESC`
  ).all<PromptVersionRow>();

  const configMap = new Map((configs.results || []).map((row) => [row.prompt_key, row]));
  const prompt_versions = versions.results || [];
  const prompts = PROMPT_REGISTRY.map((entry) => {
    const config = configMap.get(entry.key) || null;
    const effective = resolvePromptText(entry.defaultText, config);
    return {
      ...entry,
      config,
      effective,
      versions: prompt_versions.filter((version) => version.prompt_key === entry.key).slice(0, 10),
    };
  });

  return json({ prompts });
}

export async function handleUpdateContentWriterPromptDraft(request: Request, env: Env, user: AuthUser, promptKey: string): Promise<Response> {
  if (!isAdmin(user)) return forbidden();
  const entry = getPromptEntry(promptKey);
  if (!entry) return json({ error: 'prompt not found' }, 404);
  if (!entry.editable) return json({ error: 'prompt is read-only' }, 400);

  const body = await request.json().catch(() => ({})) as { draft_text?: unknown };
  if (typeof body.draft_text !== 'string') return json({ error: 'draft_text required' }, 400);

  await env.DB.prepare(
    `INSERT INTO content_writer_prompt_configs (prompt_key, draft_text, updated_by, updated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(prompt_key) DO UPDATE SET
       draft_text = excluded.draft_text,
       updated_by = excluded.updated_by,
       updated_at = excluded.updated_at`
  ).bind(promptKey, body.draft_text, user.id).run();

  return json({ success: true });
}

export async function handlePublishContentWriterPrompt(env: Env, user: AuthUser, promptKey: string): Promise<Response> {
  if (!isAdmin(user)) return forbidden();
  const entry = getPromptEntry(promptKey);
  if (!entry) return json({ error: 'prompt not found' }, 404);
  if (!entry.editable) return json({ error: 'prompt is read-only' }, 400);

  const current = await env.DB.prepare(
    `SELECT prompt_key, draft_text, published_text, published_version,
            updated_by, updated_at, published_by, published_at
     FROM content_writer_prompt_configs
     WHERE prompt_key = ?`
  ).bind(promptKey).first<PromptConfigRow>();

  const text = current?.draft_text?.trim();
  if (!text) return json({ error: 'save a non-empty draft before publishing' }, 400);

  const version = nextPromptVersion(current);
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO content_writer_prompt_configs
         (prompt_key, draft_text, published_text, published_version, updated_by, updated_at, published_by, published_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'), ?, datetime('now'))
       ON CONFLICT(prompt_key) DO UPDATE SET
         published_text = excluded.published_text,
         published_version = excluded.published_version,
         updated_by = excluded.updated_by,
         updated_at = excluded.updated_at,
         published_by = excluded.published_by,
         published_at = excluded.published_at`
    ).bind(promptKey, current?.draft_text || text, text, version, user.id, user.id),
    env.DB.prepare(
      `INSERT INTO content_writer_prompt_versions (id, prompt_key, version, prompt_text, published_by)
       VALUES (?, ?, ?, ?, ?)`
    ).bind(newId(), promptKey, version, text, user.id),
  ]);

  return json({ success: true, version });
}

export async function handleResetContentWriterPrompt(env: Env, user: AuthUser, promptKey: string): Promise<Response> {
  if (!isAdmin(user)) return forbidden();
  const entry = getPromptEntry(promptKey);
  if (!entry) return json({ error: 'prompt not found' }, 404);
  if (!entry.editable) return json({ error: 'prompt is read-only' }, 400);

  await env.DB.prepare(
    `INSERT INTO content_writer_prompt_configs
       (prompt_key, draft_text, published_text, published_version, updated_by, updated_at, published_by, published_at)
     VALUES (?, NULL, NULL, 0, ?, datetime('now'), NULL, NULL)
     ON CONFLICT(prompt_key) DO UPDATE SET
       draft_text = NULL,
       published_text = NULL,
       published_version = 0,
       updated_by = excluded.updated_by,
       updated_at = excluded.updated_at,
       published_by = NULL,
       published_at = NULL`
  ).bind(promptKey, user.id).run();

  return json({ success: true });
}

interface PostPreviewRow {
  id: string;
  workspace_id: string;
  title: string | null;
  topic: string | null;
  target_keyword: string | null;
  brief_json: string | null;
  sources_json: string | null;
  outline_json: string | null;
  body_md: string | null;
}

interface PreviewWorkspace {
  name?: string | null;
  website_url?: string | null;
}

export async function handleRenderContentWriterPrompt(request: Request, env: Env, user: AuthUser): Promise<Response> {
  if (!isAdmin(user)) return forbidden();

  const body = await request.json().catch(() => ({})) as {
    mode?: 'post_step' | 'interview' | 'finalize' | 'website_pages_discovery' | 'kb_auto_draft';
    step?: unknown;
    doc_type?: unknown;
    post_id?: string;
  };

  const configs = await loadPromptConfigs(env.DB);
  const mode = body.mode || 'post_step';
  const previewContext = body.post_id
    ? await buildPreviewFromPost(env, body.post_id)
    : buildSamplePreviewContext();
  const promptContext = buildWriterPromptContext({
    workspace: previewContext.workspace,
    brief: previewContext.brief,
    kb: previewContext.kb,
    priorContext: previewContext.priorContext,
    metadata: previewContext.metadata,
  });

  if (mode === 'website_pages_discovery') {
    const prompt = resolvePromptFromMap(configs, 'discovery.sitemap.user', WEBSITE_PAGES_DISCOVERY_PROMPT);
    const renderedPrompt = renderPromptTemplate(prompt.text, promptContext);
    return json({
      mode,
      doc_type: 'sitemap',
      post_id: body.post_id || null,
      messages: [
        { role: 'system', content: 'You produce precise Website Pages knowledge-base documents from crawled page evidence.' },
        { role: 'user', content: renderedPrompt.text },
      ],
      context: promptContext.values,
      placeholder_warnings: [...new Set(renderedPrompt.placeholder_warnings)],
      template_placeholders: [...new Set(renderedPrompt.placeholders)],
      metadata: {
        ...previewContext.metadata,
        model_routing: {
          crawler: 'deterministic robots.txt + sitemap + homepage crawl',
          fallback_search_model: 'perplexity/sonar-pro',
          summarizer_model: 'deepseek/deepseek-v4-pro',
        },
        prompt_sources: {
          'discovery.sitemap.user': prompt,
        },
      },
    });
  }

  if (mode === 'kb_auto_draft') {
    const docType = isAutoDraftDocType(body.doc_type) ? body.doc_type : 'tone_of_voice';
    const key = docType === 'sitemap' ? 'discovery.sitemap.user' : `auto_draft.${docType}.user`;
    const prompt = resolvePromptFromMap(
      configs,
      key,
      docType === 'sitemap' ? WEBSITE_PAGES_DISCOVERY_PROMPT : KB_AUTO_DRAFT_PROMPTS[docType],
    );
    const renderedPrompt = renderPromptTemplate(prompt.text, promptContext);
    return json({
      mode,
      doc_type: docType,
      post_id: body.post_id || null,
      messages: [
        { role: 'system', content: 'You create conservative, reviewable knowledge-base drafts from crawled business website evidence.' },
        { role: 'user', content: renderedPrompt.text },
      ],
      context: promptContext.values,
      placeholder_warnings: [...new Set(renderedPrompt.placeholder_warnings)],
      template_placeholders: [...new Set(renderedPrompt.placeholders)],
      metadata: {
        ...previewContext.metadata,
        model_routing: {
          crawler: 'deterministic robots.txt + sitemap + homepage crawl',
          fallback_search_model: 'perplexity/sonar-pro',
          draft_model: 'deepseek/deepseek-v4-pro',
        },
        prompt_sources: {
          [key]: prompt,
        },
      },
    });
  }

  if (mode === 'interview' || mode === 'finalize') {
    const docType = isDocType(body.doc_type) ? body.doc_type : 'sitemap';
    const system = resolvePromptFromMap(configs, interviewPromptKey(docType), INTERVIEW_PROMPTS[docType]);
    const renderedSystem = renderPromptTemplate(system.text, promptContext);
    const messages: Array<{ role: 'system' | 'user'; content: string }> = [
      { role: 'system', content: renderedSystem.text },
    ];
    const promptSources: Record<string, unknown> = {
      [interviewPromptKey(docType)]: system,
    };
    const placeholderWarnings = [...renderedSystem.placeholder_warnings];
    const templatePlaceholders = [...renderedSystem.placeholders];
    if (mode === 'finalize') {
      const finalize = resolvePromptFromMap(configs, finalizePromptKey(docType), FINALIZE_PROMPTS[docType]);
      const renderedFinalize = renderPromptTemplate(finalize.text, promptContext);
      messages.push({ role: 'user', content: renderedFinalize.text });
      promptSources[finalizePromptKey(docType)] = finalize;
      placeholderWarnings.push(...renderedFinalize.placeholder_warnings);
      templatePlaceholders.push(...renderedFinalize.placeholders);
    }
    return json({
      mode,
      doc_type: docType,
      post_id: body.post_id || null,
      messages,
      context: promptContext.values,
      placeholder_warnings: [...new Set(placeholderWarnings)],
      template_placeholders: [...new Set(templatePlaceholders)],
      metadata: {
        ...previewContext.metadata,
        prompt_sources: promptSources,
      },
    });
  }

  const step = isPostStep(body.step) ? body.step : 'draft';
  const promptKeys = postStepPromptKeys(step);
  const master = resolvePromptFromMap(configs, promptKeys.master, MASTER_WRITING_PROMPT_BASE);
  const stepPrompt = resolvePromptFromMap(configs, promptKeys.system, STEP_INSTRUCTIONS[step]);
  const userPrompt = resolvePromptFromMap(configs, promptKeys.user, POST_STEP_USER_PROMPTS[step]);

  const messages = [
    {
      role: 'system' as const,
      content: buildPostStepSystemPrompt(previewContext.kb, step, {
        master: master.text,
        step: stepPrompt.text,
        context: promptContext,
      }),
    },
    {
      role: 'user' as const,
      content: buildPostStepUserMessage(
        previewContext.brief,
        step,
        previewContext.priorContext,
        userPrompt.text,
        promptContext,
      ),
    },
  ];
  const renderedMaster = renderPromptTemplate(master.text, promptContext);
  const renderedStep = renderPromptTemplate(stepPrompt.text, promptContext);
  const renderedUser = renderPromptTemplate(userPrompt.text, promptContext);

  return json({
    mode: 'post_step',
    step,
    post_id: body.post_id || null,
    messages,
    context: promptContext.values,
    placeholder_warnings: [...new Set([
      ...renderedMaster.placeholder_warnings,
      ...renderedStep.placeholder_warnings,
      ...renderedUser.placeholder_warnings,
    ])],
    template_placeholders: [...new Set([
      ...detectPromptPlaceholders(master.text),
      ...detectPromptPlaceholders(stepPrompt.text),
      ...detectPromptPlaceholders(userPrompt.text),
    ])],
    metadata: {
      ...previewContext.metadata,
      prompt_sources: {
        [promptKeys.master]: master,
        [promptKeys.system]: stepPrompt,
        [promptKeys.user]: userPrompt,
      },
    },
  });
}

async function buildPreviewFromPost(env: Env, postId: string): Promise<{
  workspace: PreviewWorkspace;
  brief: Parameters<typeof buildPostStepUserMessage>[0];
  kb: KBContext;
  priorContext: { sources?: string; outline?: string; draft?: string };
  metadata: Record<string, unknown>;
}> {
  const post = await env.DB.prepare(
    `SELECT id, workspace_id, title, topic, target_keyword, brief_json, sources_json, outline_json, body_md
     FROM content_writer_posts
     WHERE id = ?`
  ).bind(postId).first<PostPreviewRow>();

  if (!post) return buildSamplePreviewContext();

  const workspace = await env.DB.prepare(
    `SELECT name, website_url
     FROM content_writer_workspaces
     WHERE id = ?`
  ).bind(post.workspace_id).first<PreviewWorkspace>();

  const kbRows = await env.DB.prepare(
    `SELECT doc_type, status, content
     FROM content_writer_kb_docs
     WHERE workspace_id = ?`
  ).bind(post.workspace_id).all<{ doc_type: DocType; status: string; content: string | null }>();

  const kb: KBContext = {};
  const kbStatus: Record<string, string> = {};
  for (const row of kbRows.results || []) {
    kbStatus[row.doc_type] = row.status;
    if (row.status === 'ready' && row.content) kb[row.doc_type] = row.content;
  }

  const brief = post.brief_json ? safeParse(post.brief_json, { topic: post.topic || '' }) : { topic: post.topic || '' };
  const priorContext: { sources?: string; outline?: string; draft?: string } = {};
  const metadata: Record<string, unknown> = { kb_status: kbStatus };

  if (post.sources_json) {
    const parsed = safeParse(post.sources_json, {}) as {
      text?: string;
      ai_questions?: unknown;
      source_search?: unknown;
    };
    priorContext.sources = [parsed.text, formatAiQuestionContext(parsed.ai_questions)]
      .filter(Boolean)
      .join('\n\n');
    metadata.source_search = parsed.source_search || null;
  }
  if (post.outline_json) {
    const parsed = safeParse(post.outline_json, {}) as { text?: string; settings?: Record<string, unknown> };
    priorContext.outline = parsed.text;
    metadata.outline_settings = parsed.settings || null;
  }
  if (post.body_md) priorContext.draft = post.body_md;

  return { workspace: workspace || {}, brief, kb, priorContext, metadata };
}

function buildSamplePreviewContext(): {
  workspace: PreviewWorkspace;
  brief: Parameters<typeof buildPostStepUserMessage>[0];
  kb: KBContext;
  priorContext: { sources?: string; outline?: string; draft?: string };
  metadata: Record<string, unknown>;
} {
  return {
    workspace: {
      name: 'Pipe Pros Austin',
      website_url: 'https://pipepros.example.com',
    },
    brief: {
      topic: 'How to know if a pipe burst',
      target_keyword: 'how will you know if your pipes burst',
      secondary_keywords: 'burst pipe signs, water leak detection',
      takeaway: 'Help homeowners confirm the issue quickly and call for emergency service.',
      notes: 'Use a calm, practical tone and avoid scare tactics.',
      include_tables: true,
      include_tldr: true,
      include_faq: true,
      capsule_pct: 65,
    },
    kb: {
      sitemap: '=== sample ===\nhttps://example.com/emergency-plumbing\nPage type: Service\nDescription: Emergency plumbing services.\nLink-worthy from blog: yes',
      tone_of_voice: 'Plainspoken, local, practical, no hype.',
      experience_notes: 'A homeowner called after hearing water in the wall; the technician found a slow leak before major damage.',
      service_details: 'BUSINESS OVERVIEW\n- Business type: emergency plumbing company\n- Industry: residential plumbing\n- Locations / service area: Austin and Round Rock\n- Primary services: burst pipe repair, water leak detection, drain clearing\n\nPRICING\n- $80 diagnostic fee, waived if repair happens during the same visit. Provide written quote before work.',
      brand_guidelines: 'BUSINESS NAME AND SPELLING\n- Business name: Pipe Pros Austin\n\nCOMPETITOR HANDLING\n- Never cite as a research source: Example Competitor.\n\nFORMATTING RULES\n- No em dashes.\n- No fearmongering.',
    },
    priorContext: {
      sources: '- [EPA WaterSense](https://www.epa.gov/watersense): Household leak prevention guidance.',
      outline: '## What are the first signs of a burst pipe? [CAPSULE]\n- Directly answer the core question.',
      draft: '# Sample draft\n\nA short sample draft for review previews.',
    },
    metadata: {
      kb_status: {
        sitemap: 'sample',
        tone_of_voice: 'sample',
        experience_notes: 'sample',
        service_details: 'sample',
        brand_guidelines: 'sample',
      },
      source_search: {
        mode: 'sample',
        structured_citation_count: 1,
        ai_question_count: 0,
        filtered_source_count: 0,
      },
      outline_settings: {
        include_tldr: true,
        include_tables: true,
        include_faq: true,
        capsule_pct: 65,
      },
      website_pages_evidence: [
        'URL: https://pipepros.example.com/',
        'Title: Pipe Pros Austin | Emergency Plumbing',
        'Page type: homepage',
        'Description: Emergency plumbing and leak detection services in Austin.',
        'H1: Austin Emergency Plumbers',
        'H2: Burst pipe repair; Water leak detection; Drain clearing',
        'Source/confidence: sitemap / high',
        '',
        'URL: https://pipepros.example.com/water-leak-detection',
        'Title: Water Leak Detection in Austin',
        'Page type: service',
        'Description: Non-invasive leak detection and repair guidance.',
        'H1: Water Leak Detection',
        'H2: Signs of hidden leaks; How detection works; Service areas',
        'Source/confidence: nav link / high',
      ].join('\n'),
    },
  };
}

function formatAiQuestionContext(value: unknown): string {
  const ctx = value as { source?: string; seed?: string; questions?: string[] } | null;
  if (!ctx?.questions?.length) return '';
  const label = ctx.source === 'chatgpt_fanout'
    ? 'ChatGPT fan-out queries from DataForSEO (US + English index)'
    : 'People Also Ask fallback questions';
  return [
    `AI search questions to answer (${label}, seed: "${ctx.seed || ''}")`,
    ...ctx.questions.map((q) => `- ${q}`),
  ].join('\n');
}

function safeParse<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
