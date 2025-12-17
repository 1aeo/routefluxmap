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
import { parseUrlHash, updateUrlHash, parseMapLocation, formatMapLocation, debounce, parseCountryCode } from '../../lib/utils/url';
import { countryCentroids, threeToTwo, findCountryAtLocation } from '../../lib/utils/geo';
import { fetchWithFallback } from '../../lib/utils/data-fetch';
import { calculateNodeRadius } from '../../lib/utils/node-sizing';
import RelayPopup from '../ui/RelayPopup';
import DateSliderChart from '../ui/DateSliderChart';
import LayerControls from '../ui/LayerControls';
import UpdateNotification from '../ui/UpdateNotification';
import NoDataToast from '../ui/NoDataToast';
import StartupOverlay from '../ui/StartupOverlay';
import { createCountryLayer, CountryTooltip } from './CountryLayer';
import ParticleCanvas from './ParticleCanvas';
import SettingsPanel from './SettingsPanel';
import 'maplibre-gl/dist/maplibre-gl.css';

// Transition duration for relay dot fading
const RELAY_TRANSITION_MS = 400;

// Mobile layout constants
const MOBILE_BREAKPOINT = 640;
const MOBILE_CONTROLS_BOTTOM = 295; // px from bottom for zoom/legend on mobile
const MOBILE_SLIDER_BOTTOM = 85;    // px from bottom for date slider on mobile

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
  const [selectedCountryName, setSelectedCountryName] = useState<string | null>(null);
  const [popupPosition, setPopupPosition] = useState<{ x: number; y: number } | null>(null);
  const [hoverInfo, setHoverInfo] = useState<{ node: AggregatedNode; x: number; y: number } | null>(null);
  const [loadingStatus, setLoadingStatus] = useState<string>('Initializing...');
  const [loadingProgress, setLoadingProgress] = useState<number>(0);
  const [mapLoaded, setMapLoaded] = useState(false);
  
  // Layer visibility state
  const [layerVisibility, setLayerVisibility] = useState<LayerVisibility>({
    relays: true,
    countries: false,
    labels: true,
    particles: true, // Enable particles by default
  });
  
  // Particle settings
  const [lineDensityFactor, setLineDensityFactor] = useState(0.5);
  const [lineOpacityFactor, setLineOpacityFactor] = useState(0.5);
  const [lineSpeedFactor, setLineSpeedFactor] = useState(0.5);
  const [relaySizeScale, setRelaySizeScale] = useState(0.5); // 0.5 = 50% slider = 1x size (current)
  const [filterRelaysByTraffic, setFilterRelaysByTraffic] = useState(false); // Filter relays to match traffic routes
  const [visibleNodeIndices, setVisibleNodeIndices] = useState<Set<number>>(new Set()); // Indices from particle worker
  const [indicesDataVersion, setIndicesDataVersion] = useState<string | null>(null); // Track which data version indices belong to
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0); // 1x playback speed for date animation
  const [isPlaying, setIsPlaying] = useState(false); // Playback state (lifted from DateSliderChart)
  const [showSettings, setShowSettings] = useState(false);
  const [trafficType, setTrafficType] = useState<'all' | 'hidden' | 'general'>('all'); // Default to all traffic
  const [pathMode, setPathMode] = useState<'city' | 'country'>('city'); // City or Country path mode
  const [cinemaMode, setCinemaMode] = useState(false); // Hide UI for presentation mode
  
  // Mobile detection
  const [isMobile, setIsMobile] = useState(false);
  const [legendExpanded, setLegendExpanded] = useState(false);
  
  // Relay transition state for smooth fading
  const [relayOpacity, setRelayOpacity] = useState(1);
  const relayTransitionRef = useRef<{ animationId: number | null; startTime: number }>({ animationId: null, startTime: 0 });
  const prevRelayDataRef = useRef<RelayData | null>(null);
  
  // Playback interval ref (for cinema mode persistence)
  const playIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
    // Reset relay filter when particles are disabled
    if (!newVisibility.particles) {
      setFilterRelaysByTraffic(false);
    }
  }, []);
  
  // Country data state
  const [countryData, setCountryData] = useState<CountryHistogram>({});
  const [countryGeojson, setCountryGeojson] = useState<GeoJSON.FeatureCollection | null>(null);
  
  // Country hover state - using ref to avoid re-renders for tooltip movement
  const countryHoverRef = useRef<{ code: string; x: number; y: number } | null>(null);
  
  // Track previously known dates to detect new ones
  const prevDatesRef = useRef<string[]>([]);
  
  // Ref to access DeckGL viewport for coordinate unprojection
  const deckRef = useRef<any>(null);
  
  // Throttle timer for country hover detection
  const countryHoverTimerRef = useRef<number | null>(null);
  const lastCountryCodeRef = useRef<string | null>(null);
  
  // Cleanup timer on unmount to prevent memory leaks
  useEffect(() => {
    return () => {
      if (countryHoverTimerRef.current) clearTimeout(countryHoverTimerRef.current);
    };
  }, []);
  
  // Mobile detection
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Close settings panel when entering cinema mode
  useEffect(() => {
    if (cinemaMode && showSettings) {
      setShowSettings(false);
    }
  }, [cinemaMode, showSettings]);
  
  // Helper to unproject screen coords to [lng, lat] via deck.gl viewport
  const unprojectCoords = useCallback((x: number, y: number): [number, number] | null => {
    const viewport = deckRef.current?.deck?.getViewports()[0];
    return viewport ? viewport.unproject([x, y]) : null;
  }, []);

  // PERF: Event throttling intentionally disabled here.
  // The particle system runs in a Web Worker (OffscreenCanvas), so main-thread
  // mouse events don't compete with rendering. Throttling caused "stuck" tooltips
  // by dropping mouseout events.

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
      setLoadingStatus('Loading index...');
      setLoadingProgress(10);
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
        setLoadingStatus('Loading map data...');
        // Try to load from local first, then fallback to CDN
        let response;
        try {
          response = await fetch('/data/countries.geojson');
          if (!response.ok) throw new Error('Local not found');
        } catch {
          response = await fetch('https://raw.githubusercontent.com/datasets/geo-countries/master/data/countries.geojson');
        }
        
        if (response.ok) {
          const geojson = await response.json();
          
          // Normalize country codes in chunks to avoid blocking the main thread
          // This prevents requestAnimationFrame violations during loading
          if (geojson.features) {
            // --- Territory Code Normalization ---
            // GeoJSON files use inconsistent ISO codes. Map common territory names
            // to their ISO 3166-1 alpha-2 codes for reliable choropleth matching.
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
            
            // Process a single feature (extracted for chunking)
            const processFeature = (feature: any) => {
              const props = feature.properties || {};
              let code = props.iso_a2 || props.ISO_A2 || props.cc2 || props['ISO3166-1-Alpha-2'];
              const isValidCode = code && /^[A-Za-z]{2}$/.test(code);
              
              if (!isValidCode) {
                const candidates3 = [
                  props.iso_a3, props.ISO_A3, props.adm0_a3,
                  props['ISO3166-1-Alpha-3'], props.sov_a3, props.gu_a3, props.su_a3
                ];
                const code3 = candidates3.find(c => c && typeof c === 'string' && /^[A-Za-z]{3}$/.test(c));
                
                if (code3 && threeToTwo[code3.toUpperCase()]) {
                  code = threeToTwo[code3.toUpperCase()];
                } else {
                  const name = (props.name || props.NAME || props.admin || '').toLowerCase();
                  for (const [pattern, territoryCode] of Object.entries(territoryMap)) {
                    if (name.includes(pattern)) {
                      code = territoryCode;
                      break;
                    }
                  }
                }
              }
              
              if (code && /^[A-Za-z]{2}$/.test(code)) {
                feature.properties.iso_a2 = code.toUpperCase();
              }
            };
            
            // Process GeoJSON features in small chunks to avoid blocking the main thread.
            // Without chunking, 200+ country features can trigger "requestAnimationFrame exceeded"
            // warnings during initial load.
            const CHUNK_SIZE = 50;
            const features = geojson.features;
            let index = 0;
            
            const processChunk = () => {
              const end = Math.min(index + CHUNK_SIZE, features.length);
              for (; index < end; index++) {
                processFeature(features[index]);
              }
              
              if (index < features.length) {
                // Use requestIdleCallback if available, else setTimeout
                if ('requestIdleCallback' in self) {
                  (self as any).requestIdleCallback(processChunk, { timeout: 50 });
                } else {
                  setTimeout(processChunk, 0);
                }
              } else {
                // All features processed
                setCountryGeojson(geojson);
                setLoadingProgress(prev => Math.max(prev, 20));
              }
            };
            
            // Start chunked processing
            processChunk();
          } else {
            setCountryGeojson(geojson);
            setLoadingProgress(prev => Math.max(prev, 20));
          }
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
        setLoadingStatus('Loading country stats...');
        const { data, source } = await fetchWithFallback<{ countries?: CountryHistogram }>(`countries-${currentDate}.json`);
        if (source === 'fallback') {
          console.info(`[TorMap] Using fallback for country data ${currentDate}`);
        }
        // data.countries is the CountryHistogram: { "US": 444507, "DE": 224891, ... }
        setCountryData(data.countries || data as CountryHistogram);
        setLoadingProgress(prev => Math.max(prev, 90));
      } catch (err) {
        console.warn('Could not load country data:', err);
        setCountryData({});
      }
    }
    
    loadCountryData();
  }, [currentDate]);

  // Smooth completion of loading
  useEffect(() => {
    if (!initialLoading && mapLoaded) {
      setLoadingProgress(100);
      setLoadingStatus('Ready');
    }
  }, [initialLoading, mapLoaded]);

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
      setLoadingStatus('Downloading relay data...');
      // Progress handler: map 0-1 download progress to 30-70% total loading
      const onProgress = (p: number) => setLoadingProgress(30 + p * 40);

      try {
        // Try flat structure first, then current/ subdirectory
        let result;
        try {
          result = await fetchWithFallback<RelayData>(`relays-${currentDate}.json`, { onProgress });
        } catch {
          result = await fetchWithFallback<RelayData>(`current/relays-${currentDate}.json`, { onProgress });
        }
        
        if (result.source === 'fallback') {
          console.info(`[TorMap] Using fallback for relay data ${currentDate}`);
        }
        
        setLoadingStatus('Processing data...');
        
        // Check if data actually changed (different day)
        const dataChanged = prevRelayDataRef.current !== null && 
          prevRelayDataRef.current.published !== result.data.published;
        
        prevRelayDataRef.current = result.data;
        setRelayData(result.data);
        setLoadingProgress(prev => Math.max(prev, 70));
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

  // Track current date in ref for playback interval (avoids recreating interval on every date change)
  const currentDateRef = useRef(currentDate);
  currentDateRef.current = currentDate;

  // Playback interval - runs in TorMap so it persists in cinema mode
  // Uses ref for currentDate to avoid recreating interval on every date change
  useEffect(() => {
    if (!isPlaying || !dateIndex) {
      if (playIntervalRef.current) {
        clearInterval(playIntervalRef.current);
        playIntervalRef.current = null;
      }
      return;
    }
    
    const playSpeed = Math.round(500 / playbackSpeed);
    const dates = dateIndex.dates;
    
    playIntervalRef.current = setInterval(() => {
      const currentIdx = currentDateRef.current ? dates.indexOf(currentDateRef.current) : -1;
      const isAtEnd = currentIdx < 0 || currentIdx >= dates.length - 1;
      
      // Loop back to start when reaching end
      if (isAtEnd) {
        handleDateChange(dates[0]);
      } else {
        handleDateChange(dates[currentIdx + 1]);
      }
    }, playSpeed);
    
    return () => {
      if (playIntervalRef.current) clearInterval(playIntervalRef.current);
    };
  }, [isPlaying, playbackSpeed, dateIndex, handleDateChange]);

  // Keyboard shortcuts (H for cinema mode, arrows/space/home/end for playback)
  // Defined in TorMap so they work even when DateSliderChart is hidden in cinema mode
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if user is typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      
      const dates = dateIndex?.dates;
      const currentIdx = currentDateRef.current && dates ? dates.indexOf(currentDateRef.current) : -1;
      
      // Helper to navigate and update URL hash
      const navigateTo = (date: string) => {
        handleDateChange(date);
        window.location.hash = `date=${date}`;
      };
      
      switch (e.key) {
        case 'h':
        case 'H':
          setCinemaMode(prev => !prev);
          break;
        case 'ArrowLeft':
          if (dates && currentIdx > 0) navigateTo(dates[currentIdx - 1]);
          break;
        case 'ArrowRight':
          if (dates && currentIdx >= 0 && currentIdx < dates.length - 1) navigateTo(dates[currentIdx + 1]);
          break;
        case ' ':
          e.preventDefault();
          setIsPlaying(prev => !prev);
          break;
        case 'Home':
          e.preventDefault();
          if (dates?.length && currentIdx > 0) navigateTo(dates[0]);
          break;
        case 'End':
          e.preventDefault();
          if (dates?.length && currentIdx >= 0 && currentIdx < dates.length - 1) navigateTo(dates[dates.length - 1]);
          break;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [dateIndex, handleDateChange]);

  // Handle click on relay marker
  const handleClick = useCallback((info: PickingInfo) => {
    if (info.object) {
      const node = info.object as AggregatedNode;
      setSelectedNode(node);
      setPopupPosition({ x: info.x, y: info.y });
      
      // Find country name from location
      if (countryGeojson) {
        const country = findCountryAtLocation(node.lng, node.lat, countryGeojson);
        setSelectedCountryName(country?.name ?? null);
      } else {
        setSelectedCountryName(null);
      }
      return true; // Stop propagation to DeckGL onClick
    }
    return false;
  }, [countryGeojson]);

  // Relay hover handler with two optimizations:
  // 1. Only trigger React re-render when the hovered NODE changes (not just position)
  // 2. Update tooltip position via DOM ref directly (no setState) for 60fps smoothness
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
    setSelectedCountryName(null);
  }, []);

  // Handle background click to close popup
  const handleDeckClick = useCallback((info: PickingInfo) => {
    if (!info.object) {
      handleClosePopup();
    }
  }, [handleClosePopup]);

  // Update country tooltip DOM directly (no React state) for zero lag
  const updateCountryTooltip = useCallback((code: string | null, x: number, y: number) => {
    if (code) {
      countryHoverRef.current = { code, x, y };
      
      if (countryTooltipRef.current) {
        const nameEl = countryTooltipRef.current.querySelector('.country-name');
        const countEl = countryTooltipRef.current.querySelector('.country-count');
        const count = countryData[code] || 0;
        
        if (nameEl) nameEl.textContent = code;
        if (countEl) countEl.textContent = `${count.toLocaleString()} clients`;
        
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

  // Use CPU point-in-polygon for country hover (no GPU picking)
  // This completely eliminates the expensive readPixels() GPU readback
  const handleCountryMouseMove = useCallback((event: React.MouseEvent) => {
    if (!layerVisibility.countries || !countryGeojson) {
      if (lastCountryCodeRef.current) {
        updateCountryTooltip(null, 0, 0);
        lastCountryCodeRef.current = null;
      }
      return;
    }

    // Throttle to ~15fps (66ms) - fast enough for smooth tooltip, cheap on CPU
    if (countryHoverTimerRef.current) return;
    
    const { offsetX, offsetY } = event.nativeEvent;
    countryHoverTimerRef.current = window.setTimeout(() => {
      countryHoverTimerRef.current = null;
      
      const coords = unprojectCoords(offsetX, offsetY);
      if (!coords) return;
      
      const country = findCountryAtLocation(coords[0], coords[1], countryGeojson);
      const code = country?.code ?? null;
      
      if (code !== lastCountryCodeRef.current) {
        lastCountryCodeRef.current = code;
        updateCountryTooltip(code, offsetX, offsetY);
      } else if (code && countryTooltipRef.current) {
        // Same country, just update position
        countryTooltipRef.current.style.left = `${offsetX + 10}px`;
        countryTooltipRef.current.style.top = `${offsetY + 10}px`;
      }
    }, 66);
  }, [layerVisibility.countries, countryGeojson, updateCountryTooltip, unprojectCoords]);

  // Handle country click - center on country and update URL
  const handleCountryClick = useCallback((event: React.MouseEvent) => {
    if (!layerVisibility.countries || !countryGeojson) return;
    
    const coords = unprojectCoords(event.nativeEvent.offsetX, event.nativeEvent.offsetY);
    if (!coords) return;
    
    const country = findCountryAtLocation(coords[0], coords[1], countryGeojson);
    if (!country) return;
    
    const centroid = countryCentroids[country.code];
    if (centroid) {
      setViewState(prev => ({
        ...prev,
        longitude: centroid[0],
        latitude: centroid[1],
        zoom: COUNTRY_ZOOM,
      }));
      updateUrlHash({
        'CC': country.code,
        'ML': formatMapLocation(centroid[0], centroid[1], COUNTRY_ZOOM)
      });
    }
  }, [layerVisibility.countries, countryGeojson, unprojectCoords]);

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
  
  // Memoize relay stats for timeline display (avoids reduce on every render)
  const relayStats = useMemo(() => {
    if (!relayData?.nodes) return null;
    return {
      relayCount: relayData.nodes.reduce((sum, n) => sum + n.relays.length, 0),
      locationCount: relayData.nodes.length,
    };
  }, [relayData]);

  // Receive visible node indices from particle worker
  const dataVersion = relayData?.published ?? null;
  const handleVisibleNodesChange = useCallback((indices: number[]) => {
    setVisibleNodeIndices(new Set(indices));
    setIndicesDataVersion(dataVersion);
  }, [dataVersion]);

  // Aggregate nodes by country (for country path mode), tracking which indices map to each country
  const countryAggregation = useMemo(() => {
    if (pathMode !== 'country' || !relayData?.nodes?.length) return null;
    
    const groups: Record<string, { relays: typeof relayData.nodes[0]['relays'], bandwidth: number, nodeIndices: number[] }> = {};
    const entries = Object.entries(countryCentroids);
    
    for (let i = 0; i < relayData.nodes.length; i++) {
      const { lng, lat, relays, bandwidth } = relayData.nodes[i];
      let minDist = Infinity, nearest = '';
      for (const [code, [cLng, cLat]] of entries) {
        const dist = (lng - cLng) ** 2 + (lat - cLat) ** 2;
        if (dist < minDist) { minDist = dist; nearest = code; }
      }
      if (!nearest) continue;
      const g = groups[nearest] ||= { relays: [], bandwidth: 0, nodeIndices: [] };
      g.relays.push(...relays);
      g.bandwidth += bandwidth;
      g.nodeIndices.push(i);
    }
    
    const nodes: AggregatedNode[] = [];
    const countryIndices: number[][] = [];
    const totalBw = relayData.bandwidth || 1;
    for (const [code, g] of Object.entries(groups)) {
      const c = countryCentroids[code];
      if (!c) continue;
      nodes.push({
        lng: c[0], lat: c[1], x: 0, y: 0,
        bandwidth: g.bandwidth,
        selectionWeight: g.bandwidth / totalBw,
        label: `${g.relays.length} relays in ${code}`,
        relays: g.relays,
      });
      countryIndices.push(g.nodeIndices);
    }
    return { nodes, countryIndices };
  }, [pathMode, relayData]);

  // Filter/aggregate nodes based on path mode and traffic filter
  const filteredNodes = useMemo(() => {
    if (!relayData?.nodes?.length) return [];
    
    const indicesValid = visibleNodeIndices.size > 0 && indicesDataVersion === dataVersion;
    
    if (pathMode === 'country' && countryAggregation) {
      if (!filterRelaysByTraffic) return countryAggregation.nodes;
      if (!indicesValid) return [];
      return countryAggregation.nodes.filter((_, i) =>
        countryAggregation.countryIndices[i].some(idx => visibleNodeIndices.has(idx))
      );
    }
    
    if (!filterRelaysByTraffic) return relayData.nodes;
    if (!indicesValid) return [];
    return relayData.nodes.filter((_, i) => visibleNodeIndices.has(i));
  }, [relayData, dataVersion, pathMode, countryAggregation, filterRelaysByTraffic, visibleNodeIndices, indicesDataVersion]);

  // Create Deck.gl layers (relay markers + country choropleth)
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
      // Note: Country hover/click handled via CPU point-in-polygon
      // This eliminates expensive GPU readPixels() on every mouse move
    });
    if (countryLayer) {
      result.push(countryLayer);
    }
    
    // Relay layer (only if we have actual nodes)
    if (filteredNodes.length > 0 && layerVisibility.relays) {
      result.push(
        new ScatterplotLayer({
          id: 'relays',
          data: filteredNodes,
          pickable: true,
          opacity: 0.85 * relayOpacity, // Apply transition opacity
          stroked: true,
          filled: true,
          // Use pixel units so getRadius returns actual screen pixels
          radiusUnits: 'pixels',
          radiusScale: 1,
          radiusMinPixels: 0,
          radiusMaxPixels: Infinity,
          lineWidthMinPixels: 1,
          getPosition: (d: AggregatedNode) => [d.lng, d.lat],
          getRadius: (d: AggregatedNode) =>
            calculateNodeRadius(d) * (relaySizeScale * 1.2),
          getFillColor: (d: AggregatedNode) => {
            // Color by majority relay type at this location
            let exits = 0, guards = 0, middles = 0;
            for (const r of d.relays) {
              if (r.flags.includes('E')) exits++;
              else if (r.flags.includes('G')) guards++;
              else middles++;
            }
            if (exits >= guards && exits >= middles) return config.relayColors.exit;
            if (guards >= middles) return config.relayColors.guard;
            return config.relayColors.middle;
          },
          getLineColor: [0, 255, 136, Math.round(100 * relayOpacity)], // Green outline with transition opacity
          onClick: handleClick,
          onHover: handleHover,
          updateTriggers: {
            getFillColor: [filteredNodes],
            getRadius: [filteredNodes, relaySizeScale],
            opacity: [relayOpacity],
            getLineColor: [relayOpacity],
          },
        })
      );
    }
    
    return result;
  }, [filteredNodes, countryData, countryGeojson, layerVisibility, handleClick, handleHover, relayOpacity, relaySizeScale]);

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
    <div className="relative w-full h-full">
      {/* Startup Overlay - covers everything during initialization */}
      <StartupOverlay
        visible={initialLoading || !mapLoaded}
        progress={loadingProgress}
        status={loadingStatus}
      />

      {/* Interactive Map - Active layer */}
      {/* Wrapper div for country hover/click detection via CPU point-in-polygon */}
      <div 
        onMouseMove={handleCountryMouseMove}
        onClick={layerVisibility.countries ? handleCountryClick : undefined}
        style={{ position: 'absolute', inset: 0, zIndex: 1 }}
      >
        <DeckGL
          ref={deckRef}
          viewState={viewState}
          onViewStateChange={handleViewStateChange}
          controller={true}
          layers={baseLayers}
          onClick={handleDeckClick} // Handle background clicks
          // Custom cursor: pointer when hovering relays or countries, grab otherwise
          getCursor={() => hoverInfo || lastCountryCodeRef.current ? 'pointer' : 'grab'}
          style={{ position: 'relative' }}
        >
          <Map
            mapStyle={config.mapStyle}
            attributionControl={false}
            onLoad={() => setMapLoaded(true)}
          >
{/* Attribution handled by custom div outside event wrapper */}
          </Map>
        </DeckGL>
      </div>

      {/* 
        Particle visualization runs entirely in a Web Worker via OffscreenCanvas.
        This isolates WebGL rendering from the main thread, preventing particle
        animation from blocking UI interactions.
      */}
      <ParticleCanvas
        nodes={relayData?.nodes ?? []}
        viewState={viewState}
        width={typeof window !== 'undefined' ? window.innerWidth : 800}
        height={typeof window !== 'undefined' ? window.innerHeight : 600}
        visible={layerVisibility.particles && hasRelayNodes}
        density={lineDensityFactor}
        opacity={lineOpacityFactor}
        speed={lineSpeedFactor}
        trafficType={trafficType}
        pathMode={pathMode}
        onVisibleNodesChange={handleVisibleNodesChange}
      />

      {/* Attribution - only show after loaded, hidden in cinema mode */}
      {!initialLoading && mapLoaded && !cinemaMode && (
        <div className="absolute bottom-1 right-0 z-50 px-1 text-[10px] bg-black/70 text-gray-400 pointer-events-auto">
          {config.attributions.map(({ name, url, prefix, suffix }, i) => (
            <span key={name}>{i > 0 && ', '}{prefix && `${prefix} `}<a href={url} target="_blank" rel="noopener" className="text-tor-green hover:underline">{name}</a>{suffix && ` ${suffix}`}</span>
          ))}
        </div>
      )}

      {/* Update notification */}
      <UpdateNotification onRefresh={handleDataRefresh} />
      
      {/* No relay data toast - shown when data was fetched but has no nodes, or no dates available */}
      {!loading && !initialLoading && (
        (dateIndex && dateIndex.dates.length === 0) ? (
          <NoDataToast message="No relay data available" />
        ) : (relayData && (!relayData.nodes || relayData.nodes.length === 0)) ? (
          <NoDataToast message="No relay data available for this date" />
        ) : null
      )}

      {/* 
        Relay tooltip: Pre-rendered (hidden) to eliminate React mount/unmount latency.
        Position updates via ref for smooth 60fps tracking during mouse movement.
      */}
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
          countryName={selectedCountryName}
          totalBandwidth={relayData?.bandwidth ?? 0}
          x={popupPosition.x}
          y={popupPosition.y}
          onClose={handleClosePopup}
        />
      )}

      {/* Country tooltip: Pre-rendered (hidden) for zero-latency display on hover */}
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
      {!cinemaMode && (
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
      )}

      {/* Legend panel - bottom right (offset to avoid map credits) */}
      {/* Mobile: Collapsible, positioned above date slider. Desktop: Always visible */}
      {!cinemaMode && (
        <div 
          className={`absolute z-20 bg-black/40 backdrop-blur-md rounded-lg border border-tor-green/20 transition-all duration-200 ${
            isMobile ? 'right-3' : 'bottom-10 right-4'
          }`}
          style={isMobile 
            ? { bottom: MOBILE_CONTROLS_BOTTOM, ...(legendExpanded ? { minWidth: '130px' } : { width: '40px', height: '40px' }) }
            : { minWidth: '130px' }
          }
        >
          {/* Mobile collapsed state - just an icon button */}
          {isMobile && !legendExpanded ? (
            <button
              onClick={() => setLegendExpanded(true)}
              className="w-full h-full flex items-center justify-center text-tor-green"
              aria-label="Show legend"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </button>
          ) : (
            <div className="px-3 pt-3 pb-1.5 relative">
              {/* Mobile: Close button - positioned prominently */}
              {isMobile && (
                <button
                  onClick={() => setLegendExpanded(false)}
                  className="absolute -top-2 -right-2 w-7 h-7 flex items-center justify-center bg-black/80 rounded-full border border-tor-green/30 text-gray-300 active:bg-tor-green/30"
                  aria-label="Close legend"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
              
              {/* Last updated */}
              {dateIndex && (
                <div className="text-gray-500 text-[10px] pb-2 mb-2 border-b border-white/10">
                  Last updated: <span className="text-tor-green">{new Date(dateIndex.lastUpdated).toLocaleDateString()}</span>
                </div>
              )}
              
              {/* Relay Type Legend */}
              <div className="space-y-0.5">
                <div className="text-xs text-gray-400 mb-1">Relay Types</div>
                {[
                  { key: 'exit' as const, label: 'Exit', desc: 'outbound traffic', extraClass: '' },
                  { key: 'guard' as const, label: 'Guard', desc: 'entry point', extraClass: '' },
                  { key: 'middle' as const, label: 'Middle', desc: 'intermediate', extraClass: '' },
                  { key: 'hidden' as const, label: 'HSDir', desc: 'hidden services', extraClass: 'mt-1' },
                ].map(({ key, label, desc, extraClass }) => (
                  <div key={key} className={`flex items-center gap-1.5 text-[10px] ${extraClass}`}>
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: `rgb(${config.relayColors[key].slice(0, 3).join(',')})` }} />
                    <span className="text-gray-400">{label}</span>
                    {!isMobile && <span className="text-gray-600 text-[9px]">– {desc}</span>}
                  </div>
                ))}
              </div>
              
              {/* Source Code link */}
              <a 
                href="https://github.com/1aeo/routefluxmap"
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 pt-1.5 border-t border-white/10 flex items-center justify-center gap-1 text-gray-500 hover:text-tor-green transition-colors text-[10px]"
              >
                Source Code
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              </a>
            </div>
          )}
        </div>
      )}

      {/* Date controls - bottom center with proper spacing from side content */}
      {/* Mobile: Full width with generous bottom padding to clear gesture nav. Desktop: Centered with margins */}
      {!cinemaMode && (
        <div 
          className={`absolute left-0 right-0 z-10 flex justify-center pointer-events-none ${
            isMobile ? 'px-2' : 'bottom-4'
          }`}
          style={isMobile ? { bottom: `max(${MOBILE_SLIDER_BOTTOM}px, calc(env(safe-area-inset-bottom, 24px) + 60px))` } : undefined}
        >
          <div className="pointer-events-auto w-full max-w-[calc(100%-16px)] sm:w-auto sm:max-w-none">
          {/* Combined date slider with histogram - only show when multiple dates */}
          {dateIndex && currentDate && dateIndex.dates.length > 1 && relayStats && (
            <DateSliderChart
              dateIndex={dateIndex}
              currentDate={currentDate}
              onDateChange={handleDateChange}
              playbackSpeed={playbackSpeed}
              onPlaybackSpeedChange={setPlaybackSpeed}
              relayCount={relayStats.relayCount}
              locationCount={relayStats.locationCount}
              isPlaying={isPlaying}
              onPlayingChange={setIsPlaying}
            />
          )}

            {/* Single date display (when only one date available) */}
            {dateIndex && currentDate && dateIndex.dates.length === 1 && (
              <div className="bg-black/40 backdrop-blur-md rounded-lg px-3 py-2 border border-tor-green/20 text-center">
                <div className="text-tor-green text-sm font-medium">
                  {new Date(currentDate).toLocaleDateString('en-US', {
                    weekday: isMobile ? 'short' : 'long',
                    year: 'numeric',
                    month: isMobile ? 'short' : 'long',
                    day: 'numeric',
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Zoom controls - responsive positioning */}
      {/* Mobile: above date slider. Desktop: bottom-left */}
      <div 
        className={`absolute z-10 flex flex-col gap-1 ${isMobile ? 'left-3' : 'bottom-8 left-4'}`}
        style={isMobile ? { bottom: MOBILE_CONTROLS_BOTTOM } : undefined}
      >
        {/* Settings, Zoom controls - hidden in cinema mode */}
        {!cinemaMode && (
          <>
            {/* Settings Toggle */}
            <button
              onClick={() => setShowSettings(!showSettings)}
              className={`w-9 h-9 flex items-center justify-center rounded-lg backdrop-blur-md border transition-colors ${
                showSettings 
                  ? 'bg-tor-green text-black border-tor-green' 
                  : 'bg-black/40 border-tor-green/20 text-tor-green active:bg-tor-green/30'
              } ${isMobile ? '' : 'hover:bg-tor-green/20'}`}
              aria-label="Toggle settings"
              title="Line Settings"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
              </svg>
            </button>

            {/* Settings Panel (Popup) */}
            <SettingsPanel
              show={showSettings}
              pathMode={pathMode}
              setPathMode={setPathMode}
              trafficType={trafficType}
              setTrafficType={setTrafficType}
              density={lineDensityFactor}
              setDensity={setLineDensityFactor}
              opacity={lineOpacityFactor}
              setOpacity={setLineOpacityFactor}
              speed={lineSpeedFactor}
              setSpeed={setLineSpeedFactor}
              relaySize={relaySizeScale}
              setRelaySize={setRelaySizeScale}
              filterRelaysByTraffic={filterRelaysByTraffic}
              setFilterRelaysByTraffic={setFilterRelaysByTraffic}
              trafficEnabled={layerVisibility.particles}
            />

            {/* Zoom buttons */}
            <button
              onClick={() => setViewState(prev => ({ ...prev, zoom: Math.min(prev.zoom + 1, 18) }))}
              className={`w-9 h-9 flex items-center justify-center rounded-lg bg-black/40 backdrop-blur-md border border-tor-green/20 text-tor-green active:bg-tor-green/30 transition-colors ${isMobile ? '' : 'hover:bg-tor-green/20'}`}
              aria-label="Zoom in"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v12M6 12h12" />
              </svg>
            </button>
            <button
              onClick={() => setViewState(prev => ({ ...prev, zoom: Math.max(prev.zoom - 1, 1) }))}
              className={`w-9 h-9 flex items-center justify-center rounded-lg bg-black/40 backdrop-blur-md border border-tor-green/20 text-tor-green active:bg-tor-green/30 transition-colors ${isMobile ? '' : 'hover:bg-tor-green/20'}`}
              aria-label="Zoom out"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 12h12" />
              </svg>
            </button>
            <div className="text-center text-[9px] text-gray-500 mt-0.5">
              {viewState.zoom.toFixed(1)}x
            </div>
          </>
        )}

        {/* Cinema Mode Toggle - always visible */}
        <button
          onClick={() => setCinemaMode(!cinemaMode)}
          className={`w-9 h-9 flex items-center justify-center rounded-lg backdrop-blur-md border transition-colors ${
            cinemaMode 
              ? 'bg-tor-green text-black border-tor-green' 
              : 'bg-black/40 border-tor-green/20 text-tor-green active:bg-tor-green/30'
          } ${isMobile ? '' : 'hover:bg-tor-green/20'}`}
          aria-label={cinemaMode ? 'Exit cinema mode' : 'Enter cinema mode'}
          title={cinemaMode ? 'Exit cinema mode (H)' : 'Cinema mode - hide UI (H)'}
        >
          {cinemaMode ? (
            // Exit fullscreen icon
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5l5.25 5.25" />
            </svg>
          ) : (
            // Enter fullscreen icon
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
            </svg>
          )}
        </button>
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
