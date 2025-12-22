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
import { type CountryHistogram, getCountryClientData, formatCompact, getDeviation, TOOLTIP_OFFSET } from '../types';
import { findCountryAtLocation, countryCentroids } from '../utils/geo';

/** Throttle interval for country hover detection (~15fps) */
const HOVER_THROTTLE_MS = 66;

/** Set tooltip position and show */
const setTooltipPosition = (el: HTMLElement, x: number, y: number) => {
  el.style.left = `${x + TOOLTIP_OFFSET}px`;
  el.style.top = `${y + TOOLTIP_OFFSET}px`;
  el.style.opacity = '1';
};

export interface CountryHoverInfo {
  code: string;
  x: number;
  y: number;
}

/** Options for mouse move handler */
export interface MouseMoveOptions {
  layerVisible: boolean;
  geojson: GeoJSON.FeatureCollection | null;
  unproject: (x: number, y: number) => [number, number] | null;
  countryData: CountryHistogram;
}

/** Options for click handler */
export interface ClickOptions {
  layerVisible: boolean;
  geojson: GeoJSON.FeatureCollection | null;
  unproject: (x: number, y: number) => [number, number] | null;
  onCountryClick: (code: string, centroid: [number, number]) => void;
}

export interface UseCountryHoverResult {
  tooltipRef: RefObject<HTMLDivElement>;
  hoverInfo: RefObject<CountryHoverInfo | null>;
  handleMouseMove: (event: React.MouseEvent, options: MouseMoveOptions) => void;
  handleClick: (event: React.MouseEvent, options: ClickOptions) => void;
  clearTooltip: () => void;
}

/** Cached tooltip element refs to avoid DOM queries on every hover */
interface TooltipElements {
  name: Element | null;
  count: Element | null;
  bounds: HTMLElement | null;
}

/**
 * Manage country hover interactions with throttled updates
 */
export function useCountryHover(): UseCountryHoverResult {
  const tooltipRef = useRef<HTMLDivElement>(null);
  const hoverInfo = useRef<CountryHoverInfo | null>(null);
  const throttleTimerRef = useRef<number | null>(null);
  const lastCountryCodeRef = useRef<string | null>(null);
  const elementsRef = useRef<TooltipElements | null>(null);
  
  /** Get cached tooltip elements (lazy initialization) */
  const getElements = (): TooltipElements | null => {
    if (!tooltipRef.current) return null;
    // Cache on first access
    return elementsRef.current ??= {
      name: tooltipRef.current.querySelector('.country-name'),
      count: tooltipRef.current.querySelector('.country-count'),
      bounds: tooltipRef.current.querySelector('.country-bounds') as HTMLElement | null,
    };
  };

  // Cleanup throttle timer on unmount
  useEffect(() => () => {
    if (throttleTimerRef.current) clearTimeout(throttleTimerRef.current);
  }, []);

  /** Update tooltip DOM directly (avoids React re-render) */
  const updateTooltip = useCallback(
    (code: string | null, x: number, y: number, countryData: CountryHistogram) => {
      const tooltip = tooltipRef.current;
      if (!tooltip) return;
      
      if (!code) {
        hoverInfo.current = null;
        tooltip.style.opacity = '0';
        return;
      }
      
      hoverInfo.current = { code, x, y };
      const els = getElements();
      if (!els) return;
      
      const { count, lower, upper, hasBounds } = getCountryClientData(countryData, code);
      
      if (els.name) els.name.textContent = code;
      if (els.count) {
        const countStr = count.toLocaleString();
        els.count.textContent = hasBounds
          ? `${countStr} ± ${formatCompact(getDeviation(lower, upper))} clients`
          : `${countStr} clients`;
      }
      if (els.bounds) {
        els.bounds.textContent = hasBounds
          ? `Lower: ${lower.toLocaleString()} / Upper: ${upper.toLocaleString()}`
          : '';
        els.bounds.style.display = hasBounds ? '' : 'none';
      }
      
      setTooltipPosition(tooltip, x, y);
    },
    []
  );

  /** Handle mouse move with throttling */
  const handleMouseMove = useCallback(
    (event: React.MouseEvent, options: MouseMoveOptions) => {
      const { layerVisible, geojson, unproject, countryData } = options;

      // Clear tooltip if layer hidden
      if (!layerVisible || !geojson) {
        if (lastCountryCodeRef.current) {
          updateTooltip(null, 0, 0, countryData);
          lastCountryCodeRef.current = null;
        }
        return;
      }

      // Skip if throttled
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
          // Same country - just update position
          setTooltipPosition(tooltipRef.current, offsetX, offsetY);
        }
      }, HOVER_THROTTLE_MS);
    },
    [updateTooltip]
  );

  /** Handle country click - center map on country */
  const handleClick = useCallback(
    (event: React.MouseEvent, options: ClickOptions) => {
      const { layerVisible, geojson, unproject, onCountryClick } = options;
      if (!layerVisible || !geojson) return;

      const coords = unproject(event.nativeEvent.offsetX, event.nativeEvent.offsetY);
      if (!coords) return;

      const country = findCountryAtLocation(coords[0], coords[1], geojson);
      if (!country) return;

      const centroid = countryCentroids[country.code];
      if (centroid) onCountryClick(country.code, centroid);
    },
    []
  );

  /** Clear tooltip state */
  const clearTooltip = useCallback(() => {
    hoverInfo.current = null;
    lastCountryCodeRef.current = null;
    if (tooltipRef.current) tooltipRef.current.style.opacity = '0';
  }, []);

  return {
    tooltipRef,
    hoverInfo,
    handleMouseMove,
    handleClick,
    clearTooltip,
  };
}

