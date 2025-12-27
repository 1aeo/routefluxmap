/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Import the module - env vars are evaluated at module load time
// In test environment, PUBLIC_DATA_URL and PUBLIC_DATA_URL_FALLBACK may be empty
import {
  fetchWithFallback,
  createUpdateChecker,
  sanitizeErrorMessage,
} from '../../src/lib/utils/data-fetch';

describe('data-fetch utilities', () => {
  // Store original fetch
  const originalFetch = global.fetch;

  beforeEach(() => {
    // Reset fetch mock before each test
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    // Restore original fetch
    global.fetch = originalFetch;
    vi.clearAllMocks();
  });

  describe('fetchWithFallback', () => {
    it('tries local path first and returns local source', async () => {
      const mockData = { test: 'local-data' };
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockData),
        headers: new Headers(),
      });

      const result = await fetchWithFallback<typeof mockData>('test.json');
      
      expect(result.source).toBe('local');
      expect(result.data).toEqual(mockData);
      // Note: fetch now always includes a signal for timeout support
      expect(global.fetch).toHaveBeenCalledWith(
        '/data/test.json',
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
    });

    it('prepends /data/ to paths without leading slash', async () => {
      const mockData = { test: 'data' };
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockData),
        headers: new Headers(),
      });

      await fetchWithFallback('some/path.json');
      
      // Note: fetch now always includes a signal for timeout support
      expect(global.fetch).toHaveBeenCalledWith(
        '/data/some/path.json',
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
    });

    it('preserves paths with leading slash', async () => {
      const mockData = { test: 'data' };
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockData),
        headers: new Headers(),
      });

      await fetchWithFallback('/custom/path.json');
      
      // Note: fetch now always includes a signal for timeout support
      expect(global.fetch).toHaveBeenCalledWith(
        '/custom/path.json',
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
    });

    it('throws error when local source fails (no fallback URLs configured)', async () => {
      // In test environment, PRIMARY_DATA_URL and FALLBACK_DATA_URL are empty
      // So only local is tried
      (global.fetch as any).mockRejectedValueOnce(new Error('Local not found'));

      await expect(fetchWithFallback('test.json')).rejects.toThrow(
        /Unable to load data/
      );
    });

    it('throws error with sanitized message when fetch fails', async () => {
      (global.fetch as any).mockRejectedValueOnce(new Error('Network error'));

      // Error messages are sanitized to prevent info leakage
      await expect(fetchWithFallback('test.json')).rejects.toThrow(/Unable to load data/);
    });

    it('handles HTTP error responses by throwing', async () => {
      // Local returns 404 - this triggers the error path in fetchWithProgress
      // Since local failures are silently caught (expected in production),
      // and no fallback URLs are configured in tests, we get a generic error
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      await expect(fetchWithFallback('notfound.json')).rejects.toThrow(
        /Unable to load data/
      );
    });

    it('includes AbortSignal for timeout support', async () => {
      const mockData = { test: 'data' };
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockData),
        headers: new Headers(),
      });

      await fetchWithFallback('test.json');
      
      // Verify that fetch was called with an AbortSignal
      const fetchCall = (global.fetch as any).mock.calls[0];
      expect(fetchCall[1]).toHaveProperty('signal');
      expect(fetchCall[1].signal).toBeInstanceOf(AbortSignal);
    });

    it('reports progress when Content-Length is available', async () => {
      const progressCallback = vi.fn();
      const mockData = { test: 'progress' };
      const jsonString = JSON.stringify(mockData);
      const encoder = new TextEncoder();
      const encoded = encoder.encode(jsonString);

      // Create a mock ReadableStream
      const mockReader = {
        read: vi.fn()
          .mockResolvedValueOnce({ done: false, value: encoded.slice(0, 10) })
          .mockResolvedValueOnce({ done: false, value: encoded.slice(10) })
          .mockResolvedValueOnce({ done: true, value: undefined }),
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'Content-Length': String(encoded.length) }),
        body: {
          getReader: () => mockReader,
        },
      });

      const result = await fetchWithFallback<typeof mockData>('test.json', {
        onProgress: progressCallback,
      });

      expect(result.data).toEqual(mockData);
      expect(progressCallback).toHaveBeenCalled();
      // Progress should be called with values between 0 and 1
      const calls = progressCallback.mock.calls;
      calls.forEach(([progress]: [number]) => {
        expect(progress).toBeGreaterThan(0);
        expect(progress).toBeLessThanOrEqual(1);
      });
    });

    it('falls back to json() when no Content-Length header', async () => {
      const mockData = { test: 'no-content-length' };
      const progressCallback = vi.fn();

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        headers: new Headers(), // No Content-Length
        json: () => Promise.resolve(mockData),
      });

      const result = await fetchWithFallback<typeof mockData>('test.json', {
        onProgress: progressCallback,
      });

      expect(result.data).toEqual(mockData);
      // Progress might not be called when Content-Length is missing
    });

    it('falls back to json() when no progress callback provided', async () => {
      const mockData = { test: 'no-callback' };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'Content-Length': '100' }),
        json: () => Promise.resolve(mockData),
      });

      const result = await fetchWithFallback<typeof mockData>('test.json');

      expect(result.data).toEqual(mockData);
    });
  });

  describe('createUpdateChecker', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('returns an UpdateChecker object with expected properties', () => {
      const callback = vi.fn();
      const checker = createUpdateChecker(callback, 5000);

      expect(checker).toHaveProperty('lastETag');
      expect(checker).toHaveProperty('checkInterval');
      expect(checker).toHaveProperty('onUpdateAvailable');
      expect(checker).toHaveProperty('stop');
      expect(typeof checker.stop).toBe('function');
      expect(checker.checkInterval).toBe(5000);

      checker.stop();
    });

    it('makes initial check immediately', async () => {
      const callback = vi.fn();
      
      (global.fetch as any).mockResolvedValue({
        ok: true,
        headers: new Headers({ 'ETag': 'initial-etag' }),
      });

      const checker = createUpdateChecker(callback, 1000);
      
      // Let the initial check complete
      await vi.advanceTimersByTimeAsync(0);
      
      expect(global.fetch).toHaveBeenCalled();
      checker.stop();
    });

    it('polls at specified interval', async () => {
      const callback = vi.fn();
      
      (global.fetch as any).mockResolvedValue({
        ok: true,
        headers: new Headers({ 'ETag': 'same-etag' }),
      });

      const checker = createUpdateChecker(callback, 1000);
      
      // Initial check
      await vi.advanceTimersByTimeAsync(0);
      const initialCallCount = (global.fetch as any).mock.calls.length;
      
      // After 1 second, should poll again
      await vi.advanceTimersByTimeAsync(1000);
      expect((global.fetch as any).mock.calls.length).toBeGreaterThan(initialCallCount);
      
      checker.stop();
    });

    it('triggers callback when ETag changes', async () => {
      const callback = vi.fn();
      
      (global.fetch as any)
        // First check - establish baseline
        .mockResolvedValueOnce({
          ok: true,
          headers: new Headers({ 'ETag': 'etag-v1' }),
        })
        // Second check - ETag changed
        .mockResolvedValueOnce({
          ok: true,
          headers: new Headers({ 'ETag': 'etag-v2' }),
        });

      const checker = createUpdateChecker(callback, 100);
      
      // Initial check (stores ETag, doesn't trigger callback)
      await vi.advanceTimersByTimeAsync(0);
      expect(callback).not.toHaveBeenCalled();
      
      // Second check (ETag changed, triggers callback)
      await vi.advanceTimersByTimeAsync(100);
      expect(callback).toHaveBeenCalledTimes(1);
      
      checker.stop();
    });

    it('does not trigger callback when ETag stays the same', async () => {
      const callback = vi.fn();
      
      (global.fetch as any).mockResolvedValue({
        ok: true,
        headers: new Headers({ 'ETag': 'same-etag' }),
      });

      const checker = createUpdateChecker(callback, 100);
      
      // Multiple checks
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(100);
      await vi.advanceTimersByTimeAsync(100);
      
      expect(callback).not.toHaveBeenCalled();
      
      checker.stop();
    });

    it('uses Last-Modified header when ETag is not available', async () => {
      const callback = vi.fn();
      
      (global.fetch as any)
        .mockResolvedValueOnce({
          ok: true,
          headers: new Headers({ 'Last-Modified': 'Mon, 01 Jan 2024 00:00:00 GMT' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          headers: new Headers({ 'Last-Modified': 'Tue, 02 Jan 2024 00:00:00 GMT' }),
        });

      const checker = createUpdateChecker(callback, 100);
      
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(100);
      
      expect(callback).toHaveBeenCalledTimes(1);
      
      checker.stop();
    });

    it('stop() cancels further polling', async () => {
      const callback = vi.fn();
      
      (global.fetch as any).mockResolvedValue({
        ok: true,
        headers: new Headers({ 'ETag': 'etag' }),
      });

      const checker = createUpdateChecker(callback, 100);
      
      // Initial check
      await vi.advanceTimersByTimeAsync(0);
      const callCountAfterInitial = (global.fetch as any).mock.calls.length;
      
      // Stop the checker
      checker.stop();
      
      // Advance time - should not make more calls
      await vi.advanceTimersByTimeAsync(500);
      expect((global.fetch as any).mock.calls.length).toBe(callCountAfterInitial);
    });

    it('handles fetch errors gracefully', async () => {
      const callback = vi.fn();
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      
      (global.fetch as any).mockRejectedValue(new Error('Network error'));

      const checker = createUpdateChecker(callback, 100);
      
      // Should not throw
      await vi.advanceTimersByTimeAsync(0);
      
      // Should continue polling after error
      await vi.advanceTimersByTimeAsync(100);
      expect((global.fetch as any).mock.calls.length).toBeGreaterThan(1);
      
      checker.stop();
      consoleSpy.mockRestore();
    });

    it('uses HEAD method for efficient polling', async () => {
      const callback = vi.fn();
      
      (global.fetch as any).mockResolvedValue({
        ok: true,
        headers: new Headers({ 'ETag': 'etag' }),
      });

      const checker = createUpdateChecker(callback, 100);
      await vi.advanceTimersByTimeAsync(0);
      
      // Check that HEAD method was used
      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ method: 'HEAD' })
      );
      
      checker.stop();
    });
  });

  describe('sanitizeErrorMessage', () => {
    it('sanitizes timeout errors', () => {
      expect(sanitizeErrorMessage(new Error('Request timeout after 30000ms'))).toBe('Request timed out');
      expect(sanitizeErrorMessage(new Error('timeout exceeded'))).toBe('Request timed out');
    });

    it('sanitizes HTTP 4xx errors', () => {
      expect(sanitizeErrorMessage(new Error('HTTP 404'))).toBe('Data not found');
      expect(sanitizeErrorMessage(new Error('HTTP 403 Forbidden'))).toBe('Data not found');
    });

    it('sanitizes HTTP 5xx errors', () => {
      expect(sanitizeErrorMessage(new Error('HTTP 500'))).toBe('Server error');
      expect(sanitizeErrorMessage(new Error('HTTP 503 Service Unavailable'))).toBe('Server error');
    });

    it('sanitizes network errors', () => {
      expect(sanitizeErrorMessage(new Error('Failed to fetch'))).toBe('Network error');
      expect(sanitizeErrorMessage(new Error('NetworkError when attempting to fetch'))).toBe('Network error');
    });

    it('returns generic message for unknown errors', () => {
      expect(sanitizeErrorMessage(new Error('Something weird happened'))).toBe('Request failed');
      expect(sanitizeErrorMessage('string error')).toBe('Request failed');
      expect(sanitizeErrorMessage(null)).toBe('Request failed');
      expect(sanitizeErrorMessage(undefined)).toBe('Request failed');
    });

    it('does not leak internal paths or stack traces', () => {
      const error = new Error('ENOENT: no such file /home/user/secret/config.json');
      expect(sanitizeErrorMessage(error)).toBe('Request failed');
      expect(sanitizeErrorMessage(error)).not.toContain('/home');
      expect(sanitizeErrorMessage(error)).not.toContain('config.json');
    });
  });
});

