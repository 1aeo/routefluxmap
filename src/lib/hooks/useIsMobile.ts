/**
 * useIsMobile - Responsive breakpoint detection
 * 
 * Detects if the viewport is below the mobile breakpoint and
 * updates on window resize.
 */

import { useState, useEffect } from 'react';

/** Mobile breakpoint in pixels */
const MOBILE_BREAKPOINT = 640;

export interface UseIsMobileResult {
  /** Whether the viewport is below mobile breakpoint */
  isMobile: boolean;
}

/**
 * Detect mobile viewport and respond to resize events
 */
export function useIsMobile(): UseIsMobileResult {
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.innerWidth < MOBILE_BREAKPOINT;
  });

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    };

    // Check on mount
    checkMobile();

    // Listen for resize events
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  return { isMobile };
}

/** Export breakpoint for components that need it */
export { MOBILE_BREAKPOINT };

