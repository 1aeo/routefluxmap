import { describe, it, expect } from 'vitest';
import { 
  getNormalizedPosition, 
  lerp, 
  clamp, 
  getCountryCoords,
  findCountryAtLocation,
  twoToThree,
  threeToTwo,
  countryCentroids,
} from '../../src/lib/utils/geo';

describe('getNormalizedPosition', () => {
  it('normalizes equator/prime meridian to center', () => {
    const { x, y } = getNormalizedPosition(0, 0);
    expect(x).toBe(0.5);
    expect(y).toBeCloseTo(0.5, 5);
  });

  it('maps longitude -180 to x=0', () => {
    const { x } = getNormalizedPosition(0, -180);
    expect(x).toBe(0);
  });

  it('maps longitude 180 to x=1', () => {
    const { x } = getNormalizedPosition(0, 180);
    expect(x).toBe(1);
  });

  it('handles extreme northern latitudes', () => {
    const { y: north } = getNormalizedPosition(85, 0);
    expect(north).toBeGreaterThan(0.5);
    expect(north).toBeLessThan(1);
  });

  it('handles extreme southern latitudes', () => {
    const { y: south } = getNormalizedPosition(-85, 0);
    expect(south).toBeLessThan(0.5);
    expect(south).toBeGreaterThan(0);
  });

  it('produces symmetric y values for opposite latitudes', () => {
    const { y: north } = getNormalizedPosition(45, 0);
    const { y: south } = getNormalizedPosition(-45, 0);
    // They should be equidistant from 0.5
    expect(north - 0.5).toBeCloseTo(0.5 - south, 5);
  });
});

describe('lerp', () => {
  it('returns min when t=0', () => {
    expect(lerp(10, 20, 0)).toBe(10);
  });

  it('returns max when t=1', () => {
    expect(lerp(10, 20, 1)).toBe(20);
  });

  it('returns midpoint when t=0.5', () => {
    expect(lerp(10, 20, 0.5)).toBe(15);
  });

  it('handles negative ranges', () => {
    expect(lerp(-10, 10, 0.5)).toBe(0);
  });

  it('works with t outside [0,1]', () => {
    expect(lerp(0, 10, 2)).toBe(20);
    expect(lerp(0, 10, -1)).toBe(-10);
  });
});

describe('clamp', () => {
  it('returns value when within range', () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });

  it('returns min when value is below range', () => {
    expect(clamp(-5, 0, 10)).toBe(0);
  });

  it('returns max when value is above range', () => {
    expect(clamp(15, 0, 10)).toBe(10);
  });

  it('handles equal min and max', () => {
    expect(clamp(5, 3, 3)).toBe(3);
  });
});

describe('getCountryCoords', () => {
  it('returns coordinates for known country codes', () => {
    const { lat, lng } = getCountryCoords('US');
    // US centroid is approximately -95.71, 37.09
    // With jitter, should be within reasonable range
    expect(lat).toBeGreaterThan(30);
    expect(lat).toBeLessThan(45);
    expect(lng).toBeGreaterThan(-110);
    expect(lng).toBeLessThan(-80);
  });

  it('handles lowercase country codes', () => {
    const { lat, lng } = getCountryCoords('de');
    // Germany centroid is approximately 10.45, 51.17
    expect(lat).toBeGreaterThan(45);
    expect(lat).toBeLessThan(60);
  });

  it('falls back to US for unknown codes', () => {
    const { lat } = getCountryCoords('XX');
    // Should fall back to US range
    expect(lat).toBeGreaterThan(30);
    expect(lat).toBeLessThan(45);
  });

  it('handles empty string by defaulting to US', () => {
    const { lat } = getCountryCoords('');
    expect(lat).toBeGreaterThan(30);
    expect(lat).toBeLessThan(45);
  });
});

