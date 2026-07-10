import { describe, it, expect } from 'vitest';
import { evaluateServiceLocationPage, detectDoorwayRisk } from './doorway';
import type { NormalizedProjectBrief, PageCandidate, KeywordClusterSummary } from '../contracts/types';

const service = { id: 's1', name: 'Drain Cleaning', normalizedName: 'drain cleaning', description: null, synonyms: [], priority: 'primary' as const };
const areaWithProof = { id: 'a1', city: 'Austin', region: null, countryIso: 'US', radiusKm: null, isPrimary: true, uniqueProof: ['Local crew based on South Lamar'] };
const areaNoProof = { id: 'a2', city: 'Round Rock', region: null, countryIso: 'US', radiusKm: null, isPrimary: false, uniqueProof: [] };
const cluster: KeywordClusterSummary = { id: 'c1', label: 'drain cleaning austin', keywordCount: 8, totalSearchVolume: 1400, hasLocalizedEvidence: true };
const rules = { requireLocalEvidence: true, requireUniqueProof: true, minClusterVolume: 50 };
const brief = { excludedTopics: [] } as unknown as NormalizedProjectBrief;

describe('evaluateServiceLocationPage', () => {
  it('allows a localized page with demand evidence and unique proof', () => {
    const d = evaluateServiceLocationPage(service, areaWithProof, cluster, rules);
    expect(d.allowed).toBe(true);
    expect(d.reasons).toEqual([]);
  });
  it('denies when there is no local demand evidence (cluster null)', () => {
    const d = evaluateServiceLocationPage(service, areaWithProof, null, rules);
    expect(d.allowed).toBe(false);
    expect(d.reasons).toContain('no_local_demand_evidence');
  });
  it('denies when the area has no unique proof, with a missing_local_proof warning', () => {
    const d = evaluateServiceLocationPage(service, areaNoProof, cluster, rules);
    expect(d.allowed).toBe(false);
    expect(d.warnings.some((w) => w.code === 'missing_local_proof')).toBe(true);
  });
  it('null cluster volume produces missing_metrics warning, not a zero-volume denial', () => {
    const noVolume = { ...cluster, totalSearchVolume: null };
    const d = evaluateServiceLocationPage(service, areaWithProof, noVolume, rules);
    expect(d.allowed).toBe(true);
    expect(d.warnings.some((w) => w.code === 'missing_metrics')).toBe(true);
  });
  it('denies below the volume floor', () => {
    const tiny = { ...cluster, totalSearchVolume: 10 };
    const d = evaluateServiceLocationPage(service, areaWithProof, tiny, rules);
    expect(d.allowed).toBe(false);
    expect(d.reasons).toContain('below_volume_floor');
  });
});

describe('detectDoorwayRisk', () => {
  const candidate = (clientId: string, city: string, proof: string[] = []): PageCandidate => ({
    clientId, type: 'service_location', title: `Drain Cleaning ${city}`,
    proposedSlug: `/drain-cleaning-${city.toLowerCase().replace(/\s+/g, '-')}/`,
    serviceId: 's1', serviceAreaId: city, primaryKeywordNormalized: `drain cleaning ${city.toLowerCase()}`,
    uniqueProof: proof,
  });
  it('flags location-swap siblings without unique proof as doorway risk', () => {
    const warnings = detectDoorwayRisk(candidate('p1', 'Austin'), [candidate('p2', 'Round Rock'), candidate('p3', 'Pflugerville')], brief, rules);
    expect(warnings.some((w) => w.code === 'doorway_risk')).toBe(true);
    expect(warnings.some((w) => w.code === 'thin_content_risk')).toBe(true);
  });
  it('does not flag when the candidate has unique local proof', () => {
    const warnings = detectDoorwayRisk(candidate('p1', 'Austin', ['Dedicated Austin crew', 'Austin case studies']), [candidate('p2', 'Round Rock')], brief, rules);
    expect(warnings.some((w) => w.code === 'thin_content_risk')).toBe(false);
  });
  it('non service_location candidates produce no doorway warnings', () => {
    const svc: PageCandidate = { ...candidate('p1', 'Austin'), type: 'service' };
    expect(detectDoorwayRisk(svc, [], brief, rules)).toEqual([]);
  });
});
