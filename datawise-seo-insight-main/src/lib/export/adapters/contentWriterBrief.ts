import type { ReportPayload, ReportSection } from '../types';
import { MAX_TABLE_ROWS, excerpt } from './shared';

export interface ContentBriefSource {
  label: string;
  url: string | null;
  summary?: string;
  approved?: boolean;
}

interface Args {
  post: {
    title: string | null;
    topic: string | null;
    target_keyword: string | null;
    status: string;
  };
  brief: {
    topic?: string;
    target_keyword?: string;
    secondary_keywords?: string;
    takeaway?: string;
    notes?: string;
  };
  sources: ContentBriefSource[];
  outlineMd: string;
}

export function buildContentWriterBriefReport({ post, brief, sources, outlineMd }: Args): ReportPayload {
  const sections: ReportSection[] = [];
  const title = post.title || post.topic || 'Untitled post';

  // --- Brief details ---
  sections.push({ type: 'heading', level: 2, text: 'Brief' });
  const briefLines: string[] = [];
  if (brief.topic || post.topic) briefLines.push(`Topic: ${brief.topic || post.topic}`);
  if (brief.target_keyword || post.target_keyword) {
    briefLines.push(`Target keyword: ${brief.target_keyword || post.target_keyword}`);
  }
  if (brief.secondary_keywords) briefLines.push(`Secondary keywords: ${brief.secondary_keywords}`);
  if (brief.takeaway) briefLines.push(`Key takeaway: ${brief.takeaway}`);
  if (brief.notes) briefLines.push(`Notes: ${brief.notes}`);
  briefLines.push(`Status: ${post.status}`);
  sections.push({ type: 'list', style: 'bullet', items: briefLines });

  // --- Outline ---
  sections.push({ type: 'heading', level: 2, text: 'Outline' });
  if (outlineMd.trim()) {
    sections.push({ type: 'markdown', content: outlineMd });
  } else {
    sections.push({ type: 'paragraph', text: 'No outline yet. Run the outline step to generate one.' });
  }

  // --- Sources ---
  sections.push({ type: 'heading', level: 2, text: `Sources (${sources.length})` });
  if (sources.length === 0) {
    sections.push({ type: 'paragraph', text: 'No research sources yet. Run the research step to gather them.' });
  } else {
    const shown = sources.slice(0, MAX_TABLE_ROWS);
    sections.push({
      type: 'list',
      style: 'numbered',
      items: shown.map((s) => {
        const parts = [s.label];
        if (s.summary) parts.push(excerpt(s.summary, 200));
        if (s.url) parts.push(s.url);
        const approvedNote = s.approved === false ? ' (not approved)' : '';
        return `${parts.join(': ')}${approvedNote}`;
      }),
    });
    if (sources.length > MAX_TABLE_ROWS) {
      sections.push({
        type: 'callout',
        tone: 'info',
        text: `Showing the first ${MAX_TABLE_ROWS} sources. ${sources.length - MAX_TABLE_ROWS} more were omitted from this export.`,
      });
    }
  }

  return {
    title: `Content Brief: ${title}`,
    subtitle: post.target_keyword ? `Target keyword: ${post.target_keyword}` : undefined,
    generatedAt: new Date(),
    sections,
  };
}
