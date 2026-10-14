// Location + language pairs the DataForSEO LLM Mentions index actually covers.
// Source: /ai_optimization/llm_mentions/locations_and_languages (pulled
// 2026-10-14). Any pair outside this list returns zero rows, so Brand Tracker
// only offers these. ChatGPT is indexed for United States + English only;
// every other pair is Google AI Overview only.

export interface LlmMentionsLocale {
  code: number;
  name: string;
  languages: Array<{ code: string; name: string }>;
}

const L = (code: string, name: string) => ({ code, name });
const EN = L('en', 'English');
const ES = L('es', 'Spanish');
const FR = L('fr', 'French');
const DE = L('de', 'German');
const AR = L('ar', 'Arabic');
const PT = L('pt', 'Portuguese');

export const LLM_MENTIONS_LOCALES: LlmMentionsLocale[] = [
  { code: 2008, name: 'Albania', languages: [L('sq', 'Albanian')] },
  { code: 2012, name: 'Algeria', languages: [FR, AR] },
  { code: 2024, name: 'Angola', languages: [PT] },
  { code: 2032, name: 'Argentina', languages: [ES] },
  { code: 2051, name: 'Armenia', languages: [L('hy', 'Armenian')] },
  { code: 2036, name: 'Australia', languages: [EN] },
  { code: 2040, name: 'Austria', languages: [DE] },
  { code: 2031, name: 'Azerbaijan', languages: [L('az', 'Azeri')] },
  { code: 2048, name: 'Bahrain', languages: [AR] },
  { code: 2050, name: 'Bangladesh', languages: [L('bn', 'Bengali')] },
  { code: 2056, name: 'Belgium', languages: [L('nl', 'Dutch'), FR, DE] },
  { code: 2068, name: 'Bolivia', languages: [ES] },
  { code: 2070, name: 'Bosnia and Herzegovina', languages: [L('bs', 'Bosnian')] },
  { code: 2076, name: 'Brazil', languages: [PT] },
  { code: 2100, name: 'Bulgaria', languages: [L('bg', 'Bulgarian')] },
  { code: 2854, name: 'Burkina Faso', languages: [FR] },
  { code: 2116, name: 'Cambodia', languages: [EN] },
  { code: 2120, name: 'Cameroon', languages: [FR] },
  { code: 2124, name: 'Canada', languages: [EN, FR] },
  { code: 2152, name: 'Chile', languages: [ES] },
  { code: 2170, name: 'Colombia', languages: [ES] },
  { code: 2188, name: 'Costa Rica', languages: [ES] },
  { code: 2384, name: "Cote d'Ivoire", languages: [FR] },
  { code: 2191, name: 'Croatia', languages: [L('hr', 'Croatian')] },
  { code: 2196, name: 'Cyprus', languages: [L('el', 'Greek'), EN] },
  { code: 2203, name: 'Czechia', languages: [L('cs', 'Czech')] },
  { code: 2208, name: 'Denmark', languages: [L('da', 'Danish')] },
  { code: 2218, name: 'Ecuador', languages: [ES] },
  { code: 2818, name: 'Egypt', languages: [AR, EN] },
  { code: 2222, name: 'El Salvador', languages: [ES] },
  { code: 2233, name: 'Estonia', languages: [L('et', 'Estonian')] },
  { code: 2246, name: 'Finland', languages: [L('fi', 'Finnish')] },
  { code: 2250, name: 'France', languages: [FR] },
  { code: 2276, name: 'Germany', languages: [DE] },
  { code: 2288, name: 'Ghana', languages: [EN] },
  { code: 2300, name: 'Greece', languages: [L('el', 'Greek'), EN] },
  { code: 2320, name: 'Guatemala', languages: [ES] },
  { code: 2344, name: 'Hong Kong', languages: [L('zh-TW', 'Chinese (Traditional)'), EN] },
  { code: 2348, name: 'Hungary', languages: [L('hu', 'Hungarian')] },
  { code: 2356, name: 'India', languages: [EN, L('hi', 'Hindi')] },
  { code: 2360, name: 'Indonesia', languages: [L('id', 'Indonesian'), EN] },
  { code: 2372, name: 'Ireland', languages: [EN] },
  { code: 2376, name: 'Israel', languages: [L('he', 'Hebrew'), AR] },
  { code: 2380, name: 'Italy', languages: [L('it', 'Italian')] },
  { code: 2392, name: 'Japan', languages: [L('ja', 'Japanese')] },
  { code: 2400, name: 'Jordan', languages: [AR] },
  { code: 2398, name: 'Kazakhstan', languages: [L('ru', 'Russian')] },
  { code: 2404, name: 'Kenya', languages: [EN] },
  { code: 2428, name: 'Latvia', languages: [L('lv', 'Latvian')] },
  { code: 2440, name: 'Lithuania', languages: [L('lt', 'Lithuanian')] },
  { code: 2458, name: 'Malaysia', languages: [L('ms', 'Malay'), EN] },
  { code: 2470, name: 'Malta', languages: [EN] },
  { code: 2484, name: 'Mexico', languages: [ES] },
  { code: 2498, name: 'Moldova', languages: [L('ro', 'Romanian')] },
  { code: 2492, name: 'Monaco', languages: [FR] },
  { code: 2504, name: 'Morocco', languages: [AR, FR] },
  { code: 2104, name: 'Myanmar (Burma)', languages: [EN] },
  { code: 2528, name: 'Netherlands', languages: [L('nl', 'Dutch')] },
  { code: 2554, name: 'New Zealand', languages: [EN] },
  { code: 2558, name: 'Nicaragua', languages: [ES] },
  { code: 2566, name: 'Nigeria', languages: [EN] },
  { code: 2807, name: 'North Macedonia', languages: [L('mk', 'Macedonian')] },
  { code: 2578, name: 'Norway', languages: [L('nb', 'Norwegian (Bokmål)')] },
  { code: 2586, name: 'Pakistan', languages: [EN, L('ur', 'Urdu')] },
  { code: 2591, name: 'Panama', languages: [ES] },
  { code: 2600, name: 'Paraguay', languages: [ES] },
  { code: 2604, name: 'Peru', languages: [ES] },
  { code: 2608, name: 'Philippines', languages: [EN, L('tl', 'Tagalog')] },
  { code: 2616, name: 'Poland', languages: [L('pl', 'Polish')] },
  { code: 2620, name: 'Portugal', languages: [PT] },
  { code: 2642, name: 'Romania', languages: [L('ro', 'Romanian')] },
  { code: 2682, name: 'Saudi Arabia', languages: [AR, EN] },
  { code: 2686, name: 'Senegal', languages: [FR] },
  { code: 2688, name: 'Serbia', languages: [L('sr', 'Serbian')] },
  { code: 2702, name: 'Singapore', languages: [EN, L('zh-CN', 'Chinese (Simplified)')] },
  { code: 2703, name: 'Slovakia', languages: [L('sk', 'Slovak')] },
  { code: 2705, name: 'Slovenia', languages: [L('sl', 'Slovenian')] },
  { code: 2710, name: 'South Africa', languages: [EN] },
  { code: 2410, name: 'South Korea', languages: [L('ko', 'Korean')] },
  { code: 2724, name: 'Spain', languages: [ES] },
  { code: 2144, name: 'Sri Lanka', languages: [EN] },
  { code: 2752, name: 'Sweden', languages: [L('sv', 'Swedish')] },
  { code: 2756, name: 'Switzerland', languages: [DE, FR, L('it', 'Italian')] },
  { code: 2158, name: 'Taiwan', languages: [L('zh-TW', 'Chinese (Traditional)')] },
  { code: 2764, name: 'Thailand', languages: [L('th', 'Thai')] },
  { code: 2788, name: 'Tunisia', languages: [AR] },
  { code: 2792, name: 'Turkiye', languages: [L('tr', 'Turkish')] },
  { code: 2804, name: 'Ukraine', languages: [L('uk', 'Ukrainian'), L('ru', 'Russian')] },
  { code: 2784, name: 'United Arab Emirates', languages: [AR, EN] },
  { code: 2826, name: 'United Kingdom', languages: [EN] },
  { code: 2840, name: 'United States', languages: [EN, ES] },
  { code: 2858, name: 'Uruguay', languages: [ES] },
  { code: 2862, name: 'Venezuela', languages: [ES] },
  { code: 2704, name: 'Vietnam', languages: [L('vi', 'Vietnamese'), EN] },
];

