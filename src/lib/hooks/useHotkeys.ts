/**
 * useHotkeys - Keyboard shortcuts
 * 
 * Registers keyboard event listeners for:
 * - H: Toggle cinema mode
 * - Left/Right arrows: Navigate dates
 * - Space: Toggle playback
 * - Home/End: Jump to first/last date
 * - +/-: Zoom in/out
 * - C/R/P: Toggle countries/relays/particles layers
 * - S: Toggle settings panel
 * - ?: Show keyboard shortcuts help
 * - Escape: Close modals/popups
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
  /** Callback to toggle playback */
  onTogglePlay: () => void;
  /** Callback to toggle cinema mode */
  onToggleCinemaMode: () => void;
  /** Callback to toggle layer visibility */
  onToggleLayer?: (layer: 'relays' | 'countries' | 'particles') => void;
  /** Callback to toggle settings panel */
  onToggleSettings?: () => void;
  /** Callback to show keyboard help */
  onShowHelp?: () => void;
  /** Callback to zoom */
  onZoom?: (delta: number) => void;
  /** Callback to close (Escape key) */
  onClose?: () => void;
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
    onTogglePlay,
    onToggleCinemaMode,
    onToggleLayer,
    onToggleSettings,
    onShowHelp,
    onZoom,
    onClose,
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
        // Cinema mode
        case 'h':
        case 'H':
          onToggleCinemaMode();
          break;

        // Date navigation
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

        // Playback
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

        // Layer toggles
        case 'c':
        case 'C':
          onToggleLayer?.('countries');
          break;

        case 'r':
        case 'R':
          onToggleLayer?.('relays');
          break;

        case 'p':
        case 'P':
          onToggleLayer?.('particles');
          break;

        // Settings panel
        case 's':
        case 'S':
          onToggleSettings?.();
          break;

        // Help
        case '?':
          onShowHelp?.();
          break;

        // Zoom
        case '+':
        case '=':
          onZoom?.(1);
          break;

        case '-':
        case '_':
          onZoom?.(-1);
          break;

        // Close/Escape
        case 'Escape':
          onClose?.();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [dates, currentDate, onDateChange, onTogglePlay, onToggleCinemaMode, onToggleLayer, onToggleSettings, onShowHelp, onZoom, onClose]);
}

