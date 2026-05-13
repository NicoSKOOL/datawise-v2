import { useSearchParams } from 'react-router-dom';
import { useCallback } from 'react';

export function useTabParam(defaultTab: string): [string, (tab: string) => void] {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get('tab') || defaultTab;

  const setTab = useCallback((newTab: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (newTab === defaultTab) {
        next.delete('tab');
      } else {
        next.set('tab', newTab);
      }
      return next;
    }, { replace: true });
  }, [defaultTab, setSearchParams]);

  return [tab, setTab];
}
