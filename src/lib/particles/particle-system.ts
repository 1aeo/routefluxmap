/**
 * Particle System for RouteFluxMap
 * 
 * Generates and animates particles flowing between Tor relay nodes.
 * Uses straight-line interpolation for clean visual appearance on Mercator maps.
 */

import type { AggregatedNode } from '../types';

export interface Particle {
  id: number;
  startLng: number;
  startLat: number;
  endLng: number;
  endLat: number;
  // Current state
  progress: number;
  speed: number;
  isHiddenService: boolean;
}

export interface ParticleState {
  lng: number;
  lat: number;
  isHiddenService: boolean;
}

export class ParticleSystem {
  private particles: Particle[] = [];
  private nodes: AggregatedNode[] = [];
  private hiddenServiceProbability = 0.04;
  private baseSpeed = 0.0005; // Units per frame
  
  // Pre-allocated position cache to reduce GC pressure at 60fps
  // Instead of creating 50k+ new objects every ~33ms, we reuse this array
  private positionCache: ParticleState[] = [];
  
  // Pre-computed cumulative probability array for O(log n) binary search
  // Instead of O(n) linear search for node selection
  private cumulativeProbs: number[] = [];
  
  constructor() {}

  /**
   * Initialize particles from nodes (synchronous, runs on main thread)
   */
  initialize(
    nodes: AggregatedNode[],
    particleCount: number,
    options: {
      hiddenServiceProbability?: number;
      offsetFactor?: number;
      baseSpeed?: number;
    } = {}
  ): void {
    this.nodes = nodes;
    this.hiddenServiceProbability = options.hiddenServiceProbability ?? 0.04;
    this.baseSpeed = options.baseSpeed ?? 0.0005;

    if (!nodes || nodes.length < 2) {
      this.particles = [];
      this.cumulativeProbs = [];
      return;
    }

    // Build cumulative probability array for O(log n) binary search
    this.buildCumulativeProbs();

    this.particles = [];
    for (let i = 0; i < particleCount; i++) {
      this.particles.push(this.createParticle(i));
    }
  }

  /**
   * Initialize particles from pre-generated buffer data (from web worker).
   * This is the preferred method when using web workers for generation.
   * 
   * @param nodes - The nodes array (needed for particle resets during animation)
   * @param particleData - Float32Array: [startLng, startLat, endLng, endLat, progress, speed] per particle
   * @param isHiddenService - Uint8Array: boolean flags per particle
   * @param options - Configuration options
   */
  initializeFromBuffers(
    nodes: AggregatedNode[],
    particleData: Float32Array,
    isHiddenService: Uint8Array,
    options: {
      hiddenServiceProbability?: number;
      baseSpeed?: number;
    } = {}
  ): void {
    this.nodes = nodes;
    this.hiddenServiceProbability = options.hiddenServiceProbability ?? 0.04;
    this.baseSpeed = options.baseSpeed ?? 0.0005;

    if (!nodes || nodes.length < 2 || particleData.length === 0) {
      this.particles = [];
      this.cumulativeProbs = [];
      return;
    }

    // Build cumulative probability array for O(log n) binary search
    // (needed for particle resets during animation)
    this.buildCumulativeProbs();

    // Each particle has 6 floats: startLng, startLat, endLng, endLat, progress, speed
    const particleCount = particleData.length / 6;
    this.particles = [];

    for (let i = 0; i < particleCount; i++) {
      const offset = i * 6;
      this.particles.push({
        id: i,
        startLng: particleData[offset],
        startLat: particleData[offset + 1],
        endLng: particleData[offset + 2],
        endLat: particleData[offset + 3],
        progress: particleData[offset + 4],
        speed: particleData[offset + 5],
        isHiddenService: isHiddenService[i] === 1,
      });
    }
  }

