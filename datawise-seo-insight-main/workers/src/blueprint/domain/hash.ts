import type { BlueprintStage } from '../contracts/enums';

export function canonicalize(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortValue);
  if (v && typeof v === 'object') {
    const obj = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) out[key] = sortValue(obj[key]);
    return out;
  }
  return v;
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function hashNormalizedInput(value: unknown): Promise<string> {
  return sha256Hex(canonicalize(value));
}

export async function buildStageInputHash(input: {
  runId: string;
  stage: BlueprintStage;
  normalizedInputHash: string;
  evidenceHash?: string;
  promptVersion?: string;
  schemaVersion?: string;
  schemaHash?: string;
  rulesetVersion?: string;
  modelPolicyVersion?: string;
}): Promise<string> {
  return hashNormalizedInput(input);
}
