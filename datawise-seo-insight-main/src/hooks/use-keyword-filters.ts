import { usePersistentState } from './use-persistent-state';
import { useDefaults } from './use-defaults';

// Single source of truth for the seed keyword + location + language shared by
// the Keyword Research tabs (bug b1c1b4d9: selecting Israel/Hebrew on one tab
// then switching to another reset the form to US/English, because each tab
// persisted its own namespaced copy). Tabs mount one at a time, so each
// hydrates the latest stored value on switch. Defaults come from the user's
// saved Settings preferences, falling back to US/English.
export function useKeywordFilters() {
  const { defaultLocation, defaultLanguage } = useDefaults();
  const [keyword, setKeyword] = usePersistentState<string>('keyword-research:keyword', '');
  const [location, setLocation] = usePersistentState<string>('keyword-research:location', defaultLocation);
  const [language, setLanguage] = usePersistentState<string>('keyword-research:language', defaultLanguage);
  return { keyword, setKeyword, location, setLocation, language, setLanguage };
}
