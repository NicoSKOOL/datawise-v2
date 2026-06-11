import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { getGSCProperties, type GSCProperty } from '@/lib/gsc';
import { useAuth } from './AuthContext';

const STORAGE_KEY = 'datawise_selected_property';

function cleanDomain(siteUrl: string): string {
  return siteUrl.replace(/^(sc-domain:|https?:\/\/)/, '').replace(/\/+$/, '');
}

interface PropertyContextType {
  properties: GSCProperty[];
  selectedPropertyId: string;
  setSelectedPropertyId: (id: string) => void;
  addProperty: (property: GSCProperty) => void;
  removeProperty: (id: string) => void;
  selectedProperty: GSCProperty | null;
  primaryDomain: string;
  connected: boolean;
  loading: boolean;
}

const PropertyContext = createContext<PropertyContextType | undefined>(undefined);

export function PropertyProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [properties, setProperties] = useState<GSCProperty[]>([]);
  const [selectedPropertyId, setSelectedPropertyIdState] = useState('');
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);

  const setSelectedPropertyId = useCallback((id: string) => {
    setSelectedPropertyIdState(id);
    localStorage.setItem(STORAGE_KEY, id);
  }, []);

  const addProperty = useCallback((property: GSCProperty) => {
    setProperties((current) => [
      property,
      ...current.filter((existing) => existing.id !== property.id),
    ]);
    setSelectedPropertyIdState(property.id);
    localStorage.setItem(STORAGE_KEY, property.id);
  }, []);

  const removeProperty = useCallback((id: string) => {
    setProperties((current) => {
      const next = current.filter((property) => property.id !== id);
      setSelectedPropertyIdState((selected) => {
        if (selected !== id) return selected;

        const replacement = next.find((property) => property.is_enabled !== 0)?.id || '';
        if (replacement) {
          localStorage.setItem(STORAGE_KEY, replacement);
        } else {
          localStorage.removeItem(STORAGE_KEY);
        }
        return replacement;
      });
      return next;
    });
  }, []);

  useEffect(() => {
    if (!user) {
      setProperties([]);
      setSelectedPropertyIdState('');
      setConnected(false);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    async function load() {
      try {
        const result = await getGSCProperties();
        if (cancelled) return;

        const props = result?.properties || [];
        setConnected(Boolean(result?.connected));
        setProperties(props);

        if (props.length > 0) {
          const enabled = props.filter((p) => p.is_enabled !== 0);
          const savedId = localStorage.getItem(STORAGE_KEY);
          // Only use saved selection if it's an enabled property
          const saved = savedId ? enabled.find((p) => p.id === savedId) : undefined;
          // A manual property has no GSC metrics, so a manual selection makes
          // the dashboard show "Connect GSC" even when a connection exists
          // (bug 1027d415). If the saved selection is a manual row but a GSC
          // property for the same domain exists, switch to the GSC twin.
          const gscTwin =
            saved && saved.kind === 'manual'
              ? enabled.find(
                  (p) => p.kind !== 'manual' && cleanDomain(p.site_url).replace(/^www\./, '') === cleanDomain(saved.site_url).replace(/^www\./, '')
                )
              : undefined;
          if (saved && !gscTwin) {
            setSelectedPropertyIdState(saved.id);
          } else if (gscTwin) {
            setSelectedPropertyIdState(gscTwin.id);
            localStorage.setItem(STORAGE_KEY, gscTwin.id);
          } else if (enabled.length > 0) {
            // Default pick prefers GSC-linked properties over manual ones.
            const preferred = enabled.find((p) => p.kind !== 'manual') || enabled[0];
            setSelectedPropertyIdState(preferred.id);
            localStorage.setItem(STORAGE_KEY, preferred.id);
          } else {
            // No enabled properties, pick first available
            setSelectedPropertyIdState(props[0].id);
            localStorage.setItem(STORAGE_KEY, props[0].id);
          }
        } else {
          setSelectedPropertyIdState('');
          localStorage.removeItem(STORAGE_KEY);
        }
      } catch {
        if (!cancelled) {
          setConnected(false);
          setProperties([]);
          setSelectedPropertyIdState('');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [user]);

  const selectedProperty = properties.find((p) => p.id === selectedPropertyId) || null;
  const primaryDomain = selectedProperty ? cleanDomain(selectedProperty.site_url) : '';

  return (
    <PropertyContext.Provider
      value={{
        properties,
        selectedPropertyId,
        setSelectedPropertyId,
        addProperty,
        removeProperty,
        selectedProperty,
        primaryDomain,
        connected,
        loading,
      }}
    >
      {children}
    </PropertyContext.Provider>
  );
}

export function useProperty() {
  const context = useContext(PropertyContext);
  if (context === undefined) {
    throw new Error('useProperty must be used within a PropertyProvider');
  }
  return context;
}
