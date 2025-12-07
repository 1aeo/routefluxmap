/**
 * ParticleOverlay - Animated particle visualization for Tor network traffic
 * 
 * Uses the ParticleSystem to animate particles flowing between relay nodes.
 * Renders using Deck.gl ScatterplotLayer with frequent position updates.
 * Also renders LineLayer for traffic paths.
 * 
 * Features smooth fade transitions when switching between days.
 */

import { useEffect, useRef, useMemo, useState, useCallback } from 'react';
import { ScatterplotLayer, LineLayer } from '@deck.gl/layers';
import type { Layer } from '@deck.gl/core';
import type { AggregatedNode } from '../../lib/types';
import { ParticleSystem, type ParticleState } from '../../lib/particles/particle-system';
import { config } from '../../lib/config';

// Transition duration in milliseconds
const TRANSITION_DURATION_MS = 400;

export interface ParticleOverlayProps {
  nodes: AggregatedNode[];
  visible: boolean;
  particleCount?: number;
  particleSize?: number;
  speedFactor?: number;
  offsetFactor?: number;
  hiddenServiceProbability?: number;
  trafficType?: 'all' | 'hidden' | 'general';
  lineDensityFactor?: number; // 0.1 to 6.0, default 4.0
  lineOpacityFactor?: number; // 0.1 to 6.0, default 4.0
  onLayerUpdate?: (layers: Layer[] | null) => void;
}

// Default colors (RGB 0-255)
const GENERAL_COLOR: [number, number, number] = [
  Math.round(config.particleGeneralColor[0] * 255),
  Math.round(config.particleGeneralColor[1] * 255),
  Math.round(config.particleGeneralColor[2] * 255),
];
const HIDDEN_COLOR: [number, number, number] = [
  Math.round(config.particleHiddenColor[0] * 255),
  Math.round(config.particleHiddenColor[1] * 255),
  Math.round(config.particleHiddenColor[2] * 255),
];

interface PathData {
  source: [number, number];
  target: [number, number];
  count: number;
}

