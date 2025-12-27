/**
 * useRelays - Core data fetching hook for relay data
 * 
 * Handles:
 * - Fetching and managing date index
 * - Fetching relay data for selected date
 * - Adaptive preloading based on playback state
 * - In-memory caching with LRU eviction
 * - Loading and error states
 * - Date changes and URL hash sync
 * - Data refresh for live updates
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { RelayData, DateIndex } from '../types';
import { fetchWithFallback, sanitizeErrorMessage } from '../utils/data-fetch';
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

export interface UseRelaysOptions {
  /** Whether playback is currently active */
  isPlaying?: boolean;
  /** Current playback speed multiplier (1, 2, or 4) */
  playbackSpeed?: number;
}

/** Maximum number of dates to keep in cache */
const MAX_CACHE_SIZE = 12;

/**
 * Calculate preload range based on playback state
 * - Idle: ±2 days symmetric
 * - Playing: asymmetric, more forward based on speed
 */
function getPreloadRange(isPlaying: boolean, speed: number): { forward: number; backward: number } {
  if (!isPlaying) {
    return { forward: 2, backward: 2 };
  }
  // Scale forward preload with speed: 1x→3, 2x→5, 4x→7
  const forward = Math.min(7, Math.ceil(speed * 2) + 1);
  return { forward, backward: 1 };
}

/**
 * Fetch relay data with fallback path support
 */
async function fetchRelayJson(date: string, options?: { onProgress?: (p: number) => void }) {
  try {
    return await fetchWithFallback<RelayData>(`relays-${date}.json`, options);
  } catch {
    return await fetchWithFallback<RelayData>(`current/relays-${date}.json`, options);
  }
}

/**
 * Fetch and manage relay data with adaptive preloading
 */
