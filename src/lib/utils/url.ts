/**
 * URL Hash Utilities
 * Handles parsing and updating URL hash parameters for state persistence
 */

/**
 * Parse URL hash parameters into a key-value record
 *
 * @returns Record of parsed hash parameters
 *
 * @example
 * // URL: https://example.com#date=2024-01-15&zoom=5
 * parseUrlHash() // { date: '2024-01-15', zoom: '5' }
 */
export function parseUrlHash(): Record<string, string> {
  if (typeof window === 'undefined') return {};

  const hash = window.location.hash.slice(1);
  const params: Record<string, string> = {};

  hash.split('&').forEach((part) => {
    const [key, value] = part.split('=');
    if (key && value) params[key] = decodeURIComponent(value);
  });

  return params;
}

/**
 * Update a single parameter in the URL hash without affecting others
 *
 * @param key - The parameter key to update
 * @param value - The new value (empty string removes the parameter)
 *
 * @example
 * // Current URL: https://example.com#date=2024-01-15
 * updateUrlHash('zoom', '5')
 * // Result: https://example.com#date=2024-01-15&zoom=5
 */
export function updateUrlHash(key: string, value: string): void {
  if (typeof window === 'undefined') return;

  const params = parseUrlHash();

  if (value) {
    params[key] = value;
  } else {
    delete params[key];
  }

  const hashString = Object.entries(params)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');

  // Use replaceState to avoid adding to browser history
  const newUrl = hashString
    ? `${window.location.pathname}${window.location.search}#${hashString}`
    : `${window.location.pathname}${window.location.search}`;

  window.history.replaceState(null, '', newUrl);
}

/**
 * Get a specific parameter from the URL hash
 *
 * @param key - The parameter key to retrieve
 * @returns The value if found, undefined otherwise
 *
 * @example
 * // URL: https://example.com#date=2024-01-15
 * getUrlHashParam('date') // '2024-01-15'
 * getUrlHashParam('zoom') // undefined
 */
export function getUrlHashParam(key: string): string | undefined {
  return parseUrlHash()[key];
}

/**
 * Remove a parameter from the URL hash
 *
 * @param key - The parameter key to remove
 */
export function removeUrlHashParam(key: string): void {
  updateUrlHash(key, '');
}

/**
 * Clear all URL hash parameters
 */
export function clearUrlHash(): void {
  if (typeof window === 'undefined') return;

  window.history.replaceState(
    null,
    '',
    `${window.location.pathname}${window.location.search}`
  );
}

