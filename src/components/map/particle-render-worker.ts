/**
 * Particle Render Worker
 * 
 * Handles both particle simulation AND rendering on a separate thread.
 * Uses OffscreenCanvas with WebGL for smooth 60fps animation independent
 * of the main thread's deck.gl picking operations.
 * 
 * Key features:
 * - Correct Web Mercator projection matching deck.gl exactly
 * - ViewState synchronization for pan/zoom
 * - Particle simulation and rendering in one thread
 */

// Worker context
const worker = self as unknown as Worker;

// Types
interface NodeData {
  lng: number;
  lat: number;
  normalized_bandwidth: number;
}

interface ParticleData {
  startLng: number;
  startLat: number;
  endLng: number;
  endLat: number;
  progress: number;
  speed: number;
  isHiddenService: number; // 0 or 1
}

interface ViewState {
  longitude: number;
  latitude: number;
  zoom: number;
  width: number;
  height: number;
}

interface InitMessage {
  type: 'init';
  canvas: OffscreenCanvas;
  nodes: NodeData[];
  particleCount: number;
  hiddenServiceProbability: number;
  baseSpeed: number;
  viewState: ViewState;
}

interface UpdateViewStateMessage {
  type: 'updateViewState';
  viewState: ViewState;
}

interface UpdateNodesMessage {
  type: 'updateNodes';
  nodes: NodeData[];
}

interface UpdateParticlesMessage {
  type: 'updateParticles';
  particleCount: number;
  hiddenServiceProbability: number;
  baseSpeed: number;
}

// Constants
const TILE_SIZE = 512; // deck.gl uses 512 as base tile size (not 256)
const PI = Math.PI;
const PI_2 = PI * 2;
const PI_4 = PI / 4;

// State
let canvas: OffscreenCanvas | null = null;
let ctx: OffscreenCanvasRenderingContext2D | null = null;
let nodes: NodeData[] = [];
let particles: ParticleData[] = [];
let viewState: ViewState | null = null;
let cumulativeProbs: number[] = [];
let animationFrameId: number | null = null;
let lastTime: number = 0;

// Colors (RGB 0-255)
const GENERAL_COLOR = [0, 255, 136]; // Green
const HIDDEN_COLOR = [255, 102, 0];  // Orange

/**
 * Web Mercator projection: convert lng/lat to world coordinates (0-1 range)
 * This matches deck.gl's internal projection exactly.
 * Reference: @math.gl/web-mercator
 * 
 * World coordinates:
 * - x: 0 = -180°, 1 = +180°
 * - y: 0 = north pole, 1 = south pole
 */
function lngLatToWorld(lng: number, lat: number): [number, number] {
  // Longitude: -180 to 180 -> 0 to 1
  const x = (lng + 180) / 360;
  
  // Latitude: Web Mercator formula
  // Standard formula: y = 0.5 - (1/(2π)) * ln(tan(π/4 + φ/2))
  // But deck.gl uses y=0 at north, y=1 at south, so we need:
  // y = 0.5 + (1/(2π)) * ln(tan(π/4 + φ/2))
  const latRad = lat * PI / 180;
  const mercN = Math.log(Math.tan(PI_4 + latRad / 2));
  // Flip sign: y increases downward (south) in world coords
  const y = 0.5 + mercN / PI_2;
  
  return [x, y];
}

/**
 * Convert world coordinates to screen pixel coordinates
 * This accounts for zoom, pan, and canvas size
 * Matches deck.gl's projection exactly
 * 
 * Formula matches @math.gl/web-mercator:
 * - Scale: TILE_SIZE * 2^zoom pixels per world unit
 * - Transform: translate by view center, then scale
 */
