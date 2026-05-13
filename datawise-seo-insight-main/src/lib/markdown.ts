// Markdown <-> HTML helpers shared across content tools.
// `marked` handles md→HTML (battle-tested: headings, blockquotes, hrs, fenced
// code, GFM lists/tables). `turndown` handles HTML→markdown for round-tripping
// TipTap edits back into the persisted body_md field.

import { marked } from 'marked';
import TurndownService from 'turndown';
// @ts-expect-error - no types shipped for the GFM plugin
import { gfm } from 'turndown-plugin-gfm';

marked.setOptions({ gfm: true, breaks: false });

export function markdownToHtml(md: string): string {
  if (!md) return '';
  return marked.parse(md, { async: false }) as string;
}

let turndownInstance: TurndownService | null = null;
function getTurndown(): TurndownService {
  if (turndownInstance) return turndownInstance;
  turndownInstance = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
  });
  // GFM plugin adds tables, strikethrough, task lists. Without this, TipTap
  // table edits would lose their markdown structure on autosave.
  turndownInstance.use(gfm);
  return turndownInstance;
}

export function htmlToMarkdown(html: string): string {
  if (!html) return '';
  return getTurndown().turndown(html);
}

// Copy markdown content into the clipboard as both rich text (HTML) and
// plain text so paste targets like Google Docs preserve formatting while
// raw markdown editors still get the source.
export async function copyAsRichText(markdown: string): Promise<boolean> {
  const html = markdownToHtml(markdown);
  if (typeof window === 'undefined' || !navigator.clipboard) return false;

  try {
    if (typeof ClipboardItem !== 'undefined') {
      const item = new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([markdown], { type: 'text/plain' }),
      });
      await navigator.clipboard.write([item]);
      return true;
    }
  } catch {
    // fall through to plain text
  }
  try {
    await navigator.clipboard.writeText(markdown);
    return true;
  } catch {
    return false;
  }
}
