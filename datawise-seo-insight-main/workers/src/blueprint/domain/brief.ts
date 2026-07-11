import { z } from 'zod';
import type { ProjectBriefInput, NormalizedProjectBrief } from '../contracts/types';
import type { ProductLimits } from '../contracts/limits';
import { BlueprintValidationError } from './errors';
import { normalizeDomain, assertPublicWebTarget } from './url';
import { normalizeKeyword } from './keyword';
import { hashNormalizedInput } from './hash';

const serviceSchema = z.object({
  clientId: z.string().min(1),
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).optional(),
  priority: z.enum(['primary', 'secondary']).optional(),
});

const areaSchema = z.object({
  clientId: z.string().min(1),
  city: z.string().trim().min(1).max(80),
  region: z.string().trim().max(80).optional(),
  countryIso: z.string().length(2),
  radiusKm: z.number().positive().max(500).optional(),
  isPrimary: z.boolean(),
  uniqueProof: z.array(z.string().trim().min(1).max(300)).max(10).optional(),
});

const briefSchema = z
  .object({
    businessName: z.string().trim().min(1).max(120),
    category: z.string().trim().min(1).max(80),
    websiteUrl: z.string().trim().url().optional(),
    countryIso: z.string().length(2),
    languageCode: z.string().trim().min(2).max(8),
    services: z.array(serviceSchema).min(1).max(10),
    serviceAreas: z.array(areaSchema).max(5),
    targetCustomers: z.array(z.string().trim().min(1).max(120)).max(10).optional(),
    differentiators: z.array(z.string().trim().min(1).max(300)).max(10).optional(),
    knownCompetitorDomains: z.array(z.string().trim().min(3).max(255)).max(10).optional(),
    excludedDomains: z.array(z.string().trim().min(3).max(255)).max(20).optional(),
    excludedTopics: z.array(z.string().trim().min(1).max(120)).max(20).optional(),
    goals: z.array(z.enum(['leads', 'local_visibility', 'authority'])).max(3).optional(),
    maxRecommendedPages: z.number().int().min(5).max(150).optional(),
    enableUsFanout: z.boolean().optional(),
  })
  .superRefine((val, ctx) => {
    if (val.serviceAreas.length > 0) {
      const primaries = val.serviceAreas.filter((a) => a.isPrimary).length;
      if (primaries !== 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['serviceAreas'],
          message: 'Exactly one service area must be primary',
        });
      }
    }
  });

export function parseProjectBrief(input: unknown): ProjectBriefInput {
  const parsed = briefSchema.safeParse(input);
  if (!parsed.success) {
    throw new BlueprintValidationError(
      'invalid_input',
      parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))
    );
  }
  return parsed.data as ProjectBriefInput;
}

// Async (catalog lists this sync): inputHash is computed here so a normalized
// brief can never exist without its hash.
export async function normalizeProjectBrief(
  input: ProjectBriefInput,
  limits: ProductLimits
): Promise<NormalizedProjectBrief> {
  const countryIso = input.countryIso.toUpperCase();
  const languageCode = input.languageCode.toLowerCase();
  const locale = `${languageCode}-${countryIso}`;
  // assertPublicWebTarget is a pure guard here (SSRF: provider stages will
  // eventually fetch this URL); normalizeDomain still owns deriving the
  // domain value used everywhere else.
  if (input.websiteUrl) assertPublicWebTarget(input.websiteUrl);
  const websiteDomain = input.websiteUrl ? normalizeDomain(input.websiteUrl) : null;
  const dedupe = (arr: string[] = []) => [...new Set(arr.map((x) => x.trim()).filter(Boolean))];

  const base = {
    mode: (websiteDomain ? 'existing_site' : 'greenfield') as NormalizedProjectBrief['mode'],
    businessName: input.businessName.trim(),
    normalizedBusinessName: normalizeKeyword(input.businessName, locale),
    category: input.category.trim(),
    websiteDomain,
    websiteUrl: input.websiteUrl ?? null,
    countryIso,
    languageCode,
    services: input.services.map((s) => ({
      id: s.clientId,
      name: s.name.trim(),
      normalizedName: normalizeKeyword(s.name, locale),
      description: s.description?.trim() || null,
      synonyms: [] as string[], // filled by AI normalization stage later; deterministic default is empty
      priority: s.priority ?? ('primary' as const),
    })),
    serviceAreas: input.serviceAreas.map((a) => ({
      id: a.clientId,
      city: a.city.trim(),
      region: a.region?.trim() || null,
      countryIso: a.countryIso.toUpperCase(),
      radiusKm: a.radiusKm ?? null,
      isPrimary: a.isPrimary,
      uniqueProof: a.uniqueProof ?? [],
    })),
    targetCustomers: dedupe(input.targetCustomers),
    differentiators: dedupe(input.differentiators).map((text, i) => ({ id: `diff_${i + 1}`, text })),
    knownCompetitorDomains: [...new Set(dedupe(input.knownCompetitorDomains).map(normalizeDomain))],
    excludedDomains: [...new Set(dedupe(input.excludedDomains).map(normalizeDomain))],
    excludedTopics: [...new Set(dedupe(input.excludedTopics).map((t) => t.toLowerCase()))],
    goals: input.goals && input.goals.length ? input.goals : ['leads' as const],
    maxRecommendedPages: Math.min(input.maxRecommendedPages ?? limits.defaultMaxRecommendedPages, limits.maxRecommendedPages),
    enableUsFanout: input.enableUsFanout ?? false,
  };

  const inputHash = await hashNormalizedInput(base);
  return { ...base, inputHash };
}