export function useParticleLayer({
  nodes,
  visible,
  particleCount = config.particleCount.default,
  particleSize = config.particleSize.default,
  speedFactor = 1.0,
  offsetFactor = config.particleOffset.default,
  hiddenServiceProbability = config.hiddenServiceProbability,
  trafficType = 'all',
  lineDensityFactor = 1.0,
  lineOpacityFactor = 1.0,
}: ParticleOverlayProps): Layer[] | null {
  const particleSystemRef = useRef<ParticleSystem | null>(null);
  const positionsRef = useRef<ParticleState[]>([]);
  const pathsRef = useRef<PathData[]>([]);
  const animationFrameRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);
  
  // Use a tick counter to trigger layer updates at a controlled rate
  const [tick, setTick] = useState(0);
  const [systemReady, setSystemReady] = useState(false);
  
  // Transition state for smooth fading between days
  const [transitionOpacity, setTransitionOpacity] = useState(1);
  const transitionRef = useRef<{ startTime: number; animationId: number | null }>({ startTime: 0, animationId: null });
  const prevNodesRef = useRef<AggregatedNode[]>([]);

  // Handle transition animation
  const startTransition = useCallback(() => {
    // Cancel any existing transition
    if (transitionRef.current.animationId !== null) {
      cancelAnimationFrame(transitionRef.current.animationId);
    }
    
    // Start fade-in from 0
    setTransitionOpacity(0);
    transitionRef.current.startTime = performance.now();
    
    const animateTransition = () => {
      const elapsed = performance.now() - transitionRef.current.startTime;
      const progress = Math.min(1, elapsed / TRANSITION_DURATION_MS);
      
      // Ease-out curve for smooth appearance
      const easedProgress = 1 - Math.pow(1 - progress, 3);
      setTransitionOpacity(easedProgress);
      
      if (progress < 1) {
        transitionRef.current.animationId = requestAnimationFrame(animateTransition);
      } else {
        transitionRef.current.animationId = null;
      }
    };
    
    transitionRef.current.animationId = requestAnimationFrame(animateTransition);
  }, []);

  // Initialize particle system when nodes change
  useEffect(() => {
    if (!nodes || nodes.length < 2) {
      particleSystemRef.current = null;
      positionsRef.current = [];
      pathsRef.current = [];
      setSystemReady(false);
      return;
    }
    
    // Check if this is a significant node change (different day's data)
    const nodesChanged = prevNodesRef.current.length > 0 && 
      (nodes.length !== prevNodesRef.current.length || 
       (nodes[0] && prevNodesRef.current[0] && nodes[0].lat !== prevNodesRef.current[0].lat));
    
    prevNodesRef.current = nodes;

    const system = new ParticleSystem();
    system.initialize(nodes, particleCount, {
      hiddenServiceProbability,
      offsetFactor,
      baseSpeed: 0.0003 * speedFactor,
    });
    particleSystemRef.current = system;

    // Get initial positions and paths
    positionsRef.current = system.getPositions();
    pathsRef.current = system.getActivePaths();
    setSystemReady(true);
    setTick(t => t + 1); // Trigger initial render
    
    // Start fade-in transition if nodes changed
    if (nodesChanged) {
      startTransition();
    }
  }, [nodes, particleCount, hiddenServiceProbability, offsetFactor, speedFactor, startTransition]);
  
  // Cleanup transition on unmount
  useEffect(() => {
    return () => {
      if (transitionRef.current.animationId !== null) {
        cancelAnimationFrame(transitionRef.current.animationId);
      }
    };
  }, []);

  // Animation loop - update positions every frame but only trigger React updates every N frames
  useEffect(() => {
    if (!visible || !systemReady) {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = 0;
      }
      return;
    }

    let frameCount = 0;
    const UPDATE_INTERVAL = 2; // Update React state every N frames
    const PATH_UPDATE_INTERVAL = 30; // Update paths less frequently (every ~0.5s)

    const animate = (currentTime: number) => {
      const deltaTime = lastTimeRef.current ? currentTime - lastTimeRef.current : 16;
      lastTimeRef.current = currentTime;

      if (particleSystemRef.current) {
        particleSystemRef.current.update(deltaTime);
        positionsRef.current = particleSystemRef.current.getPositions();
        
        frameCount++;
        
        // Update paths periodically
        if (frameCount % PATH_UPDATE_INTERVAL === 0) {
          pathsRef.current = particleSystemRef.current.getActivePaths();
        }

        // Only trigger React update every UPDATE_INTERVAL frames
        if (frameCount % UPDATE_INTERVAL === 0) {
          setTick(t => t + 1);
        }
      }

      animationFrameRef.current = requestAnimationFrame(animate);
    };

    animationFrameRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = 0;
      }
    };
  }, [visible, systemReady]);

  // Update particle count when it changes
  useEffect(() => {
    if (particleSystemRef.current) {
      particleSystemRef.current.setParticleCount(particleCount);
    }
  }, [particleCount]);

  // Filter positions based on traffic type
  const filteredPositions = useMemo(() => {
    const positions = positionsRef.current;
    if (trafficType === 'all') return positions;
    if (trafficType === 'hidden') return positions.filter(p => p.isHiddenService);
    return positions.filter(p => !p.isHiddenService);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trafficType, tick]);

  // Create the Deck.gl layers - recreate when tick changes
  const layers = useMemo(() => {
    if (!visible || filteredPositions.length === 0) {
      return null;
    }

    const result: Layer[] = [];
    
    // Apply transition opacity to all elements
    const effectiveOpacity = transitionOpacity;

    // Line layer for connections
    // Only show if we have paths
    if (pathsRef.current.length > 0) {
      // Calculate max count for opacity scaling
      const maxCount = Math.max(...pathsRef.current.map(p => p.count));
      const totalPaths = pathsRef.current.length;
      
      // Filter paths to reduce density in busy areas
      // Dynamic threshold: if there are many paths, drop the low-traffic ones
      // Adjusted: Increased density by 50% (higher thresholds for dropping)
      // Scaled by lineDensityFactor: higher factor = lower threshold = more lines (higher density)
      // Actually, "higher density" means we want to see MORE lines.
      // So if densityFactor is high (e.g. 2.0), we should LOWER the threshold.
      // If densityFactor is low (e.g. 0.5), we should RAISE the threshold.
      
      let minCountThreshold = 1;
      if (totalPaths > 1500) minCountThreshold = 2;
      if (totalPaths > 4500) minCountThreshold = 3;
      if (totalPaths > 7500) minCountThreshold = Math.ceil(maxCount * 0.05);
      
      // Apply density factor (inverse relationship to threshold)
      minCountThreshold = Math.max(1, Math.round(minCountThreshold / lineDensityFactor));
      
      const visiblePaths = pathsRef.current.filter(p => p.count >= minCountThreshold);

      if (visiblePaths.length > 0) {
        // Determine line color based on traffic type
        // Green for general/all, Orange for hidden only
        const lineColor: [number, number, number] = trafficType === 'hidden' 
          ? HIDDEN_COLOR  // Orange for hidden services
          : GENERAL_COLOR; // Green for general or all
        
        result.push(
          new LineLayer<PathData>({
            id: 'particle-paths',
            data: visiblePaths,
            pickable: false,
            opacity: 1, // We'll control opacity via color
            getWidth: 1,
            getSourcePosition: (d: PathData) => [d.source[0], d.source[1]],
            getTargetPosition: (d: PathData) => [d.target[0], d.target[1]],
            getColor: (d: PathData) => {
              // Opacity based on count: faint (8) to solid (72)
              const normalized = maxCount > 0 ? d.count / maxCount : 0;
              // Non-linear scaling to make low counts visible but faint
              let alpha = 8 + Math.min(72, Math.floor(Math.pow(normalized, 0.5) * 72));
              
              // Apply opacity factor and transition
              alpha = Math.min(255, Math.max(0, Math.round(alpha * lineOpacityFactor * effectiveOpacity)));
              
              return [lineColor[0], lineColor[1], lineColor[2], alpha];
            },
            updateTriggers: {
              getColor: [tick, lineOpacityFactor, trafficType, effectiveOpacity], // Update colors when traffic type or transition changes
            }
          })
        );
      }
    }

    // Particle scatterplot layer
    result.push(
      new ScatterplotLayer<ParticleState>({
        id: 'particle-layer',
        data: filteredPositions,
        pickable: false,
        opacity: 0.8 * effectiveOpacity, // Apply transition opacity
        stroked: false,
        filled: true,
        radiusScale: 1,
        radiusMinPixels: particleSize,
        radiusMaxPixels: particleSize * 2,
        getPosition: (d: ParticleState) => [d.lng, d.lat, 0],
        getRadius: particleSize,
        getFillColor: (d: ParticleState) => 
          d.isHiddenService ? HIDDEN_COLOR : GENERAL_COLOR,
        // Optimize for frequent updates
        updateTriggers: {
          getPosition: [tick],
          opacity: [effectiveOpacity],
        },
      })
    );

    return result;
  }, [visible, filteredPositions, particleSize, tick, lineDensityFactor, lineOpacityFactor, trafficType, transitionOpacity]);

  return layers;
}

/**
 * Standalone component for particles (if needed outside TorMap)
 */
export default function ParticleOverlay(props: ParticleOverlayProps) {
  const layers = useParticleLayer(props);
  
  useEffect(() => {
    if (props.onLayerUpdate) {
      props.onLayerUpdate(layers);
    }
  }, [layers, props.onLayerUpdate]);

  return null;
}
