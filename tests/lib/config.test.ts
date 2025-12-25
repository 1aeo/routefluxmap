import { describe, it, expect } from 'vitest';
import { getRelayMetricsUrl, getCountryMetricsUrl, getParticleZoomScale, config } from '../../src/lib/config';

describe('getRelayMetricsUrl', () => {
  it('generates correct URL for valid uppercase fingerprint', () => {
    const fp = '7EAAC4D0E1AC54E888C49F2F0C6BF5B2DDFB4C4A';
    const url = getRelayMetricsUrl(fp);
    expect(url).toContain('/relay/7EAAC4D0E1AC54E888C49F2F0C6BF5B2DDFB4C4A');
  });

  it('handles lowercase fingerprints by uppercasing', () => {
    const fp = '7eaac4d0e1ac54e888c49f2f0c6bf5b2ddfb4c4a';
    const url = getRelayMetricsUrl(fp);
    expect(url).toContain('7EAAC4D0E1AC54E888C49F2F0C6BF5B2DDFB4C4A');
  });

  it('removes $ prefix from fingerprints', () => {
    const fp = '$7EAAC4D0E1AC54E888C49F2F0C6BF5B2DDFB4C4A';
    const url = getRelayMetricsUrl(fp);
    expect(url).not.toContain('$');
    expect(url).toContain('7EAAC4D0E1AC54E888C49F2F0C6BF5B2DDFB4C4A');
  });

  it('removes colons from fingerprints', () => {
    const fp = '7E:AA:C4:D0:E1:AC:54:E8:88:C4:9F:2F:0C:6B:F5:B2:DD:FB:4C:4A';
    const url = getRelayMetricsUrl(fp);
    // URL contains :// from protocol, but fingerprint portion should not have colons
    const fingerprintPart = url.split('/relay/')[1];
    expect(fingerprintPart).not.toContain(':');
  });

  it('removes spaces from fingerprints', () => {
    const fp = '7E AA C4 D0 E1 AC 54 E8 88 C4 9F 2F 0C 6B F5 B2 DD FB 4C 4A';
    const url = getRelayMetricsUrl(fp);
    expect(url).not.toContain(' ');
  });
});

describe('getCountryMetricsUrl', () => {
  it('generates correct URL for valid uppercase code', () => {
    const url = getCountryMetricsUrl('US');
    expect(url).toContain('/country/US/');
  });

  it('normalizes lowercase to uppercase', () => {
    const url = getCountryMetricsUrl('de');
    expect(url).toContain('/country/DE/');
  });

  it('strips invalid characters', () => {
    expect(getCountryMetricsUrl('U-S')).toContain('/country/US/');
    expect(getCountryMetricsUrl('U S')).toContain('/country/US/');
    expect(getCountryMetricsUrl('U.S.')).toContain('/country/US/');
  });

  it('returns fallback for invalid length (too short)', () => {
    const url = getCountryMetricsUrl('X');
    expect(url).toMatch(/\/country\/$/);
  });

  it('returns fallback for invalid length (too long)', () => {
    const url = getCountryMetricsUrl('USA');
    expect(url).toMatch(/\/country\/$/);
  });

  it('returns fallback for empty string', () => {
    const url = getCountryMetricsUrl('');
    expect(url).toMatch(/\/country\/$/);
  });

  it('handles mixed case correctly', () => {
    expect(getCountryMetricsUrl('uS')).toContain('/country/US/');
    expect(getCountryMetricsUrl('Us')).toContain('/country/US/');
  });
});

