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

import { useCallback, useRef, useEffect, useMemo } from 'react';
import type { RefObject } from 'react';
import { type CountryHistogram, getCountryClientData, formatRange, TOOLTIP_OFFSET } from '../types';
import { findCountryAtLocation, countryCentroids } from '../utils/geo';

/** Throttle interval for country hover detection (~15fps) */
const HOVER_THROTTLE_MS = 66;

/** Cached tooltip element refs to avoid DOM queries on every hover */
interface TooltipElements {
  name: Element | null;
  count: Element | null;
  bounds: HTMLElement | null;
}

/** Set tooltip position and show (module-level for zero allocation) */
const setTooltipPosition = (el: HTMLElement, x: number, y: number): void => {
  el.style.left = `${x + TOOLTIP_OFFSET}px`;
  el.style.top = `${y + TOOLTIP_OFFSET}px`;
  el.style.opacity = '1';
};

/** Update tooltip count/bounds content (module-level pure function) */
const updateTooltipContent = (els: TooltipElements, countryData: CountryHistogram, code: string): void => {
  const { count, lower, upper, hasBounds } = getCountryClientData(countryData, code);
  
  if (els.count) els.count.textContent = `${count.toLocaleString()} clients`;
  if (els.bounds) {
    els.bounds.textContent = hasBounds ? `Est. range: ${formatRange(lower, upper)}` : '';
    els.bounds.style.display = hasBounds ? '' : 'none';
  }
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
  /** Refresh tooltip content with new data (for when countryData changes during hover) */
  refreshData: (countryData: CountryHistogram) => void;
}

/**
 * Manage country hover interactions with throttled updates
 */
export function useCountryHover(): UseCountryHoverResult {
  const tooltipRef = useRef<HTMLDivElement>(null);
  const hoverInfo = useRef<CountryHoverInfo | null>(null);
  const throttleTimerRef = useRef<number | null>(null);
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
      
      if (els.name) els.name.textContent = code;
      updateTooltipContent(els, countryData, code);
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
        if (hoverInfo.current) updateTooltip(null, 0, 0, countryData);
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
        const prevCode = hoverInfo.current?.code ?? null;

        if (code !== prevCode) {
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
    if (tooltipRef.current) tooltipRef.current.style.opacity = '0';
  }, []);

  /** Refresh tooltip content with new data (when data changes during active hover) */
  const refreshData = useCallback((countryData: CountryHistogram) => {
    // Early exit if no active hover (avoid getElements call)
    const info = hoverInfo.current;
    if (!info) return;
    
    const els = elementsRef.current;
    if (!els) return;
    
    updateTooltipContent(els, countryData, info.code);
  }, []);

  // Memoize return object to prevent unnecessary re-renders in consumers
  return useMemo(() => ({
    tooltipRef,
    hoverInfo,
    handleMouseMove,
    handleClick,
    clearTooltip,
    refreshData,
  }), [handleMouseMove, handleClick, clearTooltip, refreshData]);
}

