/**
 * Test utilities and mock factories for hook testing
 */

import type { RelayData, DateIndex, AggregatedNode, RelayInfo, LayerVisibility } from '../../../src/lib/types';

/**
 * Create a mock RelayInfo
 */
export function mockRelayInfo(overrides: Partial<RelayInfo> = {}): RelayInfo {
  return {
    nickname: 'TestRelay',
    fingerprint: 'ABCD1234567890ABCD1234567890ABCD12345678',
    bandwidth: 1000000,
    flags: 'G',
    ip: '192.168.1.1',
    port: '9001',
    ...overrides,
  };
}

/**
 * Create a mock AggregatedNode
 */
export function mockAggregatedNode(overrides: Partial<AggregatedNode> = {}): AggregatedNode {
  return {
    lat: 40.7128,
    lng: -74.006,
    x: 0.5,
    y: 0.5,
    bandwidth: 1000000,
    selectionWeight: 0.1,
    label: 'Test Node',
    relays: [mockRelayInfo()],
    ...overrides,
  };
}

/**
 * Create mock RelayData for a specific date
 */
export function mockRelayData(overrides: Partial<RelayData> = {}): RelayData {
  return {
    version: '1.0',
    generatedAt: new Date().toISOString(),
    source: 'onionoo',
    published: '2024-01-15',
    nodes: [
      mockAggregatedNode({ label: 'Node 1', lat: 40.7128, lng: -74.006 }),
      mockAggregatedNode({ label: 'Node 2', lat: 51.5074, lng: -0.1278 }),
      mockAggregatedNode({ label: 'Node 3', lat: 48.8566, lng: 2.3522 }),
    ],
    bandwidth: 3000000,
    relayCount: 3,
    geolocatedCount: 3,
    minMax: { min: 500000, max: 1500000 },
    ...overrides,
  };
}

/**
 * Create a mock DateIndex
 */
export function mockDateIndex(overrides: Partial<DateIndex> = {}): DateIndex {
  return {
    version: '1.0',
    lastUpdated: new Date().toISOString(),
    dates: ['2024-01-13', '2024-01-14', '2024-01-15'],
    bandwidths: [2800000, 2900000, 3000000],
    relayCount: 3,
    ...overrides,
  };
}

/**
 * Create mock LayerVisibility
 */
export function mockLayerVisibility(overrides: Partial<LayerVisibility> = {}): LayerVisibility {
  return {
    relays: true,
    countries: false,
    labels: true,
    particles: true,
    ...overrides,
  };
}

/**
 * Create a mock fetch response
 */
export function mockFetchResponse<T>(data: T, options: { ok?: boolean; status?: number } = {}) {
  const response = {
    ok: options.ok ?? true,
    status: options.status ?? 200,
    json: () => Promise.resolve(data),
    headers: new Headers(),
    // Add body for streaming support (used by fetchWithFallback progress tracking)
    body: null,
    text: () => Promise.resolve(JSON.stringify(data)),
    clone: () => response,
  };
  return response;
}

/**
 * Setup window.location.hash for testing URL state
 */
export function setLocationHash(hash: string) {
  Object.defineProperty(window, 'location', {
    value: { ...window.location, hash },
    writable: true,
  });
}

/**
 * Mock window.matchMedia for mobile detection tests
 */
export function mockMatchMedia(matches: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

/**
 * Mock ResizeObserver for tests
 */
export function mockResizeObserver() {
  global.ResizeObserver = vi.fn().mockImplementation(() => ({
    observe: vi.fn(),
    unobserve: vi.fn(),
    disconnect: vi.fn(),
  }));
}

/**
 * Wait for next tick (useful for async state updates)
 */
export function waitForNextTick(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

/**
 * Flush all pending promises
 */
export async function flushPromises(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0));
}

