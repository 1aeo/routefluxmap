/**
 * ParticleCanvas - OffscreenCanvas-based particle rendering
 * 
 * Renders particles on a separate canvas using a Web Worker with OffscreenCanvas.
 * This completely decouples particle animation from deck.gl's picking system,
 * ensuring smooth 60fps animation even when the main thread is busy with picking.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import type { MapViewState } from '@deck.gl/core';
import type { AggregatedNode } from '../../lib/types';

export interface ParticleCanvasProps {
  nodes: AggregatedNode[];
  viewState: MapViewState;
  visible: boolean;
  particleCount?: number;
  hiddenServiceProbability?: number;
  baseSpeed?: number;
  width: number;
  height: number;
}

export default function ParticleCanvas({
  nodes,
  viewState,
  visible,
  particleCount = 50000,
  hiddenServiceProbability = 0.04,
  baseSpeed = 0.0003,
  width,
  height,
}: ParticleCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const workerRef = useRef<Worker | null>(null);
  const isInitializedRef = useRef(false);
  const offscreenCanvasRef = useRef<OffscreenCanvas | null>(null);

  // Initialize worker and offscreen canvas
  useEffect(() => {
    if (!canvasRef.current || isInitializedRef.current) return;
    
    const canvas = canvasRef.current;
    
    // Check for OffscreenCanvas support
    if (!canvas.transferControlToOffscreen) {
      console.warn('[ParticleCanvas] OffscreenCanvas not supported, falling back to regular canvas');
      return;
    }
    
    // Transfer control to offscreen
    const offscreen = canvas.transferControlToOffscreen();
    offscreenCanvasRef.current = offscreen;
    
    // Create worker
    const worker = new Worker(
      new URL('../../workers/particle-render-worker.ts', import.meta.url),
      { type: 'module' }
    );
    workerRef.current = worker;
    
    // Get pixel ratio
    const pixelRatio = window.devicePixelRatio || 1;
    
    // Initialize worker with offscreen canvas
    worker.postMessage(
      {
        type: 'init',
        canvas: offscreen,
        width,
        height,
        pixelRatio,
      },
      [offscreen]
    );
    
    // Wait for ready signal
    const handleMessage = (e: MessageEvent) => {
      if (e.data.type === 'ready') {
        isInitializedRef.current = true;
        
        // Send initial nodes if available
        if (nodes && nodes.length >= 2) {
          worker.postMessage({
            type: 'nodes',
            nodes: nodes.map(n => ({
              lng: n.lng,
              lat: n.lat,
              normalized_bandwidth: n.normalized_bandwidth,
            })),
            particleCount,
            hiddenServiceProbability,
            baseSpeed,
          });
        }
        
        // Send initial viewState
        worker.postMessage({
          type: 'viewState',
          viewState: {
            longitude: viewState.longitude,
            latitude: viewState.latitude,
            zoom: viewState.zoom,
            pitch: viewState.pitch || 0,
            bearing: viewState.bearing || 0,
          },
        });
      }
    };
    
    worker.addEventListener('message', handleMessage);
    
    return () => {
      worker.removeEventListener('message', handleMessage);
      worker.postMessage({ type: 'stop' });
      worker.terminate();
      workerRef.current = null;
      isInitializedRef.current = false;
    };
  }, []); // Only run once on mount

  // Update nodes when they change
  useEffect(() => {
    if (!workerRef.current || !isInitializedRef.current) return;
    if (!nodes || nodes.length < 2) return;
    
    workerRef.current.postMessage({
      type: 'nodes',
      nodes: nodes.map(n => ({
        lng: n.lng,
        lat: n.lat,
        normalized_bandwidth: n.normalized_bandwidth,
      })),
      particleCount,
      hiddenServiceProbability,
      baseSpeed,
    });
  }, [nodes, particleCount, hiddenServiceProbability, baseSpeed]);

  // Update viewState when it changes
  useEffect(() => {
    if (!workerRef.current || !isInitializedRef.current) return;
    
    workerRef.current.postMessage({
      type: 'viewState',
      viewState: {
        longitude: viewState.longitude,
        latitude: viewState.latitude,
        zoom: viewState.zoom,
        pitch: viewState.pitch || 0,
        bearing: viewState.bearing || 0,
      },
    });
  }, [viewState]);

  // Update canvas size when dimensions change
  useEffect(() => {
    if (!workerRef.current || !isInitializedRef.current || !offscreenCanvasRef.current) return;
    
    const pixelRatio = window.devicePixelRatio || 1;
    
    // Note: We can't resize an OffscreenCanvas after transfer, so we need to
    // recreate it. For now, we'll handle this by updating the worker with new dimensions.
    // The worker will handle the resize internally.
    workerRef.current.postMessage({
      type: 'resize',
      width,
      height,
      pixelRatio,
    });
  }, [width, height]);

  if (!visible) {
    return null;
  }

  return (
    <canvas
      ref={canvasRef}
      className="absolute top-0 left-0 pointer-events-none"
      style={{
        width: `${width}px`,
        height: `${height}px`,
        zIndex: 1, // Above map, below UI elements
      }}
    />
  );
}
