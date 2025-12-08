/**
 * ParticleCanvas - OffscreenCanvas-based particle rendering
 * 
 * Renders particles on a separate canvas using a Web Worker with OffscreenCanvas.
 * This completely decouples particle animation from deck.gl's picking system,
 * ensuring smooth 60fps animation even when the main thread is busy with picking.
 * 
 * Features:
 * - Correct Web Mercator projection matching deck.gl
 * - Synchronized viewState updates for pan/zoom
 * - Particle simulation and rendering in worker thread
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import type { MapViewState } from '@deck.gl/core';
import type { AggregatedNode } from '../../lib/types';

export interface ParticleCanvasProps {
  nodes: AggregatedNode[];
  visible: boolean;
  particleCount?: number;
  hiddenServiceProbability?: number;
  baseSpeed?: number;
  viewState: MapViewState;
  containerWidth: number;
  containerHeight: number;
}

export default function ParticleCanvas({
  nodes,
  visible,
  particleCount = 50000,
  hiddenServiceProbability = 0.04,
  baseSpeed = 0.0003,
  viewState,
  containerWidth,
  containerHeight,
}: ParticleCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const workerRef = useRef<Worker | null>(null);
  const isInitializedRef = useRef(false);
  const offscreenCanvasRef = useRef<OffscreenCanvas | null>(null);

  // Initialize worker and canvas
  useEffect(() => {
    if (!visible || !canvasRef.current || nodes.length < 2) {
      return;
    }

    const canvas = canvasRef.current;
    
    // Create worker
    // Vite handles worker imports - use ?worker suffix for proper bundling
    const workerUrl = new URL('./particle-render-worker.ts', import.meta.url);
    const worker = new Worker(workerUrl, { type: 'module' });
    workerRef.current = worker;

    // Transfer canvas control to worker
    const offscreen = canvas.transferControlToOffscreen();
    offscreenCanvasRef.current = offscreen;

    // Wait for worker to be ready
    const handleReady = () => {
      if (!workerRef.current || !offscreenCanvasRef.current) return;
      
      // Prepare node data (only what worker needs)
      const nodeData = nodes.map(n => ({
        lng: n.lng,
        lat: n.lat,
        normalized_bandwidth: n.normalized_bandwidth,
      }));

      // Initialize worker
      workerRef.current.postMessage(
        {
          type: 'init',
          canvas: offscreenCanvasRef.current,
          nodes: nodeData,
          particleCount,
          hiddenServiceProbability,
          baseSpeed,
          viewState: {
            longitude: viewState.longitude,
            latitude: viewState.latitude,
            zoom: viewState.zoom,
            width: containerWidth,
            height: containerHeight,
          },
        },
        [offscreenCanvasRef.current]
      );
      
      isInitializedRef.current = true;
      worker.removeEventListener('message', handleReady);
    };

    worker.addEventListener('message', handleReady);

    // Cleanup
    return () => {
      if (workerRef.current) {
        workerRef.current.postMessage({ type: 'stop' });
        workerRef.current.terminate();
        workerRef.current = null;
      }
      isInitializedRef.current = false;
      offscreenCanvasRef.current = null;
    };
  }, [visible, nodes.length]); // Only re-init if visibility or node count changes

  // Update viewState when it changes (pan/zoom)
  useEffect(() => {
    if (!isInitializedRef.current || !workerRef.current || !visible) return;

    workerRef.current.postMessage({
      type: 'updateViewState',
      viewState: {
        longitude: viewState.longitude,
        latitude: viewState.latitude,
        zoom: viewState.zoom,
        width: containerWidth,
        height: containerHeight,
      },
    });
  }, [viewState.longitude, viewState.latitude, viewState.zoom, containerWidth, containerHeight, visible]);

  // Update nodes when they change
  useEffect(() => {
    if (!isInitializedRef.current || !workerRef.current || !visible || nodes.length < 2) return;

    const nodeData = nodes.map(n => ({
      lng: n.lng,
      lat: n.lat,
      normalized_bandwidth: n.normalized_bandwidth,
    }));

    workerRef.current.postMessage({
      type: 'updateNodes',
      nodes: nodeData,
    });
  }, [nodes, visible]);

  // Update particle settings when they change
  useEffect(() => {
    if (!isInitializedRef.current || !workerRef.current || !visible) return;

    workerRef.current.postMessage({
      type: 'updateParticles',
      particleCount,
      hiddenServiceProbability,
      baseSpeed,
    });
  }, [particleCount, hiddenServiceProbability, baseSpeed, visible]);

  // Set canvas size explicitly (required for OffscreenCanvas)
  useEffect(() => {
    if (canvasRef.current && visible) {
      canvasRef.current.width = containerWidth;
      canvasRef.current.height = containerHeight;
    }
  }, [containerWidth, containerHeight, visible]);

  if (!visible) {
    return null;
  }

  return (
    <canvas
      ref={canvasRef}
      width={containerWidth}
      height={containerHeight}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 1, // Above map, below deck.gl layers
      }}
    />
  );
}
