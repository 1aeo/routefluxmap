/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMapView } from '../../../src/lib/hooks/useMapView';

// Mock @deck.gl/core
vi.mock('@deck.gl/core', () => ({
  FlyToInterpolator: vi.fn().mockImplementation(() => ({})),
}));

describe('useMapView', () => {
  beforeEach(() => {
    // Reset URL hash before each test
    window.location.hash = '';
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('initial state', () => {
    it('uses default view state when no URL hash', () => {
      const { result } = renderHook(() => useMapView());

      expect(result.current.viewState.longitude).toBe(-40);
      expect(result.current.viewState.latitude).toBe(30);
      expect(result.current.viewState.zoom).toBe(2);
      expect(result.current.viewState.pitch).toBe(0);
      expect(result.current.viewState.bearing).toBe(0);
    });

    it('parses map location from URL hash', () => {
      window.location.hash = '#ML=10.5,20.5,5';

      const { result } = renderHook(() => useMapView());

      expect(result.current.viewState.longitude).toBe(10.5);
      expect(result.current.viewState.latitude).toBe(20.5);
      expect(result.current.viewState.zoom).toBe(5);
    });

    it('centers on country when CC parameter present', () => {
      window.location.hash = '#CC=US';

      const { result } = renderHook(() => useMapView());

      // US centroid is approximately [-95.7, 37.1]
      expect(result.current.viewState.longitude).toBeCloseTo(-95.7, 0);
      expect(result.current.viewState.latitude).toBeCloseTo(37.1, 0);
      expect(result.current.viewState.zoom).toBe(5); // COUNTRY_ZOOM
    });

    it('prioritizes ML over CC when both present', () => {
      window.location.hash = '#ML=10,20,8&CC=US';

      const { result } = renderHook(() => useMapView());

      expect(result.current.viewState.longitude).toBe(10);
      expect(result.current.viewState.latitude).toBe(20);
      expect(result.current.viewState.zoom).toBe(8);
    });
  });

  describe('setViewState', () => {
    it('updates view state directly', () => {
      const { result } = renderHook(() => useMapView());

      act(() => {
        result.current.setViewState({
          longitude: 100,
          latitude: 50,
          zoom: 10,
          pitch: 45,
          bearing: 90,
        });
      });

      expect(result.current.viewState.longitude).toBe(100);
      expect(result.current.viewState.latitude).toBe(50);
      expect(result.current.viewState.zoom).toBe(10);
      expect(result.current.viewState.pitch).toBe(45);
      expect(result.current.viewState.bearing).toBe(90);
    });
  });

  describe('handleViewStateChange', () => {
    it('updates view state from DeckGL event', () => {
      const { result } = renderHook(() => useMapView());

      act(() => {
        result.current.handleViewStateChange({
          viewState: {
            longitude: 15,
            latitude: 25,
            zoom: 6,
            pitch: 0,
            bearing: 0,
          },
        });
      });

      expect(result.current.viewState.longitude).toBe(15);
      expect(result.current.viewState.latitude).toBe(25);
      expect(result.current.viewState.zoom).toBe(6);
    });

    it('debounces URL updates', async () => {
      vi.useFakeTimers();
      const { result } = renderHook(() => useMapView());

      // Multiple rapid changes
      act(() => {
        result.current.handleViewStateChange({
          viewState: { longitude: 10, latitude: 20, zoom: 5, pitch: 0, bearing: 0 },
        });
      });
      act(() => {
        result.current.handleViewStateChange({
          viewState: { longitude: 11, latitude: 21, zoom: 5, pitch: 0, bearing: 0 },
        });
      });
      act(() => {
        result.current.handleViewStateChange({
          viewState: { longitude: 12, latitude: 22, zoom: 5, pitch: 0, bearing: 0 },
        });
      });

      // URL should not be updated yet (debounce pending)
      expect(window.location.hash).toBe('');

      // Advance timers past debounce delay
      await act(async () => {
        vi.advanceTimersByTime(350);
      });

      // URL should contain the final values
      expect(window.location.hash).toContain('ML=');

      vi.useRealTimers();
    });
  });

  describe('flyToCountry', () => {
    it('flies to country centroid', () => {
      const { result } = renderHook(() => useMapView());

      act(() => {
        result.current.flyToCountry('DE');
      });

      // Germany centroid is approximately [10.4, 51.2]
      expect(result.current.viewState.longitude).toBeCloseTo(10.4, 0);
      expect(result.current.viewState.latitude).toBeCloseTo(51.2, 0);
      expect(result.current.viewState.zoom).toBe(5);
    });

    it('handles unknown country codes gracefully', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { result } = renderHook(() => useMapView());

      const initialLng = result.current.viewState.longitude;

      act(() => {
        result.current.flyToCountry('XX');
      });

      // View state should not change
      expect(result.current.viewState.longitude).toBe(initialLng);
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Unknown country code'));

      consoleSpy.mockRestore();
    });

    it('updates URL with country code', () => {
      const { result } = renderHook(() => useMapView());

      act(() => {
        result.current.flyToCountry('FR');
      });

      expect(window.location.hash).toContain('CC=FR');
      expect(window.location.hash).toContain('ML=');
    });
  });

  describe('flyToLocation', () => {
    it('flies to specific coordinates', () => {
      const { result } = renderHook(() => useMapView());

      act(() => {
        result.current.flyToLocation(50, 40, 8);
      });

      expect(result.current.viewState.longitude).toBe(50);
      expect(result.current.viewState.latitude).toBe(40);
      expect(result.current.viewState.zoom).toBe(8);
    });

    it('uses clamped zoom when not specified', () => {
      const { result } = renderHook(() => useMapView());

      // Set initial zoom to something low
      act(() => {
        result.current.setViewState({
          ...result.current.viewState,
          zoom: 3,
        });
      });

      act(() => {
        result.current.flyToLocation(50, 40);
      });

      // Zoom should be clamped to FOCUS_ZOOM_MIN (6)
      expect(result.current.viewState.zoom).toBe(6);
    });

    it('clamps zoom to max when current zoom is high', () => {
      const { result } = renderHook(() => useMapView());

      // Set initial zoom to something high
      act(() => {
        result.current.setViewState({
          ...result.current.viewState,
          zoom: 15,
        });
      });

      act(() => {
        result.current.flyToLocation(50, 40);
      });

      // Zoom should be clamped to FOCUS_ZOOM_MAX (10)
      expect(result.current.viewState.zoom).toBe(10);
    });
  });
});

