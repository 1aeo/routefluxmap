/**
 * TorMap - Main map visualization component
 * Uses Deck.gl for relay markers + MapLibre GL for base map
 * 
 * This is the orchestrator component that composes hooks and child components.
 */

import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import DeckGL from '@deck.gl/react';
import { Map } from 'react-map-gl/maplibre';
import type { AggregatedNode } from '../../lib/types';
import { config } from '../../lib/config';
import { countryCentroids, findCountryAtLocation } from '../../lib/utils/geo';
import { formatMapLocation, updateUrlHash } from '../../lib/utils/url';

// Hooks
import {
  useRelays,
  useCountryGeo,
  useMapView,
  useLayerVisibility,
  useParticleSettings,
  useDatePlayback,
  useRelaySelection,
  useCountryHover,
  useHotkeys,
  useWebGL,
  useIsMobile,
  FLY_TO_DURATION_MS,
} from '../../lib/hooks';

// Layer factories
import { createRelayLayer, createFocusRingLayer } from '../../lib/layers';

// Components
import { createCountryLayer, CountryTooltip } from './CountryLayer';
import ParticleCanvas from './ParticleCanvas';
import MapHeader from './MapHeader';
import MapControls from './MapControls';
import MapLegend from './MapLegend';
import WebGLError from './WebGLError';
import RelayTooltip from './RelayTooltip';
import RelayPopup from '../ui/RelayPopup';
import RelaySearch from '../ui/RelaySearch';
import DateSliderChart from '../ui/DateSliderChart';
import UpdateNotification from '../ui/UpdateNotification';
import NoDataToast from '../ui/NoDataToast';
import StartupOverlay from '../ui/StartupOverlay';
import KeyboardShortcutsHelp from '../ui/KeyboardShortcutsHelp';
import 'maplibre-gl/dist/maplibre-gl.css';

// Mobile layout constants
const MOBILE_SLIDER_BOTTOM = 85;
const COUNTRY_ZOOM = 5;

