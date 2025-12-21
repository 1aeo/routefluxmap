/**
 * useDatePlayback - Timeline animation control
 * 
 * Manages date animation playback:
 * - Play/pause state
 * - Playback speed
 * - Interval-based date advancement
 * - Looping when reaching end
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
}

/** Base interval in ms at 1x speed */
const BASE_INTERVAL_MS = 500;

/**
 * Manage date playback animation
 */
export function useDatePlayback(options: UseDatePlaybackOptions): UseDatePlaybackResult {
  const { dates, currentDate, onDateChange } = options;
  
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0);
  
  // Use refs to avoid recreating interval on every state change
  const playIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const currentDateRef = useRef(currentDate);
  
  // Keep ref in sync with prop
  currentDateRef.current = currentDate;

  /**
   * Toggle play/pause
   */
  const togglePlay = useCallback(() => {
    setIsPlaying(prev => !prev);
  }, []);

  // Playback interval effect
  useEffect(() => {
    // Clear existing interval
    if (playIntervalRef.current) {
      clearInterval(playIntervalRef.current);
      playIntervalRef.current = null;
    }

    // Don't start if not playing or no dates
    if (!isPlaying || !dates.length) {
      return;
    }

    const intervalMs = Math.round(BASE_INTERVAL_MS / playbackSpeed);

    playIntervalRef.current = setInterval(() => {
      const currentIdx = currentDateRef.current 
        ? dates.indexOf(currentDateRef.current) 
        : -1;
      
      const isAtEnd = currentIdx < 0 || currentIdx >= dates.length - 1;

      // Loop back to start when reaching end
      if (isAtEnd) {
        onDateChange(dates[0]);
      } else {
        onDateChange(dates[currentIdx + 1]);
      }
    }, intervalMs);

    // Cleanup on unmount or deps change
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

