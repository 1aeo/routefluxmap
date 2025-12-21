/**
 * Layer factories barrel export
 * 
 * Import layer factories from this file:
 * import { createRelayLayer, createFocusRingLayer } from '@/lib/layers';
 */

export { createRelayLayer } from './createRelayLayer';
export type { CreateRelayLayerOptions } from './createRelayLayer';

export {
  createFocusRingLayer,
  FOCUS_RING_COLOR,
  FOCUS_RING_RADIUS_PX,
  FOCUS_RING_LINE_WIDTH,
} from './createFocusRingLayer';
export type { CreateFocusRingLayerOptions } from './createFocusRingLayer';

