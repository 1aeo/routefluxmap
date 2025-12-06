/**
 * RouteFluxMap Configuration
 * Theme: 1aeo.com style (Black + Green)
 */

export const config = {
  // Site info
  siteUrl: 'https://routefluxmap.1aeo.com',
  metricsUrl: 'https://metrics.1aeo.com',
  dataBaseUrl: import.meta.env.PUBLIC_DATA_URL || 'https://data.routefluxmap.1aeo.com',

  // Color ramps - Green theme
  bandwidthColorRamp: ['#004d29', '#00ff88'] as const,
  connectionsColorRamp: ['#004d29', '#00cc6a'] as const,
  countriesColorRamp: ['#1a1a2e', '#00ff88'] as const,

  // Particle colors (normalized 0-1)
  particleHiddenColor: [1.0, 0.5, 0.0] as const,      // Orange
  particleGeneralColor: [0.0, 1.0, 0.53] as const,    // Green (#00ff88)

  // Node count configuration
  nodeCount: {
    default: 500,
    min: 100,
    max: 2000,
  },

  // Node radius (pixels)
  nodeRadius: {
    min: 5,
    max: 40,
  },

  // Country count configuration
  countryCount: {
    default: 50,
    min: 5,
    max: 200,
  },

  // Particle count configuration
  particleCount: {
    default: 400_000,
    min: 100_000,
    max: 5_000_000,
  },

  // Particle path offset
  particleOffset: {
    default: 0.10,
    min: 0.0001,
    max: 4.0,
  },

  // Particle size (pixels)
  particleSize: {
    default: 1,
    min: 1,
    max: 10,
  },

  // Particle speed (ms for particle to circle earth)
  particleBaseSpeedMs: 60_000,
  particleSpeedFactor: {
    min: 0.01,
    max: 4.0,
  },

  // Hidden services probability
  hiddenServiceProbability: 0.04,

  // Mobile adjustments
  mobile: {
    particleFactor: 0.3,
    nodeFactor: 0.5,
    countryFactor: 0.2,
  },

  // Zoom levels
  zoom: {
    desktop: { min: 3, start: 4 },
    mobile: { min: 2, start: 2 },
  },

  // Map settings - dark theme
  mapStyle: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
  mapAttribution: 'Map tiles by <a href="http://cartodb.com/attributions">CartoDB</a>',

  // Relay marker colors (RGBA 0-255)
  relayColors: {
    guard: [0, 200, 80, 220] as [number, number, number, number],       // Deep forest green - entry nodes
    exit: [255, 102, 0, 220] as [number, number, number, number],       // Orange - exit nodes
    middle: [80, 220, 255, 200] as [number, number, number, number],    // Cyan/teal - middle relays
    hidden: [139, 92, 246, 200] as [number, number, number, number],    // Purple - hidden service dir
  },

  // Content
  title: 'RouteFluxMap',
  summary: `
    <h2>Data Flow in the Tor Network</h2>
    <p>The Tor network is a group of volunteer-operated servers (relays) that allows people to improve their privacy and
    security on the Internet.</p>
    <p>Each circle represents aggregated relay bandwidth. Click to see individual relays with links to detailed metrics.</p>
  `,
} as const;

// Helper to get particle zoom scale
export function getParticleZoomScale(zoom: number, baseSize: number): number {
  return baseSize * Math.max(1, Math.pow(2, zoom - 4));
}

// Helper to check if mobile
export function isMobile(): boolean {
  if (typeof window === 'undefined') return false;
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

// Helper to build metrics relay URL
export function getRelayMetricsUrl(fingerprint: string): string {
  // Tor relay fingerprints must be:
  // - 40 characters (SHA-1 hash)
  // - Hexadecimal (0-9, A-F)
  // - Uppercase (canonical form)
  // - No spaces, colons, or $ prefix
  
  // Clean the fingerprint: remove $, spaces, colons, and other separators
  const cleanFingerprint = fingerprint
    .replace(/[$:\s-]/g, '')
    .toUpperCase();
  
  // Validate: must be exactly 40 hex characters
  if (!/^[0-9A-F]{40}$/.test(cleanFingerprint)) {
    console.warn(`Invalid fingerprint format: ${fingerprint}`);
    // Still return the URL, but the metrics site will handle the error
  }
  
  return `${config.metricsUrl}/relay/${cleanFingerprint}`;
}

export type Config = typeof config;
