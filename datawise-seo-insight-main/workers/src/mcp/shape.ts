export interface ToolResult {
  content: Array<{ type: 'text'; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

export interface CompactOptions {
  maxArray: number;
  maxString: number;
  maxDepth?: number;
}

export const CONCISE: CompactOptions = { maxArray: 25, maxString: 300 };
export const DETAILED: CompactOptions = { maxArray: 100, maxString: 2000 };

// Keys that must never reach a model: billing detail and identity (spec 5).
const DROP_KEYS = new Set(['cost', 'request_id', 'user_id']);

const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' };

export function stripHtml(input: string): string {
  return input
    .replace(/<[^>]*>/g, '')
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (m) => ENTITIES[m] ?? m)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function compact(value: unknown, opts: CompactOptions, depth = 0): unknown {
  const maxDepth = opts.maxDepth ?? 6;
  if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const clean = stripHtml(value);
    return clean.length > opts.maxString ? clean.slice(0, opts.maxString - 3) + '...' : clean;
  }
  if (depth >= maxDepth) return undefined;
  if (Array.isArray(value)) {
    return value.slice(0, opts.maxArray).map((v) => compact(v, opts, depth + 1));
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (DROP_KEYS.has(k)) continue;
      const c = compact(v, opts, depth + 1);
      if (c !== undefined) out[k] = c;
    }
    return out;
  }
  return undefined;
}

export function toolResult(structured: Record<string, unknown>, summary: string): ToolResult {
  return {
    content: [{ type: 'text', text: `${summary}\n\n${JSON.stringify(structured)}` }],
    structuredContent: structured,
  };
}

export function toolError(message: string): ToolResult {
  return { isError: true, content: [{ type: 'text', text: message }] };
}
