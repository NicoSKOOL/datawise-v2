import type { DataForSeoEnv } from '../dataforseo/client';

// The engine layer: one adapter per AI engine turns (query, locale) into a
// DataForSEO request and the raw payload into a NormalizedAnswer. Everything
// downstream (tracker, Instant Check, dashboard card) reads only this shape.
// Spec: docs/superpowers/specs/2026-09-06-ai-engines-v2-design.md

export type EngineId = 'google_ai_mode' | 'chatgpt' | 'gemini' | 'perplexity';
export const ALL_ENGINES: EngineId[] = ['google_ai_mode', 'chatgpt', 'gemini', 'perplexity'];

export function isEngineId(value: unknown): value is EngineId {
  return typeof value === 'string' && (ALL_ENGINES as string[]).includes(value);
}

export interface Locale {
  location_code: number;
  language_code: string;
}

export const DEFAULT_LOCALE: Locale = { location_code: 2840, language_code: 'en' };

export interface AnswerSource {
  url: string | null;
  domain: string;
  title: string | null;
  position: number;
}

export interface AnswerBrand {
  name: string;
  category: string | null;
  urls: string[];
}

export interface AnswerAd {
  domain: string | null;
  advertiser: string | null;
  rendered: boolean;
}

export interface NormalizedAnswer {
  engine: EngineId;
  model: string | null;
  answerText: string;
  answerMarkdown: string;
  cited: AnswerSource[];
  retrieved: AnswerSource[];
  brands: AnswerBrand[];
  ads: AnswerAd[];
  fanOut: string[];
}

export interface EngineRequest {
  endpoint: string;
  body: Record<string, unknown>[];
}

export interface EngineAdapter {
  id: EngineId;
  buildRequest(env: DataForSeoEnv, query: string, locale: Locale): Promise<EngineRequest>;
  parse(raw: unknown): NormalizedAnswer;
}