describe('getParticleZoomScale', () => {
  it('returns base size at zoom level 4', () => {
    const result = getParticleZoomScale(4, 2);
    expect(result).toBe(2);
  });

  it('returns base size for zoom below 4', () => {
    expect(getParticleZoomScale(3, 2)).toBe(2);
    expect(getParticleZoomScale(2, 2)).toBe(2);
    expect(getParticleZoomScale(1, 2)).toBe(2);
    expect(getParticleZoomScale(0, 2)).toBe(2);
  });

  it('doubles size for each zoom level above 4', () => {
    // zoom 5: 2^(5-4) = 2^1 = 2, so 2 * 2 = 4
    expect(getParticleZoomScale(5, 2)).toBe(4);
    // zoom 6: 2^(6-4) = 2^2 = 4, so 2 * 4 = 8
    expect(getParticleZoomScale(6, 2)).toBe(8);
    // zoom 7: 2^(7-4) = 2^3 = 8, so 2 * 8 = 16
    expect(getParticleZoomScale(7, 2)).toBe(16);
  });

  it('handles fractional zoom levels', () => {
    // zoom 4.5: 2^(4.5-4) = 2^0.5 ≈ 1.414
    const result = getParticleZoomScale(4.5, 2);
    expect(result).toBeCloseTo(2 * Math.SQRT2, 5);
  });

  it('handles different base sizes', () => {
    expect(getParticleZoomScale(5, 1)).toBe(2);
    expect(getParticleZoomScale(5, 3)).toBe(6);
    expect(getParticleZoomScale(5, 10)).toBe(20);
  });

  it('handles zero base size', () => {
    expect(getParticleZoomScale(5, 0)).toBe(0);
    expect(getParticleZoomScale(10, 0)).toBe(0);
  });

  it('handles negative zoom levels', () => {
    // Below zoom 4, returns base size (max of 1 and calculated)
    expect(getParticleZoomScale(-1, 2)).toBe(2);
  });

  it('handles high zoom levels correctly', () => {
    // zoom 10: 2^(10-4) = 64
    expect(getParticleZoomScale(10, 1)).toBe(64);
    // zoom 14: 2^(14-4) = 1024
    expect(getParticleZoomScale(14, 1)).toBe(1024);
  });
});

describe('config object', () => {
  it('has required color ramps', () => {
    expect(config.bandwidthColorRamp).toBeDefined();
    expect(config.bandwidthColorRamp).toHaveLength(2);
    expect(config.connectionsColorRamp).toBeDefined();
    expect(config.countriesColorRamp).toBeDefined();
  });

  it('has valid node radius configuration', () => {
    expect(config.nodeRadius.min).toBeLessThan(config.nodeRadius.max);
    expect(config.nodeRadius.min).toBeGreaterThan(0);
  });

  it('has valid particle count configuration', () => {
    expect(config.particleCount.min).toBeLessThan(config.particleCount.max);
    expect(config.particleCount.default).toBeGreaterThanOrEqual(config.particleCount.min);
    expect(config.particleCount.default).toBeLessThanOrEqual(config.particleCount.max);
  });

  it('has valid zoom configuration', () => {
    expect(config.zoom.desktop.min).toBeLessThanOrEqual(config.zoom.desktop.start);
    expect(config.zoom.mobile.min).toBeLessThanOrEqual(config.zoom.mobile.start);
  });

  it('has relay colors defined for all types', () => {
    expect(config.relayColors.guard).toBeDefined();
    expect(config.relayColors.exit).toBeDefined();
    expect(config.relayColors.middle).toBeDefined();
    expect(config.relayColors.hidden).toBeDefined();
    
    // Each color should be RGBA tuple
    expect(config.relayColors.guard).toHaveLength(4);
    expect(config.relayColors.exit).toHaveLength(4);
  });

  it('has hidden service probability in valid range', () => {
    expect(config.hiddenServiceProbability).toBeGreaterThan(0);
    expect(config.hiddenServiceProbability).toBeLessThan(1);
  });

  it('has mobile adjustment factors in valid range', () => {
    expect(config.mobile.particleFactor).toBeGreaterThan(0);
    expect(config.mobile.particleFactor).toBeLessThanOrEqual(1);
    expect(config.mobile.nodeFactor).toBeGreaterThan(0);
    expect(config.mobile.nodeFactor).toBeLessThanOrEqual(1);
  });

  it('has valid attributions array', () => {
    expect(config.attributions).toBeDefined();
    expect(config.attributions.length).toBeGreaterThan(0);
    config.attributions.forEach(attr => {
      expect(attr.name).toBeDefined();
      expect(attr.url).toBeDefined();
    });
  });
});

