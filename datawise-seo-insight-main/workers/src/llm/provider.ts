import type { Env } from '../index';

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

// User-provided LLM config (BYOK)
export interface UserLLMConfig {
  provider: 'openai' | 'claude' | 'gemini' | 'openrouter';
  api_key: string;
  model?: string;
}

export interface ChatCompleteResult {
  text: string;
  usage: { input_tokens: number; output_tokens: number };
}

export interface LLMProvider {
  chat(messages: ChatMessage[], env: Env, config?: UserLLMConfig): Promise<ReadableStream>;
  chatComplete(messages: ChatMessage[], env: Env, config?: UserLLMConfig, maxTokens?: number): Promise<ChatCompleteResult>;
}

// Factory: user config takes priority, then env config
export function getLLMProvider(env: Env, userConfig?: UserLLMConfig): LLMProvider {
  const provider = userConfig?.provider || env.LLM_PROVIDER || 'openai';
  switch (provider) {
    case 'claude':
      return new ClaudeProvider();
    case 'gemini':
      return new GeminiProvider();
    case 'openrouter':
      return new OpenRouterProvider();
    case 'openai':
    default:
      return new OpenAIProvider();
  }
}

class OpenAIProvider implements LLMProvider {
  async chat(messages: ChatMessage[], env: Env, config?: UserLLMConfig): Promise<ReadableStream> {
    const apiKey = config?.api_key || env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('No OpenAI API key configured. Add your key in Settings.');

    const model = config?.model || env.LLM_MODEL || 'gpt-4o-mini';

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages,
        stream: true,
        temperature: 0.7,
        max_tokens: 4096,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('OpenAI API error:', error);
      if (response.status === 401) throw new Error('Invalid OpenAI API key. Check your key in Settings.');
      throw new Error(`OpenAI error: ${response.status}`);
    }

    return transformSSEStream(response.body!);
  }

  async chatComplete(messages: ChatMessage[], env: Env, config?: UserLLMConfig, maxTokens = 4096): Promise<ChatCompleteResult> {
    const apiKey = config?.api_key || env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('No OpenAI API key configured. Add your key in Settings.');

    const model = config?.model || env.LLM_MODEL || 'gpt-4o-mini';

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages,
        stream: false,
        temperature: 0.7,
        max_tokens: maxTokens,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('OpenAI API error:', error);
      if (response.status === 401) throw new Error('Invalid OpenAI API key. Check your key in Settings.');
      throw new Error(`OpenAI error: ${response.status}`);
    }

    const data = await response.json() as any;
    return {
      text: data.choices?.[0]?.message?.content || '',
      usage: {
        input_tokens: data.usage?.prompt_tokens || 0,
        output_tokens: data.usage?.completion_tokens || 0,
      },
    };
  }
}

class ClaudeProvider implements LLMProvider {
  async chat(messages: ChatMessage[], env: Env, config?: UserLLMConfig): Promise<ReadableStream> {
    const apiKey = config?.api_key || env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('No Anthropic API key configured. Add your key in Settings.');

    const model = config?.model || env.LLM_MODEL || 'claude-sonnet-4-6';

    // Combine ALL system messages into one (Claude API only supports one system param)
    const systemContent = messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n---\n\n');
    const chatMessages = messages.filter(m => m.role !== 'system');

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 4096,
        system: systemContent,
        messages: chatMessages,
        stream: true,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('Claude API error:', error);
      if (response.status === 401) throw new Error('Invalid Anthropic API key. Check your key in Settings.');
      throw new Error(`Claude error: ${response.status}`);
    }

    return transformClaudeStream(response.body!);
  }

  async chatComplete(messages: ChatMessage[], env: Env, config?: UserLLMConfig, maxTokens = 4096): Promise<ChatCompleteResult> {
    const apiKey = config?.api_key || env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('No Anthropic API key configured. Add your key in Settings.');

    const model = config?.model || env.LLM_MODEL || 'claude-sonnet-4-6';

    const systemContent = messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n---\n\n');
    const chatMessages = messages.filter(m => m.role !== 'system');

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system: systemContent,
        messages: chatMessages,
        stream: false,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('Claude API error:', error);
      if (response.status === 401) throw new Error('Invalid Anthropic API key. Check your key in Settings.');
      throw new Error(`Claude error: ${response.status}`);
    }

    const data = await response.json() as any;
    return {
      text: data.content?.[0]?.text || '',
      usage: {
        input_tokens: data.usage?.input_tokens || 0,
        output_tokens: data.usage?.output_tokens || 0,
      },
    };
  }
}

