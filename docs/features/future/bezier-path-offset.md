# Feature: Bezier Curve Path Offset

**Status:** Proposed  
**Priority:** Medium  
**Complexity:** High  
**Reference:** TorFlow `public/shaders/particle.vert`, `public/javascripts/layers/particlelayer.js`

## Overview

Replace straight-line particle paths with curved Bezier paths that arc over the globe. This creates a more visually appealing "great circle" effect where particles curve naturally between relay nodes, similar to flight path visualizations.

## Current Implementation

RouteFluxMap uses **straight-line interpolation** between source and destination:

```typescript
// Current: particle-system.ts
getPositions(): ParticleState[] {
  return this.particles.map(p => {
    // Handle Pacific wrap-around
    let startLng = p.startLng;
    let endLng = p.endLng;
    
    const diff = endLng - startLng;
    if (diff > 180) endLng -= 360;
    else if (diff < -180) endLng += 360;
    
    // Simple linear interpolation
    const t = p.progress;
    let lng = startLng + (endLng - startLng) * t;
    const lat = p.startLat + (p.endLat - p.startLat) * t;
    
    return { lng, lat, isHiddenService: p.isHiddenService };
  });
}
```

**Result**: Particles travel in straight lines on the Mercator projection.

## TorFlow Implementation

TorFlow uses **spherical Bezier curve interpolation** with configurable offset:

### Vertex Shader (`particle.vert`)

```glsl
// Convert normalized xy to 3D point on unit sphere
vec3 xyToSphere(vec2 xy) {
  float xn = mod(xy.x, 1.0);
  if (xn < 0.0) xn += 1.0;
  vec2 ll = vec2((xn - 0.5) * PI * 2.0, (xy.y - 0.5) * PI);
  float x = sin(ll.x + PI / 2.0) * cos(ll.y);
  float y = sin(ll.y);
  float back = (xn > 0.5) ? 1.0 : -1.0;
  return vec3(x, y, back * sqrt(1.0 - x*x - y*y));
}

// Convert 3D sphere point back to normalized xy
vec2 sphereToXY(vec3 s) {
  return vec2(
    -atan(s.z, -s.x) / (2.0 * PI),
    0.5 + atan(s.y, sqrt(s.x*s.x + s.z*s.z)) / PI
  );
}

// Bezier basis functions
float B1(float t) { return t*t*t; }
float B2(float t) { return 3.0*t*t*(1.0-t); }
float B3(float t) { return 3.0*t*(1.0-t)*(1.0-t); }
float B4(float t) { return (1.0-t)*(1.0-t)*(1.0-t); }

// Bezier interpolation on sphere
vec3 getBezier3(float t, vec3 C1, vec3 C2, vec3 C3, vec3 C4) {
  return normalize(vec3(
    C1.x*B1(t) + C2.x*B2(t) + C3.x*B3(t) + C4.x*B4(t),
    C1.y*B1(t) + C2.y*B2(t) + C3.y*B3(t) + C4.y*B4(t),
    C1.z*B1(t) + C2.z*B2(t) + C3.z*B3(t) + C4.z*B4(t)
  ));
}

vec2 sphereInterp(vec2 startPos, vec2 endPos, vec4 aOffsets, float uOffsetFactor, float uSpeedFactor) {
  // Get spherical points on unit sphere
  vec3 s1 = xyToSphere(startPos);
  vec3 s4 = xyToSphere(endPos);

  // Distance on sphere (arc length)
  vec3 sdiff = s4 - s1;
  float sdist = acos(dot(s1, s4)) / PI;

  // Perpendicular vector for curve offset
  vec3 sperp = normalize(cross(s1, s4));

  // Bezier control points from attributes
  float t0 = aOffsets.x;      // Position along path (0-0.5)
  float t1 = aOffsets.z;      // Position along path (0.5-1.0)
  float offset0 = aOffsets.y * sdist * uOffsetFactor;  // Curve magnitude
  float offset1 = aOffsets.w * sdist * uOffsetFactor;  // Curve magnitude

  // Build control points on sphere
  vec3 s2 = normalize(s1 + (t0 * sdiff + offset0 * sperp));
  vec3 s3 = normalize(s1 + (t1 * sdiff + offset1 * -sperp));

  // Randomize animation timing
  float r0 = rand(vec2(s1.x, s2.y));
  float r1 = rand(vec2(s1.y, s2.x));

  float nSpeed = (uSpeedFactor + uSpeedFactor * r1) * sdist;
  float tOffset = r0 * nSpeed;
  float t = mod(uTime + tOffset, nSpeed) / nSpeed;

  // Get position along curved path
  vec3 spos = getBezier3(t, s1, s2, s3, s4);
  return sphereToXY(spos);
}
```

