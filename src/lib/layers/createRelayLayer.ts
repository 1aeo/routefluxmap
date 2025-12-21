/**
 * createRelayLayer - Factory for relay marker ScatterplotLayer
 * 
 * Creates a Deck.gl ScatterplotLayer for relay node markers with:
 * - Color by relay type (exit/guard/middle)
 * - Size by bandwidth
 * - Configurable opacity and sizing
 */

import { ScatterplotLayer } from '@deck.gl/layers';
import type { PickingInfo } from '@deck.gl/core';
import type { AggregatedNode } from '../types';
import { config } from '../config';
import { calculateNodeRadius } from '../utils/node-sizing';

export interface CreateRelayLayerOptions {
  /** Relay nodes to display */
  nodes: AggregatedNode[];
  /** Whether layer is visible */
  visible: boolean;
  /** Opacity multiplier (0-1) */
  opacity?: number;
  /** Relay size scale (0-1, 0.5 = 1x) */
  sizeScale?: number;
  /** Click handler */
  onClick?: (info: PickingInfo) => boolean | void;
  /** Hover handler */
  onHover?: (info: PickingInfo) => void;
}

/**
 * Create a ScatterplotLayer for relay nodes
 */
export function createRelayLayer(options: CreateRelayLayerOptions): ScatterplotLayer<AggregatedNode> | null {
  const {
    nodes,
    visible,
    opacity = 1,
    sizeScale = 0.5,
    onClick,
    onHover,
  } = options;

  if (!visible || nodes.length === 0) {
    return null;
  }

  return new ScatterplotLayer<AggregatedNode>({
    id: 'relays',
    data: nodes,
    pickable: true,
    opacity: 0.85 * opacity,
    stroked: true,
    filled: true,
    // Use pixel units so getRadius returns actual screen pixels
    radiusUnits: 'pixels',
    radiusScale: 1,
    radiusMinPixels: 0,
    radiusMaxPixels: Infinity,
    lineWidthMinPixels: 1,
    getPosition: (d: AggregatedNode) => [d.lng, d.lat],
    getRadius: (d: AggregatedNode) => calculateNodeRadius(d) * (sizeScale * 1.2),
    getFillColor: (d: AggregatedNode) => {
      // Color by majority relay type at this location
      let exits = 0, guards = 0, middles = 0;
      for (const r of d.relays) {
        if (r.flags.includes('E')) exits++;
        else if (r.flags.includes('G')) guards++;
        else middles++;
      }
      if (exits >= guards && exits >= middles) return config.relayColors.exit;
      if (guards >= middles) return config.relayColors.guard;
      return config.relayColors.middle;
    },
    getLineColor: [0, 255, 136, Math.round(100 * opacity)], // Green outline with transition opacity
    onClick,
    onHover,
    updateTriggers: {
      getFillColor: [nodes],
      getRadius: [nodes, sizeScale],
      opacity: [opacity],
      getLineColor: [opacity],
    },
  });
}

