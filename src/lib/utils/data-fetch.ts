/**
 * Data fetching utilities with primary/fallback support
 * 
 * Tries primary data URL first, falls back to secondary if primary fails.
 * Both URLs are configured via environment variables at build time.
 */

import { isValidDateComponents } from './format';

// Get data URLs from environment (set at build time)
const PRIMARY_DATA_URL = import.meta.env.PUBLIC_DATA_URL || '';
const FALLBACK_DATA_URL = import.meta.env.PUBLIC_DATA_URL_FALLBACK || '';

interface FetchResult<T> {
  data: T;
  source: 'local' | 'primary' | 'fallback';
}

/** Default timeout for fetch requests (60 seconds) */
const DEFAULT_FETCH_TIMEOUT_MS = 60000;

/** Maximum response size in bytes (50MB - protects against DoS) */
const MAX_RESPONSE_SIZE = 50 * 1024 * 1024;

interface FetchOptions extends RequestInit {
  onProgress?: (progress: number) => void;
  /** Timeout in milliseconds (default: 60000) */
  timeout?: number;
}

/**
 * Sanitize error message for user display
 * Prevents leaking internal details while remaining helpful
 */
export function sanitizeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    const msg = error.message;
    // Allow safe, generic error messages
    if (msg.includes('timeout')) return 'Request timed out';
    if (msg.includes('HTTP 4')) return 'Data not found';
    if (msg.includes('HTTP 5')) return 'Server error';
    if (msg.includes('Failed to fetch') || msg.includes('NetworkError')) {
      return 'Network error';
    }
  }
  return 'Request failed';
}

/**
 * Create an AbortController with timeout
 */
function createTimeoutController(timeoutMs: number): { controller: AbortController; clear: () => void } {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort(new Error(`Request timeout after ${timeoutMs}ms`));
  }, timeoutMs);
  
  return {
    controller,
    clear: () => clearTimeout(timeoutId),
  };
}

/**
 * Helper to fetch with progress tracking and timeout
 */
async function fetchWithProgress<T>(url: string, options?: FetchOptions): Promise<T> {
  const timeout = options?.timeout ?? DEFAULT_FETCH_TIMEOUT_MS;
  const { controller, clear } = createTimeoutController(timeout);
  
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    // Check content-length to prevent DoS via huge responses
    const contentLength = response.headers.get('Content-Length');
    if (contentLength) {
      const size = parseInt(contentLength, 10);
      if (size > MAX_RESPONSE_SIZE) {
        throw new Error('Response too large');
      }
    }

    // If no progress callback or no content-length, fallback to standard json()
    if (!options?.onProgress || !contentLength) {
      const data = await response.json();
      clear();
      return data;
    }

    const total = parseInt(contentLength, 10);
    let loaded = 0;

    const reader = response.body?.getReader();
    if (!reader) {
      const data = await response.json();
      clear();
      return data;
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
    clear();
    return JSON.parse(text);
  } catch (error: any) {
    clear();
    // Provide clearer error message for timeout
    if (error.name === 'AbortError' || error.message?.includes('timeout')) {
      throw new Error(`Request timeout after ${timeout}ms`);
    }
    throw error;
  }
}

/**
 * Sanitize and validate path for data fetching
 * Prevents path traversal and ensures safe characters only
 */
function sanitizePath(path: string): string {
  if (!path || typeof path !== 'string') {
    throw new Error('Invalid path');
  }
  
  // Track if path originally started with /
  const hadLeadingSlash = path.startsWith('/');
  
  // Remove path traversal attempts
  let sanitized = path
    .replace(/\.\.\//g, '')        // Remove ../
    .replace(/\.\.$/g, '')         // Remove trailing ..
    .replace(/^\/+/, '')           // Temporarily remove leading slashes for validation
    .replace(/\0/g, '');           // Remove null bytes
  
  // Validate: only allow alphanumeric, dash, underscore, dot, and forward slash
  if (sanitized && !/^[\w\-./]+$/.test(sanitized)) {
    throw new Error('Path contains invalid characters');
  }
  
  // Prevent hidden files
  if (sanitized.startsWith('.') || sanitized.includes('/.')) {
    throw new Error('Path cannot reference hidden files');
  }
  
  // Restore leading slash if it was there (for absolute paths)
  return hadLeadingSlash ? '/' + sanitized : sanitized;
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
  // Sanitize the path first
  const safePath = sanitizePath(path);
  const errors: string[] = [];

  // 1. Try local first (for dev or bundled data)
  try {
    const localPath = safePath.startsWith('/') ? safePath : `/data/${safePath}`;
    const data = await fetchWithProgress<T>(localPath, options);
    return { data, source: 'local' };
  } catch {
    // Local not available, continue to remote
  }

  // 2. Try primary data URL
  if (PRIMARY_DATA_URL) {
    try {
      const url = `${PRIMARY_DATA_URL}/${safePath}`;
      const data = await fetchWithProgress<T>(url, options);
      return { data, source: 'primary' };
    } catch (err) {
      errors.push(`Primary: ${sanitizeErrorMessage(err)}`);
    }
  }

  // 3. Try fallback data URL
  if (FALLBACK_DATA_URL) {
    try {
      const url = `${FALLBACK_DATA_URL}/${safePath}`;
      const data = await fetchWithProgress<T>(url, options);
      console.info(`[DataFetch] Using fallback for ${safePath}`);
      return { data, source: 'fallback' };
    } catch (err) {
      errors.push(`Fallback: ${sanitizeErrorMessage(err)}`);
    }
  }

  // All sources failed - provide generic message to users
  throw new Error(`Unable to load data: ${errors.join('; ')}`);
}

// Note: Date validation for fetch paths uses isValidDateComponents from format.ts
// The app fetches data via fetchWithFallback with pre-sanitized paths from useRelays

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
