/**
 * Node Sizing Utilities
 * Extracted from TorMap.tsx for testability and reusability
 */

import type { AggregatedNode } from '../types';
import { config } from '../config';

/**
 * Configuration for node radius calculation
 */
export interface NodeRadiusConfig {
  minRadius: number;
  maxRadius: number;
}

/**
 * Calculate the display radius for a relay node marker
 *
 * Uses a combination of relay count (cluster density) and bandwidth
 * to determine visual size. At lower zoom levels, relay count is
 * emphasized more to highlight "major hubs".
 *
 * @param node - The aggregated node containing relay data
 * @param zoom - Current map zoom level
 * @param maxRelayCount - Maximum relay count across all nodes (for normalization)
 * @param maxBandwidth - Maximum bandwidth across all nodes (for normalization)
 * @param radiusConfig - Optional min/max radius configuration
 * @returns The calculated radius in pixels
 */
export function calculateNodeRadius(
  node: AggregatedNode,
  zoom: number,
  maxRelayCount: number,
  maxBandwidth: number,
  radiusConfig: NodeRadiusConfig = {
    minRadius: config.nodeRadius.min,
    maxRadius: config.nodeRadius.max,
  }
): number {
  const { minRadius, maxRadius } = radiusConfig;

  // Use log scale for relay count to handle large differences
  // More aggressive scaling for clusters
  const relayCount = node.relays.length;
  const countNormalized =
    Math.log(1 + relayCount * 2) / Math.log(1 + maxRelayCount * 2);

  // Also factor in bandwidth (secondary)
  const bwNormalized = node.bandwidth / (maxBandwidth || 1);

  // Combine: count (density) vs bandwidth
  // At lower zooms, emphasize count more to show "major hubs"
  const zoomFactor = Math.max(0, 1 - (zoom - 1) / 4); // 1.0 at zoom 1, 0.0 at zoom 5
  const countWeight = 0.8 + zoomFactor * 0.15; // 0.95 at zoom 1, 0.8 at zoom 5
  const bwWeight = 1 - countWeight;

  const combined =
    countNormalized * countWeight + Math.sqrt(bwNormalized) * bwWeight;

  // Apply non-linear scaling for better visual differentiation
  // Exponent: higher = smaller dots for low values
  // At zoom 1-2, we want high differentiation
  const exponent = zoom < 3 ? 0.9 : 0.7;
  const radius = minRadius + (maxRadius - minRadius) * Math.pow(combined, exponent);

  return radius;
}

/**
 * Calculate zoom-based scaling factor for node markers
 *
 * @param zoom - Current map zoom level
 * @returns Scale factor for radius
 */
export function calculateZoomScale(zoom: number): number {
  // At zoom 3, scale = 1. At zoom 10, scale = ~4
  return Math.pow(1.2, zoom - 3);
}

/**
 * Get min/max pixel constraints based on zoom level
 *
 * @param zoom - Current map zoom level
 * @returns Object with baseMinPixels and baseMaxPixels
 */
export function getZoomPixelConstraints(zoom: number): {
  baseMinPixels: number;
  baseMaxPixels: number;
} {
  // At zoom 1-2: min 2, max 15 (reduced max to avoid clutter)
  const baseMinPixels = zoom < 4 ? 2 : zoom < 6 ? 3 : 4;
  const baseMaxPixels = zoom < 3 ? 15 : zoom < 4 ? 20 : zoom < 6 ? 30 : 50;

  return { baseMinPixels, baseMaxPixels };
}


