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
  
  // Pre-computed properties for efficient rendering
  type: 'exit' | 'guard' | 'middle';
  isHSDir: boolean;
  
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

// Country client count histogram
export interface CountryHistogram {
  [countryCode: string]: number;
}

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
  particleOffset: number;
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
