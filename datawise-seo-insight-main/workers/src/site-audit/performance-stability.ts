export type LoadingVerdict = 'fast' | 'ok' | 'slow' | 'very_slow' | 'unknown';
export type PerformanceConfidence = 'high' | 'medium' | 'low';
export type PerformanceScoreSource = 'lighthouse_median' | 'onpage_fallback';

export interface PerformanceProbeSample {
  ok: boolean;
  lcp_ms?: number | null;
  performance_score?: number | null;
  status_code?: number | null;
  status_message?: string | null;
  error?: string | null;
  duration_ms?: number | null;
  lighthouse_version?: string | null;
  final_url?: string | null;
}

export interface PerformanceMeasurementSummary {
  requested_sample_count: number;
  sample_count: number;
  successful_sample_count: number;
  median_lcp_ms: number | null;
  median_seconds: number | null;
  seconds_min: number | null;
  seconds_max: number | null;
  median_performance_score: number | null;
  score_source: PerformanceScoreSource;
  confidence: PerformanceConfidence;
  straddles_lcp_threshold: boolean;
}

export interface StableLoadingSummary {
  score: number;
  seconds: number | null;
  ttfb_ms: number | null;
  total_bytes: number | null;
  verdict: LoadingVerdict;
  verdict_text: string;
  sample_count?: number;
  seconds_min?: number | null;
  seconds_max?: number | null;
  score_source?: PerformanceScoreSource;
  confidence?: PerformanceConfidence;
  straddles_lcp_threshold?: boolean;
}

export async function collectPerformanceProbeSamples(
  requestedSampleCount: number,
  runProbe: (sampleIndex: number) => Promise<PerformanceProbeSample>
): Promise<PerformanceProbeSample[]> {
  return Promise.all(
    Array.from({ length: requestedSampleCount }, (_, index) => runProbe(index + 1))
  );
}

const LCP_NEEDS_IMPROVEMENT_MS = 2500;

function roundMs(value: number): number {
  return Math.round(value);
}

function roundSeconds(value: number): number {
  return Math.round(value * 10) / 10;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function loadingScoreFromSeconds(seconds: number | null): number {
  if (seconds == null) return 50;
  if (seconds < 1.5) return 95;
  if (seconds < 2.5) return 80;
  if (seconds < 4) return 55;
  return 25;
}

export function loadingVerdictFromSeconds(seconds: number | null): LoadingVerdict {
  if (seconds == null) return 'unknown';
  if (seconds < 1.5) return 'fast';
  if (seconds < 2.5) return 'ok';
  if (seconds < 4) return 'slow';
  return 'very_slow';
}

export function loadingVerdictText(verdict: LoadingVerdict): string {
  if (verdict === 'fast') return 'Fast. Core Web Vitals are in the green.';
  if (verdict === 'ok') {
    return 'OK. LCP is within Google\'s passing threshold but there is room to improve.';
  }
  if (verdict === 'slow') {
    return 'Slow. LCP is over 2.5s, Google considers this "needs improvement".';
  }
  if (verdict === 'very_slow') {
    return 'Very slow. LCP is over 4s, actively hurting rankings.';
  }
  return 'Performance data unavailable.';
}

export function summarizePerformanceSamples(
  samples: PerformanceProbeSample[],
  requestedSampleCount = 3
): PerformanceMeasurementSummary {
  const successful = samples.filter((sample) => sample.ok && isFiniteNumber(sample.lcp_ms));
  const lcpValues = successful.map((sample) => sample.lcp_ms as number);
  const scoreValues = samples
    .filter((sample) => sample.ok && isFiniteNumber(sample.performance_score))
    .map((sample) => sample.performance_score as number);

  const medianLcp = median(lcpValues);
  const medianScore = median(scoreValues);
  const secondsValues = lcpValues.map((value) => value / 1000);
  const straddlesLcpThreshold =
    lcpValues.some((value) => value < LCP_NEEDS_IMPROVEMENT_MS) &&
    lcpValues.some((value) => value >= LCP_NEEDS_IMPROVEMENT_MS);

  const successfulCount = successful.length;
  const confidence: PerformanceConfidence =
    successfulCount === 0
      ? 'low'
      : successfulCount < requestedSampleCount || straddlesLcpThreshold
        ? 'medium'
        : 'high';

  return {
    requested_sample_count: requestedSampleCount,
    sample_count: samples.length,
    successful_sample_count: successfulCount,
    median_lcp_ms: medianLcp == null ? null : roundMs(medianLcp),
    median_seconds: medianLcp == null ? null : roundSeconds(medianLcp / 1000),
    seconds_min: secondsValues.length ? roundSeconds(Math.min(...secondsValues)) : null,
    seconds_max: secondsValues.length ? roundSeconds(Math.max(...secondsValues)) : null,
    median_performance_score: medianScore == null ? null : Math.round(medianScore),
    score_source: successfulCount > 0 ? 'lighthouse_median' : 'onpage_fallback',
    confidence,
    straddles_lcp_threshold: straddlesLcpThreshold,
  };
}

export function mergeLoadingWithPerformanceSummary(
  loading: StableLoadingSummary,
  summary: PerformanceMeasurementSummary | null
): StableLoadingSummary {
  if (summary?.median_seconds == null) {
    return {
      ...loading,
      sample_count: summary?.successful_sample_count ?? 0,
      seconds_min: summary?.seconds_min ?? null,
      seconds_max: summary?.seconds_max ?? null,
      score_source: 'onpage_fallback',
      confidence: 'low',
      straddles_lcp_threshold: summary?.straddles_lcp_threshold ?? false,
    };
  }

  const verdict = loadingVerdictFromSeconds(summary.median_seconds);
  return {
    ...loading,
    score: loadingScoreFromSeconds(summary.median_seconds),
    seconds: summary.median_seconds,
    verdict,
    verdict_text: loadingVerdictText(verdict),
    sample_count: summary.successful_sample_count,
    seconds_min: summary.seconds_min,
    seconds_max: summary.seconds_max,
    score_source: summary.score_source,
    confidence: summary.confidence,
    straddles_lcp_threshold: summary.straddles_lcp_threshold,
  };
}

export function hasStablePoorLcp(
  summary: PerformanceMeasurementSummary | null,
  fallbackLcpMs: number | null | undefined
): boolean {
  const lcpMs =
    summary?.median_lcp_ms != null
      ? summary.median_lcp_ms
      : isFiniteNumber(fallbackLcpMs)
        ? fallbackLcpMs
        : null;
  return lcpMs != null && lcpMs > LCP_NEEDS_IMPROVEMENT_MS;
}

export function shouldUseOnPageDurationForSlowPageLoad(
  summary: PerformanceMeasurementSummary | null
): boolean {
  return summary?.median_lcp_ms == null;
}
