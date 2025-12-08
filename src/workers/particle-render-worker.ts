/**
 * Particle Render Worker
 * 
 * Handles both particle simulation AND rendering on a separate thread.
 * Uses OffscreenCanvas with WebGL for smooth 60fps animation independent
 * of the main thread's deck.gl picking operations.
 * 
 * Projection: Uses Web Mercator matching deck.gl/@math.gl/web-mercator exactly.
 */

// Worker context
const worker = self as unknown as Worker;

// Types
interface NodeData {
  lng: number;
  lat: number;
  normalized_bandwidth: number;
}

interface ViewState {
  longitude: number;
  latitude: number;
  zoom: number;
  pitch: number;
  bearing: number;
}

interface InitMessage {
  type: 'init';
  canvas: OffscreenCanvas;
  width: number;
  height: number;
  pixelRatio: number;
}

interface NodesMessage {
  type: 'nodes';
  nodes: NodeData[];
  particleCount: number;
  hiddenServiceProbability: number;
  baseSpeed: number;
}

interface ViewStateMessage {
  type: 'viewState';
  viewState: ViewState;
}

interface UpdateMessage {
  type: 'update';
  deltaTime: number;
}

interface ResizeMessage {
  type: 'resize';
  width: number;
  height: number;
  pixelRatio: number;
}

interface Particle {
  id: number;
  startLng: number;
  startLat: number;
  endLng: number;
  endLat: number;
  progress: number;
  speed: number;
  isHiddenService: boolean;
}

// State
let canvas: OffscreenCanvas | null = null;
let ctx: OffscreenCanvasRenderingContext2D | null = null;
let width = 0;
let height = 0;
let pixelRatio = 1;
let viewState: ViewState | null = null;
let particles: Particle[] = [];
let nodes: NodeData[] = [];
let cumulativeProbs: number[] = [];
let hiddenServiceProbability = 0.04;
let baseSpeed = 0.0005;
let animationFrameId: number | null = null;
let lastTime = 0;

// Colors (RGB 0-255)
const GENERAL_COLOR = [0, 255, 136]; // Green
const HIDDEN_COLOR = [255, 102, 0];  // Orange

/**
 * Web Mercator projection: convert lng/lat to world coordinates [0, 1]
 * This matches @math.gl/web-mercator exactly (deck.gl uses 512 as base tile size)
 * 
 * Formula matches deck.gl's internal projection:
 * - X: normalized longitude [-180, 180] -> [0, 1]
 * - Y: Mercator latitude projection, normalized to [0, 1]
 */
function lngLatToWorld(lng: number, lat: number): [number, number] {
  // Normalize longitude to [0, 1]
  const x = (lng + 180) / 360;
  
  // Mercator projection for latitude
  const latRad = (lat * Math.PI) / 180;
  const mercN = Math.log(Math.tan(Math.PI / 4 + latRad / 2));
  const y = 0.5 - mercN / (2 * Math.PI);
  
  return [x, y];
}

/**
 * Convert world coordinates to screen pixel coordinates
 * Accounts for viewState (zoom, center, pan)
 * 
 * This matches deck.gl's projection exactly:
 * - Uses 512 as base tile size (matching @math.gl/web-mercator)
 * - World coordinates are normalized [0, 1] where 1 = full world width
 * - At zoom z, world width in pixels = 512 * 2^z
 * 
 * The key insight: deck.gl centers the viewport at the viewState center,
 * so we need to calculate the offset from the center in world pixel space.
 */
function worldToScreen(worldX: number, worldY: number): [number, number] | null {
  if (!viewState) return null;
  
  // Base tile size for deck.gl (512, not 256)
  const TILE_SIZE = 512;
  
  // World coordinates of viewport center
  const [centerWorldX, centerWorldY] = lngLatToWorld(viewState.longitude, viewState.latitude);
  
  // Scale factor: at zoom z, world is 512 * 2^z pixels wide
  const scale = Math.pow(2, viewState.zoom) * TILE_SIZE;
  
  // Convert world coordinates [0, 1] to pixel coordinates in world space
  const worldPixelX = worldX * scale;
  const worldPixelY = worldY * scale;
  const centerPixelX = centerWorldX * scale;
  const centerPixelY = centerWorldY * scale;
  
  // Calculate offset from center in world pixel space
  const offsetX = worldPixelX - centerPixelX;
  const offsetY = worldPixelY - centerPixelY;
  
  // Screen coordinates: viewport center is at (width/2, height/2)
  // Add offset to center position
  const screenX = width / 2 + offsetX;
  const screenY = height / 2 + offsetY;
  
  return [screenX, screenY];
}

/**
 * Convert lng/lat directly to screen pixel coordinates
 */
function lngLatToScreen(lng: number, lat: number): [number, number] | null {
  const [worldX, worldY] = lngLatToWorld(lng, lat);
  return worldToScreen(worldX, worldY);
}

/**
 * Build cumulative probability array for binary search
 */
function buildCumulativeProbs(): void {
  let sum = 0;
  cumulativeProbs = nodes.map(n => {
    sum += n.normalized_bandwidth;
    return sum;
  });
}

/**
 * Binary search for probabilistic node selection
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
function createParticle(id: number): Particle {
  const [source, dest] = getProbabilisticPair();
  
  return {
    id,
    startLng: source.lng,
    startLat: source.lat,
    endLng: dest.lng,
    endLat: dest.lat,
    progress: Math.random(),
    speed: baseSpeed * (0.8 + Math.random() * 0.4),
    isHiddenService: Math.random() < hiddenServiceProbability,
  };
}

/**
 * Update all particles
 */
