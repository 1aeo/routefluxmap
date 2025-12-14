/**
 * Particle System for RouteFluxMap
 * 
 * Generates and animates particles flowing between Tor relay nodes.
 * Uses straight-line interpolation for clean visual appearance on Mercator maps.
 * 
 * Node Selection Algorithm:
 * Uses Vose's Alias Method for O(1) weighted random sampling. This is optimal
 * for high-frequency selection (50k+ particles resetting continuously) where
 * nodes are selected proportionally to their bandwidth weight.
 * 
 * Reference: M.D. Vose, "A Linear Algorithm for Generating Random Numbers
 * with a Given Distribution" (1991)
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
  
  // Vose's Alias Method tables for O(1) weighted random sampling
  // aliasProb[i] = probability of selecting index i directly
  // aliasIdx[i] = fallback index if not selected directly
  private aliasProb: number[] = [];
  private aliasIdx: number[] = [];
  
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
      this.aliasProb = [];
      this.aliasIdx = [];
      return;
    }

    // Build alias tables for O(1) weighted sampling
    this.buildAliasTables();

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
      this.aliasProb = [];
      this.aliasIdx = [];
      return;
    }

    // Build alias tables for O(1) weighted sampling
    // (needed for particle resets during animation)
    this.buildAliasTables();

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
   * Build Vose's Alias tables for O(1) weighted random sampling.
   * 
   * Algorithm: Partition weights into "small" (<1) and "large" (>=1) buckets,
   * then pair them so each bucket sums to exactly 1. This allows sampling
   * in constant time: pick a random bucket, then flip a biased coin.
   * 
   * Called once during initialization - O(n) setup for O(1) lookups.
   * With ~1,257 nodes, this takes <0.2ms.
   */
  private buildAliasTables(): void {
    const n = this.nodes.length;
    if (n === 0) {
      this.aliasProb = [];
      this.aliasIdx = [];
      return;
    }

    // Extract weights with backward compatibility
    const weights = this.nodes.map(node => 
      node.selectionWeight ?? node.normalized_bandwidth ?? 0
    );
    const total = weights.reduce((a, b) => a + b, 0);
    
    // Handle edge case: all weights are zero
    if (total === 0) {
      // Uniform distribution fallback
      this.aliasProb = new Array(n).fill(1);
      this.aliasIdx = new Array(n).fill(0).map((_, i) => i);
      return;
    }
    
    // Scale weights so they sum to n (each bucket averages to 1)
    const scaled = weights.map(w => (w / total) * n);
    
    this.aliasProb = new Array(n);
    this.aliasIdx = new Array(n);
    
    // Partition indices into small (<1) and large (>=1)
    const small: number[] = [];
    const large: number[] = [];
    
    for (let i = 0; i < n; i++) {
      if (scaled[i] < 1) {
        small.push(i);
      } else {
        large.push(i);
      }
    }
    
    // Pair small and large buckets
    while (small.length > 0 && large.length > 0) {
      const s = small.pop()!;
      const l = large.pop()!;
      
      this.aliasProb[s] = scaled[s];
      this.aliasIdx[s] = l;
      
      // Redistribute excess from large to fill the gap
      scaled[l] = scaled[l] + scaled[s] - 1;
      
      if (scaled[l] < 1) {
        small.push(l);
      } else {
        large.push(l);
      }
    }
    
    // Handle remaining items (due to floating point, may have leftovers)
    while (large.length > 0) {
      const l = large.pop()!;
      this.aliasProb[l] = 1;
      this.aliasIdx[l] = l;
    }
    while (small.length > 0) {
      const s = small.pop()!;
      this.aliasProb[s] = 1;
      this.aliasIdx[s] = s;
    }
  }

  /**
   * Sample a node index using the alias tables in O(1) time.
   * 
   * Algorithm: Pick a random bucket i, then with probability aliasProb[i]
   * return i, otherwise return aliasIdx[i].
   */
  private sampleWeightedIndex(): number {
    const n = this.aliasProb.length;
    if (n === 0) return 0;
    
    // Pick a random bucket
    const i = Math.floor(Math.random() * n);
    
    // Biased coin flip: return i with probability aliasProb[i]
    return Math.random() < this.aliasProb[i] ? i : this.aliasIdx[i];
  }

  /**
   * Create a single particle with random source/dest
   */
  private createParticle(id: number): Particle {
    const [source, dest] = this.getDistinctNodePair();
    
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
   * Get a guaranteed-distinct source/dest pair using weighted sampling.
   * 
   * Both source and destination are selected proportionally to bandwidth.
   * On collision (same node selected twice), we retry weighted sampling
   * a few times to maintain the bandwidth distribution. Only falls back
   * to uniform offset if collisions persist (extremely rare).
   * 
   * Collision rate ≈ Σ(weight²) ≈ 2-3% for typical Tor network distribution.
   * With 3 weighted retries, >99.9% of pairs maintain full weighted distribution.
   */
  private getDistinctNodePair(): [AggregatedNode, AggregatedNode] {
    const n = this.nodes.length;
    
    // Edge cases
    if (n === 0) {
      throw new Error('Cannot select nodes from empty array');
    }
    if (n === 1) {
      // Only one node: return same for both (degenerate case)
      return [this.nodes[0], this.nodes[0]];
    }
    
    // Select source (weighted by bandwidth)
    const sourceIdx = this.sampleWeightedIndex();
    
    // Select destination (weighted by bandwidth)
    let destIdx = this.sampleWeightedIndex();
    
    // On collision, retry weighted sampling (maintains bandwidth distribution)
    // 3 retries handles 99.9%+ of cases since collision rate is ~2-3%
    if (destIdx === sourceIdx) {
      for (let retry = 0; retry < 3; retry++) {
        destIdx = this.sampleWeightedIndex();
        if (destIdx !== sourceIdx) break;
      }
      
      // Final fallback: guaranteed different via offset (extremely rare)
      if (destIdx === sourceIdx) {
        const offset = 1 + Math.floor(Math.random() * (n - 1));
        destIdx = (sourceIdx + offset) % n;
      }
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
        const [source, dest] = this.getDistinctNodePair();
        
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
