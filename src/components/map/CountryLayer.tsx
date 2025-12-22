/**
 * CountryLayer - GeoJSON choropleth showing Tor client connections by country
 * 
 * Performance: Uses CPU point-in-polygon for hover detection instead of GPU picking.
 * This avoids expensive readPixels() calls that block the render loop.
 */

import { GeoJsonLayer } from '@deck.gl/layers';
import { type CountryHistogram, getCountryClientData, formatCompact, getDeviation, TOOLTIP_OFFSET } from '../../lib/types';
import { forwardRef } from 'react';

interface CountryLayerOptions {
  countryData: CountryHistogram;
  geojson: GeoJSON.FeatureCollection | null;
  visible: boolean;
  opacity?: number;
}

// Color constants
const NO_DATA_COLOR: [number, number, number, number] = [26, 26, 46, 50];
const LINE_COLOR: [number, number, number, number] = [0, 100, 50, 100];

// Color ramp: dark (#1a1a2e, a=100) → green (#00ff88, a=255)
// Pre-computed deltas for efficient interpolation
const COLOR_BASE = [26, 26, 46, 100] as const;
const COLOR_DELTA = [-26, 229, 90, 155] as const; // end - start

/** Interpolate color based on normalized value [0,1] */
function getCountryColor(t: number): [number, number, number, number] {
  return [
    Math.round(COLOR_BASE[0] + COLOR_DELTA[0] * t),
    Math.round(COLOR_BASE[1] + COLOR_DELTA[1] * t),
    Math.round(COLOR_BASE[2] + COLOR_DELTA[2] * t),
    Math.round(COLOR_BASE[3] + COLOR_DELTA[3] * t),
  ];
}

// Get country code from feature properties
function getCountryCode(feature: any): string | null {
  const props = feature.properties;
  return props?.iso_a2 || props?.ISO_A2 || props?.cc2 || null;
}

/**
 * Creates a Deck.gl GeoJsonLayer for country choropleth visualization.
 * Layer is always created (even when hidden) to keep geometry in GPU memory.
 */
export function createCountryLayer({
  countryData,
  geojson,
  visible,
  opacity = 0.6,
}: CountryLayerOptions): GeoJsonLayer | null {
  // Return null only if there's no geojson data - but always create the layer
  // even when not visible to keep geometry in GPU memory and avoid re-parsing lag
  if (!geojson) return null;
  
  // Pre-compute counts lookup and max in single pass
  let maxCount = 1;
  const countLookup: Record<string, number> = {};
  for (const code in countryData) {
    const count = getCountryClientData(countryData, code).count;
    countLookup[code] = count;
    if (count > maxCount) maxCount = count;
  }
  
  return new GeoJsonLayer({
    id: 'countries',
    data: geojson,
    visible,
    // Disable GPU picking entirely - use CPU point-in-polygon instead
    // This eliminates expensive readPixels() GPU readback on every mouse move
    pickable: false,
    stroked: true,
    filled: true,
    extruded: false,
    wireframe: false,
    opacity,
    lineWidthMinPixels: 1,
    
    // Style based on client count (uses pre-computed lookup)
    getFillColor: (feature: any) => {
      const cc = getCountryCode(feature);
      const count = cc ? countLookup[cc] : undefined;
      if (count === undefined) return NO_DATA_COLOR;
      return getCountryColor(Math.sqrt(count / maxCount)); // sqrt for better distribution
    },
    
    getLineColor: LINE_COLOR,
    getLineWidth: 1,
    
    updateTriggers: {
      getFillColor: [countryData, maxCount],
      visible: [visible],
    },
  });
}

// Country hover tooltip component
interface CountryTooltipProps {
  countryCode: string;
  countryData: CountryHistogram;
  x: number;
  y: number;
  style?: React.CSSProperties;
}

export const CountryTooltip = forwardRef<HTMLDivElement, CountryTooltipProps>(
  function CountryTooltip({ countryCode, countryData, x, y, style }, ref) {
    const { count, lower, upper, hasBounds } = getCountryClientData(countryData, countryCode);
    const countStr = count.toLocaleString();
    
    return (
      <div
        ref={ref}
        className="absolute pointer-events-none bg-black/90 text-white text-sm px-3 py-2 rounded-lg shadow-lg border border-purple-500/30 z-10 transition-opacity duration-75"
        style={{ left: x + TOOLTIP_OFFSET, top: y + TOOLTIP_OFFSET, ...style }}
      >
        <div className="font-medium text-purple-400 country-name">{countryCode}</div>
        <div className="text-gray-400 country-count">
          {countStr}{hasBounds && ` ± ${formatCompact(getDeviation(lower, upper))}`} clients
        </div>
        {/* Always render bounds element so DOM ref caching works; hide via display:none */}
        <div 
          className="text-gray-500 text-xs country-bounds"
          style={{ display: hasBounds ? undefined : 'none' }}
        >
          Lower: {lower.toLocaleString()} / Upper: {upper.toLocaleString()}
        </div>
      </div>
    );
  }
);

/** Format country data for display: total count and top 10 countries */
export function formatCountryStats(countryData: CountryHistogram): {
  total: number;
  topCountries: { code: string; count: number }[];
} {
  let total = 0;
  const entries: { code: string; count: number }[] = [];
  
  for (const code in countryData) {
    const count = getCountryClientData(countryData, code).count;
    total += count;
    entries.push({ code, count });
  }
  
  entries.sort((a, b) => b.count - a.count);
  return { total, topCountries: entries.slice(0, 10) };
}