export function useRelays(options: UseRelaysOptions = {}): UseRelaysResult {
  const { isPlaying = false, playbackSpeed = 1 } = options;
  
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
  
  // In-memory cache for relay data
  const cacheRef = useRef<Map<string, RelayData>>(new Map());
  // Track dates currently being fetched to avoid duplicate requests
  const fetchingRef = useRef<Set<string>>(new Set());

  // Build date→index lookup for O(1) access (used in eviction)
  const dateIndexMap = useMemo(() => {
    const map = new Map<string, number>();
    dateIndex?.dates.forEach((d, i) => map.set(d, i));
    return map;
  }, [dateIndex]);

  /**
   * Fetch relay data for a single date (used for preloading)
   */
  const fetchRelayDataForDate = useCallback(async (date: string): Promise<RelayData | null> => {
    if (cacheRef.current.has(date) || fetchingRef.current.has(date)) {
      return cacheRef.current.get(date) ?? null;
    }
    
    fetchingRef.current.add(date);
    
    try {
      const result = await fetchRelayJson(date);
      cacheRef.current.set(date, result.data);
      return result.data;
    } catch {
      return null;
    } finally {
      fetchingRef.current.delete(date);
    }
  }, []);

  /**
   * Evict dates furthest from current to keep cache under limit
   */
  const evictDistant = useCallback((currentIdx: number) => {
    if (cacheRef.current.size <= MAX_CACHE_SIZE) return;
    
    // Sort cached dates by distance from current (furthest first)
    const cached = [...cacheRef.current.keys()];
    cached.sort((a, b) => {
      const idxA = dateIndexMap.get(a) ?? 0;
      const idxB = dateIndexMap.get(b) ?? 0;
      return Math.abs(idxB - currentIdx) - Math.abs(idxA - currentIdx);
    });
    
    // Evict furthest until under limit
    while (cacheRef.current.size > MAX_CACHE_SIZE && cached.length > 0) {
      cacheRef.current.delete(cached.shift()!);
    }
  }, [dateIndexMap]);

  /**
   * Preload adjacent dates based on playback state
   */
  const preloadAdjacent = useCallback((currentIdx: number, dates: string[], range: { forward: number; backward: number }) => {
    const toPreload: string[] = [];
    
    // Forward dates first (higher priority during playback)
    for (let i = 1; i <= range.forward && currentIdx + i < dates.length; i++) {
      toPreload.push(dates[currentIdx + i]);
    }
    
    // Then backward dates
    for (let i = 1; i <= range.backward && currentIdx - i >= 0; i++) {
      toPreload.push(dates[currentIdx - i]);
    }
    
    // Filter out already cached or fetching
    const uncached = toPreload.filter(d => !cacheRef.current.has(d) && !fetchingRef.current.has(d));
    if (uncached.length === 0) return;
    
    // Fetch first batch immediately, rest after delay (non-blocking)
    const batch = uncached.slice(0, 3);
    const remaining = uncached.slice(3);
    
    Promise.allSettled(batch.map(fetchRelayDataForDate));
    
    if (remaining.length > 0) {
      setTimeout(() => {
        Promise.allSettled(remaining.map(fetchRelayDataForDate));
      }, 100);
    }
  }, [fetchRelayDataForDate]);

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

      prevDatesRef.current = index.dates;
      setDateIndex(index);

      // Check URL hash for initial date
      const urlParams = parseUrlHash();
      if (urlParams.date && index.dates.includes(urlParams.date)) {
        setCurrentDate(urlParams.date);
      } else if (index.dates.length > 0) {
        setCurrentDate(index.dates[index.dates.length - 1]);
      } else {
        setInitialLoading(false);
        setLoading(false);
      }

      return latestNewDate;
    } catch (err) {
      setError(sanitizeErrorMessage(err));
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
    return fetchIndexData();
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

  // Fetch relay data when date changes (with cache check and staleness detection)
  useEffect(() => {
    if (!currentDate || !dateIndex) return;

    // Track staleness - set to true by cleanup when effect re-runs
    let stale = false;

    // O(1) lookup using precomputed map
    const currentIdx = dateIndexMap.get(currentDate) ?? -1;
    if (currentIdx < 0) return;

    // Check cache first
    const cached = cacheRef.current.get(currentDate);
    if (cached) {
      setRelayData(cached);
      setLoading(false);
      setInitialLoading(false);
      return;
    }
    
    // Not in cache - fetch with loading indicator
    setLoading(true);
    setLoadingStatus('Downloading relay data...');
    
    const onProgress = (p: number) => {
      if (!stale) setLoadingProgress(30 + p * 40);
    };

    fetchRelayJson(currentDate, { onProgress })
      .then(result => {
        // Always cache - data is valid for this date and useful for future playback
        cacheRef.current.set(currentDate, result.data);
        
        // Only update UI if we're still displaying this date
        if (stale) return;
        
        if (result.source === 'fallback') {
          console.info(`[useRelays] Using fallback for relay data ${currentDate}`);
        }
        setLoadingStatus('Processing data...');
        setRelayData(result.data);
        setLoadingProgress(prev => Math.max(prev, 70));
        setError(null);
      })
      .catch((err) => {
        // Don't show errors for dates we've moved past
        if (stale) return;
        setError(sanitizeErrorMessage(err));
      })
      .finally(() => {
        // Don't update loading state for stale requests
        if (stale) return;
        setLoading(false);
        setInitialLoading(false);
      });

    // Cleanup: mark as stale when currentDate changes or component unmounts
    return () => {
      stale = true;
    };
  }, [currentDate, dateIndex, dateIndexMap]);

  // Preload adjacent dates when date or playback state changes
  useEffect(() => {
    if (!currentDate || !dateIndex) return;
    
    const dates = dateIndex.dates;
    const currentIdx = dates.indexOf(currentDate);
    if (currentIdx < 0) return;
    
    const range = getPreloadRange(isPlaying, playbackSpeed);
    preloadAdjacent(currentIdx, dates, range);
    evictDistant(currentIdx);
  }, [currentDate, dateIndex, isPlaying, playbackSpeed, preloadAdjacent, evictDistant]);

  // Compute relay stats
  const relayStats = useMemo(() => {
    if (!relayData?.nodes) return null;
    return {
      relayCount: relayData.nodes.reduce((sum, n) => sum + n.relays.length, 0),
      locationCount: relayData.nodes.length,
    };
  }, [relayData]);

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