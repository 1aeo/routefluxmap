/**
 * Particle Render Worker
 * Renders traffic flow visualization with bandwidth-proportional routes.
 * - Line thickness, particle count, speed, and size all scale with bandwidth rank
 * - Uses OffscreenCanvas for GPU rendering on separate thread
 */
export {};

// --- Types ---
interface ViewState {
  longitude: number;
  latitude: number;
  zoom: number;
  width: number;
  height: number;
  bearing?: number;
  pitch?: number;
}

interface WorkerMessage {
  type: 'init' | 'updateNodes' | 'updateViewState' | 'resize' | 'updateSettings';
  canvas?: OffscreenCanvas;
  nodes?: { lng: number; lat: number; isHSDir: boolean; normalized_bandwidth?: number }[];
  viewState?: ViewState;
  width?: number;
  height?: number;
  pixelRatio?: number;
  density?: number;
  opacity?: number;
  speed?: number;
  trafficType?: 'all' | 'hidden' | 'general';
  pathMode?: 'city' | 'country';
  countryCentroids?: Record<string, [number, number]>;
}

interface Route {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  isHidden: boolean;
  bandwidthScore: number;
  bandwidthRank: number; // 0 = top, 1 = lowest
}

// --- Constants ---
const MAX_ROUTES = 3000;
const TILE_SIZE = 512;
const PI = Math.PI;
const DEG_TO_RAD = PI / 180;
const LINE_OFFSET = 0.00008; // Perpendicular offset for parallel lines

// Bandwidth rank thresholds: [threshold, lineCount, particleCount]
const RANK_TIERS = [
  [0.01, 5, 6], // Top 1%
  [0.05, 4, 5], // Top 5%
  [0.10, 3, 4], // Top 10%
  [0.25, 2, 3], // Top 25%
  [0.50, 1, 2], // Top 50%
  [1.00, 1, 1], // Rest
] as const;

// --- State ---
let canvas: OffscreenCanvas | null = null;
let gl: WebGL2RenderingContext | null = null;
let lineProgram: WebGLProgram | null = null;
let particleProgram: WebGLProgram | null = null;
let lineVAO: WebGLVertexArrayObject | null = null;
let particleVAO: WebGLVertexArrayObject | null = null;

// Cached uniform locations (performance optimization)
let lineUniforms: Record<string, WebGLUniformLocation | null> = {};
let particleUniforms: Record<string, WebGLUniformLocation | null> = {};

let nodes: { x: number; y: number; isHSDir: boolean; bandwidth: number }[] = [];
let allRoutes: Route[] = [];
let routes: Route[] = [];
let lineVertexCount = 0;
let particleCount = 0;

let currentDensity = 1.0;
let currentOpacity = 1.0;
let currentSpeedFactor = 1.0;
let currentTrafficType = 'all';
let currentPathMode: 'city' | 'country' = 'city';
let currentViewState: ViewState = { longitude: 0, latitude: 0, zoom: 1, width: 800, height: 600 };
let devicePixelRatio = 1;
let startTime = 0;

// Country centroids for country mode (lng, lat)
let countryCentroids: Record<string, [number, number]> = {};

// Raw nodes before aggregation (for switching modes without re-fetching)
let rawNodes: { lng: number; lat: number; isHSDir: boolean; bandwidth: number }[] = [];

// --- Shaders ---
const LINE_VS = `#version 300 es
in vec2 a_position;
in float a_type;
uniform float u_scale;
uniform vec2 u_center, u_screenSize;
out float v_type;
void main() {
  vec2 p = (a_position - u_center) * u_scale;
  gl_Position = vec4(p.x / (u_screenSize.x * 0.5), -p.y / (u_screenSize.y * 0.5), 0.0, 1.0);
  v_type = a_type;
}`;

const LINE_FS = `#version 300 es
precision mediump float;
uniform float u_opacity;
uniform int u_trafficType;
in float v_type;
out vec4 fragColor;
void main() {
  if (u_trafficType == 1 && v_type > 0.5) discard;
  if (u_trafficType == 2 && v_type < 0.5) discard;
  vec3 color = v_type < 0.5 ? vec3(0.0, 1.0, 0.53) : vec3(1.0, 0.4, 0.0);
  float a = u_opacity * 0.1;
  fragColor = vec4(color * a, a);
}`;

