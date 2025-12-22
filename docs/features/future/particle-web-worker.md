# Feature: Web Worker for Particle Generation

**Status:** ✅ Fully Implemented  
**Priority:** Low-Medium  
**Complexity:** Medium  
**Implementation:** `src/workers/particle-render.worker.ts`, `src/components/map/ParticleCanvas.tsx`

## Overview

Offload particle generation and rendering to a Web Worker using OffscreenCanvas. This provides:
- Zero UI blocking during particle generation
- GPU rendering on a separate thread
- Smooth 60fps animation independent of main thread

## Problem Statement

### Without Web Worker

Particle generation runs on the main thread:

```typescript
// Synchronous generation blocks UI
for (let i = 0; i < particleCount; i++) {
  this.particles.push(this.createParticle(i));  // Blocks UI
}
```

With 50,000+ particles, this loop can take 50-200ms, causing:
- Visible frame drops during initial load
- Frozen UI while generating particles
- Poor user experience on slower devices

### With Web Worker

Particle generation runs in a background thread:
- UI remains responsive during generation
- Progress bar shows generation status (0-100%)
- ArrayBuffer transfer (zero-copy) when complete

## Benefits

| Aspect | Without Worker | With Worker |
|--------|---------------|-------------|
| Initial load | UI freezes ~100ms | Smooth, progressive |
| Progress feedback | None | Loading bar 0-100% |
| Node update | UI freezes | Background regeneration |
| Count change | UI freezes | Smooth transition |
| Memory | Direct allocation | Transferable ArrayBuffer |

## Architecture

### Message Protocol

```typescript
// Worker Input Message
interface GenerateMessage {
  type: 'start';
  nodes: NodeData[];        // Minimal node data: {lng, lat, normalized_bandwidth}
  count: number;            // Number of particles to generate
  hiddenServiceProbability: number;
  baseSpeed: number;
}

// Worker Progress Message
interface ProgressMessage {
  type: 'progress';
  progress: number;         // 0-1 completion ratio
}

// Worker Complete Message
interface CompleteMessage {
  type: 'complete';
  particles: ArrayBuffer;   // Float32Array transferred
  isHiddenService: ArrayBuffer;  // Uint8Array transferred
}
```

### Buffer Layout

Each particle uses 6 floats (24 bytes):

| Offset | Field | Type |
|--------|-------|------|
| 0 | startLng | float32 |
| 1 | startLat | float32 |
| 2 | endLng | float32 |
| 3 | endLat | float32 |
| 4 | progress | float32 (0-1 random start) |
| 5 | speed | float32 (with variation) |

Hidden service flags use a separate `Uint8Array` (1 byte per particle).

### Progress Reporting

Worker reports progress every 1% of particles generated:

```
Progress step = max(1, floor(count / 100))
Report when (i + 1) % PROGRESS_STEP === 0
```

## Implementation

### File Structure

```
src/lib/particles/
├── particle-system.ts     # Main particle management
├── particle-worker.ts     # Web Worker script
└── use-particle-worker.ts # React hook for worker management
```

### Worker Script (`particle-worker.ts`)

Handles particle generation in background thread:
- Receives node data and generation parameters
- Uses binary search (O(log n)) for probabilistic node selection
- Reports progress at 1% intervals
- Transfers ArrayBuffers on completion (zero-copy)

### React Hook (`use-particle-worker.ts`)

```typescript
interface UseParticleWorkerResult {
  buffers: ParticleBuffers | null;  // Generated data
  progress: number | null;           // 0-1 during generation
  isGenerating: boolean;
  error: Error | null;
}
```

The hook:
- Creates/terminates workers on parameter changes
- Tracks generation progress
- Returns typed arrays for ParticleSystem initialization

### ParticleSystem Integration

```typescript
// Initialize from worker buffers
particleSystem.initializeFromBuffers(
  nodes,
  buffers.particles,
  buffers.isHiddenService,
  { hiddenServiceProbability, baseSpeed }
);
```

### Loading Bar Component

Displays generation progress:

```tsx
<LoadingBar progress={0.5} label="Generating particles" />
// Shows: "Generating particles 50%"
```

## Performance

| Particle Count | Main Thread | Web Worker |
|---------------|-------------|------------|
| 10K | ~10ms freeze | Smooth |
| 50K | ~50ms freeze | Smooth |
| 100K | ~100ms freeze | Smooth |
| 400K | ~400ms freeze | Smooth |

## Fallback

For environments without Worker support, a synchronous fallback is provided:

```typescript
import { generateParticlesSync } from './use-particle-worker';

// Falls back to main thread if Worker unavailable
const buffers = typeof Worker !== 'undefined'
  ? await workerGenerate(options)
  : generateParticlesSync(nodes, count, probability, speed);
```

## Browser Support

Web Workers are supported in all modern browsers:
- Chrome 4+
- Firefox 3.5+
- Safari 4+
- Edge 12+
- All modern mobile browsers

## Future Enhancements

- **SharedArrayBuffer**: Use shared memory for even less overhead
- **WASM acceleration**: Move generation to WebAssembly for 10x speed
- **Streaming**: Start rendering as particles are generated
- **Worker pool**: Multiple workers for parallel generation
- **Cancellation**: Proper cancellation with `AbortController`

## Reference

Inspired by [TorFlow](https://github.com/unchartedsoftware/torflow)'s approach to background particle generation.