### Particle Data Layout

Each particle stores 8 floats:
```
[startX, startY, endX, endY, t0, offset0, t1, offset1]
```

Where:
- `t0`, `t1`: Control point positions (0.0-0.5 and 0.5-1.0)
- `offset0`, `offset1`: How far control points deviate from straight line

### Generation (in Web Worker)

```javascript
for (var i = 0; i < spec.count; i++) {
  var pair = _getProbabilisticPair(nodes);
  var sign = Math.random() > 0.5 ? 1 : -1;  // Curve left or right
  var t0 = Math.random() / 2;               // 0.0 - 0.5
  var t1 = Math.random() / 2 + 0.5;         // 0.5 - 1.0
  
  buffer[i * 8] = pair.source.x;
  buffer[i * 8 + 1] = pair.source.y;
  buffer[i * 8 + 2] = pair.dest.x;
  buffer[i * 8 + 3] = pair.dest.y;
  buffer[i * 8 + 4] = t0;
  buffer[i * 8 + 5] = sign * Math.random() * offset;  // Random curve amount
  buffer[i * 8 + 6] = t1;
  buffer[i * 8 + 7] = sign * Math.random() * offset;  // Same sign = S-curve
}
```

### Configurable Offset

TorFlow allows runtime adjustment of path curvature:

```javascript
// config.js
particle_offset: 0.10,      // Default offset
particle_min_offset: 0.0001,
particle_max_offset: 4.0,

// UI slider updates the uniform
this._shader.setUniform('uOffsetFactor', this.getPathOffset());
```

## Visual Comparison

### Straight Lines (Current)
```
                    ○ Dest
                   /
                  /
                 /
                /
               /
   Source ○───/
```

### Bezier Curves (TorFlow)
```
                    ○ Dest
                 .-'
               .'
             .'
           .'
   Source ○
```

### With High Offset
```
                         ○ Dest
                    _.--'
               _.--'
          _.--'
   Source ○
```

## Implementation Options

### Option A: GPU-based (WebGL Shader)

Port TorFlow's shader to Deck.gl custom layer:

```typescript
// Custom Deck.gl layer with vertex shader
class BezierParticleLayer extends Layer {
  getShaders() {
    return {
      vs: BEZIER_PARTICLE_VS,  // Port TorFlow shader
      fs: PARTICLE_FS,
    };
  }
  
  draw(opts) {
    this.state.model.setUniforms({
      uTime: performance.now() / 1000,
      uOffsetFactor: this.props.offsetFactor,
      // ...
    });
    this.state.model.draw(opts.renderPass);
  }
}
```

**Pros:**
- Smooth curves with minimal CPU overhead
- Animates on GPU (60fps)
- True spherical interpolation

**Cons:**
- Complex WebGL/luma.gl setup
- Harder to debug
- Deck.gl integration challenges

### Option B: CPU-based Approximation

Calculate curved paths on CPU with line segments:

```typescript
// src/lib/particles/bezier-path.ts

interface BezierParams {
  t0: number;
  offset0: number;
  t1: number;
  offset1: number;
}

function slerp(p1: [number, number], p2: [number, number], t: number): [number, number] {
  // Spherical linear interpolation
  const lat1 = p1[1] * Math.PI / 180;
  const lat2 = p2[1] * Math.PI / 180;
  const lng1 = p1[0] * Math.PI / 180;
  const lng2 = p2[0] * Math.PI / 180;
  
  // Convert to 3D
  const x1 = Math.cos(lat1) * Math.cos(lng1);
  const y1 = Math.cos(lat1) * Math.sin(lng1);
  const z1 = Math.sin(lat1);
  
  const x2 = Math.cos(lat2) * Math.cos(lng2);
  const y2 = Math.cos(lat2) * Math.sin(lng2);
  const z2 = Math.sin(lat2);
  
  // Spherical interpolation
  const dot = x1*x2 + y1*y2 + z1*z2;
  const omega = Math.acos(Math.max(-1, Math.min(1, dot)));
  const sinOmega = Math.sin(omega);
  
  if (Math.abs(sinOmega) < 0.0001) {
    // Points are nearly identical
    return [p1[0] + (p2[0] - p1[0]) * t, p1[1] + (p2[1] - p1[1]) * t];
  }
  
  const a = Math.sin((1 - t) * omega) / sinOmega;
  const b = Math.sin(t * omega) / sinOmega;
  
  const x = a * x1 + b * x2;
  const y = a * y1 + b * y2;
  const z = a * z1 + b * z2;
  
  // Convert back to lat/lng
  const lat = Math.atan2(z, Math.sqrt(x*x + y*y)) * 180 / Math.PI;
  const lng = Math.atan2(y, x) * 180 / Math.PI;
  
  return [lng, lat];
}

function bezierOnSphere(
  start: [number, number],
  end: [number, number],
  params: BezierParams,
  t: number
): [number, number] {
  // Calculate control points
  const perpAngle = Math.atan2(end[1] - start[1], end[0] - start[0]) + Math.PI / 2;
  const dist = Math.sqrt(
    Math.pow(end[0] - start[0], 2) + Math.pow(end[1] - start[1], 2)
  );
  
  const cp1: [number, number] = [
    start[0] + (end[0] - start[0]) * params.t0 + Math.cos(perpAngle) * params.offset0 * dist,
    start[1] + (end[1] - start[1]) * params.t0 + Math.sin(perpAngle) * params.offset0 * dist,
  ];
  
  const cp2: [number, number] = [
    start[0] + (end[0] - start[0]) * params.t1 - Math.cos(perpAngle) * params.offset1 * dist,
    start[1] + (end[1] - start[1]) * params.t1 - Math.sin(perpAngle) * params.offset1 * dist,
  ];
  
  // Cubic Bezier
  const u = 1 - t;
  const tt = t * t;
  const uu = u * u;
  const uuu = uu * u;
  const ttt = tt * t;
  
  return [
    uuu * start[0] + 3 * uu * t * cp1[0] + 3 * u * tt * cp2[0] + ttt * end[0],
    uuu * start[1] + 3 * uu * t * cp1[1] + 3 * u * tt * cp2[1] + ttt * end[1],
  ];
}
```

