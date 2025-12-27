/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useRelays } from '../../../src/lib/hooks/useRelays';
import { mockDateIndex, mockRelayData, mockFetchResponse } from './test-utils';

describe('useRelays', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    // Reset URL hash
    window.location.hash = '';
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.clearAllMocks();
  });

  describe('initial loading state', () => {
    it('starts with loading states true', () => {
      // Mock fetch that never resolves (to test initial state)
      (global.fetch as any).mockImplementation(() => new Promise(() => {}));

      const { result } = renderHook(() => useRelays());

      expect(result.current.initialLoading).toBe(true);
      expect(result.current.loading).toBe(true);
      expect(result.current.relayData).toBeNull();
      expect(result.current.dateIndex).toBeNull();
      expect(result.current.currentDate).toBeNull();
    });

    it('shows loading status message', async () => {
      (global.fetch as any).mockImplementation(() => new Promise(() => {}));

      const { result } = renderHook(() => useRelays());

      // Initial status is 'Initializing...' but quickly becomes 'Loading index...'
      // Both are valid loading states
      expect(['Initializing...', 'Loading index...']).toContain(result.current.loadingStatus);
    });
  });

  describe('successful data fetch', () => {
    it('fetches index and relay data', async () => {
      const dateIndex = mockDateIndex();
      const relayData = mockRelayData();

      (global.fetch as any)
        // First call: index.json
        .mockResolvedValueOnce(mockFetchResponse(dateIndex))
        // Second call: relay data
        .mockResolvedValueOnce(mockFetchResponse(relayData));

      const { result } = renderHook(() => useRelays());

      await waitFor(() => {
        expect(result.current.initialLoading).toBe(false);
      });

      expect(result.current.dateIndex).toEqual(dateIndex);
      expect(result.current.relayData).toEqual(relayData);
      expect(result.current.currentDate).toBe('2024-01-15'); // Latest date
      expect(result.current.error).toBeNull();
    });

    it('defaults to latest date when no URL hash', async () => {
      const dateIndex = mockDateIndex({
        dates: ['2024-01-10', '2024-01-11', '2024-01-12'],
      });

      (global.fetch as any)
        .mockResolvedValueOnce(mockFetchResponse(dateIndex))
        .mockResolvedValueOnce(mockFetchResponse(mockRelayData()));

      const { result } = renderHook(() => useRelays());

      await waitFor(() => {
        expect(result.current.currentDate).toBe('2024-01-12');
      });
    });

    it('computes relay stats correctly', async () => {
      const relayData = mockRelayData({
        nodes: [
          { ...mockRelayData().nodes[0], relays: [{} as any, {} as any] },
          { ...mockRelayData().nodes[1], relays: [{} as any] },
        ],
      });

      (global.fetch as any)
        .mockResolvedValueOnce(mockFetchResponse(mockDateIndex()))
        .mockResolvedValueOnce(mockFetchResponse(relayData));

      const { result } = renderHook(() => useRelays());

      await waitFor(() => {
        expect(result.current.relayStats).not.toBeNull();
      });

      expect(result.current.relayStats?.relayCount).toBe(3);
      expect(result.current.relayStats?.locationCount).toBe(2);
    });
  });

  describe('error handling', () => {
    it('sets error state when index fetch fails', async () => {
      (global.fetch as any).mockRejectedValueOnce(new Error('Network error'));

      const { result } = renderHook(() => useRelays());

      await waitFor(() => {
        expect(result.current.error).not.toBeNull();
      });

      // Error messages are sanitized to prevent info leakage
      expect(result.current.error).toMatch(/Unable to load data|Network error|Request failed/);
      expect(result.current.loading).toBe(false);
      expect(result.current.initialLoading).toBe(false);
    });

    it('sets error state when relay fetch fails', async () => {
      (global.fetch as any)
        .mockResolvedValueOnce(mockFetchResponse(mockDateIndex()))
        .mockRejectedValueOnce(new Error('Relay fetch failed'))
        .mockRejectedValueOnce(new Error('Relay fetch failed'));

      const { result } = renderHook(() => useRelays());

      await waitFor(() => {
        expect(result.current.error).not.toBeNull();
      });

      // Error messages are sanitized to prevent info leakage
      expect(result.current.error).toMatch(/Unable to load data|Request failed/);
    });
  });

  describe('date changes', () => {
    it('fetches new relay data when date changes', async () => {
      const dateIndex = mockDateIndex({
        dates: ['2024-01-14', '2024-01-15'],
      });
      const relayData1 = mockRelayData({ published: '2024-01-15' });
      const relayData2 = mockRelayData({ published: '2024-01-14' });

      (global.fetch as any)
        .mockResolvedValueOnce(mockFetchResponse(dateIndex))
        .mockResolvedValueOnce(mockFetchResponse(relayData1))
        .mockResolvedValueOnce(mockFetchResponse(relayData2));

      const { result } = renderHook(() => useRelays());

      // Wait for initial load
      await waitFor(() => {
        expect(result.current.relayData?.published).toBe('2024-01-15');
      });

      // Change date
      act(() => {
        result.current.setCurrentDate('2024-01-14');
      });

      await waitFor(() => {
        expect(result.current.relayData?.published).toBe('2024-01-14');
      });
    });

    it('updates URL hash when date changes', async () => {
      (global.fetch as any)
        .mockResolvedValueOnce(mockFetchResponse(mockDateIndex()))
        .mockResolvedValueOnce(mockFetchResponse(mockRelayData()));

      const { result } = renderHook(() => useRelays());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      act(() => {
        result.current.setCurrentDate('2024-01-14');
      });

      expect(window.location.hash).toContain('2024-01-14');
    });
  });

  describe('refresh', () => {
    it('refresh returns null when no new dates', async () => {
      const dateIndex = mockDateIndex();

      (global.fetch as any)
        .mockResolvedValueOnce(mockFetchResponse(dateIndex))
        .mockResolvedValueOnce(mockFetchResponse(mockRelayData()))
        // Preload of adjacent date after relay data loads
        .mockResolvedValueOnce(mockFetchResponse(mockRelayData({ published: '2024-01-14' })))
        // Refresh call
        .mockResolvedValueOnce(mockFetchResponse(dateIndex));

      const { result } = renderHook(() => useRelays());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      let refreshResult: string | null = null;
      await act(async () => {
        refreshResult = await result.current.refresh();
      });

      expect(refreshResult).toBeNull();
    });

    it('refresh returns new date when available', async () => {
      const dateIndex1 = mockDateIndex({
        dates: ['2024-01-14', '2024-01-15'],
      });
      const dateIndex2 = mockDateIndex({
        dates: ['2024-01-14', '2024-01-15', '2024-01-16'],
      });

      (global.fetch as any)
        .mockResolvedValueOnce(mockFetchResponse(dateIndex1))
        .mockResolvedValueOnce(mockFetchResponse(mockRelayData()))
        // Preload of adjacent date (2024-01-14) after relay data loads
        .mockResolvedValueOnce(mockFetchResponse(mockRelayData({ published: '2024-01-14' })))
        // Refresh call returns updated index
        .mockResolvedValueOnce(mockFetchResponse(dateIndex2));

      const { result } = renderHook(() => useRelays());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      let refreshResult: string | null = null;
      await act(async () => {
        refreshResult = await result.current.refresh();
      });

      expect(refreshResult).toBe('2024-01-16');
    });
  });
});