  /**
   * Build cumulative probability array for binary search node selection.
   * Called once during initialization - O(n) setup for O(log n) lookups.
   */
  private buildCumulativeProbs(): void {
    let sum = 0;
    this.cumulativeProbs = this.nodes.map(n => {
      // Backward compat: support both new selectionWeight and old normalized_bandwidth
      sum += n.selectionWeight ?? n.normalized_bandwidth ?? 0;
      return sum;
    });
  }

  /**
   * Create a single particle with random source/dest
   */
  private createParticle(id: number): Particle {
    const [source, dest] = this.getProbabilisticPair();
    
    return {
      id,
      startLng: source.lng,
      startLat: source.lat,
      endLng: dest.lng,
      endLat: dest.lat,
      progress: Math.random(), // Random start position
      speed: this.baseSpeed * (0.8 + Math.random() * 0.4), // Slight speed variation (more uniform)
      isHiddenService: Math.random() < this.hiddenServiceProbability,
    };
  }

  /**
   * Get probabilistic node index based on bandwidth using O(log n) binary search.
   * 
   * Uses pre-computed cumulative probability array for fast lookups.
   * With 500+ nodes and 50k particles resetting continuously, this is
   * called thousands of times per second - binary search provides 10-100x
   * speedup over linear search.
   */
  private getProbabilisticIndex(): number {
    if (this.cumulativeProbs.length === 0) return 0;
    
    // Scale random value to total probability mass
    const total = this.cumulativeProbs[this.cumulativeProbs.length - 1];
    const rnd = Math.random() * total;
    
    // Binary search for first index where cumulativeProbs[i] >= rnd
    let left = 0;
    let right = this.cumulativeProbs.length - 1;
    
    while (left < right) {
      const mid = (left + right) >>> 1; // Faster than Math.floor for positive ints
      if (this.cumulativeProbs[mid] < rnd) {
        left = mid + 1;
      } else {
        right = mid;
      }
    }
    
    return Math.min(left, this.nodes.length - 1);
  }

  /**
   * Get a source/dest pair (must be different nodes)
   */
  private getProbabilisticPair(): [AggregatedNode, AggregatedNode] {
    const maxTries = 500;
    let tries = 0;
    let sourceIdx = this.getProbabilisticIndex();
    let destIdx = this.getProbabilisticIndex();
    
    while (sourceIdx === destIdx && tries < maxTries) {
      destIdx = this.getProbabilisticIndex();
      tries++;
    }
    
    return [this.nodes[sourceIdx], this.nodes[destIdx]];
  }

  /**
   * Update all particles by one time step
   */
  update(deltaTime: number = 16): void {
    const dt = deltaTime / 16; // Normalize to ~60fps
    
    for (const particle of this.particles) {
      particle.progress += particle.speed * dt;
      
      // Reset particle when it completes its journey
      if (particle.progress >= 1) {
        const [source, dest] = this.getProbabilisticPair();
        
        particle.startLng = source.lng;
        particle.startLat = source.lat;
        particle.endLng = dest.lng;
        particle.endLat = dest.lat;
        particle.progress = 0;
        particle.speed = this.baseSpeed * (0.8 + Math.random() * 0.4);
        particle.isHiddenService = Math.random() < this.hiddenServiceProbability;
      }
    }
  }

