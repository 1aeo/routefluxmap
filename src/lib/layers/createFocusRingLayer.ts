/**
 * createFocusRingLayer - Factory for relay focus highlight
 * 
 * Creates a ScatterplotLayer that displays a yellow ring around
 * a focused relay (from search results).
 */

import { ScatterplotLayer } from '@deck.gl/layers';
import type { AggregatedNode } from '../types';

/** Focus ring color (yellow) */
const FOCUS_RING_COLOR: [number, number, number, number] = [255, 255, 0, 200];

/** Focus ring radius in pixels */
const FOCUS_RING_RADIUS_PX = 24;

/** Focus ring line width */
const FOCUS_RING_LINE_WIDTH = 3;

export interface CreateFocusRingLayerOptions {
  /** The focused node to highlight (null for no ring) */
  focusedNode: AggregatedNode | null;
}

/**
 * Create a ScatterplotLayer for the focus ring highlight
 */
export function createFocusRingLayer(
  options: CreateFocusRingLayerOptions
): ScatterplotLayer<AggregatedNode> | null {
  const { focusedNode } = options;

  if (!focusedNode) {
    return null;
  }

  return new ScatterplotLayer<AggregatedNode>({
    id: 'relay-focus-ring',
    data: [focusedNode],
    pickable: false,
    filled: false,
    stroked: true,
    radiusUnits: 'pixels',
    getPosition: (d: AggregatedNode) => [d.lng, d.lat],
    getRadius: FOCUS_RING_RADIUS_PX,
    getLineColor: FOCUS_RING_COLOR,
    lineWidthMinPixels: FOCUS_RING_LINE_WIDTH,
    updateTriggers: {
      data: [focusedNode],
    },
  });
}

// Export constants for external use
export { FOCUS_RING_COLOR, FOCUS_RING_RADIUS_PX, FOCUS_RING_LINE_WIDTH };

