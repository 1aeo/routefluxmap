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
  private cumulativeProbs: number[] = []; // Pre-computed cumulative probabilities for binary search
  private hiddenServiceProbability = 0.04;
  private baseSpeed = 0.0005; // Units per frame
  
  constructor() {}

  /**
   * Initialize particles from nodes
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

    // Build cumulative probability array for O(log n) selection
    this._buildCumulativeProbs();

    this.particles = [];
    for (let i = 0; i < particleCount; i++) {
      this.particles.push(this.createParticle(i));
    }
  }

  /**
   * Build cumulative probability array for binary search
   */
  private _buildCumulativeProbs(): void {
    let sum = 0;
    this.cumulativeProbs = this.nodes.map(n => {
      sum += n.normalized_bandwidth;
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
   * Get probabilistic node index based on bandwidth using binary search
   * O(log n) instead of O(n) linear search
   */
  private getProbabilisticIndex(): number {
    if (this.cumulativeProbs.length === 0) return 0;
    
    const total = this.cumulativeProbs[this.cumulativeProbs.length - 1];
    const rnd = Math.random() * total;
    
    // Binary search for the index
    let left = 0;
    let right = this.cumulativeProbs.length - 1;
    
    while (left < right) {
      const mid = Math.floor((left + right) / 2);
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
   */
  getPositions(): ParticleState[] {
    return this.particles.map(p => {
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
      
      return {
        lng,
        lat,
        isHiddenService: p.isHiddenService,
      };
    });
  }

  /**
   * Get active paths with particle counts
   * Used for drawing connection lines
   */
  getActivePaths(): { source: [number, number], target: [number, number], count: number }[] {
    const paths = new Map<string, { source: [number, number], target: [number, number], count: number }>();

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

      // Key by coordinates
      const key = `${startLng.toFixed(4)},${p.startLat.toFixed(4)}|${endLng.toFixed(4)},${p.endLat.toFixed(4)}`;
      
      if (!paths.has(key)) {
        paths.set(key, {
          source: [startLng, p.startLat],
          target: [endLng, p.endLat],
          count: 0
        });
      }
      paths.get(key)!.count++;
    }
    return Array.from(paths.values());
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

  /**
   * Update nodes and rebuild cumulative probabilities
   */
  setNodes(nodes: AggregatedNode[]): void {
    this.nodes = nodes;
    if (nodes && nodes.length >= 2) {
      this._buildCumulativeProbs();
    } else {
      this.cumulativeProbs = [];
    }
  }
}
