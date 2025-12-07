import { describe, it, expect } from 'vitest';
import {
  calculateNodeRadius,
  calculateZoomScale,
  getZoomPixelConstraints,
} from '../../src/lib/utils/node-sizing';
import type { AggregatedNode, RelayInfo } from '../../src/lib/types';

// Helper to create a mock node for testing
function createMockNode(
  relayCount: number,
  bandwidth: number
): AggregatedNode {
  const relays: RelayInfo[] = Array(relayCount)
    .fill(null)
    .map((_, i) => ({
      nickname: `Relay${i}`,
      fingerprint: `FP${i}`,
      bandwidth: bandwidth / relayCount,
      flags: 'M',
      ip: '127.0.0.1',
      port: '9001',
    }));

  return {
    lat: 0,
    lng: 0,
    x: 0.5,
    y: 0.5,
    bandwidth,
    normalized_bandwidth: 0.5,
    label: `Test Node (${relayCount} relays)`,
    relays,
  };
}

describe('calculateNodeRadius', () => {
  it('returns reasonable radius for nodes with minimal data', () => {
    const node = createMockNode(1, 1000);
    const radius = calculateNodeRadius(node, 3, 100, 1_000_000);

    // Should return a valid radius within the configured range
    expect(radius).toBeGreaterThanOrEqual(5); // config.nodeRadius.min
    expect(radius).toBeLessThanOrEqual(40); // config.nodeRadius.max
  });

  it('returns larger radius for nodes with more relays', () => {
    const smallNode = createMockNode(1, 10000);
    const largeNode = createMockNode(50, 10000);

    const smallRadius = calculateNodeRadius(smallNode, 3, 100, 1_000_000);
    const largeRadius = calculateNodeRadius(largeNode, 3, 100, 1_000_000);

    expect(largeRadius).toBeGreaterThan(smallRadius);
  });

  it('returns larger radius for nodes with higher bandwidth', () => {
    const lowBwNode = createMockNode(10, 1000);
    const highBwNode = createMockNode(10, 1_000_000);

    const lowBwRadius = calculateNodeRadius(lowBwNode, 3, 100, 1_000_000);
    const highBwRadius = calculateNodeRadius(highBwNode, 3, 100, 1_000_000);

    expect(highBwRadius).toBeGreaterThan(lowBwRadius);
  });

  it('respects custom radius config', () => {
    const node = createMockNode(50, 500_000);
    const customConfig = { minRadius: 10, maxRadius: 100 };

    const radius = calculateNodeRadius(
      node,
      3,
      100,
      1_000_000,
      customConfig
    );

    expect(radius).toBeGreaterThanOrEqual(10);
    expect(radius).toBeLessThanOrEqual(100);
  });

  it('handles edge case of zero maxBandwidth', () => {
    const node = createMockNode(10, 1000);
    // Should not throw or return NaN
    const radius = calculateNodeRadius(node, 3, 100, 0);

    expect(Number.isFinite(radius)).toBe(true);
    expect(radius).toBeGreaterThanOrEqual(5);
  });

  it('produces different results at different zoom levels', () => {
    const node = createMockNode(25, 500_000);

    const radiusZoom1 = calculateNodeRadius(node, 1, 100, 1_000_000);
    const radiusZoom5 = calculateNodeRadius(node, 5, 100, 1_000_000);

    // At different zoom levels, weighting changes, so radius should differ
    expect(radiusZoom1).not.toBe(radiusZoom5);
  });
});

describe('calculateZoomScale', () => {
  it('returns 1 at zoom level 3', () => {
    expect(calculateZoomScale(3)).toBe(1);
  });

  it('returns greater than 1 at higher zoom levels', () => {
    expect(calculateZoomScale(5)).toBeGreaterThan(1);
    expect(calculateZoomScale(10)).toBeGreaterThan(calculateZoomScale(5));
  });

  it('returns less than 1 at lower zoom levels', () => {
    expect(calculateZoomScale(1)).toBeLessThan(1);
    expect(calculateZoomScale(2)).toBeLessThan(1);
  });

  it('scales exponentially', () => {
    const scale4 = calculateZoomScale(4);
    const scale5 = calculateZoomScale(5);
    const scale6 = calculateZoomScale(6);

    // Each zoom level should multiply by 1.2
    expect(scale5 / scale4).toBeCloseTo(1.2, 5);
    expect(scale6 / scale5).toBeCloseTo(1.2, 5);
  });
});

describe('getZoomPixelConstraints', () => {
  it('returns smaller constraints at low zoom', () => {
    const constraints = getZoomPixelConstraints(2);

    expect(constraints.baseMinPixels).toBe(2);
    expect(constraints.baseMaxPixels).toBe(15);
  });

  it('returns medium constraints at medium zoom', () => {
    const constraints = getZoomPixelConstraints(4);

    expect(constraints.baseMinPixels).toBe(3);
    expect(constraints.baseMaxPixels).toBe(30); // zoom < 6, so baseMaxPixels = 30
  });

  it('returns larger constraints at high zoom', () => {
    const constraints = getZoomPixelConstraints(8);

    expect(constraints.baseMinPixels).toBe(4);
    expect(constraints.baseMaxPixels).toBe(50);
  });

  it('provides correct thresholds at boundary zoom levels', () => {
    // Test exact boundary values based on the implementation:
    // zoom < 3: max 15, zoom < 4: max 20, zoom < 6: max 30, else: max 50
    expect(getZoomPixelConstraints(3).baseMaxPixels).toBe(20); // zoom < 4
    expect(getZoomPixelConstraints(6).baseMaxPixels).toBe(50); // zoom >= 6
  });
});

