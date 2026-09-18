import { describe, expect, it } from 'vitest';
import { detectKeywordLocale, resolveKeywordLocale } from '../keyword-script';

// Bug 626f52f4: Thai keyword ideas returned nothing because the request went
// out as US / English. Unambiguous scripts now pick their own language.
describe('detectKeywordLocale', () => {
  it('maps Thai, Japanese, Korean, Greek and Hebrew seeds to their language and market', () => {
    expect(detectKeywordLocale('หลังคาเย็นลดความร้อน')).toMatchObject({ location_code: 2764, language_code: 'th' });
    expect(detectKeywordLocale('東京 ラーメン おすすめ')).toMatchObject({ location_code: 2392, language_code: 'ja' });
    expect(detectKeywordLocale('서울 맛집')).toMatchObject({ location_code: 2410, language_code: 'ko' });
    expect(detectKeywordLocale('δικηγόρος αθήνα')).toMatchObject({ location_code: 2300, language_code: 'el' });
    expect(detectKeywordLocale('עורך דין תל אביב')).toMatchObject({ location_code: 2376, language_code: 'he' });
  });

  it('returns null for Latin, empty and ambiguous-script keywords', () => {
    expect(detectKeywordLocale('holiday cottages padstow')).toBeNull();
    expect(detectKeywordLocale('   ')).toBeNull();
    expect(detectKeywordLocale('12345')).toBeNull();
    expect(detectKeywordLocale('купить квартиру')).toBeNull();
    expect(detectKeywordLocale('محامي دبي')).toBeNull();
    expect(detectKeywordLocale('北京 律师')).toBeNull();
  });

  it('needs the script to dominate: a Latin brand with one Thai word stays Latin', () => {
    expect(detectKeywordLocale('iphone 15 pro max ราคา')).toBeNull();
    expect(detectKeywordLocale('ราคา ไอโฟน iphone')).toMatchObject({ language_code: 'th' });
  });
});

describe('resolveKeywordLocale', () => {
  it('switches a Thai seed away from US / English', () => {
    expect(resolveKeywordLocale('หลังคาลดความร้อน', { location: '2840', language: 'en' })).toEqual({
      location: '2764', language: 'th',
      switched: { location_code: 2764, language_code: 'th', locationLabel: 'Thailand', languageLabel: 'Thai' },
    });
  });

  it('leaves the selection alone when the language already matches or the script is Latin', () => {
    expect(resolveKeywordLocale('หลังคาลดความร้อน', { location: '2764', language: 'th' })).toEqual({ location: '2764', language: 'th', switched: null });
    expect(resolveKeywordLocale('roof insulation', { location: '2826', language: 'en' })).toEqual({ location: '2826', language: 'en', switched: null });
  });
});
