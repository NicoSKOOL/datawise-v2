import assert from 'node:assert/strict';
import { sortTableRows } from '../src/lib/table-sort.ts';

const competitionRows = [
  { keyword: 'first medium', competition_level: 'MEDIUM' },
  { keyword: 'first low', competition_level: 'LOW' },
  { keyword: 'first high', competition_level: 'HIGH' },
  { keyword: 'unknown bucket', competition_level: 'UNKNOWN' },
  { keyword: 'blank bucket', competition_level: '-' },
  { keyword: 'second low', competition_level: 'LOW' },
];

assert.deepEqual(
  sortTableRows(competitionRows, { column: 'competition_level', direction: 'asc' }).map((row) => row.keyword),
  ['first low', 'second low', 'first medium', 'first high', 'unknown bucket', 'blank bucket'],
);

assert.deepEqual(
  sortTableRows(competitionRows, { column: 'competition_level', direction: 'desc' }).map((row) => row.keyword),
  ['first high', 'first medium', 'first low', 'second low', 'unknown bucket', 'blank bucket'],
);

const numericRows = [
  { keyword: 'ten', search_volume: '10' },
  { keyword: 'missing', search_volume: '-' },
  { keyword: 'two thousand', search_volume: '2,000' },
  { keyword: 'one', search_volume: 1 },
];

assert.deepEqual(
  sortTableRows(numericRows, { column: 'search_volume', direction: 'asc' }).map((row) => row.keyword),
  ['one', 'ten', 'two thousand', 'missing'],
);

assert.deepEqual(
  sortTableRows(numericRows, { column: 'search_volume', direction: 'desc' }).map((row) => row.keyword),
  ['two thousand', 'ten', 'one', 'missing'],
);
