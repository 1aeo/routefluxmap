/**
 * ParticleLayer - Custom Deck.gl layer for animated Tor traffic particles
 * 
 * Renders particles flowing between relay nodes using Bezier curves on a sphere.
 * Each particle travels from a randomly selected source node to destination node,
 * with selection probability weighted by bandwidth.
 */

import { Layer, project32, picking } from '@deck.gl/core';
import { Model, Geometry } from '@luma.gl/engine';
import type { LayerProps, UpdateParameters, LayerContext } from '@deck.gl/core';
import type { AggregatedNode } from '../../lib/types';

// Vertex shader for particle animation
const PARTICLE_VS = `#version 300 es
precision highp float;

in vec4 aPositions;  // start.xy, end.xy (normalized 0-1)
in vec4 aOffsets;    // t0, offset0, t1, offset1 (Bezier curve params)

uniform mat4 uProjectionMatrix;
uniform mat4 uViewMatrix;
uniform float uTime;
uniform float uPointSize;
uniform float uSpeedFactor;
uniform float uOffsetFactor;
uniform vec2 uViewportSize;

out float vAlpha;

const float PI = 3.141592654;

// Bezier basis functions
float B1(float t) { return t*t*t; }
float B2(float t) { return 3.0*t*t*(1.0-t); }
float B3(float t) { return 3.0*t*(1.0-t)*(1.0-t); }
float B4(float t) { return (1.0-t)*(1.0-t)*(1.0-t); }

// Pseudo-random number generator
float rand(vec2 co) {
  return fract(sin(dot(co.xy, vec2(12.9898, 78.233))) * 43758.5453);
}

// Convert normalized xy to 3D point on unit sphere
vec3 xyToSphere(vec2 xy) {
  float xn = mod(xy.x, 1.0);
  if (xn < 0.0) xn += 1.0;
  vec2 ll = vec2((xn - 0.5) * PI * 2.0, (xy.y - 0.5) * PI);
  float x = sin(ll.x + PI / 2.0) * cos(ll.y);
  float y = sin(ll.y);
  float back = (xn > 0.5) ? 1.0 : -1.0;
  return vec3(x, y, back * sqrt(max(0.0, 1.0 - x*x - y*y)));
}

// Convert 3D sphere point back to normalized xy
vec2 sphereToXY(vec3 s) {
  return vec2(
    -atan(s.z, -s.x) / (2.0 * PI),
    0.5 + atan(s.y, sqrt(s.x*s.x + s.z*s.z)) / PI
  );
}

// Bezier interpolation on sphere
vec3 getBezier3(float t, vec3 C1, vec3 C2, vec3 C3, vec3 C4) {
  return normalize(vec3(
    C1.x*B1(t) + C2.x*B2(t) + C3.x*B3(t) + C4.x*B4(t),
    C1.y*B1(t) + C2.y*B2(t) + C3.y*B3(t) + C4.y*B4(t),
    C1.z*B1(t) + C2.z*B2(t) + C3.z*B3(t) + C4.z*B4(t)
  ));
}

// Spherical interpolation with Bezier curve
vec2 sphereInterp(vec2 startPos, vec2 endPos, vec4 offsets, float offsetFactor, float speedFactor) {
  // Convert to spherical coordinates
  vec3 s1 = xyToSphere(startPos);
  vec3 s4 = xyToSphere(endPos);

  // Distance on sphere
  vec3 sdiff = s4 - s1;
  float sdist = acos(clamp(dot(s1, s4), -1.0, 1.0)) / PI;

  // Perpendicular vector for curve offset
  vec3 sperp = normalize(cross(s1, s4));
  
  // Handle edge case where points are the same or opposite
  if (length(sperp) < 0.001) {
    sperp = vec3(0.0, 1.0, 0.0);
  }

  // Bezier control point parameters
  float t0 = offsets.x;
  float t1 = offsets.z;
  float offset0 = offsets.y * sdist * offsetFactor;
  float offset1 = offsets.w * sdist * offsetFactor;

  // Build control points
  vec3 s2 = normalize(s1 + (t0 * sdiff + offset0 * sperp));
  vec3 s3 = normalize(s1 + (t1 * sdiff + offset1 * -sperp));

  // Time-based animation with random offset per particle
  float r0 = rand(vec2(s1.x, s2.y));
  float r1 = rand(vec2(s1.y, s2.x));

  float nSpeed = (speedFactor + speedFactor * r1) * sdist;
  float tOffset = r0 * nSpeed;
  float t = mod(uTime + tOffset, nSpeed) / nSpeed;

  // Get position along curve
  vec3 spos = getBezier3(t, s1, s2, s3, s4);
  return sphereToXY(spos);
}

void main() {
  vec2 startPos = aPositions.xy;
  vec2 endPos = aPositions.zw;

  // Handle wrapping around Pacific Ocean
  float a = endPos.x - startPos.x;
  if (startPos.x < 0.5 && endPos.x > 0.5) {
    float b = (1.0 - endPos.x) + startPos.x;
    if (a > b) endPos.x -= 1.0;
  } else if (startPos.x > 0.5 && endPos.x < 0.5) {
    float b = startPos.x - (1.0 + endPos.x);
    if (a < b) endPos.x += 1.0;
  }

  // Interpolate position
  vec2 pos = sphereInterp(startPos, endPos, aOffsets, uOffsetFactor, uSpeedFactor);

  // Convert from normalized [0,1] to longitude/latitude
  float lng = (pos.x - 0.5) * 360.0;
  float lat = (pos.y - 0.5) * 180.0;

  // Project to clip space (Deck.gl handles the projection matrix)
  vec4 worldPos = vec4(lng, lat, 0.0, 1.0);
  
  gl_Position = uProjectionMatrix * uViewMatrix * worldPos;
  gl_PointSize = uPointSize;
  
  // Fade based on position in animation cycle
  vAlpha = 1.0;
}
`;