function updateParticles(deltaTime: number): void {
  const dt = deltaTime / 16; // Normalize to ~60fps
  
  for (const particle of particles) {
    particle.progress += particle.speed * dt;
    
    if (particle.progress >= 1) {
      const [source, dest] = getProbabilisticPair();
      particle.startLng = source.lng;
      particle.startLat = source.lat;
      particle.endLng = dest.lng;
      particle.endLat = dest.lat;
      particle.progress = 0;
      particle.speed = baseSpeed * (0.8 + Math.random() * 0.4);
      particle.isHiddenService = Math.random() < hiddenServiceProbability;
    }
  }
}

/**
 * Render particles to canvas
 */
function render(): void {
  if (!ctx || !viewState) return;
  
  // Clear canvas
  ctx.clearRect(0, 0, width, height);
  
  // Render particles
  for (const particle of particles) {
    // Handle longitude wrapping for shortest path
    let startLng = particle.startLng;
    let endLng = particle.endLng;
    const diff = endLng - startLng;
    if (diff > 180) {
      endLng -= 360;
    } else if (diff < -180) {
      endLng += 360;
    }
    
    // Interpolate position
    const t = particle.progress;
    let lng = startLng + (endLng - startLng) * t;
    const lat = particle.startLat + (particle.endLat - particle.startLat) * t;
    
    // Normalize longitude
    while (lng > 180) lng -= 360;
    while (lng < -180) lng += 360;
    
    // Convert to screen coordinates
    const screenPos = lngLatToScreen(lng, lat);
    if (!screenPos) continue;
    
    const [x, y] = screenPos;
    
    // Skip if outside viewport (with small margin for particles near edges)
    if (x < -10 || x > width + 10 || y < -10 || y > height + 10) continue;
    
    // Draw particle
    ctx.fillStyle = particle.isHiddenService
      ? `rgb(${HIDDEN_COLOR[0]}, ${HIDDEN_COLOR[1]}, ${HIDDEN_COLOR[2]})`
      : `rgb(${GENERAL_COLOR[0]}, ${GENERAL_COLOR[1]}, ${GENERAL_COLOR[2]})`;
    ctx.globalAlpha = 0.8;
    ctx.beginPath();
    ctx.arc(x, y, 1.5 * pixelRatio, 0, Math.PI * 2);
    ctx.fill();
  }
  
  ctx.globalAlpha = 1.0;
}

/**
 * Animation loop
 */
function animate(currentTime: number): void {
  if (!canvas) return;
  
  const deltaTime = lastTime ? currentTime - lastTime : 16;
  lastTime = currentTime;
  
  updateParticles(deltaTime);
  render();
  
  animationFrameId = requestAnimationFrame(animate);
}

/**
 * Handle initialization
 */
function handleInit(msg: InitMessage): void {
  canvas = msg.canvas;
  width = msg.width;
  height = msg.height;
  pixelRatio = msg.pixelRatio;
  
  ctx = canvas.getContext('2d', { alpha: true, desynchronized: true });
  if (!ctx) {
    console.error('[ParticleWorker] Failed to get 2D context');
    return;
  }
  
  // Set up canvas for high DPI
  canvas.width = width * pixelRatio;
  canvas.height = height * pixelRatio;
  ctx.scale(pixelRatio, pixelRatio);
  
  worker.postMessage({ type: 'ready' });
}

/**
 * Handle nodes update
 */
function handleNodes(msg: NodesMessage): void {
  nodes = msg.nodes;
  hiddenServiceProbability = msg.hiddenServiceProbability;
  baseSpeed = msg.baseSpeed;
  
  if (!nodes || nodes.length < 2) {
    particles = [];
    cumulativeProbs = [];
    return;
  }
  
  buildCumulativeProbs();
  
  // Generate particles
  particles = [];
  for (let i = 0; i < msg.particleCount; i++) {
    particles.push(createParticle(i));
  }
  
  // Start animation if not already running
  if (animationFrameId === null && canvas) {
    lastTime = 0;
    animationFrameId = requestAnimationFrame(animate);
  }
}

/**
 * Handle viewState update
 */
function handleViewState(msg: ViewStateMessage): void {
  viewState = msg.viewState;
}

/**
 * Handle update request
 */
function handleUpdate(msg: UpdateMessage): void {
  // Animation loop handles updates automatically
  // This is just for manual triggers if needed
}

/**
 * Handle resize
 */
function handleResize(msg: ResizeMessage): void {
  width = msg.width;
  height = msg.height;
  pixelRatio = msg.pixelRatio;
  
  if (canvas && ctx) {
    canvas.width = width * pixelRatio;
    canvas.height = height * pixelRatio;
    ctx.scale(pixelRatio, pixelRatio);
  }
}

// Message handler
worker.addEventListener('message', (e: MessageEvent) => {
  const msg = e.data;
  
  switch (msg.type) {
    case 'init':
      handleInit(msg as InitMessage);
      break;
    case 'nodes':
      handleNodes(msg as NodesMessage);
      break;
    case 'viewState':
      handleViewState(msg as ViewStateMessage);
      break;
    case 'update':
      handleUpdate(msg as UpdateMessage);
      break;
    case 'resize':
      handleResize(msg as ResizeMessage);
      break;
    case 'stop':
      if (animationFrameId !== null) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
      }
      break;
  }
});
