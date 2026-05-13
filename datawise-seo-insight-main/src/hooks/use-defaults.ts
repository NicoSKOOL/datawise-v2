import { useAuth } from '@/contexts/AuthContext';
import { useProperty } from '@/contexts/PropertyContext';

/**
 * Returns user-level defaults for location, language, and domain.
 * - Location and language come from the user's saved preferences (Settings page).
 * - Domain comes from the currently selected GSC property.
 */
export function useDefaults() {
  const { user } = useAuth();
  const { primaryDomain } = useProperty();

  return {
    defaultLocation: String(user?.default_location_code ?? 2840),
    defaultLanguage: user?.default_language_code ?? 'en',
    defaultDomain: primaryDomain,
  };
}
