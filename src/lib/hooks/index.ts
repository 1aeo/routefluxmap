/**
 * Custom hooks barrel export
 * 
 * Import all hooks from this file:
 * import { useRelays, useMapView, ... } from '@/lib/hooks';
 */

// Data hooks
export { useRelays } from './useRelays';
export type { UseRelaysResult } from './useRelays';

export { useCountryGeo } from './useCountryGeo';
export type { UseCountryGeoResult } from './useCountryGeo';

// Map state hooks
export { useMapView, COUNTRY_ZOOM, FLY_TO_DURATION_MS } from './useMapView';
export type { UseMapViewResult } from './useMapView';

export { useLayerVisibility } from './useLayerVisibility';
export type { UseLayerVisibilityResult, UseLayerVisibilityOptions } from './useLayerVisibility';

export { useParticleSettings } from './useParticleSettings';
export type { UseParticleSettingsResult, TrafficType, PathMode } from './useParticleSettings';

// Interaction hooks
export { useRelaySelection } from './useRelaySelection';
export type { UseRelaySelectionResult, HoverInfo } from './useRelaySelection';

export { useCountryHover } from './useCountryHover';
export type { UseCountryHoverResult, CountryHoverInfo } from './useCountryHover';

// Control hooks
export { useDatePlayback } from './useDatePlayback';
export type { UseDatePlaybackResult, UseDatePlaybackOptions } from './useDatePlayback';

export { useHotkeys } from './useHotkeys';
export type { UseHotkeysOptions } from './useHotkeys';

// Utility hooks
export { useWebGL } from './useWebGL';
export type { UseWebGLResult, WebGLError } from './useWebGL';

export { useIsMobile, MOBILE_BREAKPOINT } from './useIsMobile';
export type { UseIsMobileResult } from './useIsMobile';