// Fragment shader for particle rendering
const PARTICLE_FS = `#version 300 es
precision highp float;

uniform vec3 uColor;
uniform float uOpacity;

in float vAlpha;
out vec4 fragColor;

void main() {
  // Soft circular particle
  vec2 cxy = 2.0 * gl_PointCoord - 1.0;
  float r = dot(cxy, cxy);
  if (r > 1.0) discard;
  
  float alpha = uOpacity * vAlpha * (1.0 - sqrt(r));
  fragColor = vec4(uColor, alpha);
}
`;

export interface ParticleLayerProps extends LayerProps {
  nodes: AggregatedNode[];
  particleCount?: number;
  particleSize?: number;
  speedFactor?: number;
  offsetFactor?: number;
  color?: [number, number, number];
  opacity?: number;
  visible?: boolean;
}

interface ParticleData {
  positions: Float32Array;
  offsets: Float32Array;
  count: number;
}

// Default props
const defaultProps: Partial<ParticleLayerProps> = {
  particleCount: 100000,
  particleSize: 2,
  speedFactor: 1.0,
  offsetFactor: 0.1,
  color: [0, 255, 136],  // Tor green
  opacity: 0.6,
  visible: true,
};

/**
 * Build cumulative probability array for binary search
 */
function buildCumulativeProbs(nodes: AggregatedNode[]): number[] {
  let sum = 0;
  return nodes.map(n => {
    sum += n.normalized_bandwidth;
    return sum;
  });
}

/**
 * Get probabilistic node index using binary search (O(log n) instead of O(n))
 */
function getProbabilisticIndex(nodes: AggregatedNode[], cumulativeProbs: number[]): number {
  if (cumulativeProbs.length === 0) return 0;
  
  const total = cumulativeProbs[cumulativeProbs.length - 1];
  const rnd = Math.random() * total;
  
  // Binary search
  let left = 0;
  let right = cumulativeProbs.length - 1;
  
  while (left < right) {
    const mid = Math.floor((left + right) / 2);
    if (cumulativeProbs[mid] < rnd) {
      left = mid + 1;
    } else {
      right = mid;
    }
  }
  
  return Math.min(left, nodes.length - 1);
}

/**
 * Generate particle data from nodes
 * Creates source/dest pairs weighted by bandwidth
 */
