import { describe, it, expect } from 'vitest';
import { BLUEPRINT_STAGES } from '../contracts/enums';
import type { BlueprintStage } from '../contracts/enums';
import { CLUSTER_RULESET_V2 } from './clustering/ruleset';
import { PAGE_PLAN_RULESET_V1 } from './page-plan/ruleset';
import { BLUEPRINT_RULESET_VERSION, BLUEPRINT_SCHEMA_VERSION, LEGACY_RULESET_VERSION, rulesetVersionForStage } from './ruleset';

const CLUSTER_STAGES: BlueprintStage[] = [
  'normalize_keyword_universe', 'embed_keyword_features', 'build_provisional_clusters', 'refine_clusters',
];
const PAGE_PLAN_STAGES: BlueprintStage[] = [
  'parse_competitor_pages', 'build_page_plan', 'overlay_existing_site', 'validate_blueprint', 'publish_blueprint',
];

describe('rulesetVersionForStage', () => {
  it('maps clustering stages to CLUSTER_RULESET_V2.version', () => {
    for (const stage of CLUSTER_STAGES) {
      expect(rulesetVersionForStage(stage)).toBe(CLUSTER_RULESET_V2.version);
    }
  });

  it('maps page-planning stages to PAGE_PLAN_RULESET_V1.version', () => {
    for (const stage of PAGE_PLAN_STAGES) {
      expect(rulesetVersionForStage(stage)).toBe(PAGE_PLAN_RULESET_V1.version);
    }
  });

  it('maps every other stage to LEGACY_RULESET_VERSION', () => {
    const other = BLUEPRINT_STAGES.filter(
      (s) => !CLUSTER_STAGES.includes(s) && !PAGE_PLAN_STAGES.includes(s)
    );
    expect(other.length).toBeGreaterThan(0);
    for (const stage of other) {
      expect(rulesetVersionForStage(stage)).toBe(LEGACY_RULESET_VERSION);
    }
  });

  it('covers every declared BlueprintStage (no stage silently falls through)', () => {
    for (const stage of BLUEPRINT_STAGES) {
      expect(typeof rulesetVersionForStage(stage)).toBe('string');
    }
  });
});

describe('version constants', () => {
  it('LEGACY_RULESET_VERSION matches the historical phase2 stub value', () => {
    expect(LEGACY_RULESET_VERSION).toBe('phase2-stub');
  });

  it('BLUEPRINT_RULESET_VERSION composes both v1 ruleset versions', () => {
    expect(BLUEPRINT_RULESET_VERSION).toBe('cluster-v2+pp-v1');
  });

  it('BLUEPRINT_SCHEMA_VERSION is the phase4 schema tag', () => {
    expect(BLUEPRINT_SCHEMA_VERSION).toBe('p4');
  });
});
