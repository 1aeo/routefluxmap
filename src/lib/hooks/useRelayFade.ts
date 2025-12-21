/**
 * useRelayFade - Smooth opacity transition for relay markers
 * 
 * Provides a fade-in animation when relay data changes, using
 * requestAnimationFrame for smooth 60fps animation.
 */

import { useState, useRef, useCallback, useEffect } from 'react';

/** Duration of the fade-in transition in milliseconds */
const RELAY_TRANSITION_MS = 400;

export interface UseRelayFadeResult {
  /** Current opacity value (0-1) */
  relayOpacity: number;
  /** Trigger a new fade-in transition */
  startTransition: () => void;
}

/**
 * Manage relay marker opacity transitions
 */
export function useRelayFade(): UseRelayFadeResult {
  const [relayOpacity, setRelayOpacity] = useState(1);
  
  const transitionRef = useRef<{
    animationId: number | null;
    startTime: number;
  }>({
    animationId: null,
    startTime: 0,
  });

  /**
   * Start a new fade-in transition from opacity 0
   */
  const startTransition = useCallback(() => {
    // Cancel any existing transition
    if (transitionRef.current.animationId !== null) {
      cancelAnimationFrame(transitionRef.current.animationId);
    }

    // Start fade-in from 0
    setRelayOpacity(0);
    transitionRef.current.startTime = performance.now();

    const animateTransition = () => {
      const elapsed = performance.now() - transitionRef.current.startTime;
      const progress = Math.min(1, elapsed / RELAY_TRANSITION_MS);

      // Ease-out curve for smooth appearance
      const easedProgress = 1 - Math.pow(1 - progress, 3);
      setRelayOpacity(easedProgress);

      if (progress < 1) {
        transitionRef.current.animationId = requestAnimationFrame(animateTransition);
      } else {
        transitionRef.current.animationId = null;
      }
    };

    transitionRef.current.animationId = requestAnimationFrame(animateTransition);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (transitionRef.current.animationId !== null) {
        cancelAnimationFrame(transitionRef.current.animationId);
      }
    };
  }, []);

  return {
    relayOpacity,
    startTransition,
  };
}

/** Export transition duration for external use */
export { RELAY_TRANSITION_MS };

