import { useState, useEffect, useRef } from 'react';

// Drop-in replacement for useState that persists the value to localStorage
// under a versioned, namespaced key. Used by the research pages (keyword
// overview / ideas / suggestions / difficulty, brand tracker) so navigating
// away and back to the page restores the user's last query and results
// instead of showing a blank slate (bug 252b25801c0bf4875942b538f1a38802 —
// "ran a few of these features, then when I returned all of the data has
// gone?").
//
// Quietly no-ops on quota or JSON failures so a corrupted entry never breaks
// the page render. Bump VERSION when changing the shape of any stored value
// to invalidate older entries.
const VERSION = 'v1';
const PREFIX = `datawise:page-state:${VERSION}:`;

export function usePersistentState<T>(key: string, initial: T): [T, React.Dispatch<React.SetStateAction<T>>] {
  const fullKey = PREFIX + key;
  const [value, setValue] = useState<T>(() => {
    if (typeof window === 'undefined') return initial;
    try {
      const raw = window.localStorage.getItem(fullKey);
      if (raw == null) return initial;
      return JSON.parse(raw) as T;
    } catch {
      return initial;
    }
  });

  // First effect run after mount must not re-write the value we just
  // hydrated, otherwise stale state from a prior render of `initial` could
  // overwrite a good cached value on hot reload.
  const skipNextWrite = useRef(true);
  useEffect(() => {
    if (skipNextWrite.current) {
      skipNextWrite.current = false;
      return;
    }
    try {
      window.localStorage.setItem(fullKey, JSON.stringify(value));
    } catch {
      // Quota exceeded or storage disabled (private mode). Best-effort only.
    }
  }, [value, fullKey]);

  return [value, setValue];
}
