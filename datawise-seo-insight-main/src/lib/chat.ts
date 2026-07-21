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

// In-memory copy of the config. First-write, last-resort-read fallback for
// browsers where localStorage is blocked or dropped (iOS Private Browsing,
// in-app browsers): after a server restore, the session still works even if
// the localStorage write fails.
let memoryLLMConfig: StoredLLMConfig | null = null;

export type StoredLLMConfig = {
  provider?: 'openai' | 'claude' | 'gemini' | 'openrouter' | string;
  api_key?: string;
  model?: string;
};

export function getStoredLLMConfig(): StoredLLMConfig | null {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(LLM_CONFIG_KEY);
  } catch {
    stored = null;
  }
  if (!stored) return memoryLLMConfig;
  try {
    const parsed = JSON.parse(stored);
    return typeof parsed === 'object' && parsed ? parsed : memoryLLMConfig;
  } catch {
    return memoryLLMConfig;
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

// Returns true only when the config was actually persisted. iOS Safari/Chrome
// Private Browsing throws on setItem, and in-app browsers (link opened from
// another app) / ITP can accept the write but silently drop it, so a plain
// setItem is not enough to know the key will survive the next read. We
// read-back verify and catch throws so the caller can surface an actionable
// error instead of the key "disappearing" (bug 702e4f26 — iPad user re-entered
// the key twice and it never stuck).
export function saveLLMConfig(config: LLMConfig): boolean {
  const payload = JSON.stringify({
    provider: 'openrouter',
    api_key: config.api_key,
    model: isApprovedOpenRouterModel(config.model) ? config.model : DEFAULT_OPENROUTER_MODEL,
  });
  memoryLLMConfig = JSON.parse(payload);
  let persisted = false;
  try {
    localStorage.setItem(LLM_CONFIG_KEY, payload);
    persisted = localStorage.getItem(LLM_CONFIG_KEY) === payload;
  } catch {
    persisted = false;
  }
  window.dispatchEvent(new Event(LLM_CONFIG_EVENT));
  return persisted;
}

// True when this browser can durably persist the BYOK key. False in iOS
// Private Browsing / restricted in-app browsers where localStorage writes
// throw or are dropped. Used to warn the user before they waste time entering
// a key that won't survive.
export function canPersistLLMConfig(): boolean {
  const probe = '__datawise_ls_probe__';
  try {
    localStorage.setItem(probe, '1');
    const ok = localStorage.getItem(probe) === '1';
    localStorage.removeItem(probe);
    return ok;
  } catch {
    return false;
  }
}

export function clearLLMConfig(): void {
  memoryLLMConfig = null;
  try {
    localStorage.removeItem(LLM_CONFIG_KEY);
  } catch {
    // Blocked storage: the memory copy is cleared, which is what runtime reads.
  }
  window.dispatchEvent(new Event(LLM_CONFIG_EVENT));
}

// Pushes the config to the account-level encrypted backup. Fire-and-forget
// safe: returns false on any failure, never throws.
export async function syncLLMConfigToServer(config: LLMConfig): Promise<boolean> {
  try {
    await api('/api/llm-config', {
      method: 'PUT',
      body: { api_key: config.api_key, model: config.model },
    });
    return true;
  } catch {
    return false;
  }
}

export async function deleteLLMConfigFromServer(): Promise<void> {
  try {
    await api('/api/llm-config', { method: 'DELETE' });
  } catch {
    // Best effort: a failed delete leaves a stale encrypted backup, which the
    // user can overwrite by saving a new key.
  }
}

let llmConfigSyncRan = false;

// Runs once per session after login. If the browser has no usable config but
// the account does, restore it locally (no PUT back). If the browser HAS a
// config, push it up so existing users get backfilled without any action.
export async function restoreOrBackfillLLMConfig(): Promise<void> {
  if (llmConfigSyncRan) return;
  llmConfigSyncRan = true;
  const local = getLLMConfig();
  if (local) {
    void syncLLMConfigToServer(local);
    return;
  }
  try {
    const res = await api<{ config: StoredLLMConfig | null }>('/api/llm-config');
    if (res.config?.api_key) {
      saveLLMConfig({
        provider: 'openrouter',
        api_key: res.config.api_key,
        model: res.config.model,
      });
    }
  } catch {
    // No backup or request failed: behave exactly as before this feature.
  }
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
