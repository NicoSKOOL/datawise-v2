export interface ContentRevivalOptions {
  include_tldr: boolean;
  include_tables: boolean;
  include_faq: boolean;
  capsule_pct: number;
  extra_instructions: string;
}

export const DEFAULT_CONTENT_REVIVAL_OPTIONS: ContentRevivalOptions = {
  include_tldr: true,
  include_tables: true,
  include_faq: true,
  capsule_pct: 65,
  extra_instructions: '',
};

export function normalizeContentRevivalOptions(input?: Partial<ContentRevivalOptions> | null): ContentRevivalOptions {
  const capsulePct = typeof input?.capsule_pct === 'number' && Number.isFinite(input.capsule_pct)
    ? Math.max(0, Math.min(100, Math.round(input.capsule_pct)))
    : DEFAULT_CONTENT_REVIVAL_OPTIONS.capsule_pct;

  return {
    include_tldr: input?.include_tldr ?? DEFAULT_CONTENT_REVIVAL_OPTIONS.include_tldr,
    include_tables: input?.include_tables ?? DEFAULT_CONTENT_REVIVAL_OPTIONS.include_tables,
    include_faq: input?.include_faq ?? DEFAULT_CONTENT_REVIVAL_OPTIONS.include_faq,
    capsule_pct: capsulePct,
    extra_instructions: typeof input?.extra_instructions === 'string'
      ? input.extra_instructions.trim().slice(0, 1500)
      : '',
  };
}

export function buildContentRevivalRewriteInstructions(input?: Partial<ContentRevivalOptions> | null): string {
  const options = normalizeContentRevivalOptions(input);
  const sections: string[] = [];

  if (options.capsule_pct > 0) {
    sections.push(`CAPSULE CONTENT STRUCTURE (apply to about ${options.capsule_pct}% of H2 sections):
- H2 heading must be phrased as a question when it reads naturally
- Immediately after the H2, write a 30-60 word direct answer in **bold**, self-contained enough to be a featured snippet
- Follow with 2-3 supporting paragraphs, examples, or data
- Do not force capsule formatting on sections where a narrative or table is clearer`);
  } else {
    sections.push(`CAPSULE CONTENT STRUCTURE:
- Do not force capsule formatting. Use normal editorial sections unless the original article already uses answer-led sections.`);
  }

  if (options.include_tldr) {
    sections.push(`TL;DR SECTION (required):
- Add a concise TL;DR directly below the # title and before the introduction
- Use the heading: **TL;DR**
- Write one paragraph of roughly 70-90 words, about 400-500 characters
- Summarize the article's practical answer, not a generic teaser`);
  } else {
    sections.push(`TL;DR SECTION:
- Do not add a TL;DR section.`);
  }

  if (options.include_tables) {
    sections.push(`TABLES (required):
- Include 1-2 genuinely useful markdown tables when the topic supports comparison, steps, criteria, examples, pricing, timelines, or checklists
- Place tables under different H2 sections, not back-to-back
- Each table must help the reader understand the topic faster than prose would
- Do not add filler tables or tables with vague columns`);
  } else {
    sections.push(`TABLES:
- Do not add markdown tables.`);
  }

  if (options.include_faq) {
    sections.push(`FAQ SECTION (required):
- Append a ## Frequently Asked Questions section as the final section
- Include 3 to 5 questions that readers of this topic are likely to ask
- The questions MUST be different from any question already answered or addressed in the post body
- Format each as: ### Question text? followed by a concise 2-4 sentence answer
- Questions should be genuinely useful and reflect real search intent around the topic`);
  } else {
    sections.push(`FAQ SECTION:
- Do not add a FAQ section.`);
  }

  if (options.extra_instructions) {
    sections.push(`EXTRA USER INSTRUCTIONS:
- ${options.extra_instructions}`);
  }

  return sections.join('\n\n');
}

export function buildContentRevivalRefineInstructions(
  changeRequest: string,
  input?: Partial<ContentRevivalOptions> | null,
): string {
  const options = normalizeContentRevivalOptions(input);
  const request = changeRequest.trim().slice(0, 1500);
  const base = buildContentRevivalRewriteInstructions(options);

  return `${base}

REQUESTED REVISION:
- ${request || 'Improve the current rewritten draft while preserving the same article purpose.'}

REFINEMENT RULES:
- Revise the current rewritten markdown instead of starting from scratch
- Preserve strong existing sections and links unless the request conflicts with them
- Keep clean markdown only, with no preamble or commentary
- Copy/download users should be able to use the result directly`;
}
