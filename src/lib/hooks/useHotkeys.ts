/**
 * useHotkeys - Keyboard shortcuts
 * 
 * Registers keyboard event listeners for:
 * - H: Toggle cinema mode
 * - Left/Right arrows: Navigate dates
 * - Space: Toggle playback
 * - Home/End: Jump to first/last date
 */

import { useEffect } from 'react';
import { updateUrlHash } from '../utils/url';

export interface UseHotkeysOptions {
  /** Available dates */
  dates: string[];
  /** Current date */
  currentDate: string | null;
  /** Callback to change date */
  onDateChange: (date: string) => void;
  /** Whether playback is active */
  isPlaying: boolean;
  /** Callback to toggle playback */
  onTogglePlay: () => void;
  /** Whether cinema mode is active */
  cinemaMode: boolean;
  /** Callback to toggle cinema mode */
  onToggleCinemaMode: () => void;
}

/**
 * Register keyboard shortcuts
 * 
 * This hook doesn't return anything - it just registers event listeners.
 */
export function useHotkeys(options: UseHotkeysOptions): void {
  const {
    dates,
    currentDate,
    onDateChange,
    isPlaying,
    onTogglePlay,
    cinemaMode,
    onToggleCinemaMode,
  } = options;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if user is typing in an input
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      const currentIdx = currentDate && dates.length > 0
        ? dates.indexOf(currentDate)
        : -1;

      // Helper to navigate and update URL hash
      const navigateTo = (date: string) => {
        onDateChange(date);
        updateUrlHash({ date });
      };

      switch (e.key) {
        case 'h':
        case 'H':
          onToggleCinemaMode();
          break;

        case 'ArrowLeft':
          if (dates.length > 0 && currentIdx > 0) {
            navigateTo(dates[currentIdx - 1]);
          }
          break;

        case 'ArrowRight':
          if (dates.length > 0 && currentIdx >= 0 && currentIdx < dates.length - 1) {
            navigateTo(dates[currentIdx + 1]);
          }
          break;

        case ' ':
          e.preventDefault();
          onTogglePlay();
          break;

        case 'Home':
          e.preventDefault();
          if (dates.length > 0 && currentIdx > 0) {
            navigateTo(dates[0]);
          }
          break;

        case 'End':
          e.preventDefault();
          if (dates.length > 0 && currentIdx >= 0 && currentIdx < dates.length - 1) {
            navigateTo(dates[dates.length - 1]);
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [dates, currentDate, onDateChange, isPlaying, onTogglePlay, cinemaMode, onToggleCinemaMode]);
}

