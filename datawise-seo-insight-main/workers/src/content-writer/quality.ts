export interface WriterQualityAnalysis {
  artifact_count: number;
  artifact_density_per_1000_chars: number;
  checked_chars: number;
  patterns: {
    glued_numeric_markers: number;
    bracketed_markers: number;
    superscript_markers: number;
    orphan_eps: number;
    currency_markers: number;
  };
}

export interface WriterRepairResult {
  text: string;
  repaired: boolean;
  analysis: WriterQualityAnalysis;
  warnings: string[];
}

const GLUED_NUMERIC_MARKER_RE = /(?<=[A-Za-z)\].,;:!?])(?:(?:1[4-9])|05)+(?=\s|[.,;:!?)]|[A-Z])/g;
const BRACKETED_MARKER_RE = /\[(?:\d{1,3})\]/g;
const SUPERSCRIPT_MARKER_RE = /<sup>\s*\d{1,3}\s*<\/sup>|\^\d{1,3}\b/gi;
const ORPHAN_EPS_RE = /\.eps\b/g;
const CURRENCY_MARKER_RE = /(\$\d{2,4})(?:16|14|05)(?=\s+[A-Za-z])/g;

function countMatches(text: string, re: RegExp): number {
  const matches = text.match(re);
  return matches ? matches.length : 0;
}

export function analyzeWriterQuality(text: string): WriterQualityAnalysis {
  const checked = text.length;
  const patterns = {
    glued_numeric_markers: countMatches(text, GLUED_NUMERIC_MARKER_RE),
    bracketed_markers: countMatches(text, BRACKETED_MARKER_RE),
    superscript_markers: countMatches(text, SUPERSCRIPT_MARKER_RE),
    orphan_eps: countMatches(text, ORPHAN_EPS_RE),
    currency_markers: countMatches(text, CURRENCY_MARKER_RE),
  };
  const artifact_count = Object.values(patterns).reduce((sum, value) => sum + value, 0);
  const artifact_density_per_1000_chars = checked > 0 ? (artifact_count / checked) * 1000 : 0;

  return {
    artifact_count,
    artifact_density_per_1000_chars,
    checked_chars: checked,
    patterns,
  };
}

export function shouldRepairWriterOutput(analysis: WriterQualityAnalysis): boolean {
  if (analysis.artifact_count >= 6) return true;
  if (analysis.artifact_count >= 3 && analysis.artifact_density_per_1000_chars >= 3) return true;
  return analysis.patterns.orphan_eps > 0 && analysis.artifact_count >= 2;
}

export function repairWriterOutput(text: string): string {
  return text
    .replace(SUPERSCRIPT_MARKER_RE, '')
    .replace(BRACKETED_MARKER_RE, '')
    .replace(CURRENCY_MARKER_RE, '$1')
    .replace(ORPHAN_EPS_RE, '.')
    .replace(GLUED_NUMERIC_MARKER_RE, '')
    .replace(/[ \t]+([.,;:!?])/g, '$1')
    .replace(/([([{\s]){2,}/g, (match) => match.replace(/[ \t]{2,}/g, ' '))
    .replace(/[ \t]{2,}/g, ' ');
}

export function repairWriterOutputIfNeeded(text: string): WriterRepairResult {
  const analysis = analyzeWriterQuality(text);
  if (!shouldRepairWriterOutput(analysis)) {
    return { text, repaired: false, analysis, warnings: [] };
  }

  const repairedText = repairWriterOutput(text);
  const warnings = [
    `Removed likely citation-marker artifacts (${analysis.artifact_count} matches).`,
  ];

  return {
    text: repairedText,
    repaired: repairedText !== text,
    analysis,
    warnings,
  };
}
