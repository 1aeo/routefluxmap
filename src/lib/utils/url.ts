/**
 * URL Hash Utilities
 * Handles parsing and updating URL hash parameters for state persistence
 */

import { cleanFingerprint } from './relay-search';

/** Maximum length for URL hash parameter values to prevent DoS */
const MAX_PARAM_VALUE_LENGTH = 200;

/** Allowed parameter keys (whitelist approach) */
const ALLOWED_PARAMS = new Set(['date', 'ML', 'CC', 'relay', 'zoom', 'lat', 'lng', 'lon']);

/**
 * Sanitize a URL parameter value
 * Removes potentially dangerous characters and enforces length limits
 */
function sanitizeParamValue(value: string): string {
  // Truncate to max length
  const truncated = value.slice(0, MAX_PARAM_VALUE_LENGTH);
  // Remove control characters and null bytes
  return truncated.replace(/[\x00-\x1f\x7f]/g, '');
}

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
    // Only accept whitelisted parameters and sanitize values
    if (key && value && ALLOWED_PARAMS.has(key)) {
      try {
        params[key] = sanitizeParamValue(decodeURIComponent(value));
      } catch {
        // Skip malformed URL-encoded values
      }
    }
  });

  return params;
}

/**
 * Update one or more parameters in the URL hash
 * 
 * @param updates - Record of key-value pairs to update. Value of null/empty string removes the key.
 * 
 * @example
 * updateUrlHash({ zoom: '5', date: '2024-01-01' })
 */
export function updateUrlHash(updates: Record<string, string | null> | string, value?: string): void {
  if (typeof window === 'undefined') return;

  const params = parseUrlHash();

  if (typeof updates === 'string') {
    // Single key-value update
    if (value) {
      params[updates] = value;
    } else {
      delete params[updates];
    }
  } else {
    // Batch update
    Object.entries(updates).forEach(([key, val]) => {
      if (val) {
        params[key] = val;
      } else {
        delete params[key];
      }
    });
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

/**
 * Create a debounced function that delays invoking func until after wait ms
 * have elapsed since the last time it was invoked.
 */
export function debounce<T extends (...args: any[]) => void>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  return (...args: Parameters<T>) => {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
    timeoutId = setTimeout(() => {
      func(...args);
      timeoutId = null;
    }, wait);
  };
}

/**
 * Parse map location from URL hash (ML parameter)
 * Format: ML=longitude,latitude,zoom
 * 
 * @example
 * // URL: https://example.com#date=2024-01-15&ML=-40.5,30.2,4
 * parseMapLocation() // { longitude: -40.5, latitude: 30.2, zoom: 4 }
 */
export function parseMapLocation(): { longitude: number; latitude: number; zoom: number } | null {
  const ml = getUrlHashParam('ML');
  if (!ml) return null;

  const parts = ml.split(',').map(parseFloat);
  if (parts.length !== 3 || parts.some(isNaN)) return null;

  const [longitude, latitude, zoom] = parts;
  
  // Validate ranges
  if (longitude < -180 || longitude > 180) return null;
  if (latitude < -90 || latitude > 90) return null;
  if (zoom < 0 || zoom > 22) return null;

  return { longitude, latitude, zoom };
}

/**
 * Format map location for URL hash
 * 
 * @example
 * formatMapLocation(-40.5, 30.2, 4) // '-40.50,30.20,4.0'
 */
export function formatMapLocation(longitude: number, latitude: number, zoom: number): string {
  return `${longitude.toFixed(2)},${latitude.toFixed(2)},${zoom.toFixed(1)}`;
}

/** Regex to validate 2-letter country codes (ISO 3166-1 alpha-2) */
const COUNTRY_CODE_REGEX = /^[A-Za-z]{2}$/;

/**
 * Parse country code from URL hash (CC parameter)
 * Validates that it's exactly 2 alphabetic characters
 * 
 * @example
 * // URL: https://example.com#date=2024-01-15&CC=US
 * parseCountryCode() // 'US'
 */
export function parseCountryCode(): string | null {
  const cc = getUrlHashParam('CC');
  if (!cc || !COUNTRY_CODE_REGEX.test(cc)) return null;
  return cc.toUpperCase();
}

/**
 * Update country code in URL hash
 * Pass null or empty string to remove
 */
export function updateCountryCode(code: string | null): void {
  updateUrlHash('CC', code?.toUpperCase() || '');
}

/** Regex to validate 40-character hex fingerprint (SHA-1) */
const FINGERPRINT_REGEX = /^[0-9A-F]{40}$/;

/** Result of parsing relay fingerprint from URL */
export type RelayParamResult = 
  | { status: 'none' }           // No relay parameter in URL
  | { status: 'invalid' }        // Parameter exists but invalid format
  | { status: 'valid'; fingerprint: string };  // Valid 40-char hex fingerprint

/**
 * Parse relay fingerprint from URL hash (relay parameter)
 * Returns discriminated result to avoid double-parsing URL
 * 
 * @example
 * // URL: https://example.com#relay=ABC123...
 * getRelayParam() // { status: 'valid', fingerprint: 'ABC123...' }
 */
export function getRelayParam(): RelayParamResult {
  const relay = getUrlHashParam('relay');
  if (relay === undefined) return { status: 'none' };
  
  const cleaned = cleanFingerprint(relay);
  return FINGERPRINT_REGEX.test(cleaned) 
    ? { status: 'valid', fingerprint: cleaned }
    : { status: 'invalid' };
}

/**
 * Update relay fingerprint in URL hash
 * Pass null or empty string to remove
 * 
 * @example
 * updateRelayFingerprint('ABC123...') // Sets #relay=ABC123...
 * updateRelayFingerprint(null) // Removes relay param
 */
export function updateRelayFingerprint(fingerprint: string | null): void {
  updateUrlHash('relay', fingerprint ? cleanFingerprint(fingerprint) : '');
}
