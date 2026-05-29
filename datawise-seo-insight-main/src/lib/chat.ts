import { api } from './api';
import { DEFAULT_OPENROUTER_MODEL, isApprovedOpenRouterModel } from './ai-models';

export interface Conversation {
  id: string;
  title: string;
  property_id: string | null;
  updated_at: string;
  property_url?: string;
}

export interface ChatMessageData {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}

export interface LLMConfig {
  provider: 'openrouter';
  api_key: string;
  model?: string;
}

const LLM_CONFIG_KEY = 'datawise_llm_config';

export type StoredLLMConfig = {
  provider?: 'openai' | 'claude' | 'gemini' | 'openrouter' | string;
  api_key?: string;
  model?: string;
};

export function getStoredLLMConfig(): StoredLLMConfig | null {
  const stored = localStorage.getItem(LLM_CONFIG_KEY);
  if (!stored) return null;
  try {
    const parsed = JSON.parse(stored);
    return typeof parsed === 'object' && parsed ? parsed : null;
  } catch {
    return null;
  }
}

export function getLLMConfig(): LLMConfig | null {
  const parsed = getStoredLLMConfig();
  if (!parsed || !parsed.api_key) return null;
  // Tolerate legacy stored provider (openai|claude|gemini) when the saved
  // api_key is clearly an OpenRouter inference key. Users migrated from the
  // multi-provider era still have those records, and a strict provider check
  // surfaced as "API key required" in the SEO Assistant even though the key
  // they saved is valid (bug 663ce49c).
  const looksLikeOpenRouter =
    parsed.provider === 'openrouter' || /^sk-or-/i.test(parsed.api_key);
  if (!looksLikeOpenRouter) return null;
  return {
    provider: 'openrouter',
    api_key: parsed.api_key,
    model: isApprovedOpenRouterModel(parsed.model) ? parsed.model : DEFAULT_OPENROUTER_MODEL,
  };
}

// Cross-component event: localStorage's native `storage` event doesn't fire
// in the SAME tab that wrote the value, so any component reading the chat
// config inside the same SPA (e.g. the Content Writer's ModelBadge) wouldn't
// notice a Settings change. We dispatch a custom event on every write so
// listeners can refresh without a page reload.
export const LLM_CONFIG_EVENT = 'datawise:llm-config-changed';

export function saveLLMConfig(config: LLMConfig): void {
  localStorage.setItem(LLM_CONFIG_KEY, JSON.stringify({
    provider: 'openrouter',
    api_key: config.api_key,
    model: isApprovedOpenRouterModel(config.model) ? config.model : DEFAULT_OPENROUTER_MODEL,
  }));
  window.dispatchEvent(new Event(LLM_CONFIG_EVENT));
}

export function clearLLMConfig(): void {
  localStorage.removeItem(LLM_CONFIG_KEY);
  window.dispatchEvent(new Event(LLM_CONFIG_EVENT));
}

export async function getConversations(propertyId?: string) {
  const qs = propertyId ? `?property_id=${encodeURIComponent(propertyId)}` : '';
  return api<{ conversations: Conversation[] }>(`/chat/conversations${qs}`);
}

export async function getConversation(id: string) {
  return api<{ conversation: Conversation; messages: ChatMessageData[] }>(`/chat/conversations/${id}`);
}

export async function deleteConversation(id: string) {
  return api<{ success: boolean }>(`/chat/conversations/${id}`, { method: 'DELETE' });
}

export async function renameConversation(id: string, title: string) {
  return api<{ success: boolean }>(`/chat/conversations/${id}`, {
    method: 'PATCH',
    body: { title },
  });
}

export async function sendMessage(
  message: string,
  onChunk: (text: string) => void,
  options?: { conversation_id?: string; property_id?: string }
): Promise<{ conversation_id: string }> {
  const token = localStorage.getItem('datawise_session_token');
  const llmConfig = getLLMConfig();
  const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8787';

  if (!llmConfig) {
    throw new Error('NO_LLM_KEY');
  }

  const response = await fetch(`${API_BASE}/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      message,
      conversation_id: options?.conversation_id,
      property_id: options?.property_id,
      llm_config: llmConfig,
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ error: `Error ${response.status}` }));
    throw new Error((errorData as any).error || `Chat error: ${response.status}`);
  }

  const conversationId = response.headers.get('X-Conversation-ID') || '';

  const reader = response.body?.getReader();
  if (!reader) throw new Error('No response body');

  const decoder = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    onChunk(decoder.decode(value, { stream: true }));
  }

  return { conversation_id: conversationId };
}
