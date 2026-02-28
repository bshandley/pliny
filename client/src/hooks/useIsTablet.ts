import { useState, useEffect } from 'react';

/**
 * Returns true on any touch-capable device (phone, tablet, touch laptop).
 * Uses navigator.maxTouchPoints which works across all modern browsers.
 * This is more reliable than viewport-width breakpoints which fail on
 * large tablets (iPad Pro landscape = 1366px, misses a 1024px cap).
 */
export function useIsTablet(): boolean {
  const [isTouchDevice, setIsTouchDevice] = useState(() => {
    if (typeof window === 'undefined') return false;
    return navigator.maxTouchPoints > 0 || 'ontouchstart' in window;
  });

  useEffect(() => {
    // maxTouchPoints doesn't change at runtime, but re-check after mount
    // in case SSR gave a wrong initial value
    setIsTouchDevice(navigator.maxTouchPoints > 0 || 'ontouchstart' in window);
  }, []);

  return isTouchDevice;
}
