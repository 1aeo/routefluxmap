/**
 * useCountryGeo - Country geographic data loading
 * 
 * Handles:
 * - Loading GeoJSON country boundaries
 * - Chunked processing to avoid blocking main thread
 * - Loading country client histogram for current date
 * - Territory code normalization
 */

import { useState, useEffect } from 'react';
import type { CountryHistogram } from '../types';
import { fetchWithFallback } from '../utils/data-fetch';
import { threeToTwo } from '../utils/geo';

// Fallback CDN URL for country boundaries
const FALLBACK_GEO_COUNTRIES_COMMIT = 'b0b7794e15e7ec4374bf183dd73cce5b92e1c0ae';
const FALLBACK_GEO_COUNTRIES_URL = `https://raw.githubusercontent.com/datasets/geo-countries/${FALLBACK_GEO_COUNTRIES_COMMIT}/data/countries.geojson`;

// Territory code mappings for normalization
const TERRITORY_MAP: Record<string, string> = {
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

export interface UseCountryGeoResult {
  /** GeoJSON FeatureCollection for country boundaries */
  countryGeojson: GeoJSON.FeatureCollection | null;
  /** Country client count histogram */
  countryData: CountryHistogram;
  /** Whether GeoJSON is loading */
  loadingGeo: boolean;
}

/**
 * Process a single GeoJSON feature to normalize country codes
 */
function processFeature(feature: any): void {
  const props = feature.properties || {};
  let code = props.iso_a2 || props.ISO_A2 || props.cc2 || props['ISO3166-1-Alpha-2'];
  const isValidCode = code && /^[A-Za-z]{2}$/.test(code);

  if (!isValidCode) {
    // Try 3-letter codes
    const candidates3 = [
      props.iso_a3, props.ISO_A3, props.adm0_a3,
      props['ISO3166-1-Alpha-3'], props.sov_a3, props.gu_a3, props.su_a3
    ];
    const code3 = candidates3.find(c => c && typeof c === 'string' && /^[A-Za-z]{3}$/.test(c));

    if (code3 && threeToTwo[code3.toUpperCase()]) {
      code = threeToTwo[code3.toUpperCase()];
    } else {
      // Try territory name matching
      const name = (props.name || props.NAME || props.admin || '').toLowerCase();
      for (const [pattern, territoryCode] of Object.entries(TERRITORY_MAP)) {
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
}

/**
 * Load and manage country geographic data
 */
export function useCountryGeo(currentDate: string | null): UseCountryGeoResult {
  const [countryGeojson, setCountryGeojson] = useState<GeoJSON.FeatureCollection | null>(null);
  const [countryData, setCountryData] = useState<CountryHistogram>({});
  const [loadingGeo, setLoadingGeo] = useState(true);

  // Load country GeoJSON for choropleth (once on mount)
  useEffect(() => {
    async function loadCountryGeoJson() {
      try {
        let response;
        let source: 'local' | 'fallback' = 'local';

        try {
          response = await fetch('/data/countries.geojson');
          if (!response.ok) throw new Error('Local not found');
        } catch {
          source = 'fallback';
          response = await fetch(FALLBACK_GEO_COUNTRIES_URL);
        }

        if (response.ok) {
          const geojson = await response.json();
          console.info(
            `[useCountryGeo] Loaded country boundaries from ${source}${
              source === 'fallback' ? ` (${FALLBACK_GEO_COUNTRIES_COMMIT.slice(0, 7)})` : ''
            }`
          );

          // Process features in chunks to avoid blocking main thread
          if (geojson.features) {
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
                setLoadingGeo(false);
              }
            };

            // Start chunked processing
            processChunk();
          } else {
            setCountryGeojson(geojson);
            setLoadingGeo(false);
          }
        }
      } catch (err) {
        console.warn('[useCountryGeo] Could not load country GeoJSON:', err);
        setLoadingGeo(false);
      }
    }

    loadCountryGeoJson();
  }, []);

  // Load country client data when date changes
  useEffect(() => {
    if (!currentDate) return;

    async function loadCountryData() {
      try {
        const { data, source } = await fetchWithFallback<{ countries?: CountryHistogram }>(
          `countries-${currentDate}.json`
        );
        
        if (source === 'fallback') {
          console.info(`[useCountryGeo] Using fallback for country data ${currentDate}`);
        }
        
        // data.countries is the CountryHistogram: { "US": 444507, "DE": 224891, ... }
        setCountryData(data.countries || data as CountryHistogram);
      } catch (err) {
        console.warn('[useCountryGeo] Could not load country data:', err);
        setCountryData({});
      }
    }

    loadCountryData();
  }, [currentDate]);

  return {
    countryGeojson,
    countryData,
    loadingGeo,
  };
}