function worldToScreen(worldX: number, worldY: number, vs: ViewState): [number, number] {
  if (!vs) return [0, 0];
  
  // Calculate scale factor (pixels per world unit at current zoom)
  // deck.gl uses: scale = TILE_SIZE * 2^zoom
  const scale = TILE_SIZE * Math.pow(2, vs.zoom);
  
  // Convert view center to world coordinates
  const [centerWorldX, centerWorldY] = lngLatToWorld(vs.longitude, vs.latitude);
  
  // Calculate pixel offset from center
  // World coordinates: [0,1] range, center at view center
  // Screen coordinates: [0, width/height], center at width/2, height/2
  const pixelX = (worldX - centerWorldX) * scale + vs.width / 2;
  const pixelY = (worldY - centerWorldY) * scale + vs.height / 2;
  
  return [pixelX, pixelY];
}

/**
 * Convert lng/lat directly to screen pixel coordinates
 */
function lngLatToScreen(lng: number, lat: number, vs: ViewState): [number, number] {
  const [worldX, worldY] = lngLatToWorld(lng, lat);
  return worldToScreen(worldX, worldY, vs);
}

/**
 * Build cumulative probability array for binary search node selection
 */
function buildCumulativeProbs(): void {
  let sum = 0;
  cumulativeProbs = nodes.map(n => {
    sum += n.normalized_bandwidth;
    return sum;
  });
}

/**
 * O(log n) binary search for probabilistic node selection
 */
