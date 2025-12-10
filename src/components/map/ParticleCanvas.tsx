import { useEffect, useRef } from 'react';
import type { MapViewState } from '@deck.gl/core';
import type { AggregatedNode } from '../../lib/types';

interface ParticleCanvasProps {
  nodes: AggregatedNode[];
  viewState: MapViewState;
  width: number;
  height: number;
  visible: boolean;
  density?: number;
  opacity?: number;
  speed?: number;
  trafficType?: 'all' | 'hidden' | 'general';
}

export default function ParticleCanvas({
  nodes,
  viewState,
  width,
  height,
  visible,
  density = 1.0,
  opacity = 1.0,
  speed = 1.0,
  trafficType = 'all'
}: ParticleCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const workerRef = useRef<Worker | null>(null);

  // Initialize Worker
  useEffect(() => {
    if (!canvasRef.current || workerRef.current) return;

    // Create worker
    const worker = new Worker(new URL('../../workers/particle-render.worker.ts', import.meta.url), {
      type: 'module'
    });
    workerRef.current = worker;

    // Transfer control
    const offscreen = canvasRef.current.transferControlToOffscreen();
    
    worker.postMessage({
      type: 'init',
      canvas: offscreen,
      width,
      height,
      pixelRatio: window.devicePixelRatio
    }, [offscreen]);

    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  // Update Nodes
  useEffect(() => {
    if (!workerRef.current || !nodes || nodes.length === 0) return;
    
    workerRef.current.postMessage({
      type: 'updateNodes',
      nodes: nodes.map(n => ({ 
        lng: n.lng, 
        lat: n.lat, 
        normalized_bandwidth: n.normalized_bandwidth,
        // Use pre-calculated flag if available, otherwise fallback to iteration (for old data compatibility)
        isHSDir: n.isHSDir ?? n.relays.some(r => r.flags.includes('H'))
      }))
    });
  }, [nodes]);

  // Update View State
  useEffect(() => {
    if (!workerRef.current) return;

    workerRef.current.postMessage({
      type: 'updateViewState',
      viewState: {
        longitude: viewState.longitude,
        latitude: viewState.latitude,
        zoom: viewState.zoom,
        width,
        height,
        bearing: viewState.bearing,
        pitch: viewState.pitch
      }
    });
  }, [viewState, width, height]);

  // Handle Resize
  useEffect(() => {
    if (!workerRef.current) return;
    workerRef.current.postMessage({
      type: 'resize',
      width,
      height,
      pixelRatio: window.devicePixelRatio
    });
  }, [width, height]);

  // Update Settings (Density, Opacity, Speed, Traffic Type)
  useEffect(() => {
    if (!workerRef.current) return;
    
    workerRef.current.postMessage({
      type: 'updateSettings',
      density,
      opacity,
      speed,
      trafficType
    });
  }, [density, opacity, speed, trafficType]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none', // Pass clicks through
        opacity: visible ? 1 : 0,
        transition: 'opacity 0.3s ease-in-out',
        zIndex: 2 // Above map
      }}
    />
  );
}
