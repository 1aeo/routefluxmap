import { describe, it, expect } from 'vitest';
import { calculateNodeRadius } from '../../src/lib/utils/node-sizing';
import type { AggregatedNode, RelayInfo } from '../../src/lib/types';

// Helper to create a mock node for testing
function createMockNode(relayCount: number): AggregatedNode {
  const relays: RelayInfo[] = Array(relayCount)
    .fill(null)
    .map((_, i) => ({
      nickname: `Relay${i}`,
      fingerprint: `FP${i}`,
      bandwidth: 1000,
      flags: 'M',
      ip: '127.0.0.1',
      port: '9001',
    }));

  return {
    lat: 0,
    lng: 0,
    x: 0.5,
    y: 0.5,
    bandwidth: relayCount * 1000,
    selectionWeight: 0.5,
    label: `Test Node (${relayCount} relays)`,
    relays,
  };
}

describe('calculateNodeRadius', () => {
  it('returns minimum radius for single-relay nodes', () => {
    const radius = calculateNodeRadius(createMockNode(1));
    expect(radius).toBe(4); // config.nodeRadius.min
  });

  it('returns larger radius for nodes with more relays', () => {
    const smallRadius = calculateNodeRadius(createMockNode(1));
    const largeRadius = calculateNodeRadius(createMockNode(50));
    expect(largeRadius).toBeGreaterThan(smallRadius);
  });

  it('ignores bandwidth - same relay count = same radius', () => {
    // Create two nodes with same relay count but different bandwidth
    const node1 = createMockNode(10);
    const node2 = createMockNode(10);
    node2.bandwidth = 1_000_000; // Different bandwidth

    expect(calculateNodeRadius(node1)).toBe(calculateNodeRadius(node2));
  });

  it('caps large relay counts to prevent outlier compression', () => {
    // Locations with 400+ relays should all get the same (max) radius
    const radius400 = calculateNodeRadius(createMockNode(400));
    const radius600 = calculateNodeRadius(createMockNode(600));
    const radius1000 = calculateNodeRadius(createMockNode(1000));

    expect(radius400).toBe(22); // config.nodeRadius.max
    expect(radius600).toBe(22);
    expect(radius1000).toBe(22);
  });

  it('uses square root scaling - 4x relays = 2x radius increase', () => {
    const radius4 = calculateNodeRadius(createMockNode(4));
    const radius16 = calculateNodeRadius(createMockNode(16));

    // (radius16 - min) / (radius4 - min) should be ~2
    const minRadius = 4;
    const ratio = (radius16 - minRadius) / (radius4 - minRadius);
    expect(ratio).toBeCloseTo(2, 0);
  });
});

