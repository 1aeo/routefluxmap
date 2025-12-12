# Feature: Bezier Curve Path Offset

**Status:** Proposed  
**Priority:** Medium  
**Complexity:** High

## Overview

Replace straight-line particle paths with curved Bezier paths that arc over the globe. This creates a more visually appealing "great circle" effect where particles curve naturally between relay nodes, similar to flight path visualizations.

## Current Implementation

RouteFluxMap uses **straight-line interpolation** between source and destination:

```typescript
// Current: linear interpolation in getPositions()
const t = p.progress;
const lng = startLng + (endLng - startLng) * t;
const lat = p.startLat + (p.endLat - p.startLat) * t;
```

**Result**: Particles travel in straight lines on the Mercator projection.

## Proposed Approach

Use **spherical Bezier curve interpolation** with configurable offset:

1. Convert lat/lng coordinates to 3D points on unit sphere
2. Calculate control points perpendicular to the great circle path
3. Apply cubic Bezier interpolation on the sphere
4. Convert back to lat/lng for rendering

### Bezier Control Points

Each path uses 4 control points:
- **P1**: Source node position (on sphere)
- **P2**: First control point (offset from path midpoint)
- **P3**: Second control point (offset from path midpoint)  
- **P4**: Destination node position (on sphere)

### Particle Data Layout

Each particle stores additional curve parameters:

| Field | Description |
|-------|-------------|
| t0 | Position along path for P2 (0.0-0.5) |
| offset0 | Perpendicular offset magnitude for P2 |
| t1 | Position along path for P3 (0.5-1.0) |
| offset1 | Perpendicular offset magnitude for P3 |

The sign of offsets determines curve direction (left or right of path).

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

### Bezier Curves (Proposed)

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

Implement curve interpolation in a custom Deck.gl layer vertex shader:

**Pseudocode:**
```
function vertexShader(position, controlPoints, time):
    // Convert to spherical coordinates
    p1 = latLngToSphere(source)
    p4 = latLngToSphere(dest)
    
    // Calculate perpendicular vector
    perp = normalize(cross(p1, p4))
    
    // Build control points
    p2 = normalize(p1 + t0 * (p4 - p1) + offset0 * perp)
    p3 = normalize(p1 + t1 * (p4 - p1) - offset1 * perp)
    
    // Cubic Bezier on sphere
    t = animationProgress
    point = bezier(t, p1, p2, p3, p4)
    
    // Convert back to lat/lng
    return sphereToLatLng(point)
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

Calculate curved paths on CPU in the particle system:

**Pseudocode:**
```
function getPosition(particle, progress):
    // Calculate control points in lat/lng space
    perpAngle = atan2(endLat - startLat, endLng - startLng) + PI/2
    dist = distance(start, end)
    
    cp1 = start + t0 * (end - start) + offset0 * perpVector
    cp2 = start + t1 * (end - start) - offset1 * perpVector
    
    // Cubic Bezier interpolation
    return cubicBezier(progress, start, cp1, cp2, end)
```

**Pros:**
- Works with existing Deck.gl layers
- Easier to debug
- No WebGL expertise needed

**Cons:**
- More CPU overhead per frame
- Less smooth at low frame rates
- Mercator distortion (not true spherical)

### Option C: Pre-computed Path Lines

Render static curved LineLayer paths, particles travel along them:

**Pseudocode:**
```
function generateArcPath(start, end, segments = 32):
    path = []
    for i in 0..segments:
        t = i / segments
        point = bezierOnSphere(start, end, defaultParams, t)
        path.push(point)
    return path
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
2. Implement vertex shader with spherical math
3. Pass bezier params as vertex attributes
4. Animate with shader uniforms

## Configuration

Add to config and settings UI:

```typescript
// config.ts
particleOffset: {
  default: 0.10,
  min: 0.0001,
  max: 0.5,
}

// Settings panel slider: "Path Curve" 0-50%
```

## Math Reference

### Cubic Bezier Basis Functions

```
B1(t) = t³
B2(t) = 3t²(1-t)
B3(t) = 3t(1-t)²
B4(t) = (1-t)³
```

### Bezier Point Calculation

```
P(t) = P1·B1(t) + P2·B2(t) + P3·B3(t) + P4·B4(t)
```

### Spherical Interpolation (SLERP)

For true great-circle paths on a sphere:
1. Convert lat/lng to 3D unit vectors
2. Calculate angle between vectors: `ω = acos(dot(v1, v2))`
3. Interpolate: `v(t) = (sin((1-t)ω)/sin(ω))·v1 + (sin(tω)/sin(ω))·v2`
4. Convert back to lat/lng

## Implementation Steps

1. [ ] Add bezier params to Particle interface
2. [ ] Create `bezier-path.ts` utility module
3. [ ] Implement spherical/planar bezier functions
4. [ ] Modify particle generation to include curve params
5. [ ] Update `getPositions()` to use bezier interpolation
6. [ ] Add "Path Curve" slider to Settings panel
7. [ ] Wire up offset factor to particle system
8. [ ] Test with various offset values
9. [ ] (Optional) Port to custom WebGL layer for GPU acceleration

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

## Reference

Inspired by [TorFlow](https://github.com/unchartedsoftware/torflow)'s curved path visualization.
