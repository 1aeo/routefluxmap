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
  type: 'init' | 'updateNodes' | 'updateViewState' | 'resize';
  canvas?: OffscreenCanvas;
  nodes?: { lng: number; lat: number }[];
  viewState?: ViewState;
  width?: number;
  height?: number;
  pixelRatio?: number;
}

// --- Global State ---
let canvas: OffscreenCanvas | null = null;
let gl: WebGL2RenderingContext | null = null;
let particleProgram: WebGLProgram | null = null;
let particleVAO: WebGLVertexArrayObject | null = null;

// Simulation State
// Project nodes to simple x/y
let nodes: { x: number; y: number }[] = [];
let particleCount = 0;
const MAX_PARTICLES = 50000;

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
in float a_speed;      // Speed factor
in float a_timeOffset; // Random time offset (0-1)

uniform float u_time;
uniform float u_scale;
uniform vec2 u_center;
uniform vec2 u_screenSize;

void main() {
  // 1. Calculate Progress (0.0 to 1.0) based on time
  // t = (time * speed + offset) % 1.0
  float t = fract(u_time * a_speed + a_timeOffset);
  
  // 2. Linear Interpolation in World Space
  // Standard straight line (TorFlow uses Bezier, we use Linear for now)
  vec2 pos = mix(a_start, a_end, t);
  
  // 3. Handle Wrapping (Optional, for now assume shortest path pre-calculated)
  
  // 4. Project to Screen Space
  // (wx - cx) * scale
  vec2 screenPos = (pos - u_center) * u_scale;
  
  // 5. Normalize to Clip Space
  gl_Position = vec4(
    screenPos.x / (u_screenSize.x * 0.5), 
    -screenPos.y / (u_screenSize.y * 0.5), 
    0.0, 
    1.0
  );
  
  gl_PointSize = 2.0;
}
`;

const FS_SOURCE = `#version 300 es
precision mediump float;
out vec4 fragColor;

void main() {
  fragColor = vec4(0.0, 1.0, 0.53, 0.8);
}
`;

function initWebGL() {
  if (!canvas) return;
  
  gl = canvas.getContext('webgl2', {
    alpha: true,
    antialias: false,
    depth: false,
    powerPreference: 'high-performance'
  }) as WebGL2RenderingContext;
  
  if (!gl) return;

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

  particleCount = MAX_PARTICLES;
  
  // Data layout:
  // a_start (2), a_end (2), a_speed (1), a_timeOffset (1) -> 6 floats
  const data = new Float32Array(particleCount * 6);
  
  for (let i = 0; i < particleCount; i++) {
    const src = nodes[Math.floor(Math.random() * nodes.length)];
    const tgt = nodes[Math.floor(Math.random() * nodes.length)];
    const off = i * 6;
    
    // Handle wrapping: if distance > 180 deg (TILE_SIZE/2), wrap around
    let startX = src.x;
    let endX = tgt.x;
    
    // World width = TILE_SIZE (512)
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
    data[off + 4] = 0.05 + Math.random() * 0.15; // Speed (cycles per second approx)
    data[off + 5] = Math.random(); // Random offset
  }

  if (particleVAO) {
    gl.bindVertexArray(particleVAO);
    
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW); // Static draw! Upload once.
    
    const STRIDE = 24; // 6 * 4 bytes
    
    // a_start
    const locStart = gl.getAttribLocation(particleProgram, 'a_start');
    gl.enableVertexAttribArray(locStart);
    gl.vertexAttribPointer(locStart, 2, gl.FLOAT, false, STRIDE, 0);
    
    // a_end
    const locEnd = gl.getAttribLocation(particleProgram, 'a_end');
    gl.enableVertexAttribArray(locEnd);
    gl.vertexAttribPointer(locEnd, 2, gl.FLOAT, false, STRIDE, 8);
    
    // a_speed
    const locSpeed = gl.getAttribLocation(particleProgram, 'a_speed');
    gl.enableVertexAttribArray(locSpeed);
    gl.vertexAttribPointer(locSpeed, 1, gl.FLOAT, false, STRIDE, 16);
    
    // a_timeOffset
    const locOffset = gl.getAttribLocation(particleProgram, 'a_timeOffset');
    gl.enableVertexAttribArray(locOffset);
    gl.vertexAttribPointer(locOffset, 1, gl.FLOAT, false, STRIDE, 20);
  }
}

// --- Animation Loop ---

function animate(now: number) {
  if (!gl || !particleProgram || particleCount === 0) {
    requestAnimationFrame(animate);
    return;
  }
  
  if (startTime === 0) startTime = now;
  const elapsed = (now - startTime) / 1000.0; // Seconds

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

  // Draw
  gl.drawArrays(gl.POINTS, 0, particleCount);

  requestAnimationFrame(animate);
}

// --- Message Handling ---

self.onmessage = (e: MessageEvent<WorkerMessage>) => {
  const { type, canvas: offscreen, nodes: rawNodes, viewState, width, height, pixelRatio } = e.data;

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
      return { x, y };
    });
    
    // Re-initialize buffer
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
};
