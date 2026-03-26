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

  useEffect(() => {
    if (!user) {
      setProperties([]);
      setConnected(false);
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function load() {
      try {
        const result = await getGSCProperties();
        if (cancelled) return;

        if (result?.connected) {
          setConnected(true);
          const props = result.properties || [];
          setProperties(props);

          if (props.length > 0) {
            const enabled = props.filter((p) => p.is_enabled !== 0);
            const savedId = localStorage.getItem(STORAGE_KEY);
            // Only use saved selection if it's an enabled property
            const savedValid = savedId && enabled.some((p) => p.id === savedId);
            if (savedValid) {
              setSelectedPropertyIdState(savedId);
            } else if (enabled.length > 0) {
              setSelectedPropertyIdState(enabled[0].id);
              localStorage.setItem(STORAGE_KEY, enabled[0].id);
            } else {
              // No enabled properties, pick first available
              setSelectedPropertyIdState(props[0].id);
              localStorage.setItem(STORAGE_KEY, props[0].id);
            }
          }
        } else {
          setConnected(false);
          setProperties([]);
        }
      } catch {
        if (!cancelled) {
          setConnected(false);
          setProperties([]);
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