export const CHATGPT_LOCATION_CODE = 2840;
export const CHATGPT_LANGUAGE_CODE = 'en';

export interface LlmMarket {
  locationCode: number;
  languageCode: string;
}

export function findLocale(locationCode: number): LlmMentionsLocale | undefined {
  return LLM_MENTIONS_LOCALES.find((l) => l.code === locationCode);
}

// Snap any location/language pair onto one the index covers. Unknown
// locations fall back to US English; a known location with an unsupported
// language falls back to that location's first (most common) language.
export function normalizeMarket(locationCode: number, languageCode: string): LlmMarket {
  const locale = findLocale(locationCode);
  if (!locale) return { locationCode: CHATGPT_LOCATION_CODE, languageCode: CHATGPT_LANGUAGE_CODE };
  const lang = locale.languages.find((l) => l.code === languageCode) ?? locale.languages[0];
  return { locationCode: locale.code, languageCode: lang.code };
}

export function isChatGptMarket(market: LlmMarket): boolean {
  return market.locationCode === CHATGPT_LOCATION_CODE && market.languageCode === CHATGPT_LANGUAGE_CODE;
}

export function marketLabel(market: LlmMarket): string {
  const locale = findLocale(market.locationCode);
  const lang = locale?.languages.find((l) => l.code === market.languageCode);
  return `${locale?.name ?? market.locationCode} · ${lang?.name ?? market.languageCode}`;
}
