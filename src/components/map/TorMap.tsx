/**
 * TorMap - Main map visualization component
 * Uses Deck.gl for relay markers + MapLibre GL for base map
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import DeckGL from '@deck.gl/react';
import { ScatterplotLayer } from '@deck.gl/layers';
import { Map } from 'react-map-gl/maplibre';
import type { MapViewState, PickingInfo } from '@deck.gl/core';
import type { AggregatedNode, RelayData, DateIndex, LayerVisibility, CountryHistogram } from '../../lib/types';
import { config } from '../../lib/config';
import { parseUrlHash, updateUrlHash, parseMapLocation, formatMapLocation, debounce, parseCountryCode, updateCountryCode } from '../../lib/utils/url';
import { countryCentroids, threeToTwo } from '../../lib/utils/geo';
import { fetchWithFallback } from '../../lib/utils/data-fetch';

// Transition duration for relay dot fading
const RELAY_TRANSITION_MS = 400;
import {
  calculateNodeRadius,
  calculateZoomScale,
  getZoomPixelConstraints,
} from '../../lib/utils/node-sizing';
import RelayPopup from '../ui/RelayPopup';
import DateSliderChart from '../ui/DateSliderChart';
import LayerControls from '../ui/LayerControls';
import UpdateNotification from '../ui/UpdateNotification';
import NoDataToast from '../ui/NoDataToast';
import LoadingBar from '../ui/LoadingBar';
import { createCountryLayer, CountryTooltip } from './CountryLayer';
import ParticleCanvas from './ParticleCanvas';
import 'maplibre-gl/dist/maplibre-gl.css';


const INITIAL_VIEW_STATE: MapViewState = {
  longitude: -40,
  latitude: 30,
  zoom: 3,
  pitch: 0,
  bearing: 0,
};

// Default zoom level when centering on a country
const COUNTRY_ZOOM = 5;

// Get initial view state from URL or use defaults
function getInitialViewState(): MapViewState {
  if (typeof window === 'undefined') return INITIAL_VIEW_STATE;
  
  // First check for explicit map location (takes priority)
  const mapLocation = parseMapLocation();
  if (mapLocation) {
    return {
      ...INITIAL_VIEW_STATE,
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
      ...INITIAL_VIEW_STATE,
      longitude: lng,
      latitude: lat,
      zoom: COUNTRY_ZOOM,
    };
  }
  
  return INITIAL_VIEW_STATE;
}

export default function TorMap() {
  const [viewState, setViewState] = useState<MapViewState>(getInitialViewState);
  const [relayData, setRelayData] = useState<RelayData | null>(null);
  const [dateIndex, setDateIndex] = useState<DateIndex | null>(null);
  const [currentDate, setCurrentDate] = useState<string | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<AggregatedNode | null>(null);
  const [popupPosition, setPopupPosition] = useState<{ x: number; y: number } | null>(null);
  const [hoverInfo, setHoverInfo] = useState<{ node: AggregatedNode; x: number; y: number } | null>(null);
  
  // Layer visibility state
  const [layerVisibility, setLayerVisibility] = useState<LayerVisibility>({
    relays: true,
    countries: false,
    labels: true,
    particles: true, // Enable particles by default
  });
  
  // Particle settings
  const [particleCount, setParticleCount] = useState(50000); // Start with lower count for performance
  const [lineDensityFactor, setLineDensityFactor] = useState(1.0);
  const [lineOpacityFactor, setLineOpacityFactor] = useState(1.0);
  const [lineSpeedFactor, setLineSpeedFactor] = useState(1.0);
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0); // 1x playback speed for date animation
  const [showSettings, setShowSettings] = useState(false);
  const [trafficType, setTrafficType] = useState<'all' | 'hidden' | 'general'>('all'); // Default to all traffic
  
  // Relay transition state for smooth fading
  const [relayOpacity, setRelayOpacity] = useState(1);
  const relayTransitionRef = useRef<{ animationId: number | null; startTime: number }>({ animationId: null, startTime: 0 });
  const prevRelayDataRef = useRef<RelayData | null>(null);

  // Clear hover/popup when relay layer is hidden
  const handleLayerVisibilityChange = useCallback((newVisibility: LayerVisibility) => {
    setLayerVisibility(newVisibility);
    // Clear relay hover/popup if relays are hidden
    if (!newVisibility.relays) {
      setHoverInfo(null);
      setSelectedNode(null);
      setPopupPosition(null);
    }
    // Clear country hover if countries are hidden
    if (!newVisibility.countries) {
      countryHoverRef.current = null;
      if (countryTooltipRef.current) {
        countryTooltipRef.current.style.opacity = '0';
      }
    }
  }, []);
  
  // Country data state
  const [countryData, setCountryData] = useState<CountryHistogram>({});
  const [countryGeojson, setCountryGeojson] = useState<GeoJSON.FeatureCollection | null>(null);
  
  // Country hover state - using ref to avoid re-renders for tooltip movement
  const countryHoverRef = useRef<{ code: string; x: number; y: number } | null>(null);
  const countryHover = countryHoverRef.current; // compatibility

  
  // Track previously known dates to detect new ones
  const prevDatesRef = useRef<string[]>([]);

  // Ref for the interactive map container (DOM throttling removed)
  const interactiveContainerRef = useRef<HTMLDivElement>(null);

  // NOTE: DOM event throttling removed.
  // With Worker particles + Optimized Tooltips (no-mount), the performance impact 
  // of 60fps picking is negligible, and throttling caused "stuck" tooltips 
  // because the "exit" events were being dropped.

  // Debounced URL updater for map location (300ms delay to avoid spamming during pan/zoom)
  // Also clears CC (country code) since user is manually navigating away from that country
  const debouncedUpdateMapLocation = useMemo(
    () => debounce((lng: number, lat: number, zoom: number) => {
      // Batch update: set ML and clear CC in one operation
      // This avoids multiple replaceState calls and redundant hash parsing
      updateUrlHash({
        'ML': formatMapLocation(lng, lat, zoom),
        'CC': null  // Clear country code when user manually pans/zooms
      });
    }, 300),
    []
  );

  // Handle view state change with URL persistence
  const handleViewStateChange = useCallback((params: any) => {
    const newViewState = params.viewState as MapViewState;
    setViewState(newViewState);
    debouncedUpdateMapLocation(newViewState.longitude, newViewState.latitude, newViewState.zoom);
    // CC clearing is now batched with ML update in debouncedUpdateMapLocation
  }, [debouncedUpdateMapLocation]);

  // Fetch index and return new date if found
  const fetchIndexData = useCallback(async (): Promise<string | null> => {
    try {
      const { data: index, source } = await fetchWithFallback<DateIndex>('index.json');
      if (source === 'fallback') {
        console.info('[TorMap] Using fallback data source for index');
      }
      
      // Check for new dates
      const prevDates = prevDatesRef.current;
      const newDates = index.dates.filter(d => !prevDates.includes(d));
      const latestNewDate = newDates.length > 0 ? newDates[newDates.length - 1] : null;
      
      // Update tracking
      prevDatesRef.current = index.dates;
      setDateIndex(index);
      
      // Check URL hash for initial date
      const urlParams = parseUrlHash();
      if (urlParams.date && index.dates.includes(urlParams.date)) {
        setCurrentDate(urlParams.date);
      } else if (index.dates.length > 0) {
        // Default to latest date
        setCurrentDate(index.dates[index.dates.length - 1]);
      } else {
        // No dates available - stop loading state
        setInitialLoading(false);
        setLoading(false);
      }
      
      return latestNewDate;
    } catch (err: any) {
      setError(err.message);
      setLoading(false);
      setInitialLoading(false);
      return null;
    }
  }, []);

  // Handle refresh when new data is detected - returns new date if found
  const handleDataRefresh = useCallback(async (): Promise<string | null> => {
    console.info('[TorMap] Refreshing data...');
    return await fetchIndexData();
  }, [fetchIndexData]);

  // Initial fetch on mount
  useEffect(() => {
    fetchIndexData();
  }, [fetchIndexData]);

  // Listen for URL hash changes
  useEffect(() => {
    const handleHashChange = () => {
      const params = parseUrlHash();
      if (params.date && dateIndex?.dates.includes(params.date)) {
        setCurrentDate(params.date);
      }
    };
    
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, [dateIndex]);

  // Load country GeoJSON for choropleth
  useEffect(() => {
    async function loadCountryGeoJson() {
      try {
        // Try to load from local first, then fallback
        let response;
        try {
          response = await fetch('/data/countries.geojson');
          if (!response.ok) throw new Error('Local not found');
        } catch {
          // Use a simplified world geojson (we'll create this)
          response = await fetch('https://raw.githubusercontent.com/datasets/geo-countries/master/data/countries.geojson');
        }
        
        if (response.ok) {
          const geojson = await response.json();
          
          // Normalize country codes once on load
          // This avoids repeated complex lookups in the rendering loop
          if (geojson.features) {
            // Territory mappings for regions with "-99" or missing ISO codes
            // Maps territory name patterns to their ISO alpha-2 codes
            const territoryMap: Record<string, string> = {
              'france': 'FR',
              'norway': 'NO',
              'french guiana': 'GF',
              'guyane': 'GF',
              'martinique': 'MQ',
              'guadeloupe': 'GP',
              'reunion': 'RE',
              'réunion': 'RE',
              'mayotte': 'YT',
              'new caledonia': 'NC',
              'french polynesia': 'PF',
              'saint pierre': 'PM',
              'wallis': 'WF',
              'puerto rico': 'PR',
              'guam': 'GU',
              'u.s. virgin': 'VI',
              'american samoa': 'AS',
              'northern mariana': 'MP',
            };
            
            geojson.features.forEach((feature: any) => {
              const props = feature.properties || {};
              // Try direct 2-letter codes (skip invalid codes like "-99")
              let code = props.iso_a2 || props.ISO_A2 || props.cc2 || props['ISO3166-1-Alpha-2'];
              
              // Validate: must be exactly 2 alphabetic characters
              const isValidCode = code && /^[A-Za-z]{2}$/.test(code);
              
              if (!isValidCode) {
                // Fallback to 3-letter conversion (iterate all possible keys to find a valid alpha-3 code)
                // This handles cases where iso_a3 might be "-99" but adm0_a3 is "FRA"
                const candidates3 = [
                  props.iso_a3,
                  props.ISO_A3,
                  props.adm0_a3,
                  props['ISO3166-1-Alpha-3'],
                  props.sov_a3,
                  props.gu_a3,
                  props.su_a3
                ];
                
                const code3 = candidates3.find(c => c && typeof c === 'string' && /^[A-Za-z]{3}$/.test(c));
                
                if (code3 && threeToTwo[code3.toUpperCase()]) {
                  code = threeToTwo[code3.toUpperCase()];
                } else {
                  // Last resort: try to match territory by name
                  const name = (props.name || props.NAME || props.admin || '').toLowerCase();
                  for (const [pattern, territoryCode] of Object.entries(territoryMap)) {
                    if (name.includes(pattern)) {
                      code = territoryCode;
                      break;
                    }
                  }
                }
              }
              
              // Standardize to iso_a2 (only if valid)
              if (code && /^[A-Za-z]{2}$/.test(code)) {
                feature.properties.iso_a2 = code.toUpperCase();
              }
            });
          }
          
          setCountryGeojson(geojson);
        }
      } catch (err) {
        console.warn('Could not load country GeoJSON:', err);
      }
    }
    
    loadCountryGeoJson();
  }, []);

  // Load real country client data from Tor Metrics (with primary/fallback support)
  useEffect(() => {
    if (!currentDate) return;
    
    async function loadCountryData() {
      try {
        const { data, source } = await fetchWithFallback<{ countries?: CountryHistogram }>(`countries-${currentDate}.json`);
        if (source === 'fallback') {
          console.info(`[TorMap] Using fallback for country data ${currentDate}`);
        }
        // data.countries is the CountryHistogram: { "US": 444507, "DE": 224891, ... }
        setCountryData(data.countries || data as CountryHistogram);
      } catch (err) {
        console.warn('Could not load country data:', err);
        setCountryData({});
      }
    }
    
    loadCountryData();
  }, [currentDate]);

  // Trigger relay fade-in transition
  const startRelayTransition = useCallback(() => {
    // Cancel any existing transition
    if (relayTransitionRef.current.animationId !== null) {
      cancelAnimationFrame(relayTransitionRef.current.animationId);
    }
    
    // Start fade-in from 0
    setRelayOpacity(0);
    relayTransitionRef.current.startTime = performance.now();
    
    const animateTransition = () => {
      const elapsed = performance.now() - relayTransitionRef.current.startTime;
      const progress = Math.min(1, elapsed / RELAY_TRANSITION_MS);
      
      // Ease-out curve for smooth appearance
      const easedProgress = 1 - Math.pow(1 - progress, 3);
      setRelayOpacity(easedProgress);
      
      if (progress < 1) {
        relayTransitionRef.current.animationId = requestAnimationFrame(animateTransition);
      } else {
        relayTransitionRef.current.animationId = null;
      }
    };
    
    relayTransitionRef.current.animationId = requestAnimationFrame(animateTransition);
  }, []);

  // Fetch relay data when date changes (with primary/fallback support)
  useEffect(() => {
    if (!currentDate) return;

    async function fetchRelays() {
      setLoading(true);
      try {
        // Try flat structure first, then current/ subdirectory
        let result;
        try {
          result = await fetchWithFallback<RelayData>(`relays-${currentDate}.json`);
        } catch {
          result = await fetchWithFallback<RelayData>(`current/relays-${currentDate}.json`);
        }
        
        if (result.source === 'fallback') {
          console.info(`[TorMap] Using fallback for relay data ${currentDate}`);
        }
        
        // Check if data actually changed (different day)
        const dataChanged = prevRelayDataRef.current !== null && 
          prevRelayDataRef.current.published !== result.data.published;
        
        prevRelayDataRef.current = result.data;
        setRelayData(result.data);
        setError(null);
        
        // Trigger fade-in if data changed
        if (dataChanged) {
          startRelayTransition();
        }
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
        setInitialLoading(false);
      }
    }

    fetchRelays();
  }, [currentDate, startRelayTransition]);
  
  // Cleanup relay transition on unmount
  useEffect(() => {
    return () => {
      if (relayTransitionRef.current.animationId !== null) {
        cancelAnimationFrame(relayTransitionRef.current.animationId);
      }
    };
  }, []);

  // Handle date change from slider
  const handleDateChange = useCallback((date: string) => {
    setCurrentDate(date);
    // Close any open popups when date changes
    setSelectedNode(null);
    setPopupPosition(null);
  }, []);

  // Handle click on relay marker
  const handleClick = useCallback((info: PickingInfo) => {
    if (info.object) {
      setSelectedNode(info.object as AggregatedNode);
      setPopupPosition({ x: info.x, y: info.y });
    } else {
      setSelectedNode(null);
      setPopupPosition(null);
    }
  }, []);

  // Handle hover - throttled to reduce picking overhead during particle animation
  // Deck.gl's picking causes GPU readback on every mouse move, which blocks animation
  // Optimized: Using refs to update DOM directly instead of React state for smoother tooltips
  const tooltipRef = useRef<HTMLDivElement>(null);
  const countryTooltipRef = useRef<HTMLDivElement>(null);
  
  const handleHover = useCallback((info: PickingInfo) => {
    if (info.object) {
      const node = info.object as AggregatedNode;
      // Only trigger re-render if the NODE changes
      if (!hoverInfo || hoverInfo.node !== node) {
        setHoverInfo({
          node,
          x: info.x,
          y: info.y,
        });
      } else if (tooltipRef.current) {
        // Manually update position without re-render
        tooltipRef.current.style.left = `${info.x + 10}px`;
        tooltipRef.current.style.top = `${info.y + 10}px`;
      }
    } else {
      // Only clear if we were previously hovering
      if (hoverInfo) {
        setHoverInfo(null);
      }
    }
  }, [hoverInfo]);

  // Close popup
  const handleClosePopup = useCallback(() => {
    setSelectedNode(null);
    setPopupPosition(null);
  }, []);

  // Handle country hover - completely ref-based for zero lag
  const handleCountryHover = useCallback((code: string | null, x: number, y: number) => {
    if (code) {
      countryHoverRef.current = { code, x, y };
      
      if (countryTooltipRef.current) {
        // Update content directly in DOM to avoid React render cycle
        // Note: We need specific class names in CountryTooltip to target elements
        const nameEl = countryTooltipRef.current.querySelector('.country-name');
        const countEl = countryTooltipRef.current.querySelector('.country-count');
        const count = countryData[code] || 0;
        
        if (nameEl) nameEl.textContent = code;
        if (countEl) countEl.textContent = `${count.toLocaleString()} clients`;
        
        // Update position and show
        countryTooltipRef.current.style.left = `${x + 10}px`;
        countryTooltipRef.current.style.top = `${y + 10}px`;
        countryTooltipRef.current.style.opacity = '1';
      }
    } else {
      countryHoverRef.current = null;
      if (countryTooltipRef.current) {
        countryTooltipRef.current.style.opacity = '0';
      }
    }
  }, [countryData]);

  // Handle country click - center on country and update URL
  const handleCountryClick = useCallback((code: string, name: string) => {
    const centroid = countryCentroids[code];
    if (centroid) {
      const [lng, lat] = centroid;
      setViewState(prev => ({
        ...prev,
        longitude: lng,
        latitude: lat,
        zoom: COUNTRY_ZOOM,
      }));
      
      // Update URL with country code and map location in one batch
      // This prevents multiple history entries/thrashing
      updateUrlHash({
        'CC': code,
        'ML': formatMapLocation(lng, lat, COUNTRY_ZOOM)
      });
    }
    // TODO: Show country statistics popup (outlier chart)
  }, []);

  // Cleanup country tooltip when layer is disabled
  useEffect(() => {
    if (!layerVisibility.countries) {
      countryHoverRef.current = null;
      if (countryTooltipRef.current) {
        countryTooltipRef.current.style.opacity = '0';
      }
    }
  }, [layerVisibility.countries]);

  // Check if we have actual relay nodes to display
  const hasRelayNodes = !!(relayData && relayData.nodes && relayData.nodes.length > 0);
  
  // Memoize expensive relay calculations (only recompute when relayData changes)
  const { maxRelayCount, maxBandwidth } = useMemo(() => {
    if (!relayData?.nodes?.length) {
      return { maxRelayCount: 1, maxBandwidth: 0 };
    }
    return {
      maxRelayCount: Math.max(...relayData.nodes.map(n => n.relays.length), 1),
      maxBandwidth: relayData.minMax.max,
    };
  }, [relayData]);

  // Memoize zoom-based calculations (only recompute when zoom changes)
  const { zoomScale, baseMinPixels, baseMaxPixels } = useMemo(() => ({
    zoomScale: calculateZoomScale(viewState.zoom),
    ...getZoomPixelConstraints(viewState.zoom),
  }), [viewState.zoom]);

  // OLD: Particle layer - smaller dots with opacity (only if we have relay nodes)
  /*
  const { layers: particleLayers, progress: particleProgress, isGenerating: isGeneratingParticles } = useParticleLayer({
    nodes: relayData?.nodes ?? [],
    visible: layerVisibility.particles && hasRelayNodes,
    particleCount,
    particleSize: 1, // Smaller particles
    speedFactor: lineSpeedFactor,
    offsetFactor: config.particleOffset.default,
    hiddenServiceProbability: config.hiddenServiceProbability,
    trafficType,
    lineDensityFactor,
    lineOpacityFactor,
  });
  */

  // Create static layers (without particles to avoid re-render loops)
  const baseLayers = useMemo(() => {
    const result: any[] = [];
    
    // Country layer (rendered first, underneath relays)
    // Always create and add the layer - visibility is controlled via Deck.gl's visible prop
    // This keeps geometry in GPU memory and prevents re-parsing lag when toggling
    const countryLayer = createCountryLayer({
      countryData,
      geojson: countryGeojson,
      visible: layerVisibility.countries,
      opacity: 0.5,
      onHover: handleCountryHover,
      onClick: handleCountryClick,
    });
    if (countryLayer) {
      result.push(countryLayer);
    }
    
    // Relay layer (only if we have actual nodes)
    const hasNodes = relayData && relayData.nodes && relayData.nodes.length > 0;
    if (hasNodes && layerVisibility.relays) {
      result.push(
        new ScatterplotLayer({
          id: 'relays',
          data: relayData.nodes,
          pickable: true,
          opacity: 0.85 * relayOpacity, // Apply transition opacity
          stroked: true,
          filled: true,
          radiusScale: zoomScale,
          radiusMinPixels: baseMinPixels,
          radiusMaxPixels: baseMaxPixels,
          lineWidthMinPixels: 1,
          getPosition: (d: AggregatedNode) => [d.lng, d.lat],
          getRadius: (d: AggregatedNode) =>
            calculateNodeRadius(d, viewState.zoom, maxRelayCount, maxBandwidth),
          getFillColor: (d: AggregatedNode) => {
            // Color by relay type: Exit (orange) > Guard (deep green) > Middle (mint green)
            const hasExit = d.relays.some(r => r.flags.includes('E'));
            const hasGuard = d.relays.some(r => r.flags.includes('G'));
            
            if (hasExit) return config.relayColors.exit;
            if (hasGuard) return config.relayColors.guard;
            return config.relayColors.middle;
          },
          getLineColor: [0, 255, 136, Math.round(100 * relayOpacity)], // Green outline with transition opacity
          onClick: handleClick,
          onHover: handleHover,
          updateTriggers: {
            getFillColor: [relayData],
            getRadius: [relayData, viewState.zoom, maxRelayCount, maxBandwidth],
            opacity: [relayOpacity],
            getLineColor: [relayOpacity],
          },
        })
      );
    }
    
    return result;
  }, [relayData, countryData, countryGeojson, layerVisibility, viewState.zoom, handleClick, handleHover, handleCountryHover, handleCountryClick, relayOpacity, maxRelayCount, maxBandwidth, zoomScale, baseMinPixels, baseMaxPixels]);

  // Combine base layers with particle layer (particle layer updates independently)
  // const layers = particleLayers ? [...baseLayers, ...particleLayers] : baseLayers;
  const layers = baseLayers;

  // Initial Loading state (only shown on first load)
  if (initialLoading && !relayData) {
    return (
      <div className="flex items-center justify-center h-full bg-tor-darker">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-tor-green mx-auto mb-4"></div>
          <p className="text-gray-400">Loading relay data...</p>
        </div>
      </div>
    );
  }

  // Error state (only shown if no data at all)
  if (error && !relayData) {
    return (
      <div className="flex items-center justify-center h-full bg-tor-darker">
        <div className="text-center">
          <div className="text-tor-orange text-4xl mb-4">⚠️</div>
          <p className="text-gray-400">Failed to load relay data</p>
          <p className="text-gray-500 text-sm mt-2">{error}</p>
          <p className="text-gray-600 text-xs mt-4">
            Run: npm run fetch-data
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative w-full h-full" ref={interactiveContainerRef}>
      <DeckGL
        viewState={viewState}
        onViewStateChange={handleViewStateChange}
        controller={true}
        layers={layers}
        // Use our throttled hover state for cursor instead of Deck.gl's internal picking
        // This avoids the expensive isHovering check on every mouse move
        getCursor={() => hoverInfo ? 'pointer' : 'grab'}
        style={{ zIndex: '1' }} // Ensure map is below UI but handles interaction
      >
        <Map
          mapStyle={config.mapStyle}
          attributionControl={true}
        />
      </DeckGL>

      {/* Offscreen Particle Canvas (Rendered independently via Worker) */}
      <ParticleCanvas
        nodes={relayData?.nodes ?? []}
        viewState={viewState}
        width={typeof window !== 'undefined' ? window.innerWidth : 800}
        height={typeof window !== 'undefined' ? window.innerHeight : 600}
        visible={layerVisibility.particles && hasRelayNodes}
      />

      {/* Update notification */}
      <UpdateNotification onRefresh={handleDataRefresh} />
      
      {/* Particle generation progress (disabled for now as worker handles it silently) */}
      {/* 
      {isGeneratingParticles && particleProgress !== null && (
        <LoadingBar progress={particleProgress} label="Generating particles" />
      )}
      */}
      
      {/* No relay data toast - shown when data was fetched but has no nodes, or no dates available */}
      {!loading && !initialLoading && (
        (dateIndex && dateIndex.dates.length === 0) ? (
          <NoDataToast message="No relay data available" />
        ) : (relayData && (!relayData.nodes || relayData.nodes.length === 0)) ? (
          <NoDataToast message="No relay data available for this date" />
        ) : null
      )}

      {/* Hover tooltip - Always rendered but hidden when not active to prevent mounting lag */}
      <div
        ref={tooltipRef}
        className="absolute pointer-events-none bg-black/40 backdrop-blur-md text-white text-sm px-3 py-2 rounded-lg shadow-lg border border-tor-green/30 z-10 transition-opacity duration-75"
        style={{
          left: 0,
          top: 0,
          opacity: (hoverInfo && !selectedNode) ? 1 : 0,
        }}
      >
        {hoverInfo && (
          <>
            <div className="font-medium text-tor-green">{hoverInfo.node.label}</div>
            <div className="text-gray-400 text-xs">
              {hoverInfo.node.relays.length} relay{hoverInfo.node.relays.length !== 1 ? 's' : ''}
            </div>
          </>
        )}
      </div>

      {/* Relay popup */}
      {selectedNode && popupPosition && (
        <RelayPopup
          node={selectedNode}
          x={popupPosition.x}
          y={popupPosition.y}
          onClose={handleClosePopup}
        />
      )}

      {/* Country hover tooltip - Always rendered but hidden when not active */}
      <CountryTooltip
        ref={countryTooltipRef}
        countryCode=""
        countryData={countryData}
        x={0}
        y={0}
        style={{
          opacity: 0,
          pointerEvents: 'none',
          zIndex: 60
        }}
      />

      {/* Header + Layer Controls - top left */}
      <div className="absolute top-4 left-4 z-10">
        <div className="bg-black/40 backdrop-blur-md rounded-lg p-3 border border-tor-green/20">
          {/* Logo/Title */}
          <div className="flex items-center gap-2 mb-3 pb-2 border-b border-tor-green/10">
            <svg className="w-6 h-6" viewBox="0 0 32 32" fill="none">
              <circle cx="16" cy="16" r="14" stroke="currentColor" strokeWidth="2" className="text-tor-green-dark"/>
              <circle cx="16" cy="16" r="8" stroke="currentColor" strokeWidth="2" className="text-tor-green"/>
              <circle cx="16" cy="16" r="3" fill="currentColor" className="text-tor-green"/>
            </svg>
            <div>
              <h1 className="text-lg font-bold leading-tight">
                <span className="text-tor-green">Route</span> <span className="text-white">Flux Map</span>
              </h1>
              <p className="text-gray-500 text-[10px]">Visualizing the Tor Network</p>
            </div>
          </div>
          
          {/* Layer toggles */}
          <LayerControls
            visibility={layerVisibility}
            onVisibilityChange={handleLayerVisibilityChange}
            showParticles={true}
            compact={true}
          />
        </div>
      </div>

      {/* Stats panel - bottom right (offset to avoid map credits) */}
      {relayData && (
        <div className="absolute bottom-8 right-4 bg-black/40 backdrop-blur-md rounded-lg p-3 border border-tor-green/20 z-10 min-w-[130px]">
          <div className="text-tor-green text-xl font-bold leading-tight">
            {relayData.nodes.reduce((sum, n) => sum + n.relays.length, 0).toLocaleString()}
          </div>
          <div className="text-gray-400 text-xs">Active Relays</div>
          <div className="text-gray-500 text-[10px]">
            {relayData.nodes.length} locations
          </div>
          {dateIndex && (
            <div className="text-gray-600 text-[10px]">
              {new Date(dateIndex.lastUpdated).toLocaleDateString()}
            </div>
          )}
          
          {/* Relay Type Legend */}
          <div className="mt-2 pt-2 border-t border-white/10 space-y-0.5">
            <div className="text-[9px] text-gray-500 mb-1">Relay Types</div>
            <div className="flex items-center gap-1.5 text-[10px]">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: `rgb(${config.relayColors.exit.slice(0, 3).join(',')})` }} />
              <span className="text-gray-400">Exit</span>
              <span className="text-gray-600 text-[9px]">– outbound traffic</span>
            </div>
            <div className="flex items-center gap-1.5 text-[10px]">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: `rgb(${config.relayColors.guard.slice(0, 3).join(',')})` }} />
              <span className="text-gray-400">Guard</span>
              <span className="text-gray-600 text-[9px]">– entry point</span>
            </div>
            <div className="flex items-center gap-1.5 text-[10px]">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: `rgb(${config.relayColors.middle.slice(0, 3).join(',')})` }} />
              <span className="text-gray-400">Middle</span>
              <span className="text-gray-600 text-[9px]">– intermediate</span>
            </div>
            <div className="flex items-center gap-1.5 text-[10px] mt-1">
              <span className="w-2 h-2 rounded-full bg-purple-400" />
              <span className="text-gray-400">HSDir</span>
              <span className="text-gray-600 text-[9px]">– hidden services</span>
            </div>
          </div>
          
          {/* GitHub link */}
          <a 
            href="https://github.com/1aeo/routefluxmap"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 pt-2 border-t border-white/10 flex items-center justify-center gap-1 text-gray-500 hover:text-tor-green transition-colors text-[10px]"
          >
            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
              <path fillRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" clipRule="evenodd" />
            </svg>
            GitHub
          </a>
        </div>
      )}

      {/* Date controls - bottom center with proper spacing from side content */}
      <div className="absolute bottom-4 left-0 right-0 z-10 flex justify-center pointer-events-none">
        <div className="pointer-events-auto">
          {/* Combined date slider with histogram - only show when multiple dates */}
          {dateIndex && currentDate && dateIndex.dates.length > 1 && (
            <DateSliderChart
              dateIndex={dateIndex}
              currentDate={currentDate}
              onDateChange={handleDateChange}
              playbackSpeed={playbackSpeed}
            />
          )}

          {/* Single date display (when only one date available) */}
          {dateIndex && currentDate && dateIndex.dates.length === 1 && (
            <div className="bg-black/40 backdrop-blur-md rounded-lg px-3 py-2 border border-tor-green/20 text-center">
              <div className="text-tor-green text-sm font-medium">
                {new Date(currentDate).toLocaleDateString('en-US', {
                  weekday: 'long',
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Zoom controls - bottom left */}
      <div className="absolute bottom-8 left-4 z-10 flex flex-col gap-1">
        {/* Settings Toggle */}
        <button
          onClick={() => setShowSettings(!showSettings)}
          className={`w-8 h-8 flex items-center justify-center rounded-lg backdrop-blur-md border transition-colors ${
            showSettings 
              ? 'bg-tor-green text-black border-tor-green' 
              : 'bg-black/40 border-tor-green/20 text-tor-green hover:bg-tor-green/20'
          }`}
          aria-label="Toggle settings"
          title="Line Settings"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
          </svg>
        </button>

        {/* Settings Panel (Popup) */}
        {showSettings && (
          <div className="absolute bottom-0 left-10 ml-2 bg-black/80 backdrop-blur-md rounded-lg p-3 border border-tor-green/20 w-48 shadow-lg animate-fade-in">
            
            {/* Traffic Type Section */}
            <h3 className="text-tor-green text-xs font-bold mb-3 uppercase tracking-wider">Traffic Type</h3>
            <div className="flex gap-1 mb-3">
              <button
                onClick={() => setTrafficType('all')}
                className={`flex-1 px-2 py-1.5 rounded text-[10px] font-medium transition-colors ${
                  trafficType === 'all'
                    ? 'bg-cyan-500 text-black'
                    : 'bg-white/10 text-gray-400 hover:bg-white/20'
                }`}
              >
                All
              </button>
              <button
                onClick={() => setTrafficType('general')}
                className={`flex-1 px-2 py-1.5 rounded text-[10px] font-medium transition-colors ${
                  trafficType === 'general'
                    ? 'bg-tor-green text-black'
                    : 'bg-white/10 text-gray-400 hover:bg-white/20'
                }`}
              >
                <span className="flex items-center justify-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-[#00ff88]" />
                  General
                </span>
              </button>
              <button
                onClick={() => setTrafficType('hidden')}
                className={`flex-1 px-2 py-1.5 rounded text-[10px] font-medium transition-colors ${
                  trafficType === 'hidden'
                    ? 'bg-tor-orange text-black'
                    : 'bg-white/10 text-gray-400 hover:bg-white/20'
                }`}
              >
                <span className="flex items-center justify-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-[#ff6600]" />
                  Hidden
                </span>
              </button>
            </div>

            {/* Line Settings Section */}
            <h3 className="text-tor-green text-xs font-bold mb-3 mt-4 pt-3 border-t border-white/10 uppercase tracking-wider">Line Settings</h3>
            
            {/* Density Slider */}
            <div className="mb-3">
              <div className="flex justify-between text-[10px] text-gray-400 mb-1">
                <span>Density</span>
                <span>{(lineDensityFactor * 100).toFixed(0)}%</span>
              </div>
              <input
                type="range"
                min="0.1"
                max="6.0"
                step="0.1"
                value={lineDensityFactor}
                onChange={(e) => setLineDensityFactor(parseFloat(e.target.value))}
                className="w-full h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-tor-green"
              />
            </div>

            {/* Opacity Slider */}
            <div className="mb-3">
              <div className="flex justify-between text-[10px] text-gray-400 mb-1">
                <span>Opacity</span>
                <span>{(lineOpacityFactor * 100).toFixed(0)}%</span>
              </div>
              <input
                type="range"
                min="0.1"
                max="6.0"
                step="0.1"
                value={lineOpacityFactor}
                onChange={(e) => setLineOpacityFactor(parseFloat(e.target.value))}
                className="w-full h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-tor-green"
              />
            </div>

            {/* Speed Slider */}
            <div className="mb-3">
              <div className="flex justify-between text-[10px] text-gray-400 mb-1">
                <span>Speed</span>
                <span>{(lineSpeedFactor * 100).toFixed(0)}%</span>
              </div>
              <input
                type="range"
                min="0.1"
                max="5.0"
                step="0.1"
                value={lineSpeedFactor}
                onChange={(e) => setLineSpeedFactor(parseFloat(e.target.value))}
                className="w-full h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-tor-green"
              />
            </div>

            {/* Playback Section */}
            <h3 className="text-tor-green text-xs font-bold mb-3 mt-4 pt-3 border-t border-white/10 uppercase tracking-wider">Playback</h3>
            
            {/* Playback Speed Slider */}
            <div className="mb-3">
              <div className="flex justify-between text-[10px] text-gray-400 mb-1">
                <span>Speed</span>
                <span>{playbackSpeed}x</span>
              </div>
              <input
                type="range"
                min="0.1"
                max="4"
                step="0.1"
                value={playbackSpeed}
                onChange={(e) => setPlaybackSpeed(parseFloat(e.target.value))}
                className="w-full h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-tor-green"
              />
            </div>
          </div>
        )}

        <button
          onClick={() => setViewState(prev => ({ ...prev, zoom: Math.min(prev.zoom + 1, 18) }))}
          className="w-8 h-8 flex items-center justify-center rounded-lg bg-black/40 backdrop-blur-md border border-tor-green/20 text-tor-green hover:bg-tor-green/20 transition-colors"
          aria-label="Zoom in"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v12M6 12h12" />
          </svg>
        </button>
        <button
          onClick={() => setViewState(prev => ({ ...prev, zoom: Math.max(prev.zoom - 1, 1) }))}
          className="w-8 h-8 flex items-center justify-center rounded-lg bg-black/40 backdrop-blur-md border border-tor-green/20 text-tor-green hover:bg-tor-green/20 transition-colors"
          aria-label="Zoom out"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 12h12" />
          </svg>
        </button>
        <div className="text-center text-[9px] text-gray-500 mt-0.5">
          {viewState.zoom.toFixed(1)}x
        </div>
      </div>

      {/* Loading indicator (non-blocking) */}
      {loading && relayData && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-20 bg-black/80 backdrop-blur-sm rounded-full px-4 py-2 border border-tor-green/20 flex items-center gap-2">
          <div className="animate-spin rounded-full h-4 w-4 border-t-2 border-b-2 border-tor-green"></div>
          <span className="text-tor-green text-xs">Loading...</span>
        </div>
      )}
    </div>
  );
}