class GeminiProvider implements LLMProvider {
  async chat(messages: ChatMessage[], env: Env, config?: UserLLMConfig): Promise<ReadableStream> {
    const apiKey = config?.api_key;
    if (!apiKey) throw new Error('No Gemini API key configured. Add your key in Settings.');

    const model = config?.model || 'gemini-2.0-flash';

    // Convert to Gemini format
    const systemInstruction = messages.find(m => m.role === 'system')?.content || '';
    const contents = messages
      .filter(m => m.role !== 'system')
      .map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }));

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemInstruction }] },
          contents,
          generationConfig: { temperature: 0.7, maxOutputTokens: 4096 },
        }),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      console.error('Gemini API error:', error);
      if (response.status === 400 || response.status === 403) throw new Error('Invalid Gemini API key. Check your key in Settings.');
      throw new Error(`Gemini error: ${response.status}`);
    }

    return transformGeminiStream(response.body!);
  }

  async chatComplete(messages: ChatMessage[], env: Env, config?: UserLLMConfig, maxTokens = 4096): Promise<ChatCompleteResult> {
    const apiKey = config?.api_key;
    if (!apiKey) throw new Error('No Gemini API key configured. Add your key in Settings.');

    const model = config?.model || 'gemini-2.0-flash';

    const systemInstruction = messages.find(m => m.role === 'system')?.content || '';
    const contents = messages
      .filter(m => m.role !== 'system')
      .map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }));

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemInstruction }] },
          contents,
          generationConfig: { temperature: 0.7, maxOutputTokens: maxTokens },
        }),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      console.error('Gemini API error:', error);
      if (response.status === 400 || response.status === 403) throw new Error('Invalid Gemini API key. Check your key in Settings.');
      throw new Error(`Gemini error: ${response.status}`);
    }

    const data = await response.json() as any;
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    return {
      text,
      usage: {
        input_tokens: data.usageMetadata?.promptTokenCount || 0,
        output_tokens: data.usageMetadata?.candidatesTokenCount || 0,
      },
    };
  }
}

class OpenRouterProvider implements LLMProvider {
  async chat(messages: ChatMessage[], env: Env, config?: UserLLMConfig): Promise<ReadableStream> {
    const apiKey = config?.api_key;
    if (!apiKey) throw new Error('No OpenRouter API key configured. Add your key in Settings.');

    const model = config?.model || 'anthropic/claude-sonnet-4';

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages,
        stream: true,
        temperature: 0.7,
        max_tokens: 4096,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('OpenRouter API error:', error);
      if (response.status === 401) throw new Error('Invalid OpenRouter API key. Check your key in Settings.');
      throw new Error(`OpenRouter error: ${response.status}`);
    }

    return transformSSEStream(response.body!);
  }

  async chatComplete(messages: ChatMessage[], env: Env, config?: UserLLMConfig, maxTokens = 4096): Promise<ChatCompleteResult> {
    const apiKey = config?.api_key;
    if (!apiKey) throw new Error('No OpenRouter API key configured. Add your key in Settings.');

    const model = config?.model || 'anthropic/claude-sonnet-4';

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages,
        stream: false,
        temperature: 0.7,
        max_tokens: maxTokens,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('OpenRouter API error:', error);
      if (response.status === 401) throw new Error('Invalid OpenRouter API key. Check your key in Settings.');
      throw new Error(`OpenRouter error: ${response.status}`);
    }

    const data = await response.json() as any;
    return {
      text: data.choices?.[0]?.message?.content || '',
      usage: {
        input_tokens: data.usage?.prompt_tokens || 0,
        output_tokens: data.usage?.completion_tokens || 0,
      },
    };
  }
}

// Transform OpenAI SSE stream to plain text
function transformSSEStream(input: ReadableStream): ReadableStream {
  const decoder = new TextDecoder();
  let buffer = '';

  return new ReadableStream({
    async start(controller) {
      const reader = input.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6).trim();
              if (data === '[DONE]') continue;
              try {
                const parsed = JSON.parse(data);
                const content = parsed.choices?.[0]?.delta?.content;
                if (content) controller.enqueue(new TextEncoder().encode(content));
              } catch { /* skip */ }
            }
          }
        }
      } finally {
        controller.close();
        reader.releaseLock();
      }
    },
  });
}

// Transform Claude SSE stream to plain text
function transformClaudeStream(input: ReadableStream): ReadableStream {
  const decoder = new TextDecoder();
  let buffer = '';

  return new ReadableStream({
    async start(controller) {
      const reader = input.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const parsed = JSON.parse(line.slice(6).trim());
                if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
                  controller.enqueue(new TextEncoder().encode(parsed.delta.text));
                }
              } catch { /* skip */ }
            }
          }
        }
      } finally {
        controller.close();
        reader.releaseLock();
      }
    },
  });
}

// Transform Gemini SSE stream to plain text
function transformGeminiStream(input: ReadableStream): ReadableStream {
  const decoder = new TextDecoder();
  let buffer = '';

  return new ReadableStream({
    async start(controller) {
      const reader = input.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const parsed = JSON.parse(line.slice(6).trim());
                const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
                if (text) controller.enqueue(new TextEncoder().encode(text));
              } catch { /* skip */ }
            }
          }
        }
      } finally {
        controller.close();
        reader.releaseLock();
      }
    },
  });
}