describe('findCountryAtLocation', () => {
  // Create minimal GeoJSON fixtures for testing
  const createPolygonFeature = (
    iso_a2: string,
    name: string,
    coords: [number, number][]
  ): GeoJSON.Feature => ({
    type: 'Feature',
    properties: { iso_a2, name },
    geometry: {
      type: 'Polygon',
      coordinates: [coords],
    },
  });

  const createMultiPolygonFeature = (
    iso_a2: string,
    name: string,
    polygons: [number, number][][]
  ): GeoJSON.Feature => ({
    type: 'Feature',
    properties: { iso_a2, name },
    geometry: {
      type: 'MultiPolygon',
      coordinates: polygons.map(p => [p]),
    },
  });

  // Simple rectangular "US" covering continental US area
  const usPolygon = createPolygonFeature('US', 'United States', [
    [-130, 20], [-60, 20], [-60, 50], [-130, 50], [-130, 20]
  ]);

  // Simple rectangular "DE" covering Germany area
  const dePolygon = createPolygonFeature('DE', 'Germany', [
    [5, 47], [15, 47], [15, 55], [5, 55], [5, 47]
  ]);

  // MultiPolygon for testing (like Hawaii + mainland)
  const multiPolygonFeature = createMultiPolygonFeature('JP', 'Japan', [
    // Main island approximation
    [[130, 30], [145, 30], [145, 45], [130, 45], [130, 30]],
    // Small island
    [[125, 25], [130, 25], [130, 28], [125, 28], [125, 25]],
  ]);

  const mockGeojson: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features: [usPolygon, dePolygon, multiPolygonFeature],
  };

  it('finds country for point inside polygon', () => {
    // Point clearly inside US bounds
    const result = findCountryAtLocation(-100, 35, mockGeojson);
    expect(result).toEqual({ code: 'US', name: 'United States' });
  });

  it('finds country for point inside Germany', () => {
    const result = findCountryAtLocation(10, 51, mockGeojson);
    expect(result).toEqual({ code: 'DE', name: 'Germany' });
  });

  it('returns null for point outside all polygons', () => {
    // Point in the ocean
    const result = findCountryAtLocation(0, 0, mockGeojson);
    expect(result).toBeNull();
  });

  it('returns null for point near but outside polygon', () => {
    // Just outside US bounds
    const result = findCountryAtLocation(-135, 35, mockGeojson);
    expect(result).toBeNull();
  });

  it('returns null for empty features array', () => {
    const emptyGeojson: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: [],
    };
    const result = findCountryAtLocation(-100, 35, emptyGeojson);
    expect(result).toBeNull();
  });

  it('returns null for null geojson', () => {
    const result = findCountryAtLocation(-100, 35, null as any);
    expect(result).toBeNull();
  });

  it('returns null for geojson without features', () => {
    const result = findCountryAtLocation(-100, 35, {} as any);
    expect(result).toBeNull();
  });

  it('handles MultiPolygon geometries - main polygon', () => {
    // Point in main Japan polygon
    const result = findCountryAtLocation(138, 36, mockGeojson);
    expect(result).toEqual({ code: 'JP', name: 'Japan' });
  });

  it('handles MultiPolygon geometries - secondary polygon', () => {
    // Point in small island polygon
    const result = findCountryAtLocation(127, 26, mockGeojson);
    expect(result).toEqual({ code: 'JP', name: 'Japan' });
  });

  it('handles features without geometry', () => {
    const geojsonWithNullGeom: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { iso_a2: 'XX', name: 'NoGeom' },
          geometry: null as any,
        },
        usPolygon,
      ],
    };
    // Should skip the null geometry and find US
    const result = findCountryAtLocation(-100, 35, geojsonWithNullGeom);
    expect(result).toEqual({ code: 'US', name: 'United States' });
  });

  it('returns null when country code is missing from properties', () => {
    const geojsonNoCode: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        properties: { name: 'Unknown Territory' }, // No iso_a2
        geometry: {
          type: 'Polygon',
          coordinates: [[[-10, -10], [10, -10], [10, 10], [-10, 10], [-10, -10]]],
        },
      }],
    };
    const result = findCountryAtLocation(0, 0, geojsonNoCode);
    expect(result).toBeNull();
  });

  it('extracts code from alternative property names', () => {
    const geojsonAltProps: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        properties: { ISO_A2: 'FR', NAME: 'France' }, // Uppercase variants
        geometry: {
          type: 'Polygon',
          coordinates: [[[-5, 42], [8, 42], [8, 51], [-5, 51], [-5, 42]]],
        },
      }],
    };
    const result = findCountryAtLocation(2, 46, geojsonAltProps);
    expect(result).toEqual({ code: 'FR', name: 'France' });
  });

  it('uses fallback name properties', () => {
    const geojsonAltName: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        properties: { iso_a2: 'IT', admin: 'Italy' }, // 'admin' instead of 'name'
        geometry: {
          type: 'Polygon',
          coordinates: [[[6, 36], [18, 36], [18, 47], [6, 47], [6, 36]]],
        },
      }],
    };
    const result = findCountryAtLocation(12, 42, geojsonAltName);
    expect(result).toEqual({ code: 'IT', name: 'Italy' });
  });
});

