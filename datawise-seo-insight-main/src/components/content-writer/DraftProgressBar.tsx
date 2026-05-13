import { useEffect, useState } from 'react';

// Estimated wall-clock duration of each step. Used as the denominator for
// the progress animation. The actual call is non-streaming, so this is a
// best-effort visualization, not real progress. Numbers below were chosen
// from observed DeepSeek V4 Pro / Sonar Pro response times against typical
// blog-post payloads. They're intentionally a touch optimistic so the bar
// reaches green before "done" rather than crawling at 99% forever.
const ETA_SECONDS: Record<string, number> = {
  research: 25,
  outline: 25,
  // Draft is bursty: DeepSeek V4 Pro at ~50-60 tok/s on a 16K cap can run
  // for 2-3 minutes on long posts. Bar still asymptotes near 95% after the
  // ETA, so a slightly conservative number here just keeps the percentage
  // honest rather than stalling at 99%.
  draft: 150,
  review: 30,
};

// The bar fills from red → orange → yellow → green as it progresses,
// communicating two things at once: how far we are, and that work is
// actively happening. Stops named here are sampled across the fill.
const STOPS = [
  { at: 0,   color: '#ef4444' }, // red-500
  { at: 33,  color: '#f97316' }, // orange-500
  { at: 66,  color: '#eab308' }, // yellow-500
  { at: 95,  color: '#22c55e' }, // green-500
  { at: 100, color: '#16a34a' }, // green-600
];

function colorAt(pct: number): string {
  // Lerp between the two surrounding stops for a smooth gradient feel even
  // though the underlying transition is just CSS width.
  const clamped = Math.max(0, Math.min(100, pct));
  let lo = STOPS[0];
  let hi = STOPS[STOPS.length - 1];
  for (let i = 0; i < STOPS.length - 1; i++) {
    if (clamped >= STOPS[i].at && clamped <= STOPS[i + 1].at) {
      lo = STOPS[i];
      hi = STOPS[i + 1];
      break;
    }
  }
  const span = hi.at - lo.at || 1;
  const t = (clamped - lo.at) / span;
  const lerp = (a: number, b: number) => Math.round(a + (b - a) * t);
  const parse = (hex: string) => [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ] as const;
  const [r1, g1, b1] = parse(lo.color);
  const [r2, g2, b2] = parse(hi.color);
  return `rgb(${lerp(r1, r2)}, ${lerp(g1, g2)}, ${lerp(b1, b2)})`;
}

interface Props {
  step: 'research' | 'outline' | 'draft' | 'review';
  active: boolean;
}

export default function DraftProgressBar({ step, active }: Props) {
  const eta = ETA_SECONDS[step] ?? 30;
  const [pct, setPct] = useState(0);
  const [startedAt, setStartedAt] = useState<number | null>(null);

  useEffect(() => {
    if (!active) {
      setPct(0);
      setStartedAt(null);
      return;
    }
    const start = performance.now();
    setStartedAt(start);
    setPct(2);
    const iv = window.setInterval(() => {
      const elapsed = (performance.now() - start) / 1000;
      // Race to 90% over `eta` seconds, then asymptote toward 95% so the bar
      // doesn't stall at 99% if the LLM takes longer than expected.
      const ratio = Math.min(elapsed / eta, 1);
      const target = ratio < 1
        ? Math.round(ratio * 90)
        : Math.min(95, 90 + Math.round((elapsed - eta) * 0.5));
      setPct(target);
    }, 250);
    return () => window.clearInterval(iv);
  }, [active, eta]);

  if (!active && pct === 0) return null;

  const elapsedSec = startedAt ? Math.round((performance.now() - startedAt) / 1000) : 0;
  const fill = colorAt(pct);

  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between text-[10px] text-muted-foreground">
        <span className="font-medium uppercase tracking-wider">{step === 'draft' ? 'Writing draft' : `Running ${step}`}</span>
        <span className="font-mono">{pct}% · {elapsedSec}s / ~{eta}s</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full transition-[width,background-color] duration-300 ease-out"
          style={{ width: `${pct}%`, backgroundColor: fill }}
        />
      </div>
    </div>
  );
}
