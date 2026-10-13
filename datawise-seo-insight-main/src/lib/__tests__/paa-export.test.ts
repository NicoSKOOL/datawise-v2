import { describe, it, expect } from 'vitest';
import { pickPaaExportRows } from '../paa-export';
import { normalizePlannerKeyword } from '../planner-keyword-selection';

// Bug d8341bf6 (Jongwon): ticking some questions and clicking Download CSV
// still exported every question.
const rows = [
  { question: 'What is the 3-3-3 rule in dog training?' },
  { question: 'How do I start training my dog?' },
  { question: 'What not to do when training a dog?' },
];

describe('pickPaaExportRows', () => {
  it('exports everything when nothing is selected', () => {
    expect(pickPaaExportRows(rows, new Set())).toEqual(rows);
  });

  it('exports only the selected questions, in their original order', () => {
    const selected = new Set([rows[2].question, rows[0].question].map(normalizePlannerKeyword));
    expect(pickPaaExportRows(rows, selected)).toEqual([rows[0], rows[2]]);
  });
});
