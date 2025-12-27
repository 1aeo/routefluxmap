/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  parseUrlHash,
  updateUrlHash,
  getUrlHashParam,
  removeUrlHashParam,
  clearUrlHash,
  debounce,
  parseMapLocation,
  formatMapLocation,
  parseCountryCode,
  updateCountryCode,
} from '../../src/lib/utils/url';

describe('URL Hash Utilities', () => {
  // Store original location
  let originalLocation: Location;

  beforeEach(() => {
    // Save original location and reset hash
    originalLocation = window.location;

    // Clear hash before each test
    window.location.hash = '';
  });

  afterEach(() => {
    // Clean up
    window.location.hash = '';
  });

  describe('parseUrlHash', () => {
    it('returns empty object when no hash', () => {
      window.location.hash = '';
      expect(parseUrlHash()).toEqual({});
    });

    it('parses single parameter', () => {
      window.location.hash = '#date=2024-01-15';
      expect(parseUrlHash()).toEqual({ date: '2024-01-15' });
    });

    it('parses multiple parameters', () => {
      window.location.hash = '#date=2024-01-15&zoom=5&lat=40.7128';
      expect(parseUrlHash()).toEqual({
        date: '2024-01-15',
        zoom: '5',
        lat: '40.7128',
      });
    });

    it('decodes URI-encoded values', () => {
      // Note: Only whitelisted params are parsed (security feature)
      window.location.hash = '#date=2024-01-15&relay=ABC%20DEF';
      expect(parseUrlHash()).toEqual({
        date: '2024-01-15',
        relay: 'ABC DEF',
      });
    });

    it('ignores malformed parameters', () => {
      window.location.hash = '#date=2024-01-15&invalid&zoom=5';
      const result = parseUrlHash();
      expect(result.date).toBe('2024-01-15');
      expect(result.zoom).toBe('5');
      expect(result.invalid).toBeUndefined();
    });
  });

  describe('updateUrlHash', () => {
    it('adds a new parameter to empty hash', () => {
      window.location.hash = '';
      updateUrlHash('date', '2024-01-15');

      // Check the hash was updated
      expect(window.location.hash).toBe('#date=2024-01-15');
    });

    it('adds parameter to existing hash', () => {
      window.location.hash = '#date=2024-01-15';
      updateUrlHash('zoom', '5');

      const params = parseUrlHash();
      expect(params.date).toBe('2024-01-15');
      expect(params.zoom).toBe('5');
    });

    it('updates existing parameter', () => {
      window.location.hash = '#date=2024-01-15&zoom=3';
      updateUrlHash('zoom', '5');

      const params = parseUrlHash();
      expect(params.date).toBe('2024-01-15');
      expect(params.zoom).toBe('5');
    });

    it('removes parameter when value is empty', () => {
      window.location.hash = '#date=2024-01-15&zoom=5';
      updateUrlHash('zoom', '');

      const params = parseUrlHash();
      expect(params.date).toBe('2024-01-15');
      expect(params.zoom).toBeUndefined();
    });

    it('encodes special characters', () => {
      // Note: Only whitelisted params are parsed (security feature)
      updateUrlHash('relay', 'hello world');

      // The value should be encoded in the URL
      expect(window.location.hash).toContain('hello%20world');

      // But parsing should decode it
      expect(parseUrlHash().relay).toBe('hello world');
    });
  });

  describe('getUrlHashParam', () => {
    it('returns value for existing parameter', () => {
      window.location.hash = '#date=2024-01-15&zoom=5';
      expect(getUrlHashParam('date')).toBe('2024-01-15');
      expect(getUrlHashParam('zoom')).toBe('5');
    });

    it('returns undefined for non-existing parameter', () => {
      window.location.hash = '#date=2024-01-15';
      expect(getUrlHashParam('zoom')).toBeUndefined();
    });

    it('returns undefined when hash is empty', () => {
      window.location.hash = '';
      expect(getUrlHashParam('date')).toBeUndefined();
    });
  });

  describe('removeUrlHashParam', () => {
    it('removes existing parameter', () => {
      window.location.hash = '#date=2024-01-15&zoom=5';
      removeUrlHashParam('zoom');

      expect(getUrlHashParam('date')).toBe('2024-01-15');
      expect(getUrlHashParam('zoom')).toBeUndefined();
    });

    it('handles removing non-existing parameter gracefully', () => {
      window.location.hash = '#date=2024-01-15';
      removeUrlHashParam('zoom');

      expect(getUrlHashParam('date')).toBe('2024-01-15');
    });

    it('clears hash when removing last parameter', () => {
      window.location.hash = '#date=2024-01-15';
      removeUrlHashParam('date');

      expect(window.location.hash).toBe('');
    });
  });

  describe('clearUrlHash', () => {
    it('clears all hash parameters', () => {
      window.location.hash = '#date=2024-01-15&zoom=5&lat=40.7128';
      clearUrlHash();

      expect(window.location.hash).toBe('');
      expect(parseUrlHash()).toEqual({});
    });

    it('handles empty hash gracefully', () => {
      window.location.hash = '';
      clearUrlHash();

      expect(window.location.hash).toBe('');
    });
  });

  describe('parseMapLocation', () => {
    it('parses valid ML parameter', () => {
      window.location.hash = '#ML=-40.50,30.20,4.0';
      const result = parseMapLocation();
      expect(result).toEqual({ longitude: -40.5, latitude: 30.2, zoom: 4 });
    });

    it('parses ML with date parameter', () => {
      window.location.hash = '#date=2024-12-01&ML=10.00,20.00,5.5';
      const result = parseMapLocation();
      expect(result).toEqual({ longitude: 10, latitude: 20, zoom: 5.5 });
    });

    it('returns null when ML parameter missing', () => {
      window.location.hash = '#date=2024-12-01';
      expect(parseMapLocation()).toBeNull();
    });

    it('returns null for invalid format', () => {
      window.location.hash = '#ML=invalid';
      expect(parseMapLocation()).toBeNull();
    });

    it('returns null for out-of-range longitude', () => {
      window.location.hash = '#ML=200,30,4';
      expect(parseMapLocation()).toBeNull();
    });

    it('returns null for out-of-range latitude', () => {
      window.location.hash = '#ML=0,100,4';
      expect(parseMapLocation()).toBeNull();
    });

    it('returns null for out-of-range zoom', () => {
      window.location.hash = '#ML=0,0,25';
      expect(parseMapLocation()).toBeNull();
    });
  });

  describe('formatMapLocation', () => {
    it('formats coordinates with correct precision', () => {
      expect(formatMapLocation(-40.5, 30.2, 4)).toBe('-40.50,30.20,4.0');
    });

    it('rounds to correct decimal places', () => {
      expect(formatMapLocation(-40.5678, 30.1234, 4.567)).toBe('-40.57,30.12,4.6');
    });

    it('handles negative coordinates', () => {
      expect(formatMapLocation(-180, -90, 1)).toBe('-180.00,-90.00,1.0');
    });
  });

  describe('debounce', () => {
    it('delays function execution', async () => {
      let callCount = 0;
      const fn = debounce(() => { callCount++; }, 50);

      fn();
      fn();
      fn();

      expect(callCount).toBe(0);
      await new Promise(resolve => setTimeout(resolve, 100));
      expect(callCount).toBe(1);
    });

    it('passes arguments to debounced function', async () => {
      let receivedArgs: number[] = [];
      const fn = debounce((a: number, b: number) => {
        receivedArgs = [a, b];
      }, 50);

      fn(1, 2);
      await new Promise(resolve => setTimeout(resolve, 100));
      expect(receivedArgs).toEqual([1, 2]);
    });
  });

  describe('parseCountryCode', () => {
    it('parses valid 2-letter country code', () => {
      window.location.hash = '#CC=US';
      expect(parseCountryCode()).toBe('US');
    });

    it('converts to uppercase', () => {
      window.location.hash = '#CC=de';
      expect(parseCountryCode()).toBe('DE');
    });

    it('parses CC with other parameters', () => {
      window.location.hash = '#date=2024-12-01&CC=RU&ML=10,20,5';
      expect(parseCountryCode()).toBe('RU');
    });

    it('returns null when CC parameter missing', () => {
      window.location.hash = '#date=2024-12-01';
      expect(parseCountryCode()).toBeNull();
    });

    it('returns null for invalid length', () => {
      window.location.hash = '#CC=USA';
      expect(parseCountryCode()).toBeNull();
    });

    it('returns null for single character', () => {
      window.location.hash = '#CC=U';
      expect(parseCountryCode()).toBeNull();
    });

    it('returns null for numeric codes', () => {
      window.location.hash = '#CC=12';
      expect(parseCountryCode()).toBeNull();
    });

    it('returns null for mixed alphanumeric', () => {
      window.location.hash = '#CC=U1';
      expect(parseCountryCode()).toBeNull();
    });
  });

  describe('updateCountryCode', () => {
    it('adds country code to URL', () => {
      window.location.hash = '#date=2024-12-01';
      updateCountryCode('US');
      expect(getUrlHashParam('CC')).toBe('US');
    });

    it('converts to uppercase', () => {
      window.location.hash = '';
      updateCountryCode('de');
      expect(getUrlHashParam('CC')).toBe('DE');
    });

    it('removes country code when null', () => {
      window.location.hash = '#CC=US&date=2024-12-01';
      updateCountryCode(null);
      expect(getUrlHashParam('CC')).toBeUndefined();
      expect(getUrlHashParam('date')).toBe('2024-12-01');
    });

    it('removes country code when empty string', () => {
      window.location.hash = '#CC=US';
      updateCountryCode('');
      expect(getUrlHashParam('CC')).toBeUndefined();
    });
  });
});
