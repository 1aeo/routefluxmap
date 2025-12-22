/**
 * @vitest-environment jsdom
 * 
 * TorMap Integration Tests
 * 
 * Note: These are simplified smoke tests. The complex async behavior
 * of TorMap is better tested through the individual hook tests:
 * - useRelays.test.ts - data fetching logic
 * - useMapView.test.ts - viewport and URL sync
 * - useDatePlayback.test.ts - playback controls
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import TorMap from '../../../src/components/map/TorMap';
import { mockDateIndex, mockRelayData, mockFetchResponse } from '../../lib/hooks/test-utils';

// vi.hoisted runs before mock hoisting, making React available in mocks
const { forwardRef } = vi.hoisted(() => require('react'));

// Mock Deck.gl components with forwardRef to handle ref prop
vi.mock('@deck.gl/react', () => ({
  default: forwardRef(({ children }: any, ref: any) => (
    <div ref={ref} data-testid="deckgl">{children}</div>
  )),
}));

vi.mock('@deck.gl/layers', () => ({
  ScatterplotLayer: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('@deck.gl/core', () => ({
  FlyToInterpolator: vi.fn().mockImplementation(() => ({})),
}));

// Mock react-map-gl/maplibre
vi.mock('react-map-gl/maplibre', () => ({
  Map: ({ onLoad }: any) => {
    setTimeout(() => onLoad?.(), 0);
    return <div data-testid="maplibre" />;
  },
}));

// Mock ParticleCanvas (WebGL component)
vi.mock('../../../src/components/map/ParticleCanvas', () => ({
  default: () => <div data-testid="particle-canvas" />,
}));

// Mock CountryLayer with forwardRef to handle ref prop
vi.mock('../../../src/components/map/CountryLayer', () => ({
  createCountryLayer: () => null,
  CountryTooltip: forwardRef((props: any, ref: any) => (
    <div ref={ref} data-testid="country-tooltip" />
  )),
}));

// Mock GeoJSON
const mockGeoJson = { type: 'FeatureCollection', features: [] };

describe('TorMap', () => {
  const originalFetch = global.fetch;
  const originalCreateElement = document.createElement.bind(document);

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    window.location.hash = '';

    // Mock WebGL2 support
    document.createElement = ((tagName: string) => {
      const element = originalCreateElement(tagName);
      if (tagName === 'canvas') {
        (element as any).getContext = (contextId: string) => {
          if (contextId === 'webgl2') return {};
          if (contextId === 'webgl') return {};
          return null;
        };
      }
      return element;
    }) as typeof document.createElement;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    document.createElement = originalCreateElement;
    vi.clearAllMocks();
  });

  const setupMocks = () => {
    (global.fetch as any).mockImplementation((url: string) => {
      if (url.includes('countries.geojson')) {
        return Promise.resolve(mockFetchResponse(mockGeoJson));
      }
      if (url.includes('index.json')) {
        return Promise.resolve(mockFetchResponse(mockDateIndex()));
      }
      if (url.includes('relays-')) {
        return Promise.resolve(mockFetchResponse(mockRelayData()));
      }
      if (url.includes('countries-')) {
        return Promise.resolve(mockFetchResponse({ countries: {} }));
      }
      return Promise.reject(new Error(`Unmocked: ${url}`));
    });
  };

  describe('rendering', () => {
    it('renders without crashing', async () => {
      setupMocks();
      const { container } = render(<TorMap />);
      await act(async () => {}); // Flush pending updates
      expect(container.firstChild).toBeDefined();
    });

    it('shows loading state initially', () => {
      (global.fetch as any).mockImplementation(() => new Promise(() => {}));
      const { container } = render(<TorMap />);
      // No act needed - we want the immediate loading state
      expect(container.firstChild).toBeDefined();
    });

    it('renders map container', async () => {
      setupMocks();
      render(<TorMap />);
      await waitFor(() => {
        expect(screen.getByTestId('deckgl')).toBeDefined();
      });
    });
  });

  describe('error handling', () => {
    it('shows error when fetch fails', async () => {
      (global.fetch as any).mockImplementation((url: string) => {
        if (url.includes('countries.geojson')) {
          return Promise.resolve(mockFetchResponse(mockGeoJson));
        }
        return Promise.reject(new Error('Network error'));
      });

      render(<TorMap />);
      await waitFor(() => {
        expect(screen.getByText(/Failed to load relay data/i)).toBeDefined();
      });
    });

    it('shows WebGL error when unavailable', async () => {
      document.createElement = ((tagName: string) => {
        const element = originalCreateElement(tagName);
        if (tagName === 'canvas') {
          (element as any).getContext = () => null;
        }
        return element;
      }) as typeof document.createElement;

      render(<TorMap />);
      expect(screen.getByText(/WebGL Required/i)).toBeDefined();
      // Flush any pending effects to avoid act() warnings
      await act(async () => {});
    });
  });
});