const PARTICLE_VS = `#version 300 es
in vec2 a_start, a_end;
in float a_speed, a_timeOffset, a_type, a_bandwidthRank;
uniform float u_time, u_scale, u_speedFactor;
uniform vec2 u_center, u_screenSize;
out float v_type, v_progress;
void main() {
  float speedMult = 1.0 + (1.0 - a_bandwidthRank) * 2.0;
  float t = fract(u_time * a_speed * u_speedFactor * speedMult + a_timeOffset);
  float st = t * t * (3.0 - 2.0 * t);
  vec2 pos = mix(a_start, a_end, st);
  vec2 p = (pos - u_center) * u_scale;
  gl_Position = vec4(p.x / (u_screenSize.x * 0.5), -p.y / (u_screenSize.y * 0.5), 0.0, 1.0);
  gl_PointSize = 2.0 + (1.0 - a_bandwidthRank) * 4.0;
  v_type = a_type;
  v_progress = t;
}`;

const PARTICLE_FS = `#version 300 es
precision mediump float;
uniform float u_opacity;
uniform int u_trafficType;
in float v_type, v_progress;
out vec4 fragColor;
void main() {
  if (u_trafficType == 1 && v_type > 0.5) discard;
  if (u_trafficType == 2 && v_type < 0.5) discard;
  vec3 color = v_type < 0.5 ? vec3(0.0, 1.0, 0.53) : vec3(1.0, 0.4, 0.0);
  float fade = smoothstep(0.0, 0.1, v_progress) * smoothstep(1.0, 0.9, v_progress);
  vec2 c = 2.0 * gl_PointCoord - 1.0;
  float soft = 1.0 - smoothstep(0.3, 1.0, dot(c, c));
  float a = u_opacity * 1.6 * fade * soft;
  fragColor = vec4(color * a, a);
}`;

// --- Helpers ---
function projectToWorld(lng: number, lat: number): [number, number] {
  const x = (TILE_SIZE / (2 * PI)) * (lng * DEG_TO_RAD + PI);
  const y = (TILE_SIZE / (2 * PI)) * (PI - Math.log(Math.tan(PI / 4 + lat * DEG_TO_RAD * 0.5)));
  return [x, y];
}

function getTierForRank(rank: number): [number, number] {
  for (const [threshold, lines, particles] of RANK_TIERS) {
    if (rank < threshold) return [lines, particles];
  }
  return [1, 1];
}

// Find nearest country centroid for a given lng/lat
function findNearestCountry(lng: number, lat: number): string | null {
  let minDist = Infinity;
  let nearest: string | null = null;
  for (const [code, [cLng, cLat]] of Object.entries(countryCentroids)) {
    const dx = lng - cLng, dy = lat - cLat;
    const dist = dx * dx + dy * dy;
    if (dist < minDist) {
      minDist = dist;
      nearest = code;
    }
  }
  return nearest;
}

// Aggregate nodes by country centroid
function aggregateNodesByCountry(): typeof nodes {
  if (!Object.keys(countryCentroids).length) return rawNodes.map(n => {
    const [x, y] = projectToWorld(n.lng, n.lat);
    return { x, y, isHSDir: n.isHSDir, bandwidth: n.bandwidth };
  });

  // Group nodes by nearest country
  const countryGroups: Record<string, { bandwidth: number; isHSDir: boolean; count: number }> = {};
  
  for (const n of rawNodes) {
    const code = findNearestCountry(n.lng, n.lat);
    if (!code) continue;
    
    if (!countryGroups[code]) {
      countryGroups[code] = { bandwidth: 0, isHSDir: false, count: 0 };
    }
    countryGroups[code].bandwidth += n.bandwidth;
    countryGroups[code].isHSDir = countryGroups[code].isHSDir || n.isHSDir;
    countryGroups[code].count++;
  }

  // Convert to node array using country centroids
  const aggregated: typeof nodes = [];
  for (const [code, group] of Object.entries(countryGroups)) {
    const centroid = countryCentroids[code];
    if (!centroid) continue;
    const [x, y] = projectToWorld(centroid[0], centroid[1]);
    aggregated.push({
      x, y,
      isHSDir: group.isHSDir,
      bandwidth: group.bandwidth / group.count // Average bandwidth per relay
    });
  }
  
  console.log(`[ParticleWorker] Aggregated ${rawNodes.length} nodes into ${aggregated.length} countries`);
  return aggregated;
}

function createShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error(gl.getShaderInfoLog(shader));
    return null;
  }
  return shader;
}

function createProgram(gl: WebGL2RenderingContext, vs: WebGLShader, fs: WebGLShader): WebGLProgram | null {
  const program = gl.createProgram();
  if (!program) return null;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error(gl.getProgramInfoLog(program));
    return null;
  }
  return program;
}

// --- WebGL Init ---
function initWebGL() {
  if (!canvas) return;
  gl = canvas.getContext('webgl2', {
    alpha: true, antialias: true, depth: false,
    powerPreference: 'high-performance', premultipliedAlpha: true
  }) as WebGL2RenderingContext;
  if (!gl) return;

  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

  const lineVs = createShader(gl, gl.VERTEX_SHADER, LINE_VS);
  const lineFs = createShader(gl, gl.FRAGMENT_SHADER, LINE_FS);
  if (lineVs && lineFs) {
    lineProgram = createProgram(gl, lineVs, lineFs);
    lineVAO = gl.createVertexArray();
    if (lineProgram) {
      lineUniforms = {
        u_scale: gl.getUniformLocation(lineProgram, 'u_scale'),
        u_center: gl.getUniformLocation(lineProgram, 'u_center'),
        u_screenSize: gl.getUniformLocation(lineProgram, 'u_screenSize'),
        u_opacity: gl.getUniformLocation(lineProgram, 'u_opacity'),
        u_trafficType: gl.getUniformLocation(lineProgram, 'u_trafficType'),
      };
    }
  }

  const particleVs = createShader(gl, gl.VERTEX_SHADER, PARTICLE_VS);
  const particleFs = createShader(gl, gl.FRAGMENT_SHADER, PARTICLE_FS);
  if (particleVs && particleFs) {
    particleProgram = createProgram(gl, particleVs, particleFs);
    particleVAO = gl.createVertexArray();
    if (particleProgram) {
      particleUniforms = {
        u_time: gl.getUniformLocation(particleProgram, 'u_time'),
        u_scale: gl.getUniformLocation(particleProgram, 'u_scale'),
        u_center: gl.getUniformLocation(particleProgram, 'u_center'),
        u_screenSize: gl.getUniformLocation(particleProgram, 'u_screenSize'),
        u_opacity: gl.getUniformLocation(particleProgram, 'u_opacity'),
        u_speedFactor: gl.getUniformLocation(particleProgram, 'u_speedFactor'),
        u_trafficType: gl.getUniformLocation(particleProgram, 'u_trafficType'),
      };
    }
  }
}

// --- Route Generation ---
function generateAllRoutes() {
  if (nodes.length < 2) return;
  allRoutes = [];

  const hsDirIndices = nodes.map((n, i) => n.isHSDir ? i : -1).filter(i => i !== -1);
  const weights = nodes.map(n => Math.sqrt(n.bandwidth + 0.1));
  const totalWeight = weights.reduce((s, w) => s + w, 0);
  
  let cum = 0;
  const cumWeights = weights.map(w => (cum += w) / totalWeight);

  const selectNode = (): number => {
    const r = Math.random();
    let lo = 0, hi = cumWeights.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cumWeights[mid] < r) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };

  let attempts = 0;
  const maxAttempts = MAX_ROUTES * 10;

  while (allRoutes.length < MAX_ROUTES && attempts < maxAttempts) {
    attempts++;
    const isHidden = Math.random() < 0.15;
    let srcIdx: number, tgtIdx: number;

    if (isHidden && hsDirIndices.length >= 2) {
      srcIdx = hsDirIndices[(Math.random() * hsDirIndices.length) | 0];
      tgtIdx = hsDirIndices[(Math.random() * hsDirIndices.length) | 0];
    } else {
      srcIdx = selectNode();
      tgtIdx = selectNode();
    }

    if (srcIdx === tgtIdx) continue;

    const src = nodes[srcIdx], tgt = nodes[tgtIdx];
    let endX = tgt.x;
    const diff = endX - src.x;
    if (diff > TILE_SIZE / 2) endX -= TILE_SIZE;
    else if (diff < -TILE_SIZE / 2) endX += TILE_SIZE;

    allRoutes.push({
      startX: src.x, startY: src.y, endX, endY: tgt.y,
      isHidden, bandwidthScore: src.bandwidth * tgt.bandwidth, bandwidthRank: 0
    });
  }

  allRoutes.sort((a, b) => b.bandwidthScore - a.bandwidthScore);
  const len = allRoutes.length - 1 || 1;
  for (let i = 0; i < allRoutes.length; i++) allRoutes[i].bandwidthRank = i / len;
}

