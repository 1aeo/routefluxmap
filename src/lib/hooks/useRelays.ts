/**
 * useRelays - Core data fetching hook for relay data
 * 
 * Handles:
 * - Fetching and managing date index
 * - Fetching relay data for selected date
 * - Loading and error states
 * - Date changes and URL hash sync
 * - Data refresh for live updates
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type { RelayData, DateIndex } from '../types';
import { fetchWithFallback } from '../utils/data-fetch';
import { parseUrlHash, updateUrlHash } from '../utils/url';

export interface UseRelaysResult {
  /** Current relay data for selected date */
  relayData: RelayData | null;
  /** Available dates and metadata */
  dateIndex: DateIndex | null;
  /** Currently selected date (YYYY-MM-DD) */
  currentDate: string | null;
  /** Whether initial data is loading */
  initialLoading: boolean;
  /** Whether data is loading (including date changes) */
  loading: boolean;
  /** Error message if fetch failed */
  error: string | null;
  /** Loading status message */
  loadingStatus: string;
  /** Loading progress (0-100) */
  loadingProgress: number;
  /** Change the current date */
  setCurrentDate: (date: string) => void;
  /** Refresh data from server, returns new date if found */
  refresh: () => Promise<string | null>;
  /** Computed relay stats */
  relayStats: { relayCount: number; locationCount: number } | null;
}

/**
 * Fetch and manage relay data
 */
export function useRelays(): UseRelaysResult {
  const [relayData, setRelayData] = useState<RelayData | null>(null);
  const [dateIndex, setDateIndex] = useState<DateIndex | null>(null);
  const [currentDate, setCurrentDate] = useState<string | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadingStatus, setLoadingStatus] = useState('Initializing...');
  const [loadingProgress, setLoadingProgress] = useState(0);

  // Track previously known dates to detect new ones
  const prevDatesRef = useRef<string[]>([]);
  // Track previous relay data for change detection
  const prevRelayDataRef = useRef<RelayData | null>(null);

  /**
   * Fetch index and return new date if found
   */
  const fetchIndexData = useCallback(async (): Promise<string | null> => {
    try {
      setLoadingStatus('Loading index...');
      setLoadingProgress(10);
      
      const { data: index, source } = await fetchWithFallback<DateIndex>('index.json');
      
      if (source === 'fallback') {
        console.info('[useRelays] Using fallback data source for index');
      }

      // Check for new dates
      const prevDates = prevDatesRef.current;
      const newDates = index.dates.filter(d => !prevDates.includes(d));
      const latestNewDate = newDates.length > 0 ? newDates[newDates.length - 1] : null;

      // Update tracking
      prevDatesRef.current = index.dates;
      setDateIndex(index);

      // Check URL hash for initial date
      const urlParams = parseUrlHash();
      if (urlParams.date && index.dates.includes(urlParams.date)) {
        setCurrentDate(urlParams.date);
      } else if (index.dates.length > 0) {
        // Default to latest date
        setCurrentDate(index.dates[index.dates.length - 1]);
      } else {
        // No dates available - stop loading state
        setInitialLoading(false);
        setLoading(false);
      }

      return latestNewDate;
    } catch (err: any) {
      setError(err.message);
      setLoading(false);
      setInitialLoading(false);
      return null;
    }
  }, []);

  /**
   * Handle data refresh - returns new date if found
   */
  const refresh = useCallback(async (): Promise<string | null> => {
    console.info('[useRelays] Refreshing data...');
    return await fetchIndexData();
  }, [fetchIndexData]);

  /**
   * Handle date change with URL update
   */
  const handleDateChange = useCallback((date: string) => {
    setCurrentDate(date);
    updateUrlHash({ date });
  }, []);

  // Initial fetch on mount
  useEffect(() => {
    fetchIndexData();
  }, [fetchIndexData]);

  // Listen for URL hash changes
  useEffect(() => {
    const handleHashChange = () => {
      const params = parseUrlHash();
      if (params.date && dateIndex?.dates.includes(params.date)) {
        setCurrentDate(params.date);
      }
    };

    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, [dateIndex]);

  // Fetch relay data when date changes
  useEffect(() => {
    if (!currentDate) return;

    async function fetchRelays() {
      setLoading(true);
      setLoadingStatus('Downloading relay data...');
      
      // Progress handler: map 0-1 download progress to 30-70% total loading
      const onProgress = (p: number) => setLoadingProgress(30 + p * 40);

      try {
        // Try flat structure first, then current/ subdirectory
        let result;
        try {
          result = await fetchWithFallback<RelayData>(`relays-${currentDate}.json`, { onProgress });
        } catch {
          result = await fetchWithFallback<RelayData>(`current/relays-${currentDate}.json`, { onProgress });
        }

        if (result.source === 'fallback') {
          console.info(`[useRelays] Using fallback for relay data ${currentDate}`);
        }

        setLoadingStatus('Processing data...');

        prevRelayDataRef.current = result.data;
        setRelayData(result.data);
        setLoadingProgress(prev => Math.max(prev, 70));
        setError(null);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
        setInitialLoading(false);
      }
    }

    fetchRelays();
  }, [currentDate]);

  // Compute relay stats (memoized via dependency)
  const relayStats = relayData?.nodes
    ? {
        relayCount: relayData.nodes.reduce((sum, n) => sum + n.relays.length, 0),
        locationCount: relayData.nodes.length,
      }
    : null;

  return {
    relayData,
    dateIndex,
    currentDate,
    initialLoading,
    loading,
    error,
    loadingStatus,
    loadingProgress,
    setCurrentDate: handleDateChange,
    refresh,
    relayStats,
  };
}

