/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDatePlayback } from '../../../src/lib/hooks/useDatePlayback';

describe('useDatePlayback', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  const defaultDates = ['2024-01-13', '2024-01-14', '2024-01-15'];

  describe('initial state', () => {
    it('starts with isPlaying false', () => {
      const onDateChange = vi.fn();
      const { result } = renderHook(() =>
        useDatePlayback({
          dates: defaultDates,
          currentDate: '2024-01-14',
          onDateChange,
        })
      );

      expect(result.current.isPlaying).toBe(false);
      expect(result.current.playbackSpeed).toBe(1.0);
    });

    it('does not call onDateChange when not playing', () => {
      const onDateChange = vi.fn();
      renderHook(() =>
        useDatePlayback({
          dates: defaultDates,
          currentDate: '2024-01-14',
          onDateChange,
        })
      );

      vi.advanceTimersByTime(1000);
      expect(onDateChange).not.toHaveBeenCalled();
    });
  });

  describe('play/pause', () => {
    it('togglePlay toggles isPlaying state', () => {
      const onDateChange = vi.fn();
      const { result } = renderHook(() =>
        useDatePlayback({
          dates: defaultDates,
          currentDate: '2024-01-14',
          onDateChange,
        })
      );

      expect(result.current.isPlaying).toBe(false);

      act(() => {
        result.current.togglePlay();
      });

      expect(result.current.isPlaying).toBe(true);

      act(() => {
        result.current.togglePlay();
      });

      expect(result.current.isPlaying).toBe(false);
    });

    it('setIsPlaying sets playing state directly', () => {
      const onDateChange = vi.fn();
      const { result } = renderHook(() =>
        useDatePlayback({
          dates: defaultDates,
          currentDate: '2024-01-14',
          onDateChange,
        })
      );

      act(() => {
        result.current.setIsPlaying(true);
      });

      expect(result.current.isPlaying).toBe(true);

      act(() => {
        result.current.setIsPlaying(false);
      });

      expect(result.current.isPlaying).toBe(false);
    });
  });

  describe('playback interval', () => {
    it('advances to next date at interval when playing', () => {
      const onDateChange = vi.fn();
      const { result } = renderHook(() =>
        useDatePlayback({
          dates: defaultDates,
          currentDate: '2024-01-13',
          onDateChange,
        })
      );

      act(() => {
        result.current.setIsPlaying(true);
      });

      // Wait for interval (500ms at 1x speed)
      act(() => {
        vi.advanceTimersByTime(500);
      });

      expect(onDateChange).toHaveBeenCalledWith('2024-01-14');
    });

    it('stops advancing when paused', () => {
      const onDateChange = vi.fn();
      const { result } = renderHook(() =>
        useDatePlayback({
          dates: defaultDates,
          currentDate: '2024-01-13',
          onDateChange,
        })
      );

      // Start playing
      act(() => {
        result.current.setIsPlaying(true);
      });

      act(() => {
        vi.advanceTimersByTime(500);
      });

      expect(onDateChange).toHaveBeenCalledTimes(1);

      // Pause
      act(() => {
        result.current.setIsPlaying(false);
      });

      // Should not advance further
      act(() => {
        vi.advanceTimersByTime(1000);
      });

      expect(onDateChange).toHaveBeenCalledTimes(1);
    });
  });

  describe('playback speed', () => {
    it('setPlaybackSpeed changes interval timing', () => {
      const onDateChange = vi.fn();
      const { result } = renderHook(() =>
        useDatePlayback({
          dates: defaultDates,
          currentDate: '2024-01-13',
          onDateChange,
        })
      );

      // Set 2x speed (250ms interval)
      act(() => {
        result.current.setPlaybackSpeed(2.0);
        result.current.setIsPlaying(true);
      });

      // At 2x speed, interval should be 250ms
      act(() => {
        vi.advanceTimersByTime(250);
      });

      expect(onDateChange).toHaveBeenCalledWith('2024-01-14');
    });

    it('slower speed increases interval', () => {
      const onDateChange = vi.fn();
      const { result } = renderHook(() =>
        useDatePlayback({
          dates: defaultDates,
          currentDate: '2024-01-13',
          onDateChange,
        })
      );

      // Set 0.5x speed (1000ms interval)
      act(() => {
        result.current.setPlaybackSpeed(0.5);
        result.current.setIsPlaying(true);
      });

      // At 0.5x speed, 500ms should not trigger yet
      act(() => {
        vi.advanceTimersByTime(500);
      });

      expect(onDateChange).not.toHaveBeenCalled();

      // After 1000ms it should trigger
      act(() => {
        vi.advanceTimersByTime(500);
      });

      expect(onDateChange).toHaveBeenCalledWith('2024-01-14');
    });
  });

  describe('looping', () => {
    it('loops back to first date when reaching end', () => {
      const onDateChange = vi.fn();
      const { result } = renderHook(() =>
        useDatePlayback({
          dates: defaultDates,
          currentDate: '2024-01-15', // Last date
          onDateChange,
        })
      );

      act(() => {
        result.current.setIsPlaying(true);
      });

      act(() => {
        vi.advanceTimersByTime(500);
      });

      // Should loop back to first date
      expect(onDateChange).toHaveBeenCalledWith('2024-01-13');
    });

    it('continues playback after looping', () => {
      const onDateChange = vi.fn();
      let currentDate = '2024-01-15';
      
      const { result, rerender } = renderHook(() =>
        useDatePlayback({
          dates: defaultDates,
          currentDate,
          onDateChange: (date) => {
            currentDate = date;
            onDateChange(date);
          },
        })
      );

      act(() => {
        result.current.setIsPlaying(true);
      });

      // First interval: loops to start
      act(() => {
        vi.advanceTimersByTime(500);
      });
      
      rerender();

      // Second interval: advances to second date
      act(() => {
        vi.advanceTimersByTime(500);
      });

      expect(onDateChange).toHaveBeenNthCalledWith(1, '2024-01-13');
      expect(onDateChange).toHaveBeenNthCalledWith(2, '2024-01-14');
    });
  });

  describe('edge cases', () => {
    it('handles empty dates array', () => {
      const onDateChange = vi.fn();
      const { result } = renderHook(() =>
        useDatePlayback({
          dates: [],
          currentDate: null,
          onDateChange,
        })
      );

      act(() => {
        result.current.setIsPlaying(true);
      });

      act(() => {
        vi.advanceTimersByTime(1000);
      });

      // Should not crash or call onDateChange
      expect(onDateChange).not.toHaveBeenCalled();
    });

    it('handles single date', () => {
      const onDateChange = vi.fn();
      const { result } = renderHook(() =>
        useDatePlayback({
          dates: ['2024-01-15'],
          currentDate: '2024-01-15',
          onDateChange,
        })
      );

      act(() => {
        result.current.setIsPlaying(true);
      });

      act(() => {
        vi.advanceTimersByTime(500);
      });

      // Should loop back to the same date
      expect(onDateChange).toHaveBeenCalledWith('2024-01-15');
    });

    it('handles currentDate not in dates array', () => {
      const onDateChange = vi.fn();
      const { result } = renderHook(() =>
        useDatePlayback({
          dates: defaultDates,
          currentDate: '2024-01-16', // Not in array
          onDateChange,
        })
      );

      act(() => {
        result.current.setIsPlaying(true);
      });

      act(() => {
        vi.advanceTimersByTime(500);
      });

      // Should start from beginning when current date not found
      expect(onDateChange).toHaveBeenCalledWith('2024-01-13');
    });
  });
});

