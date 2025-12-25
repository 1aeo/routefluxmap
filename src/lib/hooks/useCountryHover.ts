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
import { getCountryMetricsUrl } from '../config';

/** Throttle interval for country hover detection (~15fps) */
const HOVER_THROTTLE_MS = 66;

/** Tooltip dimensions and padding for bounds checking */
const TOOLTIP_WIDTH = 180;
const TOOLTIP_HEIGHT = 100;
const VIEWPORT_PADDING = 10;
// Pre-computed offsets (width/height + padding)
const TOOLTIP_RIGHT_OFFSET = TOOLTIP_WIDTH + VIEWPORT_PADDING;
const TOOLTIP_BOTTOM_OFFSET = TOOLTIP_HEIGHT + VIEWPORT_PADDING;
// SSR check (computed once at module load)
const IS_BROWSER = typeof window !== 'undefined';

/** Check if event target is inside the tooltip element */
const isEventInTooltip = (event: React.MouseEvent, tooltipEl: HTMLElement | null): boolean => {
  if (!tooltipEl) return false;
  return tooltipEl.contains(event.target as Node);
};

/** Clamp tooltip position to keep it within viewport */
function clampToViewport(x: number, y: number): [number, number] {
  if (!IS_BROWSER) return [x, y];
  
  return [
    Math.max(VIEWPORT_PADDING, Math.min(x, window.innerWidth - TOOLTIP_RIGHT_OFFSET)),
    Math.max(VIEWPORT_PADDING, Math.min(y, window.innerHeight - TOOLTIP_BOTTOM_OFFSET)),
  ];
}

/** Cached tooltip element refs to avoid DOM queries on every hover */
interface TooltipElements {
  name: Element | null;
  count: Element | null;
  bounds: HTMLElement | null;
  link: HTMLAnchorElement | null;
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
  project: (lng: number, lat: number) => [number, number] | null;
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
      link: tooltipRef.current.querySelector('.country-link') as HTMLAnchorElement | null,
    };
  };

  // Cleanup throttle timer on unmount
  useEffect(() => () => {
    if (throttleTimerRef.current) clearTimeout(throttleTimerRef.current);
  }, []);

  /** Hide tooltip (lightweight, no element updates needed) */
  const hideTooltip = useCallback(() => {
    hoverInfo.current = null;
    if (tooltipRef.current) {
      tooltipRef.current.style.opacity = '0';
    }
  }, []);

  /** Update tooltip DOM directly (avoids React re-render) */
  const updateTooltip = useCallback(
    (code: string, x: number, y: number, countryData: CountryHistogram) => {
      const tooltip = tooltipRef.current;
      if (!tooltip) return;
      
      hoverInfo.current = { code, x, y };
      const els = getElements();
      if (!els) return;
      
      if (els.name) els.name.textContent = code;
      updateTooltipContent(els, countryData, code);
      
      // Show and update link
      if (els.link) {
        els.link.href = getCountryMetricsUrl(code);
        els.link.style.display = '';
      }
      
      setTooltipPosition(tooltip, x, y);
    },
    []
  );

  /** Handle mouse move with throttling */
  const handleMouseMove = useCallback(
    (event: React.MouseEvent, options: MouseMoveOptions) => {
      const { layerVisible, geojson, unproject, project, countryData } = options;

      // Clear tooltip if layer hidden
      if (!layerVisible || !geojson) {
        if (hoverInfo.current) hideTooltip();
        return;
      }

      // Keep tooltip visible if cursor is inside it (for clicking the link)
      if (hoverInfo.current && isEventInTooltip(event, tooltipRef.current)) {
        return;
      }

      // Skip if throttled
      if (throttleTimerRef.current) return;

      // Access native event properties directly (avoid destructuring allocation)
      const nativeEvent = event.nativeEvent;
      const offsetX = nativeEvent.offsetX;
      const offsetY = nativeEvent.offsetY;

      throttleTimerRef.current = window.setTimeout(() => {
        throttleTimerRef.current = null;

        const coords = unproject(offsetX, offsetY);
        if (!coords) return;

        const country = findCountryAtLocation(coords[0], coords[1], geojson);
        const code = country?.code ?? null;
        const prevCode = hoverInfo.current?.code ?? null;

        // Early exit if same country (centroid is fixed, no update needed)
        if (code === prevCode) return;

        // Hide tooltip if moved off country
        if (!code) {
          hideTooltip();
          return;
        }

        // Get centroid and project to screen coordinates
        const centroid = countryCentroids[code];
        if (!centroid) return;

        const screenPos = project(centroid[0], centroid[1]);
        if (!screenPos) return;

        // Clamp to viewport bounds and show tooltip
        const [clampedX, clampedY] = clampToViewport(screenPos[0], screenPos[1]);
        updateTooltip(code, clampedX, clampedY, countryData);
      }, HOVER_THROTTLE_MS);
    },
    [hideTooltip, updateTooltip]
  );

  /** Handle country click - center map on country */
  const handleClick = useCallback(
    (event: React.MouseEvent, options: ClickOptions) => {
      const { layerVisible, geojson, unproject, onCountryClick } = options;
      if (!layerVisible || !geojson) return;

      // Ignore clicks on the tooltip (let the link handle its own clicks)
      if (isEventInTooltip(event, tooltipRef.current)) {
        return;
      }

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
    if (tooltipRef.current) {
      tooltipRef.current.style.opacity = '0';
      // Reset link display state using cached element ref
      if (elementsRef.current?.link) {
        elementsRef.current.link.style.display = 'none';
      }
    }
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

