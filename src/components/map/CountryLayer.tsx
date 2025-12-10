/**
 * CountryLayer - GeoJSON choropleth showing Tor client connections by country
 * Uses Deck.gl GeoJsonLayer for rendering country polygons
 */

import { GeoJsonLayer } from '@deck.gl/layers';
import type { CountryHistogram } from '../../lib/types';
import { forwardRef } from 'react';

interface CountryLayerOptions {
  countryData: CountryHistogram;
  geojson: GeoJSON.FeatureCollection | null;
  visible: boolean;
  opacity?: number;
  onClick?: (countryCode: string, countryName: string) => void;
  onHover?: (countryCode: string | null, x: number, y: number) => void;
}

// Color scale from dark to bright green
function getCountryColor(normalizedValue: number): [number, number, number, number] {
  // From dark purple/blue to bright green
  const r = Math.round(26 + (0 - 26) * normalizedValue);
  const g = Math.round(26 + (255 - 26) * normalizedValue);
  const b = Math.round(46 + (136 - 46) * normalizedValue);
  const a = Math.round(100 + 155 * normalizedValue); // 100-255 alpha
  
  return [r, g, b, a];
}

// Get country code from feature properties
function getCountryCode(feature: any): string | null {
  const props = feature.properties;
  return props?.iso_a2 || props?.ISO_A2 || props?.cc2 || null;
}

// Get country name from feature properties
function getCountryName(feature: any): string {
  const props = feature.properties;
  return props?.name || props?.NAME || props?.admin || 'Unknown';
}

export function createCountryLayer({
  countryData,
  geojson,
  visible,
  opacity = 0.6,
  onClick,
  onHover,
}: CountryLayerOptions): GeoJsonLayer | null {
  // Return null only if there's no geojson data - but always create the layer
  // even when not visible to keep geometry in GPU memory and avoid re-parsing lag
  if (!geojson) return null;
  
  // Calculate max client count for normalization
  const counts = Object.values(countryData);
  const maxCount = Math.max(...counts, 1);
  
  return new GeoJsonLayer({
    id: 'countries',
    data: geojson,
    visible, // Control visibility through Deck.gl's built-in prop for instant toggling
    pickable: visible, // Only pickable when visible
    stroked: true,
    filled: true,
    extruded: false,
    wireframe: false,
    opacity,
    lineWidthMinPixels: 1,
    
    // Style based on client count
    getFillColor: (feature: any) => {
      const cc = getCountryCode(feature);
      if (!cc || !countryData[cc]) {
        return [26, 26, 46, 50]; // Dark with low opacity for countries without data
      }
      const count = countryData[cc];
      const normalized = Math.sqrt(count / maxCount); // Square root for better distribution
      return getCountryColor(normalized);
    },
    
    getLineColor: [0, 100, 50, 100], // Dark green border
    getLineWidth: 1,
    
    // Hover styling
    autoHighlight: true,
    highlightColor: [255, 255, 255, 100],
    
    // Event handlers
    onClick: (info: any) => {
      if (info.object && onClick) {
        const cc = getCountryCode(info.object);
        const name = getCountryName(info.object);
        if (cc) {
          onClick(cc, name);
        }
      }
    },
    
    onHover: (info: any) => {
      if (onHover) {
        if (info.object) {
          const cc = getCountryCode(info.object);
          onHover(cc, info.x, info.y);
        } else {
          onHover(null, 0, 0);
        }
      }
    },
    
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
  ({ countryCode, countryData, x, y, style }, ref) => {
    const count = countryData[countryCode] || 0;
    
    return (
      <div
        ref={ref}
        className="absolute pointer-events-none bg-black/90 text-white text-sm px-3 py-2 rounded-lg shadow-lg border border-purple-500/30 z-10 transition-opacity duration-75"
        style={{
          left: x + 10,
          top: y + 10,
          ...style
        }}
      >
        <div className="font-medium text-purple-400 country-name">{countryCode}</div>
        <div className="text-gray-400 country-count">
          {count.toLocaleString()} clients
        </div>
      </div>
    );
  }
);

// Utility to format country data for display
export function formatCountryStats(countryData: CountryHistogram): {
  total: number;
  topCountries: { code: string; count: number }[];
} {
  const entries = Object.entries(countryData);
  const total = entries.reduce((sum, [, count]) => sum + count, 0);
  
  const topCountries = entries
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([code, count]) => ({ code, count }));
  
  return { total, topCountries };
}


