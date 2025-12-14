/**
 * RouteFluxMap Configuration
 * Theme: Black + Green
 * 
 * Many values are adaptive - they adjust based on current relay data.
 * Static defaults are used before data loads or as fallbacks.
 */

export const config = {
  // Site info - configure via environment variables
  siteUrl: import.meta.env.PUBLIC_SITE_URL || '',
  metricsUrl: import.meta.env.PUBLIC_METRICS_URL || '',
  dataBaseUrl: import.meta.env.PUBLIC_DATA_URL || '',

  // Color ramps - Green theme
  bandwidthColorRamp: ['#004d29', '#00ff88'] as const,
  connectionsColorRamp: ['#004d29', '#00cc6a'] as const,
  countriesColorRamp: ['#1a1a2e', '#00ff88'] as const,

  // Particle colors (normalized 0-1)
  particleHiddenColor: [1.0, 0.5, 0.0] as const,      // Orange
  particleGeneralColor: [0.0, 1.0, 0.53] as const,    // Green (#00ff88)

  // Node count configuration
  // ADAPTIVE: Shows all aggregated locations from data when available
  // Static default used before data loads (~1,200-1,500 locations typical)
  nodeCount: {
    default: 1500,
    min: 100,
    max: 3000,
  },

  // Node radius (pixels)
  // Sized by relay count only (bandwidth shown via particles)
  nodeRadius: {
    min: 4,
    max: 22,
  },

  // Country count configuration
  // ADAPTIVE: Shows all countries with relays when data available
  // Static default covers typical range (~80-120 countries have relays)
  countryCount: {
    default: 120,
    min: 5,
    max: 250,
  },

  // Particle count configuration
  // ADAPTIVE: Scales with network bandwidth (particles = bandwidth × K)
  // K=400 derived from: ~400k particles at ~1000 bandwidth baseline
  // This gives ~0.2 particles/pixel on 1080p = good visual density
  particleScaleFactor: 400,
  particleCount: {
    default: 500_000,  // Fallback before data loads
    min: 100_000,
    max: 2_000_000,
  },

  // Particle size (pixels)
  particleSize: {
    default: 1,
    min: 1,
    max: 10,
  },

  // Particle speed (ms for particle to circle earth)
  particleBaseSpeedMs: 55_000,
  particleSpeedFactor: {
    min: 0.01,
    max: 4.0,
  },

  // Hidden service traffic probability
  // Estimated ~3-6% of Tor traffic goes to .onion addresses
  // This is a research estimate - not directly measurable due to Tor's privacy design
  // Source: https://metrics.torproject.org/hidserv-dir-onions-seen.html
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
  
  // Attribution sources (name, url, prefix?, suffix?)
  attributions: [
    { name: 'MapLibre', url: 'https://maplibre.org/', prefix: '', suffix: '' },
    { name: 'CARTO', url: 'https://carto.com/attributions', prefix: '©', suffix: '' },
    { name: 'OpenStreetMap', url: 'https://www.openstreetmap.org/copyright', prefix: '©', suffix: '' },
    { name: 'MaxMind', url: 'https://www.maxmind.com', prefix: '', suffix: '' },
    { name: 'TorFlow', url: 'https://github.com/unchartedsoftware/torflow', prefix: '', suffix: 'contributors' },
  ] as const,

  // Relay marker colors (RGBA 0-255)
  relayColors: {
    guard: [0, 240, 255, 220] as [number, number, number, number],      // Cyan - entry nodes
    exit: [255, 136, 0, 220] as [number, number, number, number],       // Orange - exit nodes
    middle: [0, 255, 136, 200] as [number, number, number, number],     // Green - middle relays (matches flow)
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
