/**
 * Particle Render Worker
 * 
 * Handles particle simulation AND rendering on a separate thread via OffscreenCanvas.
 * OPTIMIZED: Uses GPU-based animation (Vertex Shader) to avoid CPU calc and bus transfer.
 * Mimics TorFlow architecture for maximum performance.
 */

// Force module scope
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
  nodes?: { lng: number; lat: number; isHSDir: boolean }[];
  viewState?: ViewState;
  width?: number;
  height?: number;
  pixelRatio?: number;
  // Settings
  density?: number;
  opacity?: number;
  speed?: number;
  trafficType?: 'all' | 'hidden' | 'general';
}

// --- Global State ---
let canvas: OffscreenCanvas | null = null;
let gl: WebGL2RenderingContext | null = null;
let particleProgram: WebGLProgram | null = null;
let particleVAO: WebGLVertexArrayObject | null = null;

// Simulation State
let nodes: { x: number; y: number; isHSDir: boolean }[] = [];
let particleCount = 0;
const MAX_PARTICLES = 50000;

// Settings
let currentDensity = 1.0;
let currentOpacity = 1.0;
let currentSpeedFactor = 1.0;
let currentTrafficType = 'all'; // 'all', 'hidden', 'general'

// View State
let currentViewState: ViewState = {
  longitude: 0,
  latitude: 0,
  zoom: 1,
  width: 800,
  height: 600,
  bearing: 0,
  pitch: 0
};
let devicePixelRatio = 1;
let startTime = 0;

// Constants matching Mapbox/Deck.gl
const TILE_SIZE = 512;
const PI = Math.PI;
const PI_4 = PI / 4;
const DEGREES_TO_RADIANS = PI / 180;

// --- Projection Helpers ---

function projectToWorld(lng: number, lat: number): [number, number] {
  const lambda = lng * DEGREES_TO_RADIANS;
  const phi = lat * DEGREES_TO_RADIANS;
  const x = (TILE_SIZE / (2 * PI)) * (lambda + PI);
  const y = (TILE_SIZE / (2 * PI)) * (PI - Math.log(Math.tan(PI_4 + phi * 0.5)));
  return [x, y];
}

// --- WebGL Shaders (GPU Animation) ---

const VS_SOURCE = `#version 300 es
// Static attributes (uploaded once)
in vec2 a_start;       // World Coordinate (Mercator)
in vec2 a_end;         // World Coordinate (Mercator)
in float a_speed;      // Base speed factor
in float a_timeOffset; // Random time offset (0-1)
in float a_type;       // 0.0 = General, 1.0 = Hidden

uniform float u_time;
uniform float u_scale;
uniform vec2 u_center;
uniform vec2 u_screenSize;
uniform float u_speedFactor; // Global speed multiplier

out float v_type; // Pass type to fragment shader

void main() {
  // 1. Calculate Progress (0.0 to 1.0) based on time
  // t = (time * baseSpeed * globalSpeed + offset) % 1.0
  float t = fract(u_time * a_speed * u_speedFactor + a_timeOffset);
  
  // 2. Linear Interpolation in World Space
  vec2 pos = mix(a_start, a_end, t);
  
  // 3. Project to Screen Space
  vec2 screenPos = (pos - u_center) * u_scale;
  
  // 4. Normalize to Clip Space
  gl_Position = vec4(
    screenPos.x / (u_screenSize.x * 0.5), 
    -screenPos.y / (u_screenSize.y * 0.5), 
    0.0, 
    1.0
  );
  
  gl_PointSize = 2.0;
  v_type = a_type;
}
`;

const FS_SOURCE = `#version 300 es
precision mediump float;
uniform float u_opacity; // Global opacity
uniform int u_trafficType; // 0=All, 1=General, 2=Hidden

in float v_type;
out vec4 fragColor;

void main() {
  // Filter based on traffic type
  if (u_trafficType == 1 && v_type > 0.5) discard; // Show General only, discard Hidden
  if (u_trafficType == 2 && v_type < 0.5) discard; // Show Hidden only, discard General

  // Base color: 
  // General (v_type < 0.5) = Tor Green (0.0, 1.0, 0.53)
  // Hidden (v_type > 0.5) = Tor Orange (1.0, 0.4, 0.0) // Orange/Gold
  
  vec3 color = (v_type < 0.5) 
    ? vec3(0.0, 1.0, 0.53) 
    : vec3(1.0, 0.4, 0.0);

  // Multiplier 1.2 means slider 1.0 -> alpha 1.2 (clamped to 1.0)
  // This ensures 100% on slider feels "fully solid"
  float a = clamp(1.2 * u_opacity, 0.0, 1.0);
  
  // Output Premultiplied Alpha
  // RGB * Alpha
  fragColor = vec4(color * a, a);
}
`;

