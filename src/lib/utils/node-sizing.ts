/**
 * Node Sizing Utilities
 * 
 * Sizes relay nodes by count (number of relays at that location).
 * Uses square root scaling for perceptually accurate area comparison.
 */

import type { AggregatedNode } from '../types';
import { config } from '../config';

/**
 * Cap for relay count normalization.
 * Data centers can have 500-1000+ relays at one location.
 * Capping at 400 provides good visual differentiation:
 * - 90 relays → 47% of range
 * - 200 relays → 71% of range  
 * - 400+ relays → max size
 */
const RELAY_COUNT_CAP = 400;

// Pre-compute for efficiency
const SQRT_CAP = Math.sqrt(RELAY_COUNT_CAP);
const RADIUS_RANGE = config.nodeRadius.max - config.nodeRadius.min;

/**
 * Calculate the display radius for a relay node marker.
 * 
 * Uses square root scaling: 4x relays = 4x area = 2x radius
 */
export function calculateNodeRadius(node: AggregatedNode): number {
  const relayCount = node.relays.length;

  // Single relay = minimum size
  if (relayCount <= 1) {
    return config.nodeRadius.min;
  }

  // Cap and normalize using square root scaling
  const cappedCount = Math.min(relayCount, RELAY_COUNT_CAP);
  const normalized = Math.sqrt(cappedCount) / SQRT_CAP;

  return config.nodeRadius.min + RADIUS_RANGE * normalized;
}

