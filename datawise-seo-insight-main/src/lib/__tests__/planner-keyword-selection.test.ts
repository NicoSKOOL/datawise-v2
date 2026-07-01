import { describe, expect, it } from 'vitest';
import {
  buildPlannerItem,
  getSelectedPlannerItems,
  toPlannerIntent,
} from '../planner-keyword-selection';

describe('toPlannerIntent', () => {
  it('maps display-cased intents to PlannerIntent values', () => {
    expect(toPlannerIntent('Commercial')).toBe('commercial');
    expect(toPlannerIntent('informational')).toBe('informational');
    expect(toPlannerIntent('Navigational')).toBe('navigational');
    expect(toPlannerIntent('Transactional')).toBe('transactional');
  });

  it('returns undefined for unknown or non-string values', () => {
    expect(toPlannerIntent('Consumer')).toBeUndefined();
    expect(toPlannerIntent(42)).toBeUndefined();
    expect(toPlannerIntent(undefined)).toBeUndefined();
  });
});

describe('per-row intent', () => {
  const rows = [
    { keyword: 'buy hvac unit', search_volume: 50, intent: 'Commercial' },
    { keyword: 'how to fix hvac', search_volume: 500, intent: 'Informational' },
  ];

  it('buildPlannerItem uses getRowIntent when provided', () => {
    const item = buildPlannerItem(rows[0], {
      source: 'keyword-gap',
      intent: 'informational',
      getRowIntent: (row) => toPlannerIntent(row.intent),
    });
    expect(item?.intent).toBe('commercial');
  });

  it('buildPlannerItem falls back to options.intent when getRowIntent returns undefined', () => {
    const item = buildPlannerItem({ keyword: 'plain', intent: 'Nonsense' }, {
      source: 'keyword-gap',
      intent: 'informational',
      getRowIntent: (row) => toPlannerIntent(row.intent),
    });
    expect(item?.intent).toBe('informational');
  });

  it('getSelectedPlannerItems threads getRowIntent through', () => {
    const items = getSelectedPlannerItems(
      rows,
      new Set(['buy hvac unit', 'how to fix hvac']),
      {
        source: 'keyword-gap',
        intent: 'informational',
        getRowIntent: (row) => toPlannerIntent(row.intent),
      },
    );
    expect(items.map((i) => i.intent)).toEqual(['commercial', 'informational']);
  });
});