function getProbabilisticIndex(): number {
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
 * Get source/dest pair (must be different nodes)
 */
function getProbabilisticPair(): [NodeData, NodeData] {
  const maxTries = 500;
  let tries = 0;
  let sourceIdx = getProbabilisticIndex();
  let destIdx = getProbabilisticIndex();
  
  while (sourceIdx === destIdx && tries < maxTries) {
    destIdx = getProbabilisticIndex();
    tries++;
  }
  
  return [nodes[sourceIdx], nodes[destIdx]];
}

/**
 * Create a single particle
 */
function createParticle(): ParticleData {
  const [source, dest] = getProbabilisticPair();
  
  return {
    startLng: source.lng,
    startLat: source.lat,
    endLng: dest.lng,
    endLat: dest.lat,
    progress: Math.random(),
    speed: 0.0003 * (0.8 + Math.random() * 0.4),
    isHiddenService: Math.random() < 0.04 ? 1 : 0,
  };
}

/**
 * Initialize particles
 */
function initializeParticles(count: number, hiddenServiceProbability: number, baseSpeed: number): void {
  particles = [];
  for (let i = 0; i < count; i++) {
    const p = createParticle();
    p.speed = baseSpeed * (0.8 + Math.random() * 0.4);
    p.isHiddenService = Math.random() < hiddenServiceProbability ? 1 : 0;
    particles.push(p);
  }
}

/**
 * Update all particles by one time step
 */
function updateParticles(deltaTime: number): void {
  const dt = deltaTime / 16; // Normalize to ~60fps
  
  for (const p of particles) {
    p.progress += p.speed * dt;
    
    // Reset particle when it completes its journey
    if (p.progress >= 1) {
      const [source, dest] = getProbabilisticPair();
      
      p.startLng = source.lng;
      p.startLat = source.lat;
      p.endLng = dest.lng;
      p.endLat = dest.lat;
      p.progress = 0;
      p.speed = 0.0003 * (0.8 + Math.random() * 0.4);
      p.isHiddenService = Math.random() < 0.04 ? 1 : 0;
    }
  }
}

/**
 * Get current particle position (lng/lat)
 */
function getParticlePosition(p: ParticleData): [number, number] {
  // Handle wrapping around Pacific Ocean for shortest path
  let startLng = p.startLng;
  let endLng = p.endLng;
  
  const diff = endLng - startLng;
  if (diff > 180) {
    endLng -= 360;
  } else if (diff < -180) {
    endLng += 360;
  }
  
  // Linear interpolation
  const t = p.progress;
  let lng = startLng + (endLng - startLng) * t;
  const lat = p.startLat + (p.endLat - p.startLat) * t;
  
  // Normalize longitude back to [-180, 180]
  while (lng > 180) lng -= 360;
  while (lng < -180) lng += 360;
  
  return [lng, lat];
}

/**
 * Render particles to canvas
 */
function render(): void {
  if (!canvas || !ctx || !viewState) return;
  
  // Clear canvas
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  
  // Set canvas size to match viewState
  if (canvas.width !== viewState.width || canvas.height !== viewState.height) {
    canvas.width = viewState.width;
    canvas.height = viewState.height;
  }
  
  // Render particles
  ctx.fillStyle = `rgb(${GENERAL_COLOR.join(',')})`;
  
  for (const p of particles) {
    const [lng, lat] = getParticlePosition(p);
    const [x, y] = lngLatToScreen(lng, lat, viewState);
    
    // Skip particles outside viewport (with some margin for smooth entry/exit)
    if (x < -10 || x > viewState.width + 10 || y < -10 || y > viewState.height + 10) {
      continue;
    }
    
    // Set color based on particle type
    if (p.isHiddenService === 1) {
      ctx.fillStyle = `rgb(${HIDDEN_COLOR.join(',')})`;
    } else {
      ctx.fillStyle = `rgb(${GENERAL_COLOR.join(',')})`;
    }
    
    // Draw particle (1px dot)
    ctx.fillRect(Math.round(x), Math.round(y), 1, 1);
  }
}

/**
 * Animation loop
 */
function animate(currentTime: number): void {
  const deltaTime = lastTime ? currentTime - lastTime : 16;
  lastTime = currentTime;
  
  // Update particles
  updateParticles(deltaTime);
  
  // Render
  render();
  
  // Continue animation
  animationFrameId = requestAnimationFrame(animate);
}

/**
 * Start animation loop
 */
function startAnimation(): void {
  if (animationFrameId !== null) return;
  lastTime = performance.now();
  animationFrameId = requestAnimationFrame(animate);
}

/**
 * Stop animation loop
 */
function stopAnimation(): void {
  if (animationFrameId !== null) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
}

/**
 * Handle initialization
 */
function handleInit(msg: InitMessage): void {
  canvas = msg.canvas;
  ctx = canvas.getContext('2d', { alpha: true, desynchronized: true });
  
  if (!ctx) {
    console.error('[ParticleWorker] Failed to get 2D context');
    return;
  }
  
  nodes = msg.nodes;
  viewState = msg.viewState;
  
  // Build cumulative probabilities
  buildCumulativeProbs();
  
  // Initialize particles
  initializeParticles(
    msg.particleCount,
    msg.hiddenServiceProbability,
    msg.baseSpeed
  );
  
  // Start animation
  startAnimation();
  
  worker.postMessage({ type: 'ready' });
}

/**
 * Handle viewState update
 */
function handleUpdateViewState(msg: UpdateViewStateMessage): void {
  viewState = msg.viewState;
  // Animation loop will pick up the new viewState on next frame
}

/**
 * Handle nodes update
 */
function handleUpdateNodes(msg: UpdateNodesMessage): void {
  nodes = msg.nodes;
  buildCumulativeProbs();
  // Particles will reset naturally as they complete their journeys
}

/**
 * Handle particle settings update
 */
function handleUpdateParticles(msg: UpdateParticlesMessage): void {
  // Rebuild particles with new settings
  buildCumulativeProbs();
  initializeParticles(
    msg.particleCount,
    msg.hiddenServiceProbability,
    msg.baseSpeed
  );
}

// Listen for messages
worker.addEventListener('message', (e: MessageEvent) => {
  const msg = e.data;
  
  switch (msg.type) {
    case 'init':
      handleInit(msg as InitMessage);
      break;
    case 'updateViewState':
      handleUpdateViewState(msg as UpdateViewStateMessage);
      break;
    case 'updateNodes':
      handleUpdateNodes(msg as UpdateNodesMessage);
      break;
    case 'updateParticles':
      handleUpdateParticles(msg as UpdateParticlesMessage);
      break;
    case 'stop':
      stopAnimation();
      break;
    default:
      console.warn('[ParticleWorker] Unknown message type:', msg.type);
  }
});
