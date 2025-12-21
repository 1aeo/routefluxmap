/**
 * MapControls - Zoom, settings, and cinema mode buttons
 * 
 * Positioned in bottom-left corner of the map.
 * Responsive layout for mobile devices.
 */

import type { PathMode, TrafficType } from '../../lib/hooks';
import SettingsPanel from './SettingsPanel';

/** Mobile layout constant */
const MOBILE_CONTROLS_BOTTOM = 295;

export interface MapControlsProps {
  /** Whether on mobile device */
  isMobile: boolean;
  /** Current zoom level */
  zoom: number;
  /** Zoom in handler */
  onZoomIn: () => void;
  /** Zoom out handler */
  onZoomOut: () => void;
  /** Whether settings panel is open */
  showSettings: boolean;
  /** Toggle settings panel */
  onToggleSettings: () => void;
  /** Whether cinema mode is active */
  cinemaMode: boolean;
  /** Toggle cinema mode */
  onToggleCinemaMode: () => void;
  // Settings panel props
  pathMode: PathMode;
  setPathMode: (mode: PathMode) => void;
  trafficType: TrafficType;
  setTrafficType: (type: TrafficType) => void;
  density: number;
  setDensity: (value: number) => void;
  opacity: number;
  setOpacity: (value: number) => void;
  speed: number;
  setSpeed: (value: number) => void;
  relaySize: number;
  setRelaySize: (value: number) => void;
  filterRelaysByTraffic: boolean;
  setFilterRelaysByTraffic: (value: boolean) => void;
  trafficEnabled: boolean;
}

export default function MapControls({
  isMobile,
  zoom,
  onZoomIn,
  onZoomOut,
  showSettings,
  onToggleSettings,
  cinemaMode,
  onToggleCinemaMode,
  pathMode,
  setPathMode,
  trafficType,
  setTrafficType,
  density,
  setDensity,
  opacity,
  setOpacity,
  speed,
  setSpeed,
  relaySize,
  setRelaySize,
  filterRelaysByTraffic,
  setFilterRelaysByTraffic,
  trafficEnabled,
}: MapControlsProps) {
  const buttonClass = `w-9 h-9 flex items-center justify-center rounded-lg backdrop-blur-md border transition-colors ${
    isMobile ? '' : 'hover:bg-tor-green/20'
  }`;
  const defaultButtonClass = `${buttonClass} bg-black/40 border-tor-green/20 text-tor-green active:bg-tor-green/30`;

  return (
    <div
      className={`absolute z-10 flex flex-col gap-1 ${isMobile ? 'left-3' : 'bottom-8 left-4'}`}
      style={isMobile ? { bottom: MOBILE_CONTROLS_BOTTOM } : undefined}
    >
      {/* Settings, Zoom controls - hidden in cinema mode */}
      {!cinemaMode && (
        <>
          {/* Settings Toggle */}
          <button
            onClick={onToggleSettings}
            className={`${buttonClass} ${
              showSettings
                ? 'bg-tor-green text-black border-tor-green'
                : 'bg-black/40 border-tor-green/20 text-tor-green active:bg-tor-green/30'
            }`}
            aria-label="Toggle settings"
            title="Line Settings"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4"
              />
            </svg>
          </button>

          {/* Settings Panel (Popup) */}
          <SettingsPanel
            show={showSettings}
            pathMode={pathMode}
            setPathMode={setPathMode}
            trafficType={trafficType}
            setTrafficType={setTrafficType}
            density={density}
            setDensity={setDensity}
            opacity={opacity}
            setOpacity={setOpacity}
            speed={speed}
            setSpeed={setSpeed}
            relaySize={relaySize}
            setRelaySize={setRelaySize}
            filterRelaysByTraffic={filterRelaysByTraffic}
            setFilterRelaysByTraffic={setFilterRelaysByTraffic}
            trafficEnabled={trafficEnabled}
          />

          {/* Zoom buttons */}
          <button
            onClick={onZoomIn}
            className={defaultButtonClass}
            aria-label="Zoom in"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v12M6 12h12" />
            </svg>
          </button>
          <button
            onClick={onZoomOut}
            className={defaultButtonClass}
            aria-label="Zoom out"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 12h12" />
            </svg>
          </button>
          <div className="text-center text-[9px] text-gray-500 mt-0.5">{zoom.toFixed(1)}x</div>
        </>
      )}

      {/* Cinema Mode Toggle - always visible */}
      <button
        onClick={onToggleCinemaMode}
        className={`${buttonClass} ${
          cinemaMode
            ? 'bg-tor-green text-black border-tor-green'
            : 'bg-black/40 border-tor-green/20 text-tor-green active:bg-tor-green/30'
        }`}
        aria-label={cinemaMode ? 'Exit cinema mode' : 'Enter cinema mode'}
        title={cinemaMode ? 'Exit cinema mode (H)' : 'Cinema mode - hide UI (H)'}
      >
        {cinemaMode ? (
          // Exit fullscreen icon
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5l5.25 5.25"
            />
          </svg>
        ) : (
          // Enter fullscreen icon
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15"
            />
          </svg>
        )}
      </button>
    </div>
  );
}

export { MOBILE_CONTROLS_BOTTOM };

