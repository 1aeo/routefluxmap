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
import { type CountryHistogram, getCountryClientData, formatRange, TOOLTIP_OFFSET, type RelayData } from '../types';
import { findCountryAtLocation, countryCentroids, getCountryRelayStats } from '../utils/geo';
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
  relays: HTMLElement | null;
  link: HTMLAnchorElement | null;
}

/** Get relay count for a country from shared cache */
function getRelayCount(relayData: RelayData | null, countryCode: string): number {
  if (!relayData?.nodes) return 0;
  const stats = getCountryRelayStats(relayData.nodes, relayData);
  return stats.get(countryCode.toUpperCase())?.relayCount || 0;
}

/** Set tooltip position and show (module-level for zero allocation) */
const setTooltipPosition = (el: HTMLElement, x: number, y: number): void => {
  el.style.left = `${x + TOOLTIP_OFFSET}px`;
  el.style.top = `${y + TOOLTIP_OFFSET}px`;
  el.style.opacity = '1';
};

/** Update tooltip content (module-level pure function) */
const updateTooltipContent = (
  els: TooltipElements, 
  countryData: CountryHistogram, 
  code: string,
  relayData: RelayData | null
): void => {
  const { count, lower, upper, hasBounds } = getCountryClientData(countryData, code);
  const relayCount = getRelayCount(relayData, code);
  const hasRelays = relayCount > 0;
  
  // Client count
  if (els.count) els.count.textContent = `${count.toLocaleString()} clients`;
  
  // Confidence bounds
  if (els.bounds) {
    els.bounds.textContent = hasBounds ? `Est. range: ${formatRange(lower, upper)}` : '';
    els.bounds.style.display = hasBounds ? '' : 'none';
  }
  
  // Relay count (hidden if 0 or cache not ready)
  if (els.relays) {
    els.relays.textContent = hasRelays ? `${relayCount.toLocaleString()} relay${relayCount !== 1 ? 's' : ''}` : '';
    els.relays.style.display = hasRelays ? '' : 'none';
  }
  
  // Link to metrics (only shown for countries with relays)
  if (els.link) {
    els.link.style.display = hasRelays ? '' : 'none';
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
  relayData?: RelayData | null;
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
  refreshData: (countryData: CountryHistogram, relayData?: RelayData | null) => void;
}

/**
 * Manage country hover interactions with throttled updates
 */
export function useCountryHover(): UseCountryHoverResult {
  const tooltipRef = useRef<HTMLDivElement>(null);
  const hoverInfo = useRef<CountryHoverInfo | null>(null);
  const throttleTimerRef = useRef<number | null>(null);
  const elementsRef = useRef<TooltipElements | null>(null);
  
  /** Clear pending throttle timer */
  const clearThrottle = () => {
    if (throttleTimerRef.current) {
      clearTimeout(throttleTimerRef.current);
      throttleTimerRef.current = null;
    }
  };
  
  /** Get tooltip elements, re-querying if stale */
  const getElements = (): TooltipElements | null => {
    const tooltip = tooltipRef.current;
    if (!tooltip) return null;
    
    // Re-query if cached elements are detached from DOM
    if (elementsRef.current?.name && !tooltip.contains(elementsRef.current.name)) {
      elementsRef.current = null;
    }
    
    return elementsRef.current ??= {
      name: tooltip.querySelector('.country-name'),
      count: tooltip.querySelector('.country-count'),
      bounds: tooltip.querySelector('.country-bounds') as HTMLElement | null,
      relays: tooltip.querySelector('.country-relays') as HTMLElement | null,
      link: tooltip.querySelector('.country-link') as HTMLAnchorElement | null,
    };
  };

  // Cleanup throttle timer on unmount
  useEffect(() => clearThrottle, []);

  /** Hide tooltip */
  const hideTooltip = useCallback(() => {
    hoverInfo.current = null;
    if (tooltipRef.current) tooltipRef.current.style.opacity = '0';
  }, []);

  /** Update tooltip DOM directly (avoids React re-render) */
  const updateTooltip = useCallback(
    (code: string, x: number, y: number, countryData: CountryHistogram, relayData: RelayData | null) => {
      const tooltip = tooltipRef.current;
      if (!tooltip) return;
      
      hoverInfo.current = { code, x, y };
      const els = getElements();
      if (!els) return;
      
      if (els.name) els.name.textContent = code;
      if (els.link) els.link.href = getCountryMetricsUrl(code);
      updateTooltipContent(els, countryData, code, relayData);
      setTooltipPosition(tooltip, x, y);
    },
    []
  );

  /** Handle mouse move with throttling */
  const handleMouseMove = useCallback(
    (event: React.MouseEvent, options: MouseMoveOptions) => {
      const { layerVisible, geojson, unproject, project, countryData, relayData } = options;

      // Clear tooltip and reset throttle if layer hidden
      if (!layerVisible || !geojson) {
        clearThrottle();
        if (hoverInfo.current) hideTooltip();
        return;
      }

      // Keep tooltip visible if cursor is inside it (for clicking the link)
      if (hoverInfo.current && isEventInTooltip(event, tooltipRef.current)) {
        return;
      }

      // Skip if throttled
      if (throttleTimerRef.current) return;

      // Capture coordinates synchronously
      const { offsetX, offsetY } = event.nativeEvent;

      throttleTimerRef.current = window.setTimeout(() => {
        throttleTimerRef.current = null;

        try {
          const coords = unproject(offsetX, offsetY);
          if (!coords) return;

          const country = findCountryAtLocation(coords[0], coords[1], geojson);
          const code = country?.code ?? null;
          const prevCode = hoverInfo.current?.code ?? null;

          // Early exit if same country
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
          updateTooltip(code, clampedX, clampedY, countryData, relayData ?? null);
        } catch {
          // Silently ignore errors (e.g., stale viewport)
        }
      }, HOVER_THROTTLE_MS);
    },
    [hideTooltip, updateTooltip]
  );

  /** Handle country click - center map on country */
  const handleClick = useCallback(
    (event: React.MouseEvent, options: ClickOptions) => {
      const { layerVisible, geojson, unproject, onCountryClick } = options;
      if (!layerVisible || !geojson) return;
      if (isEventInTooltip(event, tooltipRef.current)) return;

      const { offsetX, offsetY } = event.nativeEvent;
      const coords = unproject(offsetX, offsetY);
      if (!coords) return;

      const country = findCountryAtLocation(coords[0], coords[1], geojson);
      if (!country) return;

      const centroid = countryCentroids[country.code];
      if (centroid) onCountryClick(country.code, centroid);
    },
    []
  );

  /** Clear tooltip state and reset throttle */
  const clearTooltip = useCallback(() => {
    clearThrottle();
    hideTooltip();
  }, [hideTooltip]);

  /** Refresh tooltip content with new data (when data changes during active hover) */
  const refreshData = useCallback((countryData: CountryHistogram, relayData?: RelayData | null) => {
    const info = hoverInfo.current;
    if (!info || !elementsRef.current) return;
    updateTooltipContent(elementsRef.current, countryData, info.code, relayData ?? null);
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

