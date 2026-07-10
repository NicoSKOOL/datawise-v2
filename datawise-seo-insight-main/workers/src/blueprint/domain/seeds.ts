import type { NormalizedProjectBrief } from '../contracts/types';

export interface SeedPolicy {
  maxTotalSeeds: number;
  includePrimaryAreaSeeds: boolean;
}

export interface SeedQuery {
  query: string;
  serviceId: string | null;
  serviceAreaId: string | null;
  source: 'category' | 'service' | 'service_primary_area';
}

export interface SeedQueryPlan {
  seeds: SeedQuery[];
  truncated: boolean;
}

// Seeds category + each service + each service in the PRIMARY area only.
// Never expands the full service x area cross product (doorway guardrail
// starts at research planning, not just page planning).
export function buildSeedQueries(brief: NormalizedProjectBrief, policy: SeedPolicy): SeedQueryPlan {
  const seeds: SeedQuery[] = [];
  const seen = new Set<string>();
  const push = (query: string, serviceId: string | null, serviceAreaId: string | null, source: SeedQuery['source']) => {
    const key = query.trim().toLowerCase().replace(/\s+/g, ' ');
    if (key && !seen.has(key)) {
      seen.add(key);
      seeds.push({ query: key, serviceId, serviceAreaId, source });
    }
  };

  push(brief.category, null, null, 'category');
  for (const service of brief.services) push(service.normalizedName, service.id, null, 'service');

  const primaryArea = brief.serviceAreas.find((a) => a.isPrimary) ?? null;
  if (policy.includePrimaryAreaSeeds && primaryArea) {
    for (const service of brief.services) {
      push(`${service.normalizedName} ${primaryArea.city.toLowerCase()}`, service.id, primaryArea.id, 'service_primary_area');
    }
  }

  return { seeds: seeds.slice(0, policy.maxTotalSeeds), truncated: seeds.length > policy.maxTotalSeeds };
}
