import type { BlueprintGraphNode } from '../db/blueprint-reads';
import { PAGE_PLAN_RULESET_V1 } from '../domain/page-plan/ruleset';

export interface CsvPageRow extends BlueprintGraphNode {
  parentSlug: string | null;
  decisionReason: string | null;
}

function escapeCsvField(value: string | number | null): string {
  if (value === null || value === undefined) {
    return '';
  }

  const str = String(value);

  if (str.includes('"') || str.includes(',') || str.includes('\n')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }

  return str;
}

export function buildBlueprintCsv(rows: CsvPageRow[]): string {
  const header = 'slug,title,page_type,primary_keyword,volume,intent,parent_slug,recommendation,priority,supporting_keywords,decision_reason,supporting_keyword_count';

  const csvRows = rows.map((row) => {
    const fields = [
      escapeCsvField(row.slug),
      escapeCsvField(row.title),
      escapeCsvField(row.pageType),
      escapeCsvField(row.primaryKeyword),
      escapeCsvField(row.primaryVolume),
      escapeCsvField(row.primaryIntent),
      escapeCsvField(row.parentSlug),
      escapeCsvField(row.recommendation),
      escapeCsvField(row.priority),
      escapeCsvField(row.supportingKeywords.slice(0, PAGE_PLAN_RULESET_V1.supporting.exportCap).join('|')),
      escapeCsvField(row.decisionReason),
      escapeCsvField(row.supportingKeywordCount),
    ];

    return fields.join(',');
  });

  return [header, ...csvRows].join('\r\n');
}
