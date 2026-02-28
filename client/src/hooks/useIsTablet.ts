import { useState, useEffect } from 'react';

const TABLET_BREAKPOINT = '(min-width: 769px) and (max-width: 1024px)';

export function useIsTablet(): boolean {
  const [isTablet, setIsTablet] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(TABLET_BREAKPOINT).matches : false
  );

  useEffect(() => {
    const mql = window.matchMedia(TABLET_BREAKPOINT);
    const handler = (e: MediaQueryListEvent) => setIsTablet(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  return isTablet;
}
