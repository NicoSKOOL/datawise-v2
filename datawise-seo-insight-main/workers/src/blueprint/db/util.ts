export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

// Money moves as decimal USD strings at the API boundary and INTEGER micro-USD in storage.
export function usdToMicro(usd: string): number {
  const trimmed = usd.trim();
  if (!/^\d+(\.\d{1,6})?$/.test(trimmed)) {
    throw new Error(`Invalid USD amount: ${usd}`);
  }
  const [whole, frac = ''] = trimmed.split('.');
  return Number(whole) * 1_000_000 + Number(frac.padEnd(6, '0'));
}

export function microToUsd(micro: number): string {
  if (!Number.isInteger(micro) || micro < 0) throw new Error(`Invalid micro-USD: ${micro}`);
  const whole = Math.floor(micro / 1_000_000);
  const frac = micro % 1_000_000;
  if (frac === 0) return `${whole}.00`;
  const fracStr = String(frac).padStart(6, '0').replace(/0+$/, '');
  return `${whole}.${fracStr.length < 2 ? fracStr.padEnd(2, '0') : fracStr}`;
}
