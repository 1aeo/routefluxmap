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
      window.location.hash = '#name=Hello%20World&city=New%20York';
      expect(parseUrlHash()).toEqual({
        name: 'Hello World',
        city: 'New York',
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
      updateUrlHash('query', 'hello world');

      // The value should be encoded in the URL
      expect(window.location.hash).toContain('hello%20world');

      // But parsing should decode it
      expect(parseUrlHash().query).toBe('hello world');
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
});

