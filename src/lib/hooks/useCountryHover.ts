/**
 * useCountryHover - Country hover and click interaction
 * 
 * Uses CPU-based point-in-polygon detection instead of GPU picking
 * for better performance (eliminates expensive readPixels calls).
 * 
 * Manages:
 * - Country tooltip state and DOM updates
 * - Throttled mouse move handling
 * - Country click to center map
 */

import { useCallback, useRef, useEffect } from 'react';
import type { RefObject } from 'react';
import type { CountryHistogram } from '../types';
import { findCountryAtLocation, countryCentroids } from '../utils/geo';

/** Throttle interval for country hover detection (~15fps) */
const HOVER_THROTTLE_MS = 66;

export interface CountryHoverInfo {
  code: string;
  x: number;
  y: number;
}

export interface UseCountryHoverResult {
  /** Ref for country tooltip DOM element */
  tooltipRef: RefObject<HTMLDivElement>;
  /** Current hover info (ref-based, no re-renders) */
  hoverInfo: RefObject<CountryHoverInfo | null>;
  /** Handle mouse move for country detection */
  handleMouseMove: (
    event: React.MouseEvent,
    options: {
      layerVisible: boolean;
      geojson: GeoJSON.FeatureCollection | null;
      unproject: (x: number, y: number) => [number, number] | null;
      countryData: CountryHistogram;
    }
  ) => void;
  /** Handle country click to center map */
  handleClick: (
    event: React.MouseEvent,
    options: {
      layerVisible: boolean;
      geojson: GeoJSON.FeatureCollection | null;
      unproject: (x: number, y: number) => [number, number] | null;
      onCountryClick: (code: string, centroid: [number, number]) => void;
    }
  ) => void;
  /** Clear tooltip state */
  clearTooltip: () => void;
}

/**
 * Manage country hover interactions
 */
export function useCountryHover(): UseCountryHoverResult {
  const tooltipRef = useRef<HTMLDivElement>(null);
  const hoverInfo = useRef<CountryHoverInfo | null>(null);
  const throttleTimerRef = useRef<number | null>(null);
  const lastCountryCodeRef = useRef<string | null>(null);

  // Cleanup throttle timer on unmount
  useEffect(() => {
    return () => {
      if (throttleTimerRef.current) {
        clearTimeout(throttleTimerRef.current);
      }
    };
  }, []);

  /**
   * Update tooltip DOM directly (no React re-render)
   */
  const updateTooltip = useCallback(
    (code: string | null, x: number, y: number, countryData: CountryHistogram) => {
      if (code) {
        hoverInfo.current = { code, x, y };

        if (tooltipRef.current) {
          const nameEl = tooltipRef.current.querySelector('.country-name');
          const countEl = tooltipRef.current.querySelector('.country-count');
          const count = countryData[code] || 0;

          if (nameEl) nameEl.textContent = code;
          if (countEl) countEl.textContent = `${count.toLocaleString()} clients`;

          tooltipRef.current.style.left = `${x + 10}px`;
          tooltipRef.current.style.top = `${y + 10}px`;
          tooltipRef.current.style.opacity = '1';
        }
      } else {
        hoverInfo.current = null;
        if (tooltipRef.current) {
          tooltipRef.current.style.opacity = '0';
        }
      }
    },
    []
  );

  /**
   * Handle mouse move with throttling
   */
  const handleMouseMove = useCallback(
    (
      event: React.MouseEvent,
      options: {
        layerVisible: boolean;
        geojson: GeoJSON.FeatureCollection | null;
        unproject: (x: number, y: number) => [number, number] | null;
        countryData: CountryHistogram;
      }
    ) => {
      const { layerVisible, geojson, unproject, countryData } = options;

      if (!layerVisible || !geojson) {
        if (lastCountryCodeRef.current) {
          updateTooltip(null, 0, 0, countryData);
          lastCountryCodeRef.current = null;
        }
        return;
      }

      // Throttle to ~15fps
      if (throttleTimerRef.current) return;

      const { offsetX, offsetY } = event.nativeEvent;

      throttleTimerRef.current = window.setTimeout(() => {
        throttleTimerRef.current = null;

        const coords = unproject(offsetX, offsetY);
        if (!coords) return;

        const country = findCountryAtLocation(coords[0], coords[1], geojson);
        const code = country?.code ?? null;

        if (code !== lastCountryCodeRef.current) {
          lastCountryCodeRef.current = code;
          updateTooltip(code, offsetX, offsetY, countryData);
        } else if (code && tooltipRef.current) {
          // Same country, just update position
          tooltipRef.current.style.left = `${offsetX + 10}px`;
          tooltipRef.current.style.top = `${offsetY + 10}px`;
        }
      }, HOVER_THROTTLE_MS);
    },
    [updateTooltip]
  );

  /**
   * Handle country click - center on country
   */
  const handleClick = useCallback(
    (
      event: React.MouseEvent,
      options: {
        layerVisible: boolean;
        geojson: GeoJSON.FeatureCollection | null;
        unproject: (x: number, y: number) => [number, number] | null;
        onCountryClick: (code: string, centroid: [number, number]) => void;
      }
    ) => {
      const { layerVisible, geojson, unproject, onCountryClick } = options;

      if (!layerVisible || !geojson) return;

      const coords = unproject(event.nativeEvent.offsetX, event.nativeEvent.offsetY);
      if (!coords) return;

      const country = findCountryAtLocation(coords[0], coords[1], geojson);
      if (!country) return;

      const centroid = countryCentroids[country.code];
      if (centroid) {
        onCountryClick(country.code, centroid);
      }
    },
    []
  );

  /**
   * Clear tooltip state
   */
  const clearTooltip = useCallback(() => {
    hoverInfo.current = null;
    lastCountryCodeRef.current = null;
    if (tooltipRef.current) {
      tooltipRef.current.style.opacity = '0';
    }
  }, []);

  return {
    tooltipRef,
    hoverInfo,
    handleMouseMove,
    handleClick,
    clearTooltip,
  };
}

