/**
 * useParticleSettings - Particle visualization settings
 * 
 * Manages settings for the particle animation system:
 * - Density (number of particles)
 * - Opacity (line transparency)
 * - Speed (animation speed)
 * - Traffic type (all/hidden/general)
 * - Path mode (city/country)
 * - Relay size scale
 * - Filter relays by traffic
 */

import { useState, useCallback } from 'react';

export type TrafficType = 'all' | 'hidden' | 'general';
export type PathMode = 'city' | 'country';

export interface UseParticleSettingsResult {
  /** Line density factor (0-1, default 0.5) */
  density: number;
  setDensity: (value: number) => void;
  
  /** Line opacity factor (0-1, default 0.5) */
  opacity: number;
  setOpacity: (value: number) => void;
  
  /** Line speed factor (0-1, default 0.5) */
  speed: number;
  setSpeed: (value: number) => void;
  
  /** Relay marker size scale (0-1, default 0.5 = 1x) */
  relaySize: number;
  setRelaySize: (value: number) => void;
  
  /** Traffic type filter */
  trafficType: TrafficType;
  setTrafficType: (value: TrafficType) => void;
  
  /** Path aggregation mode */
  pathMode: PathMode;
  setPathMode: (value: PathMode) => void;
  
  /** Whether to filter relays to match traffic routes */
  filterRelaysByTraffic: boolean;
  setFilterRelaysByTraffic: (value: boolean) => void;
  
  /** Visible node indices from particle worker */
  visibleNodeIndices: Set<number>;
  setVisibleNodeIndices: (indices: Set<number>) => void;
  
  /** Track which data version the indices belong to */
  indicesDataVersion: string | null;
  setIndicesDataVersion: (version: string | null) => void;
  
  /** Reset all settings to defaults */
  resetToDefaults: () => void;
}

/** Default slider value (center position) */
const DEFAULT_FACTOR = 0.5;

/**
 * Manage particle visualization settings
 */
export function useParticleSettings(): UseParticleSettingsResult {
  // Line settings (0-1 range, 0.5 = default/center)
  const [density, setDensity] = useState(DEFAULT_FACTOR);
  const [opacity, setOpacity] = useState(DEFAULT_FACTOR);
  const [speed, setSpeed] = useState(DEFAULT_FACTOR);
  const [relaySize, setRelaySize] = useState(DEFAULT_FACTOR);
  
  // Traffic settings
  const [trafficType, setTrafficType] = useState<TrafficType>('all');
  const [pathMode, setPathMode] = useState<PathMode>('city');
  const [filterRelaysByTraffic, setFilterRelaysByTraffic] = useState(false);
  
  // Visible node tracking (from particle worker)
  const [visibleNodeIndices, setVisibleNodeIndices] = useState<Set<number>>(new Set());
  const [indicesDataVersion, setIndicesDataVersion] = useState<string | null>(null);

  /**
   * Reset all settings to defaults
   */
  const resetToDefaults = useCallback(() => {
    setDensity(DEFAULT_FACTOR);
    setOpacity(DEFAULT_FACTOR);
    setSpeed(DEFAULT_FACTOR);
    setRelaySize(DEFAULT_FACTOR);
    setTrafficType('all');
    setPathMode('city');
    setFilterRelaysByTraffic(false);
  }, []);

  return {
    density,
    setDensity,
    opacity,
    setOpacity,
    speed,
    setSpeed,
    relaySize,
    setRelaySize,
    trafficType,
    setTrafficType,
    pathMode,
    setPathMode,
    filterRelaysByTraffic,
    setFilterRelaysByTraffic,
    visibleNodeIndices,
    setVisibleNodeIndices,
    indicesDataVersion,
    setIndicesDataVersion,
    resetToDefaults,
  };
}