function filterRoutesByDensity() {
  if (!allRoutes.length) return;
  routes = allRoutes.slice(0, Math.max(1, (allRoutes.length * currentDensity) | 0));
}

// --- Buffer Init ---
function initLineBuffer() {
  if (!gl || !lineProgram || !lineVAO || !routes.length) return;

  let totalLines = 0;
  for (const r of routes) totalLines += getTierForRank(r.bandwidthRank)[0];

  const data = new Float32Array(totalLines * 6); // 2 verts * 3 floats
  let vi = 0;

  for (const r of routes) {
    const [lineCount] = getTierForRank(r.bandwidthRank);
    const type = r.isHidden ? 1.0 : 0.0;
    const dx = r.endX - r.startX, dy = r.endY - r.startY;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const px = -dy / len, py = dx / len;

    for (let i = 0; i < lineCount; i++) {
      const m = (i - (lineCount - 1) / 2) * LINE_OFFSET;
      const ox = px * m, oy = py * m;
      data[vi++] = r.startX + ox; data[vi++] = r.startY + oy; data[vi++] = type;
      data[vi++] = r.endX + ox; data[vi++] = r.endY + oy; data[vi++] = type;
    }
  }

  lineVertexCount = totalLines * 2;
  gl.bindVertexArray(lineVAO);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);

  const posLoc = gl.getAttribLocation(lineProgram, 'a_position');
  const typeLoc = gl.getAttribLocation(lineProgram, 'a_type');
  gl.enableVertexAttribArray(posLoc);
  gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 12, 0);
  gl.enableVertexAttribArray(typeLoc);
  gl.vertexAttribPointer(typeLoc, 1, gl.FLOAT, false, 12, 8);
  gl.bindVertexArray(null);
}

function initParticleBuffer() {
  if (!gl || !particleProgram || !particleVAO || !routes.length) return;

  let total = 0;
  for (const r of routes) total += getTierForRank(r.bandwidthRank)[1];

  const data = new Float32Array(total * 8);
  let vi = 0;

  for (const r of routes) {
    const [, pCount] = getTierForRank(r.bandwidthRank);
    const type = r.isHidden ? 1.0 : 0.0;
    for (let p = 0; p < pCount; p++) {
      data[vi++] = r.startX; data[vi++] = r.startY;
      data[vi++] = r.endX; data[vi++] = r.endY;
      data[vi++] = 0.12; // Fixed base speed (same for all particles)
      data[vi++] = Math.random(); // Random start time offset (0-1 cycle)
      data[vi++] = type;
      data[vi++] = r.bandwidthRank;
    }
  }

  particleCount = total;
  gl.bindVertexArray(particleVAO);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);

  const stride = 32;
  const attrs = ['a_start', 'a_end', 'a_speed', 'a_timeOffset', 'a_type', 'a_bandwidthRank'];
  const sizes = [2, 2, 1, 1, 1, 1];
  const offsets = [0, 8, 16, 20, 24, 28];
  
  for (let i = 0; i < attrs.length; i++) {
    const loc = gl.getAttribLocation(particleProgram, attrs[i]);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, sizes[i], gl.FLOAT, false, stride, offsets[i]);
  }
  gl.bindVertexArray(null);
}

function rebuildBuffers() {
  generateAllRoutes();
  filterRoutesByDensity();
  initLineBuffer();
  initParticleBuffer();
}

function rebuildBuffersForDensity() {
  filterRoutesByDensity();
  initLineBuffer();
  initParticleBuffer();
}

