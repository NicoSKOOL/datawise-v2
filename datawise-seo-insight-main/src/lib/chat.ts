import { api } from './api';

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
  provider: 'openai' | 'claude' | 'gemini' | 'openrouter';
  api_key: string;
  model?: string;
}

const LLM_CONFIG_KEY = 'datawise_llm_config';

export function getLLMConfig(): LLMConfig | null {
  const stored = localStorage.getItem(LLM_CONFIG_KEY);
  if (!stored) return null;
  try {
    return JSON.parse(stored);
  } catch {
    return null;
  }
}

export function saveLLMConfig(config: LLMConfig): void {
  localStorage.setItem(LLM_CONFIG_KEY, JSON.stringify(config));
}

export function clearLLMConfig(): void {
  localStorage.removeItem(LLM_CONFIG_KEY);
}

export async function getConversations() {
  return api<{ conversations: Conversation[] }>('/chat/conversations');
}

export async function getConversation(id: string) {
  return api<{ conversation: Conversation; messages: ChatMessageData[] }>(`/chat/conversations/${id}`);
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
