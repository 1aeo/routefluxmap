/**
 * useMapView - Map viewport state management
 * 
 * Handles:
 * - Viewport state (lng, lat, zoom, pitch, bearing)
 * - Initial state from URL hash
 * - URL hash sync on pan/zoom
 * - Fly-to animations for countries and relays
 */

import { useState, useCallback, useMemo } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { FlyToInterpolator } from '@deck.gl/core';
import type { MapViewState } from '@deck.gl/core';
import { parseMapLocation, formatMapLocation, parseCountryCode, updateUrlHash, debounce } from '../utils/url';
import { countryCentroids } from '../utils/geo';

/** Default zoom level when centering on a country */
const COUNTRY_ZOOM = 5;

/** Focus relay zoom constraints */
const FOCUS_ZOOM_MIN = 6;
const FOCUS_ZOOM_MAX = 10;

/** Fly-to animation duration */
const FLY_TO_DURATION_MS = 1000;

/** Default initial view state */
const DEFAULT_VIEW_STATE: MapViewState = {
  longitude: -40,
  latitude: 30,
  zoom: 2,
  pitch: 0,
  bearing: 0,
};

export interface UseMapViewResult {
  /** Current viewport state */
  viewState: MapViewState;
  /** Update viewport state - accepts state or updater function */
  setViewState: Dispatch<SetStateAction<MapViewState>>;
  /** Handle view state change event from DeckGL */
  handleViewStateChange: (params: { viewState: MapViewState }) => void;
  /** Fly to a country by code */
  flyToCountry: (countryCode: string) => void;
  /** Fly to specific coordinates */
  flyToLocation: (lng: number, lat: number, zoom?: number) => void;
}

/**
 * Get initial view state from URL or use defaults
 */
function getInitialViewState(): MapViewState {
  if (typeof window === 'undefined') return DEFAULT_VIEW_STATE;

  // First check for explicit map location (takes priority)
  const mapLocation = parseMapLocation();
  if (mapLocation) {
    return {
      ...DEFAULT_VIEW_STATE,
      longitude: mapLocation.longitude,
      latitude: mapLocation.latitude,
      zoom: mapLocation.zoom,
    };
  }

  // Then check for country code
  const countryCode = parseCountryCode();
  if (countryCode && countryCentroids[countryCode]) {
    const [lng, lat] = countryCentroids[countryCode];
    return {
      ...DEFAULT_VIEW_STATE,
      longitude: lng,
      latitude: lat,
      zoom: COUNTRY_ZOOM,
    };
  }

  return DEFAULT_VIEW_STATE;
}

/**
 * Manage map viewport state with URL sync
 */
export function useMapView(): UseMapViewResult {
  const [viewState, setViewState] = useState<MapViewState>(getInitialViewState);

  // Debounced URL updater for map location (300ms delay to avoid spamming during pan/zoom)
  const debouncedUpdateMapLocation = useMemo(
    () =>
      debounce((lng: number, lat: number, zoom: number) => {
        // Batch update: set ML and clear CC in one operation
        updateUrlHash({
          ML: formatMapLocation(lng, lat, zoom),
          CC: null, // Clear country code when user manually pans/zooms
        });
      }, 300),
    []
  );

  /**
   * Handle view state change from DeckGL with URL persistence
   */
  const handleViewStateChange = useCallback(
    (params: { viewState: MapViewState }) => {
      const newViewState = params.viewState;
      setViewState(newViewState);
      debouncedUpdateMapLocation(newViewState.longitude, newViewState.latitude, newViewState.zoom);
    },
    [debouncedUpdateMapLocation]
  );

  /**
   * Fly to a country by its 2-letter code
   */
  const flyToCountry = useCallback((countryCode: string) => {
    const centroid = countryCentroids[countryCode];
    if (!centroid) {
      console.warn(`[useMapView] Unknown country code: ${countryCode}`);
      return;
    }

    setViewState(prev => ({
      ...prev,
      longitude: centroid[0],
      latitude: centroid[1],
      zoom: COUNTRY_ZOOM,
      transitionDuration: FLY_TO_DURATION_MS,
      transitionInterpolator: new FlyToInterpolator(),
    }));

    updateUrlHash({
      CC: countryCode,
      ML: formatMapLocation(centroid[0], centroid[1], COUNTRY_ZOOM),
    });
  }, []);

  /**
   * Fly to specific coordinates
   */
  const flyToLocation = useCallback((lng: number, lat: number, zoom?: number) => {
    setViewState(prev => ({
      ...prev,
      longitude: lng,
      latitude: lat,
      zoom: zoom ?? Math.max(FOCUS_ZOOM_MIN, Math.min(FOCUS_ZOOM_MAX, prev.zoom)),
      transitionDuration: FLY_TO_DURATION_MS,
      transitionInterpolator: new FlyToInterpolator(),
    }));
  }, []);

  return {
    viewState,
    setViewState,
    handleViewStateChange,
    flyToCountry,
    flyToLocation,
  };
}

// Export constants for external use
export { COUNTRY_ZOOM, FLY_TO_DURATION_MS };