// --- Animation ---
function animate(now: number) {
  if (!gl || !lineProgram || !particleProgram) {
    requestAnimationFrame(animate);
    return;
  }

  if (!startTime) startTime = now;
  const t = (now - startTime) / 1000;
  const scale = Math.pow(2, currentViewState.zoom);
  const [cx, cy] = projectToWorld(currentViewState.longitude, currentViewState.latitude);
  const traffic = currentTrafficType === 'general' ? 1 : currentTrafficType === 'hidden' ? 2 : 0;

  gl.viewport(0, 0, currentViewState.width * devicePixelRatio, currentViewState.height * devicePixelRatio);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);

  // Lines
  if (lineVertexCount > 0) {
    gl.useProgram(lineProgram);
    gl.bindVertexArray(lineVAO);
    gl.uniform1f(lineUniforms.u_scale, scale);
    gl.uniform2f(lineUniforms.u_center, cx, cy);
    gl.uniform2f(lineUniforms.u_screenSize, currentViewState.width, currentViewState.height);
    gl.uniform1f(lineUniforms.u_opacity, currentOpacity);
    gl.uniform1i(lineUniforms.u_trafficType, traffic);
    gl.drawArrays(gl.LINES, 0, lineVertexCount);
  }

  // Particles
  if (particleCount > 0) {
    gl.useProgram(particleProgram);
    gl.bindVertexArray(particleVAO);
    gl.uniform1f(particleUniforms.u_time, t);
    gl.uniform1f(particleUniforms.u_scale, scale);
    gl.uniform2f(particleUniforms.u_center, cx, cy);
    gl.uniform2f(particleUniforms.u_screenSize, currentViewState.width, currentViewState.height);
    gl.uniform1f(particleUniforms.u_opacity, currentOpacity);
    gl.uniform1f(particleUniforms.u_speedFactor, currentSpeedFactor);
    gl.uniform1i(particleUniforms.u_trafficType, traffic);
    gl.drawArrays(gl.POINTS, 0, particleCount);
  }

  requestAnimationFrame(animate);
}

// --- Node Processing ---
function processNodes() {
  if (currentPathMode === 'country') {
    nodes = aggregateNodesByCountry();
  } else {
    nodes = rawNodes.map(n => {
      const [x, y] = projectToWorld(n.lng, n.lat);
      return { x, y, isHSDir: n.isHSDir, bandwidth: n.bandwidth };
    });
  }
  rebuildBuffers();
}

// --- Message Handler ---
self.onmessage = (e: MessageEvent<WorkerMessage>) => {
  const msg = e.data;

  if (msg.type === 'init' && msg.canvas) {
    canvas = msg.canvas;
    devicePixelRatio = msg.pixelRatio || 1;
    if (msg.countryCentroids) countryCentroids = msg.countryCentroids;
    initWebGL();
    requestAnimationFrame(animate);
  }

  if (msg.type === 'updateNodes' && msg.nodes) {
    // Store raw nodes for mode switching
    rawNodes = msg.nodes.map(n => ({
      lng: n.lng, lat: n.lat,
      isHSDir: !!n.isHSDir,
      bandwidth: n.normalized_bandwidth ?? 0
    }));
    processNodes();
  }

  if (msg.type === 'updateViewState' && msg.viewState) {
    currentViewState = { ...currentViewState, ...msg.viewState };
  }

  if (msg.type === 'resize' && msg.width && msg.height) {
    currentViewState.width = msg.width;
    currentViewState.height = msg.height;
    if (canvas) {
      canvas.width = msg.width * devicePixelRatio;
      canvas.height = msg.height * devicePixelRatio;
    }
  }

  if (msg.type === 'updateSettings') {
    const densityChanged = msg.density !== undefined && msg.density !== currentDensity;
    const pathModeChanged = msg.pathMode !== undefined && msg.pathMode !== currentPathMode;
    
    if (msg.density !== undefined) currentDensity = msg.density;
    if (msg.opacity !== undefined) currentOpacity = msg.opacity;
    if (msg.speed !== undefined) currentSpeedFactor = msg.speed;
    if (msg.trafficType !== undefined) currentTrafficType = msg.trafficType;
    if (msg.pathMode !== undefined) currentPathMode = msg.pathMode;
    
    // Path mode change requires full rebuild with re-aggregation
    if (pathModeChanged && rawNodes.length) {
      processNodes();
    } else if (densityChanged && allRoutes.length) {
      rebuildBuffersForDensity();
    }
  }
};
