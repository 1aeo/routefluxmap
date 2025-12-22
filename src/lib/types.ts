/**
 * RouteFluxMap Type Definitions
 */

// Individual relay info (for popup display with metrics links)
export interface RelayInfo {
  nickname: string;
  fingerprint: string;         // For link to {metricsUrl}/relay/{fp}
  bandwidth: number;
  flags: string;               // M, G, E, H
  ip: string;
  port: string;
}

// Aggregated node (multiple relays at same location)
export interface AggregatedNode {
  lat: number;
  lng: number;
  x: number;                   // Normalized [0,1] for WebGL
  y: number;                   // Normalized [0,1] for WebGL
  bandwidth: number;           // Raw bandwidth for this location
  selectionWeight: number;     // Normalized weight for particle distribution (bandwidth/total)
  label: string;               // Summary: "RelayName" or "N relays at location"
  relays: RelayInfo[];         // Individual relays for popup
  
  // Pre-computed properties (optional - computed at runtime if missing)
  type?: 'exit' | 'guard' | 'middle';
  isHSDir?: boolean;
  
  // Backward compatibility: old data may have normalized_bandwidth instead of selectionWeight
  normalized_bandwidth?: number;
}

// Date index from storage
export interface DateIndex {
  version?: string;
  lastUpdated: string;
  dates: string[];
  bandwidths: number[];
  // Optional fields (computed from bandwidths array if needed)
  min?: { date: string; bandwidth: number };
  max?: { date: string; bandwidth: number };
  relayCount?: number;
}

// Relay data for a specific date
export interface RelayData {
  version?: string;
  generatedAt?: string;
  source?: 'onionoo' | 'collector';
  published: string;
  nodes: AggregatedNode[];
  bandwidth: number;
  relayCount?: number;
  geolocatedCount?: number;
  minMax: { min: number; max: number };
}

// Country client data with confidence bounds (new format)
export interface CountryClientData {
  count: number;
  lower: number;
  upper: number;
}

// Country client count histogram
// Supports both old format (number) and new format (object with bounds)
export interface CountryHistogram {
  [countryCode: string]: number | CountryClientData;
}

/** Result of parsing country client data */
export interface ParsedCountryData {
  count: number;
  lower: number;
  upper: number;
  hasBounds: boolean;
}

/** Shared empty result to avoid allocations */
const EMPTY_COUNTRY_DATA: ParsedCountryData = { count: 0, lower: 0, upper: 0, hasBounds: false };

/**
 * Normalize country data access (handles both old and new formats).
 * Old format: { "US": 826214 }
 * New format: { "US": { count: 826214, lower: 593164, upper: 1100000 } }
 */
export function getCountryClientData(
  countryData: CountryHistogram,
  code: string
): ParsedCountryData {
  const data = countryData[code];
  if (data == null) return EMPTY_COUNTRY_DATA;
  if (typeof data === 'number') {
    return { count: data, lower: 0, upper: 0, hasBounds: false };
  }
  return {
    count: data.count,
    lower: data.lower,
    upper: data.upper,
    hasBounds: data.lower > 0 || data.upper > 0,
  };
}

/** Format large numbers compactly (e.g., 1.2M, 456K) */
export function formatCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return n.toLocaleString();
}

/** Format confidence bounds as compact range (e.g., "294K – 1.1M") */
export function formatRange(lower: number, upper: number): string {
  return `${formatCompact(lower)} – ${formatCompact(upper)}`;
}

/** Tooltip offset from cursor (px) */
export const TOOLTIP_OFFSET = 10;

// Country timeline data point
export interface CountryTimeline {
  date: string;
  count: number;
}

// Country outlier data point
export interface CountryOutlier {
  position: number;
  date: string;
  client_count: number;
}

// View state for the map
export interface ViewState {
  longitude: number;
  latitude: number;
  zoom: number;
  pitch: number;
  bearing: number;
}

// Layer visibility settings
export interface LayerVisibility {
  particles: boolean;
  relays: boolean;
  countries: boolean;
  labels: boolean;
}

// Layer settings
export interface LayerSettings {
  particleCount: number;
  particleSize: number;
  particleSpeed: number;
  nodeCount: number;
  countryCount: number;
  scaleByBandwidth: boolean;
  scaleSizeByZoom: boolean;
  trafficType: 'all' | 'hidden' | 'general';
}

// Parsed URL state
export interface UrlState {
  date?: string;
  mapLocation?: {
    lng: number;
    lat: number;
    zoom: number;
  };
  country?: {
    cc2: string;
    cc3: string;
  };
}

// Chart data point
export interface ChartDataPoint {
  x: string;
  y: number;
  xRange?: {
    start: Date;
    end: Date;
  };
}

// Particle data for WebGL buffer
export interface ParticleData {
  buffer: Float32Array;
  count: number;
}

// Popup state
export interface PopupState {
  node: AggregatedNode | null;
  x: number;
  y: number;
}