/**
 * Web Worker for Particle Generation
 * 
 * Offloads particle initialization to a background thread to prevent
 * UI freezing during generation of 50k+ particles.
 * 
 * Uses binary search (O(log n)) for probabilistic node selection,
 * matching the main thread optimization.
 */

// Worker context
const worker = self as unknown as Worker;

// Types for worker messages
interface NodeData {
  lng: number;
  lat: number;
  normalized_bandwidth: number;
}

interface GenerateMessage {
  type: 'start';
  nodes: NodeData[];
  count: number;
  hiddenServiceProbability: number;
  baseSpeed: number;
}

interface ProgressMessage {
  type: 'progress';
  progress: number; // 0-1
}

interface CompleteMessage {
  type: 'complete';
  particles: ArrayBuffer; // Float32Array: [startLng, startLat, endLng, endLat, progress, speed] per particle
  isHiddenService: ArrayBuffer; // Uint8Array: boolean flags
}

// Pre-computed cumulative probability array for O(log n) binary search
let cumulativeProbs: number[] = [];

/**
 * Build cumulative probability array for binary search.
 * Called once per generation request.
 */
function buildCumulativeProbs(nodes: NodeData[]): void {
  let sum = 0;
  cumulativeProbs = nodes.map(n => {
    sum += n.normalized_bandwidth;
    return sum;
  });
}

/**
 * O(log n) binary search for probabilistic node selection.
 */
function getProbabilisticIndex(nodes: NodeData[]): number {
  if (cumulativeProbs.length === 0) return 0;
  
  const total = cumulativeProbs[cumulativeProbs.length - 1];
  const rnd = Math.random() * total;
  
  let left = 0;
  let right = cumulativeProbs.length - 1;
  
  while (left < right) {
    const mid = (left + right) >>> 1;
    if (cumulativeProbs[mid] < rnd) {
      left = mid + 1;
    } else {
      right = mid;
    }
  }
  
  return Math.min(left, nodes.length - 1);
}

/**
 * Get source/dest pair (must be different nodes).
 */
function getProbabilisticPair(nodes: NodeData[]): [NodeData, NodeData] {
  const maxTries = 500;
  let tries = 0;
  let sourceIdx = getProbabilisticIndex(nodes);
  let destIdx = getProbabilisticIndex(nodes);
  
  while (sourceIdx === destIdx && tries < maxTries) {
    destIdx = getProbabilisticIndex(nodes);
    tries++;
  }
  
  return [nodes[sourceIdx], nodes[destIdx]];
}

/**
 * Generate all particles and report progress.
 */
function generate(msg: GenerateMessage): void {
  const { nodes, count, hiddenServiceProbability, baseSpeed } = msg;
  
  if (!nodes || nodes.length < 2) {
    // Send empty result
    const emptyParticles = new Float32Array(0);
    const emptyFlags = new Uint8Array(0);
    worker.postMessage(
      { type: 'complete', particles: emptyParticles.buffer, isHiddenService: emptyFlags.buffer },
      [emptyParticles.buffer, emptyFlags.buffer]
    );
    return;
  }
  
  // Build cumulative probability array for binary search
  buildCumulativeProbs(nodes);
  
  const PROGRESS_STEP = Math.max(1, Math.floor(count / 100)); // Report every 1%
  
  // 6 floats per particle: startLng, startLat, endLng, endLat, progress, speed
  const particles = new Float32Array(count * 6);
  const isHiddenService = new Uint8Array(count);
  
  for (let i = 0; i < count; i++) {
    const [source, dest] = getProbabilisticPair(nodes);
    
    const offset = i * 6;
    particles[offset] = source.lng;
    particles[offset + 1] = source.lat;
    particles[offset + 2] = dest.lng;
    particles[offset + 3] = dest.lat;
    particles[offset + 4] = Math.random(); // progress: random start position
    particles[offset + 5] = baseSpeed * (0.8 + Math.random() * 0.4); // speed variation
    
    isHiddenService[i] = Math.random() < hiddenServiceProbability ? 1 : 0;
    
    // Report progress periodically
    if ((i + 1) % PROGRESS_STEP === 0) {
      worker.postMessage({
        type: 'progress',
        progress: (i + 1) / count,
      } as ProgressMessage);
    }
  }
  
  // Transfer buffers (zero-copy)
  worker.postMessage(
    {
      type: 'complete',
      particles: particles.buffer,
      isHiddenService: isHiddenService.buffer,
    } as CompleteMessage,
    [particles.buffer, isHiddenService.buffer]
  );
}

// Listen for generation requests
worker.addEventListener('message', (e: MessageEvent<GenerateMessage>) => {
  if (e.data.type === 'start') {
    generate(e.data);
  }
});