**Pros:**
- Works with existing Deck.gl layers
- Easier to debug
- No WebGL expertise needed

**Cons:**
- More CPU overhead
- Less smooth at low frame rates
- Mercator distortion (not true spherical)

### Option C: Pre-computed Path Lines

Render static curved LineLayer paths, particles travel along them:

```typescript
// Generate curved path as line segments
function generateArcPath(
  start: [number, number],
  end: [number, number],
  segments: number = 32
): [number, number][] {
  const path: [number, number][] = [];
  
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const point = bezierOnSphere(start, end, defaultParams, t);
    path.push(point);
  }
  
  return path;
}

// Render with PathLayer
new PathLayer({
  id: 'arc-paths',
  data: paths,
  getPath: d => d,
  getWidth: 1,
  getColor: [0, 255, 136, 50],
  widthMinPixels: 1,
});
```

**Pros:**
- Simplest implementation
- Static paths are efficient
- Clear visual effect

**Cons:**
- Particles don't follow curves (visual disconnect)
- More GPU memory for path geometry

## Recommended Approach

Start with **Option B (CPU-based)** for simplicity, then migrate to **Option A (GPU)** if performance allows.

### Phase 1: CPU Bezier

1. Add bezier calculation to `particle-system.ts`
2. Store bezier params per particle (t0, offset0, t1, offset1)
3. Calculate curved position in `getPositions()`
4. Add offset slider to Settings panel

### Phase 2: GPU Migration (Optional)

1. Create custom Deck.gl layer
2. Port TorFlow shader code
3. Pass bezier params as vertex attributes
4. Animate with shader uniforms

## Configuration

Add to config and settings UI:

```typescript
// config.ts
particleOffset: {
  default: 0.10,
  min: 0.0001,
  max: 0.5,      // Keep reasonable for Mercator
},

// Settings panel slider
<div className="mb-3">
  <div className="flex justify-between text-[10px] text-gray-400 mb-1">
    <span>Path Curve</span>
    <span>{(pathOffset * 100).toFixed(0)}%</span>
  </div>
  <input
    type="range"
    min="0"
    max="0.5"
    step="0.01"
    value={pathOffset}
    onChange={(e) => setPathOffset(parseFloat(e.target.value))}
    className="w-full h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-tor-green"
  />
</div>
```

## Implementation Steps

1. [ ] Add bezier params to Particle interface
2. [ ] Create `bezier-path.ts` utility module
3. [ ] Modify particle generation to include curve params
4. [ ] Update `getPositions()` to use bezier interpolation
5. [ ] Add "Path Curve" slider to Settings panel
6. [ ] Wire up offset factor to particle system
7. [ ] Test with various offset values
8. [ ] (Optional) Port to custom WebGL layer for GPU acceleration

## Files to Modify/Create

- `src/lib/particles/particle-system.ts` - Add bezier support
- `src/lib/particles/bezier-path.ts` - Curve calculations (new)
- `src/components/map/TorMap.tsx` - Add offset state and slider
- `src/lib/config.ts` - Add offset config values

## Future Enhancements

- True spherical great-circle interpolation
- Variable curve per path (based on distance)
- GPU shader implementation for performance
- Different curve styles (arc, S-curve, etc.)
- Animate curve offset over time for visual effect

