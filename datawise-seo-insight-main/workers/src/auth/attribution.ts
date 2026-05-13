export interface AttributionPayload {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  utm_term?: string;
  promo_code?: string;
  referrer?: string;
  landing_path?: string;
}

function clampStr(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s ? s.slice(0, max) : null;
}

export function sanitizeAttribution(raw: unknown): AttributionPayload | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const out: AttributionPayload = {};
  const utmSource = clampStr(r.utm_source, 128);
  if (utmSource) out.utm_source = utmSource;
  const utmMedium = clampStr(r.utm_medium, 128);
  if (utmMedium) out.utm_medium = utmMedium;
  const utmCampaign = clampStr(r.utm_campaign, 128);
  if (utmCampaign) out.utm_campaign = utmCampaign;
  const utmContent = clampStr(r.utm_content, 128);
  if (utmContent) out.utm_content = utmContent;
  const utmTerm = clampStr(r.utm_term, 128);
  if (utmTerm) out.utm_term = utmTerm;
  const promoCode = clampStr(r.promo_code, 64);
  if (promoCode) out.promo_code = promoCode.toUpperCase();
  const ref = clampStr(r.referrer, 512);
  if (ref) out.referrer = ref;
  const lp = clampStr(r.landing_path, 512);
  if (lp) out.landing_path = lp;
  return Object.keys(out).length ? out : undefined;
}
