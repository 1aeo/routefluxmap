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

interface FetchOptions extends RequestInit {
  onProgress?: (progress: number) => void;
}

/**
 * Helper to fetch with progress tracking
 */
async function fetchWithProgress<T>(url: string, options?: FetchOptions): Promise<T> {
  const response = await fetch(url, options);
  
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  // If no progress callback or no content-length, fallback to standard json()
  const contentLength = response.headers.get('Content-Length');
  if (!options?.onProgress || !contentLength) {
    return response.json();
  }

  const total = parseInt(contentLength, 10);
  let loaded = 0;

  const reader = response.body?.getReader();
  if (!reader) {
    return response.json();
  }

  const chunks: Uint8Array[] = [];
  
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    
    if (value) {
      chunks.push(value);
      loaded += value.length;
      options.onProgress(Math.min(1.0, loaded / total));
    }
  }

  // Reassemble JSON
  const allChunks = new Uint8Array(loaded);
  let position = 0;
  for (const chunk of chunks) {
    allChunks.set(chunk, position);
    position += chunk.length;
  }
  
  const text = new TextDecoder('utf-8').decode(allChunks);
  return JSON.parse(text);
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
  options?: FetchOptions
): Promise<FetchResult<T>> {
  const errors: string[] = [];

  // 1. Try local first (for dev or bundled data)
  try {
    const localPath = path.startsWith('/') ? path : `/data/${path}`;
    const data = await fetchWithProgress<T>(localPath, options);
    return { data, source: 'local' };
  } catch {
    // Local not available, continue to remote
  }

  // 2. Try primary data URL
  if (PRIMARY_DATA_URL) {
    try {
      const url = `${PRIMARY_DATA_URL}/${path}`;
      const data = await fetchWithProgress<T>(url, options);
      return { data, source: 'primary' };
    } catch (err: any) {
      errors.push(`Primary (${err.message})`);
    }
  }

  // 3. Try fallback data URL
  if (FALLBACK_DATA_URL) {
    try {
      const url = `${FALLBACK_DATA_URL}/${path}`;
      const data = await fetchWithProgress<T>(url, options);
      console.info(`[DataFetch] Using fallback for ${path}`);
      return { data, source: 'fallback' };
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

// ============================================================================
// Update Polling with ETag
// ============================================================================

interface UpdateChecker {
  lastETag: string | null;
  checkInterval: number;
  onUpdateAvailable: () => void;
  stop: () => void;
}

/**
 * Create an update checker that polls for new data using ETags
 * 
 * @param intervalMs - How often to check (default: 5 minutes)
 * @param onUpdateAvailable - Callback when new data is available
 * @returns UpdateChecker with stop() method
 */
export function createUpdateChecker(
  onUpdateAvailable: () => void,
  intervalMs: number = 5 * 60 * 1000 // 5 minutes default
): UpdateChecker {
  let lastETag: string | null = null;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  async function checkForUpdates() {
    if (stopped) return;
    
    try {
      // Try local first, then primary URL
      const urls = [
        '/data/index.json',
        PRIMARY_DATA_URL ? `${PRIMARY_DATA_URL}/index.json` : null,
      ].filter(Boolean) as string[];
      
      for (const url of urls) {
        try {
          const response = await fetch(url, {
            method: 'HEAD',
            cache: 'no-cache',
          });
          
          if (!response.ok) continue;
          
          const etag = response.headers.get('ETag');
          const lastModified = response.headers.get('Last-Modified');
          const identifier = etag || lastModified;
          
          if (identifier) {
            if (lastETag === null) {
              // First check - just store the value
              lastETag = identifier;
            } else if (lastETag !== identifier) {
              // Data has changed!
              lastETag = identifier;
              console.info('[UpdateChecker] New data available!');
              onUpdateAvailable();
            }
            break; // Successfully checked, don't try other URLs
          }
        } catch {
          // Try next URL
        }
      }
    } catch (err) {
      console.warn('[UpdateChecker] Error checking for updates:', err);
    }
    
    // Schedule next check
    if (!stopped) {
      timeoutId = setTimeout(checkForUpdates, intervalMs);
    }
  }

  // Start checking
  checkForUpdates();

  return {
    get lastETag() { return lastETag; },
    checkInterval: intervalMs,
    onUpdateAvailable,
    stop: () => {
      stopped = true;
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
    },
  };
}
