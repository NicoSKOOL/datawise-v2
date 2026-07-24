import { describe, it, expect } from 'vitest';
import { BLUEPRINT_STAGES, PAGE_TYPES, EVIDENCE_KINDS, WARNING_CODES } from './enums';

describe('contract enums match the handoff', () => {
  it('has 20 pipeline stages, publish last', () => {
    expect(BLUEPRINT_STAGES).toHaveLength(20);
    expect(BLUEPRINT_STAGES[0]).toBe('validate_intake');
    expect(BLUEPRINT_STAGES[12]).toBe('adjudicate_clusters');
    expect(BLUEPRINT_STAGES[19]).toBe('publish_blueprint');
  });
  it('has 10 page types, 10 evidence kinds, 9 warning codes', () => {
    expect(PAGE_TYPES).toHaveLength(10);
    expect(EVIDENCE_KINDS).toHaveLength(10);
    expect(WARNING_CODES).toHaveLength(9);
  });
});
