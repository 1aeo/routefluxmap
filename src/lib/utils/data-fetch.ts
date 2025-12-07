/**
 * Data fetching utilities with primary/fallback support
 * 
 * Tries primary data URL first, falls back to secondary if primary fails.
 * Both URLs are configured via environment variables at build time.
 */

// Get data URLs from environment (set at build time)
const PRIMARY_DATA_URL = import.meta.env.PUBLIC_DATA_URL || '';
const FALLBACK_DATA_URL = import.meta.env.PUBLIC_DATA_URL_FALLBACK || '';

interface FetchResult<T> {
  data: T;
  source: 'local' | 'primary' | 'fallback';
}

/**
 * Fetch data with automatic fallback
 * 
 * Order of attempts:
 * 1. Local /data/ path (for development or bundled data)
 * 2. Primary data URL (e.g., DO Spaces)
 * 3. Fallback data URL (e.g., R2)
 */
export async function fetchWithFallback<T>(
  path: string,
  options?: RequestInit
): Promise<FetchResult<T>> {
  const errors: string[] = [];

  // 1. Try local first (for dev or bundled data)
  try {
    const localPath = path.startsWith('/') ? path : `/data/${path}`;
    const response = await fetch(localPath, options);
    if (response.ok) {
      const data = await response.json();
      return { data, source: 'local' };
    }
  } catch {
    // Local not available, continue to remote
  }

  // 2. Try primary data URL
  if (PRIMARY_DATA_URL) {
    try {
      const url = `${PRIMARY_DATA_URL}/${path}`;
      const response = await fetch(url, options);
      if (response.ok) {
        const data = await response.json();
        return { data, source: 'primary' };
      }
      errors.push(`Primary (${response.status})`);
    } catch (err: any) {
      errors.push(`Primary (${err.message})`);
    }
  }

  // 3. Try fallback data URL
  if (FALLBACK_DATA_URL) {
    try {
      const url = `${FALLBACK_DATA_URL}/${path}`;
      const response = await fetch(url, options);
      if (response.ok) {
        const data = await response.json();
        console.info(`[DataFetch] Using fallback for ${path}`);
        return { data, source: 'fallback' };
      }
      errors.push(`Fallback (${response.status})`);
    } catch (err: any) {
      errors.push(`Fallback (${err.message})`);
    }
  }

  // All sources failed
  throw new Error(`Failed to fetch ${path}: ${errors.join(', ')}`);
}

/**
 * Fetch JSON from data URL with fallback support
 */
export async function fetchDataJson<T>(filename: string): Promise<T> {
  const { data } = await fetchWithFallback<T>(filename);
  return data;
}

/**
 * Fetch relay data for a specific date
 */
export async function fetchRelayData(date: string) {
  // Try flat structure first, then current/ subdirectory
  try {
    return await fetchWithFallback(`relays-${date}.json`);
  } catch {
    return await fetchWithFallback(`current/relays-${date}.json`);
  }
}

/**
 * Fetch country data for a specific date
 */
export async function fetchCountryData(date: string) {
  return await fetchWithFallback(`countries-${date}.json`);
}

/**
 * Fetch the date index
 */
export async function fetchDateIndex() {
  return await fetchWithFallback('index.json');
}

/**
 * Get configured data URLs for debugging
 */
export function getDataUrlConfig() {
  return {
    primary: PRIMARY_DATA_URL || '(not set)',
    fallback: FALLBACK_DATA_URL || '(not set)',
  };
}