function initWebGL() {
  if (!canvas) return;
  
  gl = canvas.getContext('webgl2', {
    alpha: true,
    antialias: false,
    depth: false,
    powerPreference: 'high-performance',
    premultipliedAlpha: true // Default is true, explicit here
  }) as WebGL2RenderingContext;
  
  if (!gl) return;

  // Enable Blending for transparency
  gl.enable(gl.BLEND);
  // Standard Pre-multiplied Alpha Blending (prevents additive saturation/blue-shift)
  // Src * 1 + Dst * (1 - SrcAlpha)
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  
  const vs = createShader(gl, gl.VERTEX_SHADER, VS_SOURCE);
  const fs = createShader(gl, gl.FRAGMENT_SHADER, FS_SOURCE);
  if (!vs || !fs) return;
  
  particleProgram = createProgram(gl, vs, fs);
  particleVAO = gl.createVertexArray();
}

function createShader(gl: WebGL2RenderingContext, type: number, source: string) {
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

function createProgram(gl: WebGL2RenderingContext, vs: WebGLShader, fs: WebGLShader) {
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

// --- Data Initialization ---

function initParticles() {
  if (!gl || !particleProgram || nodes.length < 2) return;

  // We always allocate MAX buffer, but only draw subset
  // Data layout: 6 floats per particle -> 7 floats (added type)
  // a_start(2), a_end(2), a_speed(1), a_timeOffset(1), a_type(1)
  const FLOATS_PER_PARTICLE = 7;
  const data = new Float32Array(MAX_PARTICLES * FLOATS_PER_PARTICLE);
  
  // Identify HSDir indices for efficient selection
  const hsDirIndices = nodes
    .map((n, i) => n.isHSDir ? i : -1)
    .filter(i => i !== -1);
  
  for (let i = 0; i < MAX_PARTICLES; i++) {
    // Determine Type randomly (approx 10% Hidden Service traffic?)
    // Or just assign random source/dest and check if they are HSDir?
    // TorFlow likely generates specific circuits.
    // Let's force ~15% particles to be Hidden Service (HSDir <-> HSDir)
    // and 85% to be General (Any <-> Any)
    const isHidden = Math.random() < 0.15;
    
    let src, tgt;
    
    if (isHidden && hsDirIndices.length >= 2) {
      // Pick from HSDir pool
      const srcIdx = hsDirIndices[Math.floor(Math.random() * hsDirIndices.length)];
      const tgtIdx = hsDirIndices[Math.floor(Math.random() * hsDirIndices.length)];
      src = nodes[srcIdx];
      tgt = nodes[tgtIdx];
    } else {
      // Pick from all nodes
      src = nodes[Math.floor(Math.random() * nodes.length)];
      tgt = nodes[Math.floor(Math.random() * nodes.length)];
    }
    
    const off = i * FLOATS_PER_PARTICLE;
    
    // Handle wrapping
    let startX = src.x;
    let endX = tgt.x;
    const worldWidth = TILE_SIZE;
    const diff = endX - startX;
    
    if (diff > worldWidth / 2) {
      endX -= worldWidth;
    } else if (diff < -worldWidth / 2) {
      endX += worldWidth;
    }

    data[off + 0] = startX;
    data[off + 1] = src.y;
    data[off + 2] = endX;
    data[off + 3] = tgt.y;
    data[off + 4] = 0.05 + Math.random() * 0.15; // Base speed
    data[off + 5] = Math.random(); // Random offset
    data[off + 6] = isHidden ? 1.0 : 0.0; // Type
  }

  if (particleVAO) {
    gl.bindVertexArray(particleVAO);
    
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    
    const STRIDE = 7 * 4; // 28 bytes
    
    const locStart = gl.getAttribLocation(particleProgram, 'a_start');
    gl.enableVertexAttribArray(locStart);
    gl.vertexAttribPointer(locStart, 2, gl.FLOAT, false, STRIDE, 0);
    
    const locEnd = gl.getAttribLocation(particleProgram, 'a_end');
    gl.enableVertexAttribArray(locEnd);
    gl.vertexAttribPointer(locEnd, 2, gl.FLOAT, false, STRIDE, 8);
    
    const locSpeed = gl.getAttribLocation(particleProgram, 'a_speed');
    gl.enableVertexAttribArray(locSpeed);
    gl.vertexAttribPointer(locSpeed, 1, gl.FLOAT, false, STRIDE, 16);
    
    const locOffset = gl.getAttribLocation(particleProgram, 'a_timeOffset');
    gl.enableVertexAttribArray(locOffset);
    gl.vertexAttribPointer(locOffset, 1, gl.FLOAT, false, STRIDE, 20);

    const locType = gl.getAttribLocation(particleProgram, 'a_type');
    gl.enableVertexAttribArray(locType);
    gl.vertexAttribPointer(locType, 1, gl.FLOAT, false, STRIDE, 24);
  }
}

// --- Animation Loop ---

function animate(now: number) {
  if (!gl || !particleProgram) {
    requestAnimationFrame(animate);
    return;
  }
  
  if (startTime === 0) startTime = now;
  const elapsed = (now - startTime) / 1000.0;

  gl.viewport(0, 0, currentViewState.width * devicePixelRatio, currentViewState.height * devicePixelRatio);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  
  gl.useProgram(particleProgram);
  if (particleVAO) {
    gl.bindVertexArray(particleVAO);
  }
  
  // Update Uniforms
  const uScale = Math.pow(2, currentViewState.zoom);
  const [centerX, centerY] = projectToWorld(currentViewState.longitude, currentViewState.latitude);
  
  gl.uniform1f(gl.getUniformLocation(particleProgram, 'u_time')!, elapsed);
  gl.uniform1f(gl.getUniformLocation(particleProgram, 'u_scale')!, uScale);
  gl.uniform2f(gl.getUniformLocation(particleProgram, 'u_center')!, centerX, centerY);
  gl.uniform2f(gl.getUniformLocation(particleProgram, 'u_screenSize')!, currentViewState.width, currentViewState.height);
  
  // Settings Uniforms
  gl.uniform1f(gl.getUniformLocation(particleProgram, 'u_opacity')!, currentOpacity);
  gl.uniform1f(gl.getUniformLocation(particleProgram, 'u_speedFactor')!, currentSpeedFactor * 5.0);

  // Traffic Type Uniform
  let trafficTypeInt = 0; // All
  if (currentTrafficType === 'general') trafficTypeInt = 1;
  if (currentTrafficType === 'hidden') trafficTypeInt = 2;
  gl.uniform1i(gl.getUniformLocation(particleProgram, 'u_trafficType')!, trafficTypeInt);

  // Draw subset based on density
  // New Logic: Density 0.0-1.0 from UI
  // Map 1.0 to old 6.0 behavior (which was 1.5x saturation)
  const activeCount = Math.min(MAX_PARTICLES, Math.floor(MAX_PARTICLES * (currentDensity * 1.5))); 

  if (activeCount > 0) {
    gl.drawArrays(gl.POINTS, 0, activeCount);
  }

  requestAnimationFrame(animate);
}

// --- Message Handling ---

self.onmessage = (e: MessageEvent<WorkerMessage>) => {
  const { 
    type, 
    canvas: offscreen, 
    nodes: rawNodes, 
    viewState, 
    width, 
    height, 
    pixelRatio,
    density,
    opacity,
    speed,
    trafficType
  } = e.data;

  if (type === 'init' && offscreen) {
    canvas = offscreen;
    devicePixelRatio = pixelRatio || 1;
    initWebGL();
    requestAnimationFrame(animate);
  }
  
  if (type === 'updateNodes' && rawNodes) {
    // Pre-project nodes
    nodes = rawNodes.map(n => {
      const [x, y] = projectToWorld(n.lng, n.lat);
      return { x, y, isHSDir: !!n.isHSDir };
    });
    initParticles();
  }
  
  if (type === 'updateViewState' && viewState) {
    currentViewState = { ...currentViewState, ...viewState };
  }
  
  if (type === 'resize' && width && height) {
    currentViewState.width = width;
    currentViewState.height = height;
    if (canvas) {
      canvas.width = width * devicePixelRatio;
      canvas.height = height * devicePixelRatio;
    }
  }

  if (type === 'updateSettings') {
    if (density !== undefined) currentDensity = density;
    if (opacity !== undefined) currentOpacity = opacity;
    if (speed !== undefined) currentSpeedFactor = speed;
    if (trafficType !== undefined) currentTrafficType = trafficType;
  }
};
