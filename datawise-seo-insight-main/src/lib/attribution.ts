// Captures and persists first-touch UTM/referrer attribution for the SPA.
// First-touch wins: once captured we never overwrite, even if the user later
// arrives via a different channel. This matches signup-attribution semantics.

const ATTRIBUTION_KEY = 'dw_attribution';
const SESSION_ID_KEY = 'dw_session_id';

export interface Attribution {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  utm_term?: string;
  promo_code?: string;
  referrer?: string;
  landing_path?: string;
  captured_at?: string;
}

const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'] as const;

function safeStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

function isInternalReferrer(ref: string): boolean {
  if (!ref) return true;
  try {
    const host = new URL(ref).hostname.replace(/^www\./, '');
    return host === window.location.hostname.replace(/^www\./, '');
  } catch {
    return false;
  }
}

// Run once on app boot. Captures URL UTM params + referrer if not already set.
export function initAttribution(): void {
  const storage = safeStorage();
  if (!storage) return;

  // First-touch: never overwrite an existing capture.
  if (storage.getItem(ATTRIBUTION_KEY)) return;

  const params = new URLSearchParams(window.location.search);
  const captured: Attribution = {};
  let anyUtm = false;
  for (const key of UTM_KEYS) {
    const v = params.get(key);
    if (v) {
      captured[key] = v.slice(0, 128);
      anyUtm = true;
    }
  }

  const promo = params.get('promo');
  if (promo) {
    captured.promo_code = promo.slice(0, 64).toUpperCase();
  }

  const ref = document.referrer || '';
  if (ref && !isInternalReferrer(ref)) {
    captured.referrer = ref.slice(0, 512);
  }

  // Only persist if we actually captured something useful (UTM or external referrer).
  if (!anyUtm && !captured.referrer && !captured.promo_code) return;

  captured.landing_path = `${window.location.pathname}${window.location.search}`.slice(0, 512);
  captured.captured_at = new Date().toISOString();
  storage.setItem(ATTRIBUTION_KEY, JSON.stringify(captured));
}

export function getAttribution(): Attribution | null {
  const storage = safeStorage();
  if (!storage) return null;
  const raw = storage.getItem(ATTRIBUTION_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Attribution;
  } catch {
    return null;
  }
}

// Stable anonymous session id used to dedupe sessions in pageview analytics.
// Survives page reloads (localStorage); cleared only when the user clears site data.
export function getSessionId(): string {
  const storage = safeStorage();
  if (!storage) return 'no-storage';
  let id = storage.getItem(SESSION_ID_KEY);
  if (!id) {
    id = (crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`).slice(0, 64);
    storage.setItem(SESSION_ID_KEY, id);
  }
  return id;
}