export default function TorMap() {
  // === HOOKS ===

  // WebGL check (must be first - renders error if unavailable)
  const { webglError } = useWebGL();

  // Device detection
  const { isMobile } = useIsMobile();

  // Playback state (lifted up to pass to useRelays for adaptive preloading)
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0);

  // Data hooks (with adaptive preloading based on playback state)
  const {
    relayData,
    dateIndex,
    currentDate,
    initialLoading,
    loading,
    error,
    loadingStatus,
    loadingProgress,
    setCurrentDate,
    refresh,
    relayStats,
  } = useRelays({ isPlaying, playbackSpeed });

  const { countryGeojson, countryData } = useCountryGeo(currentDate);

  // Map state hooks
  const { viewState, setViewState, handleViewStateChange, flyToLocation } = useMapView();

  const relaySelection = useRelaySelection();
  const countryHover = useCountryHover();

  // Layer visibility with callbacks
  const layerVisibilityCallbacks = useMemo(
    () => ({
      onRelaysHidden: () => {
        relaySelection.clearAll();
      },
      onCountriesHidden: () => {
        countryHover.clearTooltip();
      },
      onParticlesDisabled: () => {
        particleSettings.setFilterRelaysByTraffic(false);
      },
    }),
    []
  );
  const { visibility, handleVisibilityChange } = useLayerVisibility(layerVisibilityCallbacks);
  
  // Particle settings
  const particleSettings = useParticleSettings();

  // Relay opacity (constant - no fade transition for easier day-to-day comparison)
  const relayOpacity = 1;

  // UI state
  const [mapLoaded, setMapLoaded] = useState(false);
  const [cinemaMode, setCinemaMode] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showKeyboardHelp, setShowKeyboardHelp] = useState(false);
  const [windowSize, setWindowSize] = useState({ width: 800, height: 600 });

  // Track window size for particle canvas
  useEffect(() => {
    const updateSize = () => {
      setWindowSize({ width: window.innerWidth, height: window.innerHeight });
    };
    updateSize(); // Set initial size
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, []);
  
  // Close settings when entering cinema mode
  useEffect(() => {
    if (cinemaMode && showSettings) {
      setShowSettings(false);
    }
  }, [cinemaMode, showSettings]);
  
  // Playback (uses lifted state for adaptive preloading)
  const playback = useDatePlayback({
    dates: dateIndex?.dates ?? [],
    currentDate,
    onDateChange: (date) => {
      setCurrentDate(date);
      relaySelection.clearAll();
    },
    isPlaying,
    setIsPlaying,
    playbackSpeed,
    setPlaybackSpeed,
  });

  // Keyboard shortcuts
  useHotkeys({
    dates: dateIndex?.dates ?? [],
    currentDate,
    onDateChange: (date) => {
      setCurrentDate(date);
      relaySelection.clearAll();
    },
    onTogglePlay: playback.togglePlay,
    onToggleCinemaMode: () => setCinemaMode((prev) => !prev),
    onToggleLayer: (layer) => {
      handleVisibilityChange({ ...visibility, [layer]: !visibility[layer] });
    },
    onToggleSettings: () => setShowSettings((prev) => !prev),
    onShowHelp: () => setShowKeyboardHelp(true),
    onZoom: (delta) => {
      setViewState((prev: typeof viewState) => ({
        ...prev,
        zoom: Math.max(1, Math.min(18, prev.zoom + delta)),
      }));
    },
    onClose: () => {
      if (showKeyboardHelp) {
        setShowKeyboardHelp(false);
      } else if (showSettings) {
        setShowSettings(false);
      } else if (relaySelection.selectedNode) {
        relaySelection.closePopup();
      }
    },
  });

  // Deck.gl ref for viewport projection
  const deckRef = useRef<any>(null);

  // === COMPUTED VALUES ===

  const hasRelayNodes = !!(relayData?.nodes?.length);

  // Filter/aggregate nodes based on path mode and traffic filter
  const filteredNodes = useMemo(() => {
    if (!relayData?.nodes?.length) return [];

    const { pathMode, filterRelaysByTraffic, visibleNodeIndices, indicesDataVersion } =
      particleSettings;
  const dataVersion = relayData?.published ?? null;
    const indicesValid =
      visibleNodeIndices.size > 0 && indicesDataVersion === dataVersion;

    if (pathMode === 'country') {
      // Aggregate by country
      const groups: Record<
        string,
        { relays: typeof relayData.nodes[0]['relays']; bandwidth: number; nodeIndices: number[] }
      > = {};
    const entries = Object.entries(countryCentroids);
    
    for (let i = 0; i < relayData.nodes.length; i++) {
      const { lng, lat, relays, bandwidth } = relayData.nodes[i];
        let minDist = Infinity,
          nearest = '';
      for (const [code, [cLng, cLat]] of entries) {
        const dist = (lng - cLng) ** 2 + (lat - cLat) ** 2;
          if (dist < minDist) {
            minDist = dist;
            nearest = code;
          }
      }
      if (!nearest) continue;
        const g = (groups[nearest] ||= { relays: [], bandwidth: 0, nodeIndices: [] });
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
          lng: c[0],
          lat: c[1],
          x: 0,
          y: 0,
        bandwidth: g.bandwidth,
        selectionWeight: g.bandwidth / totalBw,
        label: `${g.relays.length} relays in ${code}`,
        relays: g.relays,
      });
      countryIndices.push(g.nodeIndices);
    }

      if (!filterRelaysByTraffic) return nodes;
      if (!indicesValid) return [];
      return nodes.filter((_, i) =>
        countryIndices[i].some((idx) => visibleNodeIndices.has(idx))
      );
    }
    
    // City mode
    if (!filterRelaysByTraffic) return relayData.nodes;
    if (!indicesValid) return [];
    return relayData.nodes.filter((_, i) => visibleNodeIndices.has(i));
  }, [relayData, particleSettings]);

  // === HANDLERS ===

  // Unproject screen coords to [lng, lat]
  const unprojectCoords = useCallback((x: number, y: number): [number, number] | null => {
    const viewport = deckRef.current?.deck?.getViewports()[0];
    return viewport ? viewport.unproject([x, y]) : null;
  }, []);

  // Handle click on relay with country lookup
  const handleRelayClick = useCallback(
    (info: any) => {
      return relaySelection.handleClick(info, (lng, lat) => {
        if (!countryGeojson) return null;
        const country = findCountryAtLocation(lng, lat, countryGeojson);
        return country?.name ?? null;
      });
    },
    [relaySelection, countryGeojson]
  );

  // Country mouse handlers
  const handleCountryMouseMove = useCallback(
    (event: React.MouseEvent) => {
      countryHover.handleMouseMove(event, {
        layerVisible: visibility.countries,
      geojson: countryGeojson,
        unproject: unprojectCoords,
        countryData,
      });
    },
    [countryHover, visibility.countries, countryGeojson, unprojectCoords, countryData]
  );

  const handleCountryClick = useCallback(
    (event: React.MouseEvent) => {
      countryHover.handleClick(event, {
        layerVisible: visibility.countries,
        geojson: countryGeojson,
        unproject: unprojectCoords,
        onCountryClick: (code, centroid) => {
          setViewState((prev: typeof viewState) => ({
            ...prev,
            longitude: centroid[0],
            latitude: centroid[1],
            zoom: COUNTRY_ZOOM,
          }));
          updateUrlHash({
            CC: code,
            ML: formatMapLocation(centroid[0], centroid[1], COUNTRY_ZOOM),
          });
        },
      });
    },
    [countryHover, visibility.countries, countryGeojson, unprojectCoords, setViewState]
  );

  // Focus relay from search
  const focusRelay = useCallback(
    (nodeIndex: number, _relayIndex: number, fingerprint: string) => {
      const nodes = relayData?.nodes;
      if (!nodes || nodeIndex >= nodes.length) return;

      const node = nodes[nodeIndex];

      // Override filters
      handleVisibilityChange({ ...visibility, relays: true });
      particleSettings.setPathMode('city');
      particleSettings.setFilterRelaysByTraffic(false);

      // Fly to location
      flyToLocation(node.lng, node.lat);

      // Set focus state
      relaySelection.setFocus(node, fingerprint);

      // Open popup after fly-to
      setTimeout(() => {
        relaySelection.setSelection(node, null);

        // Project to screen coords
        const viewport = deckRef.current?.deck?.getViewports()[0];
        if (viewport) {
          const [x, y] = viewport.project([node.lng, node.lat]);
          relaySelection.setSelection(
            node,
            { x, y },
            countryGeojson ? findCountryAtLocation(node.lng, node.lat, countryGeojson)?.name : null
          );
        }
      }, FLY_TO_DURATION_MS);
    },
    [relayData, visibility, handleVisibilityChange, particleSettings, flyToLocation, relaySelection, countryGeojson]
  );

  // Visible nodes change from particle worker
  const handleVisibleNodesChange = useCallback(
    (indices: number[]) => {
      particleSettings.setVisibleNodeIndices(new Set(indices));
      particleSettings.setIndicesDataVersion(relayData?.published ?? null);
    },
    [particleSettings, relayData?.published]
  );

  // === LAYERS ===

  const layers = useMemo(() => {
    const result: any[] = [];

    // Country layer
    const countryLayer = createCountryLayer({
      countryData,
      geojson: countryGeojson,
      visible: visibility.countries,
      opacity: 0.5,
    });
    if (countryLayer) result.push(countryLayer);

    // Relay layer
    const relayLayer = createRelayLayer({
      nodes: filteredNodes,
      visible: visibility.relays,
      opacity: relayOpacity,
      sizeScale: particleSettings.relaySize,
      onClick: handleRelayClick,
      onHover: relaySelection.handleHover,
    });
    if (relayLayer) result.push(relayLayer);

    // Focus ring layer
    const focusRingLayer = createFocusRingLayer({
      focusedNode: relaySelection.focusedNode,
    });
    if (focusRingLayer) result.push(focusRingLayer);

    return result;
  }, [
    countryData,
    countryGeojson,
    visibility,
    filteredNodes,
    relayOpacity,
    particleSettings.relaySize,
    handleRelayClick,
    relaySelection,
  ]);

  // === RENDER ===

  // WebGL error state
  if (webglError) {
    return <WebGLError error={webglError} />;
  }

  // Error state (only when no data at all)
  if (error && !relayData) {
    return (
      <div className="flex items-center justify-center h-full bg-tor-darker">
        <div className="text-center">
          <div className="text-tor-orange text-4xl mb-4">⚠️</div>
          <p className="text-gray-400">Failed to load relay data</p>
          <p className="text-gray-500 text-sm mt-2">{error}</p>
          <p className="text-gray-600 text-xs mt-4">Run: npm run fetch-data</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative w-full h-full">
      {/* Startup Overlay */}
      <StartupOverlay
        visible={initialLoading || !mapLoaded}
        progress={loadingProgress}
        status={loadingStatus}
      />

      {/* Map wrapper for country hover */}
      <div 
        onMouseMove={handleCountryMouseMove}
        onClick={visibility.countries ? handleCountryClick : undefined}
        style={{ position: 'absolute', inset: 0, zIndex: 1 }}
      >
        <DeckGL
          ref={deckRef}
          viewState={viewState}
          onViewStateChange={handleViewStateChange as any}
          controller={true}
          layers={layers}
          onClick={relaySelection.handleDeckClick}
          getCursor={() =>
            relaySelection.hoverInfo || countryHover.hoverInfo.current ? 'pointer' : 'grab'
          }
          style={{ position: 'relative' }}
        >
          <Map mapStyle={config.mapStyle} attributionControl={false} onLoad={() => setMapLoaded(true)} />
        </DeckGL>
      </div>

      {/* Particle Canvas */}
      <ParticleCanvas
        nodes={relayData?.nodes ?? []}
        viewState={viewState}
        width={windowSize.width}
        height={windowSize.height}
        visible={visibility.particles && hasRelayNodes}
        density={particleSettings.density}
        opacity={particleSettings.opacity}
        speed={particleSettings.speed}
        trafficType={particleSettings.trafficType}
        pathMode={particleSettings.pathMode}
        onVisibleNodesChange={handleVisibleNodesChange}
      />

      {/* Attribution */}
      {!initialLoading && mapLoaded && (
        <div
          className={`absolute bottom-1 right-0 z-50 px-1 text-gray-400 pointer-events-auto ${
            cinemaMode ? 'text-[9px] bg-black/40 opacity-70' : 'text-[10px] bg-black/70'
          }`}
        >
          {config.attributions.map(({ name, url, prefix, suffix }, i) => (
            <span key={name}>
              {i > 0 && ', '}
              {prefix && `${prefix} `}
              <a href={url} target="_blank" rel="noopener" className="text-tor-green hover:underline">
                {name}
              </a>
              {suffix && ` ${suffix}`}
            </span>
          ))}
        </div>
      )}

      {/* Update notification */}
      <UpdateNotification onRefresh={refresh} />
      
      {/* No data toast */}
      {!loading && !initialLoading && (
        <>
          {dateIndex?.dates.length === 0 && <NoDataToast message="No relay data available" />}
          {relayData && !relayData.nodes?.length && (
          <NoDataToast message="No relay data available for this date" />
          )}
          </>
        )}

      {/* Relay tooltip */}
      <RelayTooltip
        ref={relaySelection.tooltipRef}
        hoverInfo={relaySelection.hoverInfo}
        hasPopup={!!relaySelection.selectedNode}
      />

      {/* Relay popup */}
      {relaySelection.selectedNode && relaySelection.popupPosition && (
        <RelayPopup
          node={relaySelection.selectedNode}
          countryName={relaySelection.selectedCountryName}
          totalBandwidth={relayData?.bandwidth ?? 0}
          x={relaySelection.popupPosition.x}
          y={relaySelection.popupPosition.y}
          onClose={relaySelection.closePopup}
          highlightFingerprint={relaySelection.focusedFingerprint}
        />
      )}

      {/* Country tooltip */}
      <CountryTooltip
        ref={countryHover.tooltipRef}
        countryCode=""
        countryData={countryData}
        x={0}
        y={0}
        style={{ opacity: 0, pointerEvents: 'none', zIndex: 60 }}
      />

      {/* UI Components - hidden in cinema mode */}
      {!cinemaMode && (
        <>
          <MapHeader visibility={visibility} onVisibilityChange={handleVisibilityChange} />

          {/* Relay Search */}
        <div className={`absolute top-4 z-10 ${isMobile ? 'left-4 right-14' : 'right-16 w-72'}`}>
          <RelaySearch
            nodes={relayData?.nodes ?? []}
            onSelectRelay={focusRelay}
            disabled={!hasRelayNodes || loading}
          />
        </div>

          <MapLegend isMobile={isMobile} dateIndex={dateIndex} />

          {/* Date controls */}
        <div 
          className={`absolute left-0 right-0 z-10 flex justify-center pointer-events-none ${
            isMobile ? 'px-2' : 'bottom-4'
          }`}
            style={
              isMobile
                ? { bottom: `max(${MOBILE_SLIDER_BOTTOM}px, calc(env(safe-area-inset-bottom, 24px) + 60px))` }
                : undefined
            }
        >
          <div className="pointer-events-auto w-full max-w-[calc(100%-16px)] sm:w-auto sm:max-w-none">
          {dateIndex && currentDate && dateIndex.dates.length > 1 && relayStats && (
            <DateSliderChart
              dateIndex={dateIndex}
              currentDate={currentDate}
                  onDateChange={(date) => {
                    setCurrentDate(date);
                    relaySelection.clearAll();
                  }}
                  playbackSpeed={playback.playbackSpeed}
                  onPlaybackSpeedChange={playback.setPlaybackSpeed}
              relayCount={relayStats.relayCount}
              locationCount={relayStats.locationCount}
                  isPlaying={playback.isPlaying}
                  onPlayingChange={playback.setIsPlaying}
            />
          )}

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
        </>
      )}

      {/* Map controls (including cinema mode button which is always visible) */}
      <MapControls
        isMobile={isMobile}
        zoom={viewState.zoom}
        onZoomIn={() => setViewState((prev: typeof viewState) => ({ ...prev, zoom: Math.min(prev.zoom + 1, 18) }))}
        onZoomOut={() => setViewState((prev: typeof viewState) => ({ ...prev, zoom: Math.max(prev.zoom - 1, 1) }))}
        showSettings={showSettings}
        onToggleSettings={() => setShowSettings((prev) => !prev)}
        cinemaMode={cinemaMode}
        onToggleCinemaMode={() => setCinemaMode((prev) => !prev)}
        onShowKeyboardHelp={() => setShowKeyboardHelp(true)}
        pathMode={particleSettings.pathMode}
        setPathMode={particleSettings.setPathMode}
        trafficType={particleSettings.trafficType}
        setTrafficType={particleSettings.setTrafficType}
        density={particleSettings.density}
        setDensity={particleSettings.setDensity}
        opacity={particleSettings.opacity}
        setOpacity={particleSettings.setOpacity}
        speed={particleSettings.speed}
        setSpeed={particleSettings.setSpeed}
        relaySize={particleSettings.relaySize}
        setRelaySize={particleSettings.setRelaySize}
        filterRelaysByTraffic={particleSettings.filterRelaysByTraffic}
        setFilterRelaysByTraffic={particleSettings.setFilterRelaysByTraffic}
        trafficEnabled={visibility.particles}
      />

      {/* Loading indicator (non-blocking) */}
      {loading && relayData && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-20 bg-black/80 backdrop-blur-sm rounded-full px-4 py-2 border border-tor-green/20 flex items-center gap-2">
          <div className="animate-spin rounded-full h-4 w-4 border-t-2 border-b-2 border-tor-green" />
          <span className="text-tor-green text-xs">Loading...</span>
        </div>
      )}

      {/* Keyboard Shortcuts Help Modal */}
      {showKeyboardHelp && (
        <KeyboardShortcutsHelp onClose={() => setShowKeyboardHelp(false)} />
      )}
    </div>
  );
}
