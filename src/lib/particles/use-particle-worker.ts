/**
 * Hook for Web Worker-based particle generation
 * 
 * Manages the worker lifecycle and provides progress updates.
 * Returns generated particle buffers for use by ParticleSystem.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import type { AggregatedNode } from '../types';

export interface ParticleBuffers {
  /** Float32Array: [startLng, startLat, endLng, endLat, progress, speed] per particle */
  particles: Float32Array;
  /** Uint8Array: boolean flags for hidden service traffic */
  isHiddenService: Uint8Array;
}

export interface UseParticleWorkerOptions {
  nodes: AggregatedNode[];
  particleCount: number;
  hiddenServiceProbability: number;
  baseSpeed: number;
  enabled?: boolean;
}

export interface UseParticleWorkerResult {
  /** Generated particle buffers, null while generating */
  buffers: ParticleBuffers | null;
  /** Generation progress 0-1, null when not generating */
  progress: number | null;
  /** Whether generation is in progress */
  isGenerating: boolean;
  /** Error if generation failed */
  error: Error | null;
}

/**
 * Hook to generate particles using a Web Worker.
 * 
 * @example
 * ```tsx
 * const { buffers, progress, isGenerating } = useParticleWorker({
 *   nodes: relayData.nodes,
 *   particleCount: 50000,
 *   hiddenServiceProbability: 0.04,
 *   baseSpeed: 0.0003,
 * });
 * 
 * if (isGenerating) {
 *   return <LoadingBar progress={progress} />;
 * }
 * 
 * // Use buffers to initialize ParticleSystem
 * ```
 */
export function useParticleWorker({
  nodes,
  particleCount,
  hiddenServiceProbability,
  baseSpeed,
  enabled = true,
}: UseParticleWorkerOptions): UseParticleWorkerResult {
  const [buffers, setBuffers] = useState<ParticleBuffers | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const workerRef = useRef<Worker | null>(null);
  
  // Track if we're currently generating
  const isGenerating = progress !== null;
  
  useEffect(() => {
    if (!enabled || !nodes || nodes.length < 2) {
      setBuffers(null);
      setProgress(null);
      return;
    }
    
    // Reset state for new generation
    setBuffers(null);
    setProgress(0);
    setError(null);
    
    // Terminate any existing worker
    if (workerRef.current) {
      workerRef.current.terminate();
    }
    
    try {
      // Create worker using Vite's worker import syntax
      const worker = new Worker(
        new URL('./particle-worker.ts', import.meta.url),
        { type: 'module' }
      );
      workerRef.current = worker;
      
      worker.onmessage = (e) => {
        switch (e.data.type) {
          case 'progress':
            setProgress(e.data.progress);
            break;
          case 'complete':
            setBuffers({
              particles: new Float32Array(e.data.particles),
              isHiddenService: new Uint8Array(e.data.isHiddenService),
            });
            setProgress(null); // Generation complete
            worker.terminate();
            workerRef.current = null;
            break;
        }
      };
      
      worker.onerror = (e) => {
        console.error('[ParticleWorker] Error:', e);
        setError(new Error(e.message || 'Worker error'));
        setProgress(null);
        worker.terminate();
        workerRef.current = null;
      };
      
      // Prepare minimal node data (only what worker needs)
      const nodeData = nodes.map(n => ({
        lng: n.lng,
        lat: n.lat,
        normalized_bandwidth: n.normalized_bandwidth,
      }));
      
      // Start generation
      worker.postMessage({
        type: 'start',
        nodes: nodeData,
        count: particleCount,
        hiddenServiceProbability,
        baseSpeed,
      });
    } catch (err) {
      // Worker creation failed (e.g., no Worker support)
      console.error('[ParticleWorker] Failed to create worker:', err);
      setError(err instanceof Error ? err : new Error('Failed to create worker'));
      setProgress(null);
    }
    
    return () => {
      if (workerRef.current) {
        workerRef.current.terminate();
        workerRef.current = null;
      }
    };
  }, [nodes, particleCount, hiddenServiceProbability, baseSpeed, enabled]);
  
  return { buffers, progress, isGenerating, error };
}

/**
 * Fallback for environments without Worker support.
 * Generates particles synchronously on main thread.
 */
export function generateParticlesSync(
  nodes: AggregatedNode[],
  particleCount: number,
  hiddenServiceProbability: number,
  baseSpeed: number
): ParticleBuffers | null {
  if (!nodes || nodes.length < 2) {
    return null;
  }
  
  // Build cumulative probabilities
  let sum = 0;
  const cumulativeProbs = nodes.map(n => {
    sum += n.normalized_bandwidth;
    return sum;
  });
  
  const getProbabilisticIndex = (): number => {
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
  };
  
  const getProbabilisticPair = (): [AggregatedNode, AggregatedNode] => {
    const maxTries = 500;
    let tries = 0;
    let sourceIdx = getProbabilisticIndex();
    let destIdx = getProbabilisticIndex();
    
    while (sourceIdx === destIdx && tries < maxTries) {
      destIdx = getProbabilisticIndex();
      tries++;
    }
    
    return [nodes[sourceIdx], nodes[destIdx]];
  };
  
  const particles = new Float32Array(particleCount * 6);
  const isHiddenService = new Uint8Array(particleCount);
  
  for (let i = 0; i < particleCount; i++) {
    const [source, dest] = getProbabilisticPair();
    
    const offset = i * 6;
    particles[offset] = source.lng;
    particles[offset + 1] = source.lat;
    particles[offset + 2] = dest.lng;
    particles[offset + 3] = dest.lat;
    particles[offset + 4] = Math.random();
    particles[offset + 5] = baseSpeed * (0.8 + Math.random() * 0.4);
    
    isHiddenService[i] = Math.random() < hiddenServiceProbability ? 1 : 0;
  }
  
  return { particles, isHiddenService };
}

