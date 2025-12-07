# Feature: Web Worker for Particle Generation

**Status:** Proposed  
**Priority:** Low-Medium  
**Complexity:** Medium  
**Reference:** TorFlow `public/javascripts/particles/particlesystem.js`

## Overview

Offload particle generation to a Web Worker to prevent UI freezing during initialization. Currently, RouteFluxMap generates particles on the main thread, which can cause brief stuttering when loading large particle counts (100K+).

## Problem Statement

### Current Behavior

```typescript
// Current: particle-system.ts runs on main thread
for (let i = 0; i < particleCount; i++) {
  this.particles.push(this.createParticle(i));  // Blocks UI
}
```

With 400,000 particles (TorFlow default), this loop can take 100-500ms, causing:
- Visible frame drops during initial load
- Frozen UI while generating particles
- Poor user experience on slower devices

### TorFlow's Solution

TorFlow uses a dedicated Web Worker that:
1. Runs particle generation off the main thread
2. Reports progress back to the UI
3. Transfers the ArrayBuffer (zero-copy) when complete

```javascript
// TorFlow: particlelayer.js
this._worker = new Worker('javascripts/particles/particlesystem.js');
this._worker.addEventListener('message', function(e) {
  switch (e.data.type) {
    case 'progress':
      self._loadingBar.update(e.data.progress);
      break;
    case 'complete':
      self._vertexBuffer.bufferData(new Float32Array(e.data.buffer));
      self._isReady = true;
      self._worker.terminate();
      break;
  }
});

this._worker.postMessage({
  type: 'start',
  spec: { offset: 0.10, count: 400000 },
  nodes: this._nodes
});
```

## Benefits

| Aspect | Current | With Web Worker |
|--------|---------|-----------------|
| Initial load | UI freezes ~200ms | Smooth, progressive |
| Progress feedback | None | Loading bar 0-100% |
| Node update | UI freezes | Background regeneration |
| Count change | UI freezes | Smooth transition |
| Memory | Direct allocation | Transferable ArrayBuffer |

## TorFlow Reference Implementation

### Worker Script (`particlesystem.js`)

```javascript
var worker = this;

(function() {
  'use strict';

  var _getProbabilisticNodeIndex = function(nodes) {
    var rnd = Math.random();
    var i = 0;
    while (i < nodes.length && rnd > nodes[i].normalized_bandwidth) {
      rnd -= nodes[i].normalized_bandwidth;
      i++;
    }
    return Math.min(i, nodes.length - 1);
  };

  var _getProbabilisticPair = function(nodes) {
    var MAX_TRIES = 500;
    var tries = 0;
    var source = _getProbabilisticNodeIndex(nodes);
    var dest = _getProbabilisticNodeIndex(nodes);
    while (source === dest) {
      dest = _getProbabilisticNodeIndex(nodes);
      tries++;
      if (tries === MAX_TRIES) {
        throw 'Cannot find destination';
      }
    }
    return { source: nodes[source], dest: nodes[dest] };
  };

  var _generateParticles = function(spec, nodes) {
    var PROGRESS_STEP = spec.count / 1000;  // Report every 0.1%
    var buffer = new Float32Array(spec.count * 8);
    var offset = spec.offset;

    for (var i = 0; i < spec.count; i++) {
      var pair = _getProbabilisticPair(nodes);
      var sign = Math.random() > 0.5 ? 1 : -1;
      var t0 = Math.random() / 2;
      var t1 = Math.random() / 2 + 0.5;
      
      // Particle data: 8 floats per particle
      buffer[i * 8] = pair.source.x;      // start.x
      buffer[i * 8 + 1] = pair.source.y;  // start.y
      buffer[i * 8 + 2] = pair.dest.x;    // end.x
      buffer[i * 8 + 3] = pair.dest.y;    // end.y
      buffer[i * 8 + 4] = t0;             // bezier t0
      buffer[i * 8 + 5] = sign * Math.random() * offset;  // offset0
      buffer[i * 8 + 6] = t1;             // bezier t1
      buffer[i * 8 + 7] = sign * Math.random() * offset;  // offset1
      
      // Report progress
      if ((i + 1) % PROGRESS_STEP === 0) {
        worker.postMessage({
          type: 'progress',
          progress: i / (spec.count - 1)
        });
      }
    }

    // Transfer buffer (zero-copy)
    worker.postMessage(
      { type: 'complete', buffer: buffer.buffer },
      [buffer.buffer]
    );
  };

  worker.addEventListener('message', function(e) {
    if (e.data.type === 'start') {
      _generateParticles(e.data.spec, e.data.nodes);
    }
  });
})();
```

### Main Thread Integration