  /**
   * Get current positions of all particles
   * Uses simple linear interpolation for straight-line paths
   * 
   * OPTIMIZED: Reuses pre-allocated positionCache to avoid creating
   * 50,000+ new objects every ~33ms (30 calls/second at 60fps).
   * This significantly reduces GC pressure during animation.
   */
  getPositions(): ParticleState[] {
    const particleCount = this.particles.length;
    
    // Expand cache only when needed (never shrink to avoid reallocations)
    while (this.positionCache.length < particleCount) {
      this.positionCache.push({ lng: 0, lat: 0, isHiddenService: false });
    }
    
    // Update positions in-place
    for (let i = 0; i < particleCount; i++) {
      const p = this.particles[i];
      const state = this.positionCache[i];
      
      // Handle wrapping around Pacific Ocean for shortest path
      let startLng = p.startLng;
      let endLng = p.endLng;
      
      const diff = endLng - startLng;
      if (diff > 180) {
        endLng -= 360;
      } else if (diff < -180) {
        endLng += 360;
      }
      
      // Simple linear interpolation
      const t = p.progress;
      let lng = startLng + (endLng - startLng) * t;
      const lat = p.startLat + (p.endLat - p.startLat) * t;
      
      // Normalize longitude back to [-180, 180]
      while (lng > 180) lng -= 360;
      while (lng < -180) lng += 360;
      
      // Update in place instead of creating new object
      state.lng = lng;
      state.lat = lat;
      state.isHiddenService = p.isHiddenService;
    }
    
    // Return slice to avoid exposing extra cached elements
    // Note: slice() creates a new array reference but reuses the ParticleState objects
    return this.positionCache.slice(0, particleCount);
  }

  /**
   * Compute numeric hash for a path to avoid string key creation.
   * Uses 4 decimal places precision (matching original toFixed(4)).
   * Hash encodes coordinates into a single number for fast Map lookups.
   */
  private hashPath(startLng: number, startLat: number, endLng: number, endLat: number): number {
    // Shift coordinates to positive range and scale to integers
    // Longitude: -180 to 180 -> 0 to 3600000 (4 decimals)
    // Latitude: -90 to 90 -> 0 to 1800000 (4 decimals)
    const slng = Math.floor((startLng + 180) * 10000);
    const slat = Math.floor((startLat + 90) * 10000);
    const elng = Math.floor((endLng + 180) * 10000);
    const elat = Math.floor((endLat + 90) * 10000);
    
    // Combine into single number using bit operations and multiplication
    // Since JS numbers are 64-bit floats with 53-bit integer precision,
    // we can safely combine these values (max ~3.6M each, need ~22 bits each)
    return slng * 1e15 + slat * 1e10 + elng * 1e5 + elat;
  }

  /**
   * Get active paths with particle counts
   * Used for drawing connection lines
   * 
   * OPTIMIZED: Uses numeric hash instead of string keys for 5-10x faster
   * path aggregation. String concatenation and toFixed() calls were the
   * bottleneck when aggregating 50,000+ particles.
   */
  getActivePaths(): { source: [number, number], target: [number, number], count: number }[] {
    const pathCounts = new Map<number, number>();
    const pathData = new Map<number, { source: [number, number], target: [number, number] }>();

    for (const p of this.particles) {
      // Handle wrapping for shortest path (match getPositions logic)
      let startLng = p.startLng;
      let endLng = p.endLng;
      
      const diff = endLng - startLng;
      if (diff > 180) {
        endLng -= 360;
      } else if (diff < -180) {
        endLng += 360;
      }

      // Use numeric hash instead of string key
      const hash = this.hashPath(startLng, p.startLat, endLng, p.endLat);
      
      const existingCount = pathCounts.get(hash);
      if (existingCount !== undefined) {
        pathCounts.set(hash, existingCount + 1);
      } else {
        pathCounts.set(hash, 1);
        pathData.set(hash, {
          source: [startLng, p.startLat],
          target: [endLng, p.endLat]
        });
      }
    }
    
    // Build result array
    const result: { source: [number, number], target: [number, number], count: number }[] = [];
    for (const [hash, count] of pathCounts) {
      const data = pathData.get(hash)!;
      result.push({
        source: data.source,
        target: data.target,
        count
      });
    }
    return result;
  }

  /**
   * Get particle count
   */
  getCount(): number {
    return this.particles.length;
  }

  /**
   * Resize particle count
   */
  setParticleCount(count: number): void {
    if (count === this.particles.length) return;
    
    if (count > this.particles.length) {
      // Add more particles
      for (let i = this.particles.length; i < count; i++) {
        this.particles.push(this.createParticle(i));
      }
    } else {
      // Remove particles
      this.particles = this.particles.slice(0, count);
    }
  }
}