function generateParticleData(nodes: AggregatedNode[], count: number, offset: number): ParticleData {
  if (!nodes || nodes.length < 2) {
    return { positions: new Float32Array(0), offsets: new Float32Array(0), count: 0 };
  }

  const positions = new Float32Array(count * 4);  // start.xy, end.xy
  const offsets = new Float32Array(count * 4);    // t0, offset0, t1, offset1

  // Pre-compute cumulative probabilities once for all selections
  const cumulativeProbs = buildCumulativeProbs(nodes);

  // Get a source/dest pair (must be different)
  const getPair = (): [AggregatedNode, AggregatedNode] => {
    const maxTries = 500;
    let tries = 0;
    let sourceIdx = getProbabilisticIndex(nodes, cumulativeProbs);
    let destIdx = getProbabilisticIndex(nodes, cumulativeProbs);
    while (sourceIdx === destIdx && tries < maxTries) {
      destIdx = getProbabilisticIndex(nodes, cumulativeProbs);
      tries++;
    }
    return [nodes[sourceIdx], nodes[destIdx]];
  };

  for (let i = 0; i < count; i++) {
    const [source, dest] = getPair();
    const sign = Math.random() > 0.5 ? 1 : -1;
    const t0 = Math.random() / 2;
    const t1 = Math.random() / 2 + 0.5;

    // Positions (normalized 0-1)
    positions[i * 4] = source.x;
    positions[i * 4 + 1] = source.y;
    positions[i * 4 + 2] = dest.x;
    positions[i * 4 + 3] = dest.y;

    // Bezier curve offsets
    offsets[i * 4] = t0;
    offsets[i * 4 + 1] = sign * Math.random() * offset;
    offsets[i * 4 + 2] = t1;
    offsets[i * 4 + 3] = sign * Math.random() * offset;
  }

  return { positions, offsets, count };
}

export default class ParticleLayer extends Layer<ParticleLayerProps> {
  static layerName = 'ParticleLayer';
  static defaultProps = defaultProps;

  state!: {
    model: Model | null;
    particleData: ParticleData | null;
    startTime: number;
  };

  getShaders() {
    return {
      vs: PARTICLE_VS,
      fs: PARTICLE_FS,
      modules: [project32, picking],
    };
  }

  initializeState(context: LayerContext) {
    const { gl } = context;
    
    this.setState({
      model: null,
      particleData: null,
      startTime: Date.now(),
    });

    // Generate initial particle data
    this._updateParticleData();
  }

  updateState(params: UpdateParameters<this>) {
    const { props, oldProps, changeFlags } = params;

    // Regenerate particles if nodes or count changed
    if (
      changeFlags.dataChanged ||
      props.nodes !== oldProps.nodes ||
      props.particleCount !== oldProps.particleCount ||
      props.offsetFactor !== oldProps.offsetFactor
    ) {
      this._updateParticleData();
    }

    // Rebuild model if needed
    if (changeFlags.extensionsChanged || !this.state.model) {
      this._buildModel(params.context);
    }
  }

  _updateParticleData() {
    const { nodes, particleCount = 100000, offsetFactor = 0.1 } = this.props;
    
    if (!nodes || nodes.length < 2) {
      this.setState({ particleData: null });
      return;
    }

    const particleData = generateParticleData(nodes, particleCount, offsetFactor);
    this.setState({ particleData });
  }

  _buildModel(context: LayerContext) {
    const { gl } = context;
    const { particleData } = this.state;

    if (!particleData || particleData.count === 0) {
      this.setState({ model: null });
      return;
    }

    // Create geometry with particle attributes
    const geometry = new Geometry({
      topology: 'point-list',
      vertexCount: particleData.count,
      attributes: {
        aPositions: { size: 4, value: particleData.positions },
        aOffsets: { size: 4, value: particleData.offsets },
      },
    });

    const shaders = this.getShaders();
    
    const model = new Model(gl, {
      ...shaders,
      id: `${this.props.id}-particles`,
      geometry,
      isInstanced: false,
    });

    this.setState({ model });
  }

  draw(opts: { uniforms: Record<string, unknown>; context: LayerContext }) {
    const { model, startTime } = this.state;
    const { visible, particleSize, speedFactor, offsetFactor, color, opacity } = this.props;

    if (!model || !visible) return;

    const { uniforms, context } = opts;
    const { viewport } = context;

    // Calculate elapsed time in seconds
    const elapsedMs = Date.now() - startTime;
    const elapsedSec = elapsedMs / 1000;

    // Normalize color to 0-1
    const normalizedColor = color!.map(c => c / 255);

    model.setUniforms({
      ...uniforms,
      uTime: elapsedSec,
      uPointSize: particleSize! * Math.max(1, viewport.zoom / 4),
      uSpeedFactor: speedFactor!,
      uOffsetFactor: offsetFactor!,
      uColor: normalizedColor,
      uOpacity: opacity!,
      uViewportSize: [viewport.width, viewport.height],
    });

    model.draw(context.renderPass);
  }

  // Request continuous redraw for animation
  shouldUpdateState() {
    return true;
  }
}