```javascript
// In particle layer initialization
updateNodes: function(nodes, bandwidth) {
  // Show loading bar
  if (this._loadingBar) {
    this._loadingBar.cancel();
  }
  this._loadingBar = new LoadingBar();
  
  // Clear current state
  this.clear();
  
  // Terminate any existing worker
  if (this._worker) {
    this._worker.terminate();
  }
  
  // Create new worker
  this._worker = new Worker('javascripts/particles/particlesystem.js');
  this._worker.addEventListener('message', function(e) {
    switch (e.data.type) {
      case 'progress':
        self._loadingBar.update(e.data.progress);
        break;
      case 'complete':
        self._loadingBar = null;
        self._vertexBuffer.bufferData(new Float32Array(e.data.buffer));
        self._timestamp = Date.now();
        self._isReady = true;
        self._worker.terminate();
        self._worker = null;
        break;
    }
  });
  
  // Start generation
  this._worker.postMessage({
    type: 'start',
    spec: {
      offset: Config.particle_offset,
      count: this.getUnscaledParticleCount()
    },
    nodes: this._nodes
  });
}
```

## RouteFluxMap Implementation Plan

### File Structure

```
src/
├── lib/
│   └── particles/
│       ├── particle-system.ts      # Current implementation
│       └── particle-worker.ts      # New: Worker script
├── workers/
│   └── particle.worker.ts          # Alternative: bundled worker
```

### Worker Script

```typescript
// src/lib/particles/particle-worker.ts

interface NodeData {
  x: number;
  y: number;
  normalized_bandwidth: number;
}

interface GenerateMessage {
  type: 'start';
  nodes: NodeData[];
  count: number;
  offset: number;
  hiddenServiceProbability: number;
}

interface ProgressMessage {
  type: 'progress';
  progress: number;  // 0-1
}

interface CompleteMessage {
  type: 'complete';
  buffer: ArrayBuffer;
  isHiddenService: Uint8Array;  // Boolean array
}

const worker = self as unknown as Worker;

function getProbabilisticIndex(nodes: NodeData[]): number {
  let rnd = Math.random();
  let i = 0;
  while (i < nodes.length && rnd > nodes[i].normalized_bandwidth) {
    rnd -= nodes[i].normalized_bandwidth;
    i++;
  }
  return Math.min(i, nodes.length - 1);
}

function getPair(nodes: NodeData[]): [NodeData, NodeData] {
  const maxTries = 500;
  let tries = 0;
  let source = getProbabilisticIndex(nodes);
  let dest = getProbabilisticIndex(nodes);
  
  while (source === dest && tries < maxTries) {
    dest = getProbabilisticIndex(nodes);
    tries++;
  }
  
  return [nodes[source], nodes[dest]];
}

function generate(msg: GenerateMessage): void {
  const { nodes, count, offset, hiddenServiceProbability } = msg;
  const PROGRESS_STEP = Math.floor(count / 100);  // Report every 1%
  
  // 4 floats per particle: startX, startY, endX, endY
  const buffer = new Float32Array(count * 4);
  const isHiddenService = new Uint8Array(count);
  
  for (let i = 0; i < count; i++) {
    const [source, dest] = getPair(nodes);
    
    buffer[i * 4] = source.x;
    buffer[i * 4 + 1] = source.y;
    buffer[i * 4 + 2] = dest.x;
    buffer[i * 4 + 3] = dest.y;
    
    isHiddenService[i] = Math.random() < hiddenServiceProbability ? 1 : 0;
    
    if ((i + 1) % PROGRESS_STEP === 0) {
      worker.postMessage({
        type: 'progress',
        progress: (i + 1) / count
      } as ProgressMessage);
    }
  }
  
  // Transfer buffers (zero-copy)
  worker.postMessage(
    {
      type: 'complete',
      buffer: buffer.buffer,
      isHiddenService: isHiddenService.buffer
    } as CompleteMessage,
    [buffer.buffer, isHiddenService.buffer]
  );
}

worker.addEventListener('message', (e: MessageEvent<GenerateMessage>) => {
  if (e.data.type === 'start') {
    generate(e.data);
  }
});
```

### Hook for Main Thread