describe('country code mappings', () => {
  describe('twoToThree', () => {
    it('maps common 2-letter codes to 3-letter codes', () => {
      expect(twoToThree['US']).toBe('USA');
      expect(twoToThree['DE']).toBe('DEU');
      expect(twoToThree['GB']).toBe('GBR');
      expect(twoToThree['FR']).toBe('FRA');
      expect(twoToThree['NL']).toBe('NLD');
      expect(twoToThree['RU']).toBe('RUS');
      expect(twoToThree['CN']).toBe('CHN');
      expect(twoToThree['JP']).toBe('JPN');
    });

    it('contains all expected European countries', () => {
      const europeanCodes = ['AT', 'BE', 'CH', 'CZ', 'DK', 'ES', 'FI', 'FR', 'DE', 'GB', 'GR', 'HU', 'IE', 'IT', 'NL', 'NO', 'PL', 'PT', 'RO', 'SE'];
      europeanCodes.forEach(code => {
        expect(twoToThree[code]).toBeDefined();
        expect(twoToThree[code]).toHaveLength(3);
      });
    });

    it('contains all expected major Tor relay countries', () => {
      // Top countries by relay count typically
      const topRelayCountries = ['US', 'DE', 'FR', 'NL', 'GB', 'RU', 'CA', 'SE', 'CH', 'AT'];
      topRelayCountries.forEach(code => {
        expect(twoToThree[code]).toBeDefined();
      });
    });

    it('has valid 3-letter code format for all entries', () => {
      Object.entries(twoToThree).forEach(([two, three]) => {
        expect(two).toMatch(/^[A-Z]{2}$/);
        expect(three).toMatch(/^[A-Z]{3}$/);
      });
    });
  });

  describe('threeToTwo', () => {
    it('is the inverse of twoToThree', () => {
      Object.entries(twoToThree).forEach(([two, three]) => {
        expect(threeToTwo[three]).toBe(two);
      });
    });

    it('maps common 3-letter codes back to 2-letter', () => {
      expect(threeToTwo['USA']).toBe('US');
      expect(threeToTwo['DEU']).toBe('DE');
      expect(threeToTwo['GBR']).toBe('GB');
      expect(threeToTwo['FRA']).toBe('FR');
    });

    it('has same number of entries as twoToThree', () => {
      expect(Object.keys(threeToTwo).length).toBe(Object.keys(twoToThree).length);
    });
  });
});

describe('countryCentroids', () => {
  it('has valid longitude values for all entries', () => {
    Object.entries(countryCentroids).forEach(([code, [lng, lat]]) => {
      expect(lng).toBeGreaterThanOrEqual(-180);
      expect(lng).toBeLessThanOrEqual(180);
    });
  });

  it('has valid latitude values for all entries', () => {
    Object.entries(countryCentroids).forEach(([code, [lng, lat]]) => {
      expect(lat).toBeGreaterThanOrEqual(-90);
      expect(lat).toBeLessThanOrEqual(90);
    });
  });

  it('uses 2-letter ISO country codes', () => {
    Object.keys(countryCentroids).forEach(code => {
      expect(code).toMatch(/^[A-Z]{2}$/);
    });
  });

  it('covers major Tor relay countries', () => {
    const majorCountries = ['US', 'DE', 'FR', 'NL', 'GB', 'RU', 'CA', 'SE', 'CH', 'AT', 'FI', 'NO', 'PL', 'RO', 'CZ'];
    majorCountries.forEach(code => {
      expect(countryCentroids[code]).toBeDefined();
      expect(countryCentroids[code]).toHaveLength(2);
    });
  });

  it('has geographically reasonable centroids', () => {
    // US should be in Western hemisphere, northern
    const [usLng, usLat] = countryCentroids['US'];
    expect(usLng).toBeLessThan(-60);
    expect(usLat).toBeGreaterThan(25);
    expect(usLat).toBeLessThan(50);

    // Germany should be in Central Europe
    const [deLng, deLat] = countryCentroids['DE'];
    expect(deLng).toBeGreaterThan(5);
    expect(deLng).toBeLessThan(15);
    expect(deLat).toBeGreaterThan(47);
    expect(deLat).toBeLessThan(55);

    // Australia should be in Southern hemisphere
    const [auLng, auLat] = countryCentroids['AU'];
    expect(auLng).toBeGreaterThan(110);
    expect(auLng).toBeLessThan(155);
    expect(auLat).toBeLessThan(0); // Southern hemisphere
  });

  it('includes French overseas territories', () => {
    const frenchTerritories = ['GF', 'GP', 'MQ', 'RE', 'YT', 'NC', 'PF'];
    frenchTerritories.forEach(code => {
      expect(countryCentroids[code]).toBeDefined();
    });
  });

  it('includes US territories', () => {
    const usTerritories = ['PR', 'VI', 'GU', 'AS', 'MP'];
    usTerritories.forEach(code => {
      expect(countryCentroids[code]).toBeDefined();
    });
  });
});

