/**
 * useWebGL - Check WebGL2 availability
 * 
 * Tor Browser has WebGL2 disabled by default for fingerprinting protection.
 * This hook detects WebGL availability and returns appropriate error states.
 */

import { useState, useEffect } from 'react';

export type WebGLError = 'WEBGL2_DISABLED' | 'WEBGL_DISABLED' | 'WEBGL_FAILED' | null;

export interface UseWebGLResult {
  /** Error type if WebGL is unavailable, null if available */
  webglError: WebGLError;
  /** Whether WebGL2 is available */
  isSupported: boolean;
}

/**
 * Check WebGL2 availability on mount
 */
export function useWebGL(): UseWebGLResult {
  const [webglError, setWebglError] = useState<WebGLError>(null);

  useEffect(() => {
    try {
      const canvas = document.createElement('canvas');
      
      // Check WebGL2 first (required for Deck.gl)
      if (canvas.getContext('webgl2')) {
        return; // WebGL2 available, no error
      }
      
      // WebGL2 unavailable - check if WebGL1 works to provide better guidance
      if (canvas.getContext('webgl')) {
        setWebglError('WEBGL2_DISABLED');
      } else {
        setWebglError('WEBGL_DISABLED');
      }
    } catch {
      setWebglError('WEBGL_FAILED');
    }
  }, []);

  return {
    webglError,
    isSupported: webglError === null,
  };
}

