// Anchor text for allocated links. Port of anchors.py. Jev cannot produce
// text, so a writing model picks the span; the rules below are enforced in
// code because the anchor must already exist verbatim in the paragraph.

import type { Allocation } from './types';

const BAD_OPENERS = new Set([
  // English
  'is', 'are', 'was', 'how', 'use', 'using', 'optimizing', 'getting', 'the',
  'a', 'an', 'to', 'and', 'that', 'this', 'these', 'it', 'you', 'your', 'we',
  'see', 'read', 'learn', 'click', 'check', 'find', 'make', 'build',
  // Spanish / Portuguese
  'el', 'la', 'los', 'las', 'un', 'una', 'es', 'son', 'se', 'que', 'para',
  'con', 'y', 'o', 'este', 'esta', 'estos', 'estas', 'tiene', 'hay', 'haz',
  'os', 'um', 'uma', 'e', 'sao', 'com', 'cómo', 'como', 'qué', 'por',
  'sin', 'del', 'al', 'su', 'sus', 'mi', 'tu', 'nuestro', 'nuestra',
  // French / German / Italian
  'le', 'les', 'une', 'est', 'der', 'die', 'das', 'ist', 'il', 'lo', 'gli',
]);
const BANNED = new Set([
  'click here', 'read more', 'this guide', 'learn more', 'here',
  'haz clic aquí', 'aquí', 'leer más', 'más información',
]);
const STOP = new Set([
  'the', 'and', 'for', 'with', 'your', 'you', 'how', 'what', 'que',
  'con', 'para', 'los', 'las', 'del', 'una', 'por', 'como', 'des', 'les',
]);

/** Loose topic words: accents stripped, short prefixes so plurals match. */
export function stems(text: string): Set<string> {
  const t = text.toLowerCase().normalize('NFKD').replace(/[^\x00-\x7f]/g, '');
  const out = new Set<string>();
  for (const w of t.match(/[a-z0-9]+/g) ?? []) {
    if (w.length >= 3 && !STOP.has(w)) out.add(w.slice(0, 5));
  }
  return out;
}

export function anchorPrompt(text: string, targetTitle: string, targetDesc: string): string {
  return `You are placing one internal link inside an existing paragraph.

PARAGRAPH:
${text}

LINK TARGET:
Title: ${targetTitle}
About: ${targetDesc.slice(0, 200)}

Choose the span of text in the paragraph that should become the clickable link.

Rules:
- The paragraph may be in any language. The anchor stays in that language.
- The anchor MUST be copied character-for-character from the paragraph above.
- It must be a NOUN PHRASE naming the thing the target page is about, for
  example "keyword research tool" or "Google AI Overviews".
- 2 to 6 words.
- It must NOT be a clause or a sentence fragment containing a verb, and must
  NOT start with a verb, an article or "the practice of". It must read
  naturally as a link on its own.
- It must name what the TARGET page is about, not just any noun in the text.
- Never "click here", "this guide", "here" or "read more".
- Do not pick a span inside the first 4 words of the paragraph.
- If the paragraph contains no clean noun phrase that matches the target,
  return null. Returning null is much better than a clumsy anchor.

Reply with only JSON: {"anchor": "<exact span>"} or {"anchor": null}`;
}

export type AnchorRejection = 'no_anchor' | 'not_verbatim' | 'bad_shape';

/** Parse the writer's reply and enforce the anchor rules. */
export function validateAnchor(
  reply: string,
  paragraph: string
): { anchor: string } | { rejected: AnchorRejection } {
  const m = reply.match(/\{[\s\S]*\}/);
  if (!m) return { rejected: 'no_anchor' };
  let anchor: unknown;
  try {
    anchor = (JSON.parse(m[0]) as { anchor?: unknown }).anchor;
  } catch {
    return { rejected: 'no_anchor' };
  }
  if (typeof anchor !== 'string' || !anchor) return { rejected: 'no_anchor' };
  if (!paragraph.includes(anchor)) return { rejected: 'not_verbatim' };
  const words = anchor.trim().split(/\s+/);
  if (words.length < 2 || words.length > 6) return { rejected: 'bad_shape' };
  if (BAD_OPENERS.has(words[0].toLowerCase()) || BANNED.has(anchor.toLowerCase())) {
    return { rejected: 'bad_shape' };
  }
  return { anchor };
}

export interface LinkWithAnchor extends Allocation {
  anchor: string;
  preview: string;
  review_reason?: string;
}

/**
 * Attach a validated anchor. An anchor sharing no topic word with the target
 * is often a loose match: keep it, but a human looks at it first.
 */
export function withAnchor(
  link: Allocation,
  anchor: string,
  target: { h1?: string; description?: string }
): LinkWithAnchor {
  const about = [
    link.target_title,
    target.h1 ?? '',
    target.description ?? '',
    link.target_canon.replace(/-/g, ' '),
  ].join(' ');
  const out: LinkWithAnchor = {
    ...link,
    anchor,
    preview: link.text.replace(anchor, `[${anchor}](${link.target})`),
  };
  if (link.action === 'apply') {
    const aboutStems = stems(about);
    const shared = [...stems(anchor)].some((s) => aboutStems.has(s));
    if (!shared) {
      out.action = 'review';
      out.review_reason = 'anchor shares no topic word with the target';
    }
  }
  return out;
}
