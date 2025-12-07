import { describe, it, expect } from 'vitest';
import { getNormalizedPosition, lerp, clamp, getCountryCoords } from '../../src/lib/utils/geo';

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

