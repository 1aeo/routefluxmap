/**
 * useDatePlayback - Timeline animation control
 * 
 * Manages date animation playback:
 * - Play/pause state
 * - Playback speed
 * - Interval-based date advancement
 * - Looping when reaching end
 * 
 * Supports lifted state for integration with adaptive preloading.
 */

import { useState, useEffect, useRef, useCallback } from 'react';

export interface UseDatePlaybackResult {
  /** Whether playback is active */
  isPlaying: boolean;
  /** Set playing state */
  setIsPlaying: (playing: boolean) => void;
  /** Toggle play/pause */
  togglePlay: () => void;
  /** Playback speed multiplier (default 1.0) */
  playbackSpeed: number;
  /** Set playback speed */
  setPlaybackSpeed: (speed: number) => void;
}

export interface UseDatePlaybackOptions {
  /** Available dates (from dateIndex) */
  dates: string[];
  /** Current date */
  currentDate: string | null;
  /** Callback to change date */
  onDateChange: (date: string) => void;
  /** External isPlaying state (for lifted state pattern) */
  isPlaying?: boolean;
  /** External setIsPlaying (for lifted state pattern) */
  setIsPlaying?: (playing: boolean) => void;
  /** External playbackSpeed state (for lifted state pattern) */
  playbackSpeed?: number;
  /** External setPlaybackSpeed (for lifted state pattern) */
  setPlaybackSpeed?: (speed: number) => void;
}

/** Base interval in ms at 1x speed */
const BASE_INTERVAL_MS = 500;

/**
 * Manage date playback animation
 * 
 * Supports two modes:
 * 1. Internal state (default): manages isPlaying/playbackSpeed internally
 * 2. Lifted state: accepts external state via options for integration with preloading
 */
export function useDatePlayback(options: UseDatePlaybackOptions): UseDatePlaybackResult {
  const { dates, currentDate, onDateChange } = options;
  
  // Internal state (only used when external state not provided)
  const [internalIsPlaying, internalSetIsPlaying] = useState(false);
  const [internalPlaybackSpeed, internalSetPlaybackSpeed] = useState(1.0);
  
  // Resolve to external or internal state
  const isPlaying = options.isPlaying ?? internalIsPlaying;
  const setIsPlaying = options.setIsPlaying ?? internalSetIsPlaying;
  const playbackSpeed = options.playbackSpeed ?? internalPlaybackSpeed;
  const setPlaybackSpeed = options.setPlaybackSpeed ?? internalSetPlaybackSpeed;
  
  // Refs for interval callback (avoids stale closures)
  const playIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const currentDateRef = useRef(currentDate);
  const isPlayingRef = useRef(isPlaying);
  const setIsPlayingRef = useRef(setIsPlaying);
  
  // Keep refs in sync
  currentDateRef.current = currentDate;
  isPlayingRef.current = isPlaying;
  setIsPlayingRef.current = setIsPlaying;

  /**
   * Toggle play/pause (stable reference)
   */
  const togglePlay = useCallback(() => {
    setIsPlayingRef.current(!isPlayingRef.current);
  }, []);

  // Playback interval effect
  useEffect(() => {
    if (playIntervalRef.current) {
      clearInterval(playIntervalRef.current);
      playIntervalRef.current = null;
    }

    if (!isPlaying || dates.length === 0) return;

    const intervalMs = Math.round(BASE_INTERVAL_MS / playbackSpeed);

    playIntervalRef.current = setInterval(() => {
      const currentIdx = currentDateRef.current 
        ? dates.indexOf(currentDateRef.current) 
        : -1;
      
      // Loop back to start when reaching end
      if (currentIdx < 0 || currentIdx >= dates.length - 1) {
        onDateChange(dates[0]);
      } else {
        onDateChange(dates[currentIdx + 1]);
      }
    }, intervalMs);

    return () => {
      if (playIntervalRef.current) {
        clearInterval(playIntervalRef.current);
        playIntervalRef.current = null;
      }
    };
  }, [isPlaying, playbackSpeed, dates, onDateChange]);

  return {
    isPlaying,
    setIsPlaying,
    togglePlay,
    playbackSpeed,
    setPlaybackSpeed,
  };
}
