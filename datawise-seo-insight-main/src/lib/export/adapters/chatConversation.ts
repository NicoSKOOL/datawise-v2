import type { ReportPayload, ReportSection } from '../types';
import type { ChatMessageData, Conversation } from '@/lib/chat';

interface Args {
  conversation: Conversation;
  messages: ChatMessageData[];
}

export function buildChatConversationReport({ conversation, messages }: Args): ReportPayload {
  const sections: ReportSection[] = [];

  const messageCount = messages.length;
  const userCount = messages.filter((m) => m.role === 'user').length;
  const assistantCount = messages.filter((m) => m.role === 'assistant').length;

  sections.push({
    type: 'kpi-grid',
    items: [
      { label: 'Messages', value: String(messageCount) },
      { label: 'Your Prompts', value: String(userCount) },
      { label: 'Assistant Replies', value: String(assistantCount) },
    ],
  });

  sections.push({ type: 'divider' });

  messages.forEach((msg) => {
    const who = msg.role === 'user' ? 'You' : 'SEO Assistant';
    const ts = formatTimestamp(msg.created_at);
    sections.push({ type: 'heading', level: 3, text: `${who}  ·  ${ts}` });
    sections.push({ type: 'markdown', content: msg.content });
  });

  const dateRange = dateRangeFromMessages(messages);

  return {
    title: conversation.title || 'SEO Assistant Conversation',
    subtitle: conversation.property_url
      ? `Property: ${conversation.property_url}`
      : 'SEO Assistant export',
    domain: conversation.property_url,
    dateRange,
    generatedAt: new Date(),
    sections,
  };
}

function formatTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function dateRangeFromMessages(
  messages: ChatMessageData[]
): { from: string; to: string } | undefined {
  if (!messages.length) return undefined;
  const sorted = [...messages].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const fmt = (iso: string) => {
    try {
      return new Date(iso).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
    } catch {
      return iso;
    }
  };
  return { from: fmt(sorted[0].created_at), to: fmt(sorted[sorted.length - 1].created_at) };
}