```typescript
// src/lib/particles/use-particle-worker.ts

import { useState, useEffect, useRef, useCallback } from 'react';
import type { AggregatedNode } from '../types';

interface ParticleWorkerOptions {
  nodes: AggregatedNode[];
  particleCount: number;
  offset: number;
  hiddenServiceProbability: number;
  onProgress?: (progress: number) => void;
}

interface ParticleBuffers {
  positions: Float32Array;
  isHiddenService: Uint8Array;
}

export function useParticleWorker({
  nodes,
  particleCount,
  offset,
  hiddenServiceProbability,
  onProgress,
}: ParticleWorkerOptions): ParticleBuffers | null {
  const [buffers, setBuffers] = useState<ParticleBuffers | null>(null);
  const workerRef = useRef<Worker | null>(null);
  
  useEffect(() => {
    if (!nodes || nodes.length < 2) {
      setBuffers(null);
      return;
    }
    
    // Create worker
    const worker = new Worker(
      new URL('./particle-worker.ts', import.meta.url),
      { type: 'module' }
    );
    workerRef.current = worker;
    
    worker.onmessage = (e) => {
      switch (e.data.type) {
        case 'progress':
          onProgress?.(e.data.progress);
          break;
        case 'complete':
          setBuffers({
            positions: new Float32Array(e.data.buffer),
            isHiddenService: new Uint8Array(e.data.isHiddenService),
          });
          worker.terminate();
          workerRef.current = null;
          break;
      }
    };
    
    // Prepare minimal node data (only what worker needs)
    const nodeData = nodes.map(n => ({
      x: n.x,
      y: n.y,
      normalized_bandwidth: n.normalized_bandwidth,
    }));
    
    // Start generation
    worker.postMessage({
      type: 'start',
      nodes: nodeData,
      count: particleCount,
      offset,
      hiddenServiceProbability,
    });
    
    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, [nodes, particleCount, offset, hiddenServiceProbability, onProgress]);
  
  return buffers;
}
```

### Loading Bar Component

```tsx
// src/components/ui/LoadingBar.tsx

interface LoadingBarProps {
  progress: number;  // 0-1
  label?: string;
}

export default function LoadingBar({ progress, label }: LoadingBarProps) {
  const percent = Math.round(progress * 100);
  
  return (
    <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50">
      <div className="bg-black/80 backdrop-blur-md rounded-lg px-4 py-2 border border-tor-green/20">
        <div className="flex items-center gap-3">
          <div className="w-32 h-1.5 bg-gray-700 rounded-full overflow-hidden">
            <div 
              className="h-full bg-tor-green transition-all duration-100"
              style={{ width: `${percent}%` }}
            />
          </div>
          <span className="text-tor-green text-xs">
            {label || 'Generating particles'} {percent}%
          </span>
        </div>
      </div>
    </div>
  );
}
```

## Integration with ParticleOverlay

```tsx
// Modified ParticleOverlay.tsx

export function useParticleLayer(props: ParticleOverlayProps): Layer[] | null {
  const [progress, setProgress] = useState<number | null>(null);
  
  // Use worker instead of synchronous generation
  const buffers = useParticleWorker({
    nodes: props.nodes,
    particleCount: props.particleCount,
    offset: props.offsetFactor,
    hiddenServiceProbability: props.hiddenServiceProbability,
    onProgress: setProgress,
  });
  
  // Show loading bar while generating
  useEffect(() => {
    if (buffers) {
      setProgress(null);  // Hide when complete
    }
  }, [buffers]);
  
  // ... rest of layer creation using buffers
  
  return (
    <>
      {progress !== null && <LoadingBar progress={progress} />}
      {/* Layers rendered using buffers */}
    </>
  );
}
```

## Performance Comparison

| Metric | Main Thread | Web Worker |
|--------|-------------|------------|
| 100K particles | ~50ms freeze | Smooth |
| 400K particles | ~200ms freeze | Smooth |
| 1M particles | ~500ms freeze | Smooth |
| Progress feedback | None | Real-time % |
| Interruptible | No | Yes (terminate) |

## Implementation Steps

1. [ ] Create `src/lib/particles/particle-worker.ts`
2. [ ] Configure bundler to handle workers (Vite/Astro)
3. [ ] Create `useParticleWorker` hook
4. [ ] Create `LoadingBar.tsx` component
5. [ ] Update `ParticleOverlay.tsx` to use worker
6. [ ] Add progress callback to particle generation
7. [ ] Test with various particle counts
8. [ ] Add fallback for browsers without Worker support

## Bundler Configuration (Vite)

```typescript
// vite.config.ts
export default defineConfig({
  worker: {
    format: 'es',
  },
});
```

## Browser Support

Web Workers are supported in all modern browsers:
- Chrome 4+
- Firefox 3.5+
- Safari 4+
- Edge 12+
- Mobile browsers: All modern

## Fallback

For environments without Worker support (unlikely but possible):

```typescript
function generateFallback(options: GenerateOptions): ParticleBuffers {
  // Run synchronously on main thread
  // Same algorithm as worker
}

const buffers = typeof Worker !== 'undefined'
  ? useParticleWorker(options)
  : generateFallback(options);
```

## Future Enhancements

- **Shared memory**: Use `SharedArrayBuffer` for even less overhead
- **WASM acceleration**: Move generation to WebAssembly for 10x speed
- **Streaming**: Start rendering as particles are generated
- **Worker pool**: Multiple workers for parallel generation
- **Cancellation**: Proper cancellation with `AbortController`

