import { getAttribution, getSessionId } from './attribution';

const API_URL = (import.meta.env.VITE_API_URL as string | undefined) || '';

// Fire-and-forget pageview beacon. Uses sendBeacon when available so it survives
// page unload; falls back to fetch with keepalive. Failures are swallowed since
// analytics must never break the user experience.
export function trackPageview(path: string, userId?: string | null): void {
  if (!API_URL) return;

  const attribution = getAttribution();
  const payload = JSON.stringify({
    session_id: getSessionId(),
    user_id: userId ?? undefined,
    path,
    referrer: attribution?.referrer,
    utm_source: attribution?.utm_source,
    utm_medium: attribution?.utm_medium,
    utm_campaign: attribution?.utm_campaign,
    utm_content: attribution?.utm_content,
    utm_term: attribution?.utm_term,
    promo_code: attribution?.promo_code,
  });

  const url = `${API_URL}/api/track/pageview`;
  try {
    if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
      const blob = new Blob([payload], { type: 'application/json' });
      if (navigator.sendBeacon(url, blob)) return;
    }
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Never throw from analytics.
  }
}
