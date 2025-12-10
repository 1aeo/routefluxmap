#!/usr/bin/env npx tsx
/**
 * RouteFluxMap - Unified Data Fetcher v1.0.0
 * 
 * Single entry point for all Tor network data fetching.
 * Automatically routes to the appropriate data source:
 * 
 * Data Sources:
 * 1. Onionoo API (onionoo.torproject.org) - Live relay data (current day)
 * 2. Collector (collector.torproject.org) - Historical relay archives
 * 3. Tor Metrics (metrics.torproject.org) - Country client estimates (all dates)
 * 4. MaxMind GeoLite2 - IP geolocation (local database)
 * 
 * Outputs:
 * - relays-YYYY-MM-DD.json (relay locations + individual relay info)
 * - countries-YYYY-MM-DD.json (client counts by country)
 * - index.json (lightweight manifest for navigation)
 * 
 * Usage:
 *   npx tsx scripts/fetch-all-data.ts              # Current day (Onionoo)
 *   npx tsx scripts/fetch-all-data.ts 12/07/25     # Specific day (mm/dd/yy)
 *   npx tsx scripts/fetch-all-data.ts 12/25        # Entire month (mm/yy)
 *   npx tsx scripts/fetch-all-data.ts 25           # Entire year (yy)
 *   npx tsx scripts/fetch-all-data.ts --parallel=5 # Control day concurrency
 *   npx tsx scripts/fetch-all-data.ts --threads=4  # XZ decompression threads (default: 4)
 *   npx tsx scripts/fetch-all-data.ts --geoip=/path/to/GeoLite2-City.mmdb
 * 
 * Resource Requirements (for historical data processing):
 *   --threads=1: ~4GB RAM (slowest, minimum memory)
 *   --threads=4: ~6GB RAM (default, good balance)
 *   --threads=0: ~9GB RAM (all cores, same speed as -T4)
 *   Processing 1 month: ~70-80 seconds with default settings
 */

import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import { exec, spawn } from 'child_process';
import * as readline from 'readline';
import { promisify } from 'util';
import { fileURLToPath } from 'url';

const execAsync = promisify(exec);

// Get project root directory (works regardless of where script is run from)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

// ============================================================================
// Version Information
// ============================================================================

const VERSION = '1.0.0';

// Parallel defaults based on workload type
const DEFAULT_PARALLEL_DAY = 1;
const DEFAULT_PARALLEL_MONTH = 8;
const DEFAULT_PARALLEL_YEAR = 12;  // Reduced from 15 to avoid overwhelming servers

// XZ decompression threads (configurable via --threads=N)
// Testing showed -T4 and -T0 have identical speed, but -T4 uses 33% less RAM
const DEFAULT_XZ_THREADS = 4;
let XZ_THREADS = DEFAULT_XZ_THREADS;

// Retry configuration
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;  // Start with 2s, then exponential backoff
const RETRY_JITTER_MS = 2000;  // Random jitter 0-2s to prevent thundering herd

// Timeout configuration
const DOWNLOAD_TIMEOUT_MS = 30000;      // 30s connection timeout for archive downloads
const DOWNLOAD_STALL_MS = 15000;        // 15s stall detection (no data received)
const COUNTRY_FETCH_TIMEOUT_MS = 180000; // 3 min timeout for country data (API is slow)

// Concurrency limits
const MAX_COUNTRY_FETCH_CONCURRENCY = 3;  // Max concurrent country data fetches

// ============================================================================
// Types
// ============================================================================

interface OnionooRelay {
  nickname: string;
  fingerprint: string;
  or_addresses: string[];
  country?: string;
  flags?: string[];
  observed_bandwidth?: number;
}

interface OnionooResponse {
  relays_published: string;
  relays: OnionooRelay[];
}

interface RelayInfo {
  nickname: string;
  fingerprint: string;
  bandwidth: number;
  flags: string;
  ip: string;
  port: string;
}

interface AggregatedNode {
  lat: number;
  lng: number;
  x: number;
  y: number;
  bandwidth: number;
  normalized_bandwidth: number;
  label: string;
  relays: RelayInfo[];
}

interface ProcessedRelayData {
  version: string;
  generatedAt: string;
  source: 'onionoo' | 'collector';
  geoip: {
    provider: 'maxmind' | 'geoip-lite' | 'country-centroid';
    version?: string;
    buildDate?: string;
  };
  published: string;
  nodes: AggregatedNode[];
  bandwidth: number;
  relayCount: number;
  geolocatedCount: number;
  minMax: { min: number; max: number };
}

interface CountryData {
  version: string;
  generatedAt: string;
  date: string;
  totalUsers: number;
  countries: { [code: string]: number };
}

interface DateIndex {
  version: string;
  lastUpdated: string;
  dates: string[];
  // Bandwidth array for sparkline/chart preview (lightweight)
  bandwidths: number[];
}

interface DateRange {
  start: Date;
  end: Date;
  mode: 'day' | 'month' | 'year';
  description: string;
}

// ============================================================================
// Configuration
// ============================================================================

function loadConfig(): Record<string, string> {
  const config: Record<string, string> = {};
  const configPaths = [
    path.join(PROJECT_ROOT, 'deploy', 'config.env'),
    path.join(PROJECT_ROOT, 'config.env'),
  ];
  
  for (const configPath of configPaths) {
    if (fs.existsSync(configPath)) {
      const content = fs.readFileSync(configPath, 'utf-8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const [key, ...valueParts] = trimmed.split('=');
        if (key && valueParts.length > 0) {
          config[key.trim()] = valueParts.join('=').trim();
        }
      }
      break;
    }
  }
  
  return config;
}

const fileConfig = loadConfig();
const CACHE_DIR = path.join(PROJECT_ROOT, 'data', 'cache');
const OUTPUT_DIR = path.join(PROJECT_ROOT, 'public', 'data');

// Default GeoIP path (can be overridden via config file or --geoip= argument)
const DEFAULT_GEOIP_PATH = path.join(PROJECT_ROOT, 'data', 'geoip', 'GeoLite2-City.mmdb');

// Runtime config (set in main after parsing args)
let GEOIP_DB_PATH = fileConfig.GEOIP_DB_PATH || DEFAULT_GEOIP_PATH;

// Country centroids as fallback (lng, lat)
const COUNTRY_CENTROIDS: Record<string, [number, number]> = {
  'AD': [1.52, 42.55], 'AE': [53.85, 23.42], 'AF': [67.71, 33.94], 'AL': [20.17, 41.15],
  'AM': [45.04, 40.07], 'AO': [17.87, -11.20], 'AR': [-63.62, -38.42], 'AT': [14.55, 47.52],
  'AU': [133.78, -25.27], 'AZ': [47.58, 40.14], 'BA': [17.68, 43.92], 'BD': [90.36, 23.68],
  'BE': [4.47, 50.50], 'BG': [25.49, 42.73], 'BR': [-51.93, -14.24], 'BY': [27.95, 53.71],
  'CA': [-106.35, 56.13], 'CH': [8.23, 46.82], 'CL': [-71.54, -35.68], 'CN': [104.20, 35.86],
  'CO': [-74.30, 4.57], 'CZ': [15.47, 49.82], 'DE': [10.45, 51.17], 'DK': [9.50, 56.26],
  'EE': [25.01, 58.60], 'EG': [30.80, 26.82], 'ES': [-3.75, 40.46], 'FI': [25.75, 61.92],
  'FR': [2.21, 46.23], 'GB': [-3.44, 55.38], 'GE': [43.36, 42.32], 'GR': [21.82, 39.07],
  'HK': [114.11, 22.40], 'HR': [15.20, 45.10], 'HU': [19.50, 47.16], 'ID': [113.92, -0.79],
  'IE': [-8.24, 53.41], 'IL': [34.85, 31.05], 'IN': [78.96, 20.59], 'IR': [53.69, 32.43],
  'IS': [-19.02, 64.96], 'IT': [12.57, 41.87], 'JP': [138.25, 36.20], 'KR': [127.77, 35.91],
  'KZ': [66.92, 48.02], 'LT': [23.88, 55.17], 'LU': [6.13, 49.82], 'LV': [24.60, 56.88],
  'MD': [28.37, 47.41], 'MX': [-102.55, 23.63], 'MY': [101.98, 4.21], 'NL': [5.29, 52.13],
  'NO': [8.47, 60.47], 'NZ': [174.89, -40.90], 'PL': [19.15, 51.92], 'PT': [-8.22, 39.40],
  'RO': [24.97, 45.94], 'RS': [21.01, 44.02], 'RU': [105.32, 61.52], 'SE': [18.64, 60.13],
  'SG': [103.82, 1.35], 'SI': [15.00, 46.15], 'SK': [19.70, 48.67], 'TH': [100.99, 15.87],
  'TR': [35.24, 38.96], 'TW': [120.96, 23.70], 'UA': [31.17, 48.38], 'US': [-95.71, 37.09],
  'VN': [108.28, 14.06], 'ZA': [22.94, -30.56],
};

// ============================================================================
// Global State
// ============================================================================

// GeoIP provider types
type GeoLiteLookup = {
  lookup(ip: string): { ll?: [number, number] } | null;
};

// GeoIP metadata for tracking the source and version
interface GeoIPMetadata {
  provider: 'maxmind' | 'geoip-lite' | 'country-centroid';
  version?: string;
  buildDate?: string;
  databasePath?: string;
}

let geoReader: any = null;
let geoipLite: GeoLiteLookup | null = null;
let geoipMetadata: GeoIPMetadata = { provider: 'country-centroid' };

const status = {
  relayFiles: 0,
  countryFiles: 0,
  skipped: 0,
  failed: 0,
  totalRelays: 0,
  totalGeolocated: 0,
};

// Timing tracker for detailed per-step timing
interface StepTiming {
  step: string;
  durationMs: number;
}

interface DateTiming {
  date: string;
  totalMs: number;
  steps: StepTiming[];
}

const timings: DateTiming[] = [];

function formatDuration(ms: number): string {
  const rounded = Math.round(ms);
  if (rounded === 0) return `${ms.toFixed(2)}ms`;
  if (rounded < 1000) return `${rounded}ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(ms / 60000);
  return `${minutes}m`;
}

// ============================================================================
// Utility Functions
// ============================================================================

function getNormalizedPosition(lat: number, lng: number): { x: number; y: number } {
  const x = (lng + 180) / 360;
  const latRad = lat * (Math.PI / 180);
  const mercN = Math.log(Math.tan(Math.PI / 4 + latRad / 2));
  const y = 0.5 + mercN / (2 * Math.PI);
  return { x, y };
}

function mapFlags(flags?: string[]): string {
  if (!flags) return 'M';
  let result = '';
  if (flags.includes('Running')) result += 'M';
  if (flags.includes('Guard')) result += 'G';
  if (flags.includes('Exit')) result += 'E';
  if (flags.includes('HSDir')) result += 'H';
  return result || 'M';
}

function parseAddress(or_addresses: string[]): { ip: string; port: string } {
  if (!or_addresses || or_addresses.length === 0) {
    return { ip: '0.0.0.0', port: '0' };
  }
  const ipv4Addr = or_addresses.find(addr => !addr.includes('['));
  const addr = ipv4Addr || or_addresses[0];
  
  if (addr.includes('[')) {
    const match = addr.match(/\[([^\]]+)\]:(\d+)/);
    if (match) return { ip: match[1], port: match[2] };
  } else {
    const parts = addr.split(':');
    if (parts.length === 2) return { ip: parts[0], port: parts[1] };
  }
  return { ip: '0.0.0.0', port: '0' };
}

function normalizeFingerprint(fp: string): string {
  if (!fp) return '';
  let clean = fp.trim().replace(/[$:\s-]/g, '');
  if (/^[0-9a-fA-F]{40}$/.test(clean)) {
    return clean.toUpperCase();
  }
  if (/^[a-zA-Z0-9+/]{27,28}=*$/.test(clean)) {
    try {
      const hex = Buffer.from(clean, 'base64').toString('hex').toUpperCase();
      if (/^[0-9A-F]{40}$/.test(hex)) return hex;
    } catch {}
  }
  return clean.toUpperCase();
}

function base64ToHex(base64: string): string {
  try {
    const padded = base64 + '='.repeat((4 - base64.length % 4) % 4);
    return Buffer.from(padded, 'base64').toString('hex').toUpperCase();
  } catch {
    return base64;
  }
}

function getCountryCoords(countryCode?: string): { lat: number; lng: number } {
  const cc = (countryCode || 'US').toUpperCase();
  const coords = COUNTRY_CENTROIDS[cc] || COUNTRY_CENTROIDS['US'];
  return {
    lat: coords[1] + (Math.random() - 0.5) * 2,
    lng: coords[0] + (Math.random() - 0.5) * 2,
  };
}

function geolocateIP(ip: string): { lat: number; lng: number } | null {
  // Try MaxMind first (more accurate, updated more frequently)
  if (geoReader) {
    try {
      const r = geoReader.get(ip);
      if (r?.location) {
        return { lat: r.location.latitude, lng: r.location.longitude };
      }
    } catch {}
  }
  
  // Fall back to geoip-lite
  if (geoipLite) {
    try {
      const lookup = geoipLite.lookup(ip);
      if (lookup?.ll) {
        const [lat, lng] = lookup.ll;
        return { lat, lng };
      }
    } catch {}
  }
  
  return null;
}

/**
 * Initialize GeoIP providers with metadata tracking.
 * Tries MaxMind first (more accurate), falls back to geoip-lite.
 */
async function initializeGeoIP(): Promise<void> {
  // Try MaxMind first (more accurate, weekly updates available)
  if (fs.existsSync(GEOIP_DB_PATH)) {
    try {
      const maxmind = await import('maxmind');
      geoReader = await maxmind.open(GEOIP_DB_PATH);
      
      // Get database metadata (build date from file mtime as proxy)
      const stats = fs.statSync(GEOIP_DB_PATH);
      const buildDate = stats.mtime.toISOString().slice(0, 10);
      
      geoipMetadata = {
        provider: 'maxmind',
        version: 'GeoLite2-City',
        buildDate,
        databasePath: GEOIP_DB_PATH,
      };
      
      console.log(`  ✓ MaxMind database loaded (build: ${buildDate})`);
      return;
    } catch (e: any) {
      console.log(`  ⚠ Failed to load MaxMind database: ${e.message}`);
    }
  } else {
    console.log(`  ⚠ MaxMind DB not found at ${GEOIP_DB_PATH}`);
  }
  
  // Fall back to geoip-lite (less accurate but works out-of-box)
  try {
    const geoipModule: any = await import('geoip-lite');
    const fallback = geoipModule?.default || geoipModule;
    if (fallback && typeof fallback.lookup === 'function') {
      geoipLite = fallback as GeoLiteLookup;
      
      // geoip-lite version comes from package.json
      let version = 'unknown';
      try {
        // Try to find the geoip-lite package.json in node_modules
        const possiblePaths = [
          path.join(PROJECT_ROOT, 'node_modules', 'geoip-lite', 'package.json'),
          path.join(__dirname, '..', 'node_modules', 'geoip-lite', 'package.json'),
        ];
        for (const pkgPath of possiblePaths) {
          if (fs.existsSync(pkgPath)) {
            const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
            version = pkg.version || 'unknown';
            break;
          }
        }
      } catch {}
      
      geoipMetadata = {
        provider: 'geoip-lite',
        version,
      };
      
      console.log(`  ✓ geoip-lite fallback loaded (v${version})`);
      return;
    }
  } catch (e: any) {
    console.log(`  ⚠ geoip-lite fallback unavailable: ${e.message}`);
  }
  
  // No GeoIP available - will use country centroids
  geoipMetadata = { provider: 'country-centroid' };
  console.log('  ⚠ No GeoIP provider available, using country centroids');
}

// ============================================================================
// Date Parsing
// ============================================================================

function parseDateRange(input: string): DateRange {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentCentury = Math.floor(currentYear / 100) * 100;
  
  input = input.trim();
  
  // Legacy --date= format
  if (input.startsWith('--date=')) {
    const dateStr = input.slice(7);
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) throw new Error(`Invalid date: ${dateStr}`);
    return { start: date, end: date, mode: 'day', description: dateStr };
  }
  
  // mm/dd/yy format
  const dayMatch = input.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
  if (dayMatch) {
    const [, month, day, yearShort] = dayMatch;
    const year = currentCentury + parseInt(yearShort, 10);
    const date = new Date(year, parseInt(month, 10) - 1, parseInt(day, 10));
    if (isNaN(date.getTime())) throw new Error(`Invalid date: ${input}`);
    return { start: date, end: date, mode: 'day', description: date.toISOString().slice(0, 10) };
  }
  
  // mm/yy format
  const monthMatch = input.match(/^(\d{1,2})\/(\d{2})$/);
  if (monthMatch) {
    const [, month, yearShort] = monthMatch;
    const year = currentCentury + parseInt(yearShort, 10);
    const monthNum = parseInt(month, 10) - 1;
    const start = new Date(year, monthNum, 1);
    const end = new Date(year, monthNum + 1, 0);
    if (isNaN(start.getTime())) throw new Error(`Invalid month: ${input}`);
    return {
      start, end, mode: 'month',
      description: `${year}-${String(monthNum + 1).padStart(2, '0')} (${start.toISOString().slice(0, 10)} to ${end.toISOString().slice(0, 10)})`,
    };
  }
  
  // yy format
  const yearMatch = input.match(/^(\d{2})$/);
  if (yearMatch) {
    const year = currentCentury + parseInt(yearMatch[1], 10);
    const start = new Date(year, 0, 1);
    const end = new Date(year, 11, 31);
    return {
      start, end, mode: 'year',
      description: `${year} (${start.toISOString().slice(0, 10)} to ${end.toISOString().slice(0, 10)})`,
    };
  }
  
  // ISO format fallback
  const date = new Date(input);
  if (!isNaN(date.getTime())) {
    return { start: date, end: date, mode: 'day', description: date.toISOString().slice(0, 10) };
  }
  
  throw new Error(`Unrecognized date format: ${input}. Use mm/dd/yy, mm/yy, or yy`);
}

function generateDatesInRange(range: DateRange): string[] {
  const dates: string[] = [];
  const current = new Date(range.start);
  const today = new Date();
  today.setHours(23, 59, 59, 999); // End of today
  
  // Cap end date at today (can't fetch future data)
  const effectiveEnd = range.end > today ? today : range.end;
  
  while (current <= effectiveEnd) {
    dates.push(current.toISOString().slice(0, 10));
    current.setDate(current.getDate() + 1);
  }
  return dates;
}

function isRecentDate(dateStr: string): boolean {
  const date = new Date(dateStr);
  const now = new Date();
  const diffDays = (now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24);
  // Use Onionoo for today and yesterday, Collector for older
  return diffDays < 2;
}

// ============================================================================
// Data Source: Onionoo (Live Data)
// ============================================================================

function fetchOnionooRelays(): Promise<OnionooResponse> {
  return new Promise((resolve, reject) => {
    console.log('    📡 Fetching from Onionoo API...');
    const startTime = Date.now();
    
    const options = {
      hostname: 'onionoo.torproject.org',
      path: '/details?type=relay&running=true',
      method: 'GET',
      headers: { 'User-Agent': `RouteFluxMap-DataFetcher/${VERSION}` },
    };
    
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
          console.log(`    ✓ Onionoo response (${elapsed}s)`);
          resolve(JSON.parse(data));
        } catch (e) { reject(e); }
      });
    });
    
    req.on('error', reject);
    req.end();
  });
}

async function processOnionooRelays(data: OnionooResponse): Promise<ProcessedRelayData> {
  const relays = data.relays || [];
  let geolocated = 0, fallback = 0;
  const maxBw = Math.max(...relays.map(r => r.observed_bandwidth || 0), 1);
  
  const aggregated: Map<string, { lat: number; lng: number; relays: RelayInfo[] }> = new Map();
  
  for (const relay of relays) {
    const addr = parseAddress(relay.or_addresses);
    let lat: number, lng: number;
    
    const geo = geolocateIP(addr.ip);
    if (geo) {
      lat = geo.lat; lng = geo.lng; geolocated++;
    } else {
      const coords = getCountryCoords(relay.country);
      lat = coords.lat; lng = coords.lng; fallback++;
    }
    
    const key = `${lat.toFixed(2)},${lng.toFixed(2)}`;
    if (!aggregated.has(key)) {
      aggregated.set(key, { lat, lng, relays: [] });
    }
    
    aggregated.get(key)!.relays.push({
      nickname: relay.nickname || 'Unnamed',
      fingerprint: normalizeFingerprint(relay.fingerprint),
      bandwidth: (relay.observed_bandwidth || 0) / maxBw,
      flags: mapFlags(relay.flags),
      ip: addr.ip,
      port: addr.port,
    });
  }
  
  status.totalGeolocated += geolocated;
  status.totalRelays += relays.length;
  
  return buildProcessedData(aggregated, data.relays_published, 'onionoo', relays.length, geolocated);
}

// ============================================================================
// Lock Manager for Thread-Safe Downloads
// ============================================================================

// Tracks in-progress downloads and extractions to prevent race conditions
const downloadLocks: Map<string, Promise<string | null>> = new Map();
const extractionLocks: Map<string, Promise<string | null>> = new Map();
const descriptorParseLocks: Map<string, Promise<Map<string, BandwidthEntry[]>>> = new Map();
const countryFetchLocks: Map<string, Promise<Map<string, CountryData>>> = new Map();

// Semaphore for limiting concurrent country fetches
let activeCountryFetches = 0;
const countryFetchQueue: (() => void)[] = [];

async function withCountryFetchLimit<T>(operation: () => Promise<T>): Promise<T> {
  // Wait if at max concurrency
  if (activeCountryFetches >= MAX_COUNTRY_FETCH_CONCURRENCY) {
    await new Promise<void>(resolve => countryFetchQueue.push(resolve));
  }
  
  activeCountryFetches++;
  try {
    return await operation();
  } finally {
    activeCountryFetches--;
    // Release next waiting operation
    const next = countryFetchQueue.shift();
    if (next) next();
  }
}

async function withLock<T>(
  locks: Map<string, Promise<T>>,
  key: string,
  operation: () => Promise<T>
): Promise<T> {
  // Check if another operation is already in progress
  const existing = locks.get(key);
  if (existing) {
    return existing;
  }
  
  // Start the operation and store its promise
  const promise = operation();
  locks.set(key, promise);
  
  try {
    return await promise;
  } finally {
    locks.delete(key);
  }
}

// ============================================================================
// Retry Logic with Exponential Backoff
// ============================================================================

async function withRetry<T>(
  operation: () => Promise<T>,
  operationName: string,
  maxRetries: number = MAX_RETRIES
): Promise<T> {
  let lastError: Error | null = null;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (e: any) {
      lastError = e;
      if (attempt < maxRetries) {
        // Add jitter to prevent thundering herd when multiple workers retry
        const jitter = Math.random() * RETRY_JITTER_MS;
        const delay = RETRY_DELAY_MS * Math.pow(2, attempt - 1) + jitter;
        console.log(`    ⚠ ${operationName} failed (attempt ${attempt}/${maxRetries}): ${e.message}`);
        console.log(`    ⏳ Retrying in ${(delay / 1000).toFixed(1)}s...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  throw lastError;
}

// ============================================================================
// Data Source: Collector (Historical Archives)
// ============================================================================

function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // Use a temp file to avoid partial downloads being used
    const tempDest = dest + '.downloading';
    const file = fs.createWriteStream(tempDest);
    let stallCheckInterval: NodeJS.Timeout | null = null;
    let resolved = false;
    
    const cleanup = () => {
      if (stallCheckInterval) {
        clearInterval(stallCheckInterval);
        stallCheckInterval = null;
      }
    };
    
    const fail = (error: Error) => {
      if (resolved) return;
      resolved = true;
      cleanup();
      fs.unlink(tempDest, () => {});
      reject(error);
    };
    
    const req = https.get(url, res => {
      if (res.statusCode !== 200) {
        fail(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      
      // Track progress for stall detection
      let lastDataTime = Date.now();
      res.on('data', () => { lastDataTime = Date.now(); });
      
      // Check for stalls every 5 seconds
      stallCheckInterval = setInterval(() => {
        if (Date.now() - lastDataTime > DOWNLOAD_STALL_MS) {
          req.destroy();
          fail(new Error(`Download stalled (no data for ${DOWNLOAD_STALL_MS / 1000}s)`));
        }
      }, 5000);
      
      res.pipe(file);
      file.on('finish', () => {
        if (resolved) return;
        resolved = true;
        cleanup();
        file.close();
        // Rename temp file to final destination atomically
        try {
          fs.renameSync(tempDest, dest);
          resolve();
        } catch (e) {
          fs.unlink(tempDest, () => {});
          reject(e as Error);
        }
      });
    });
    
    // Connection timeout
    req.setTimeout(DOWNLOAD_TIMEOUT_MS, () => {
      req.destroy();
      fail(new Error(`Connection timeout (${DOWNLOAD_TIMEOUT_MS / 1000}s)`));
    });
    
    req.on('error', e => {
      fail(e);
    });
  });
}

async function verifyArchive(archivePath: string): Promise<boolean> {
  try {
    await execAsync(`xz -t "${archivePath}"`, { timeout: 120000 });
    return true;
  } catch {
    return false;
  }
}

async function ensureConsensusArchive(year: number, month: number): Promise<string | null> {
  const monthStr = `${year}-${String(month).padStart(2, '0')}`;
  const cachePath = path.join(CACHE_DIR, `consensuses-${monthStr}.tar.xz`);
  
  // Use lock to prevent multiple parallel downloads of the same file
  return withLock(downloadLocks, `consensus-${monthStr}`, async () => {
    // Check if already downloaded and valid
    if (fs.existsSync(cachePath) && fs.statSync(cachePath).size > 1000) {
      // Verify integrity
      if (await verifyArchive(cachePath)) {
        return cachePath;
      }
      console.log(`    ⚠ Corrupted consensus archive ${monthStr}, re-downloading...`);
      fs.unlinkSync(cachePath);
    }
    
    console.log(`    📥 Downloading consensus archive ${monthStr}...`);
    const url = `https://collector.torproject.org/archive/relay-descriptors/consensuses/consensuses-${monthStr}.tar.xz`;
    
    try {
      await withRetry(async () => {
        await downloadFile(url, cachePath);
        // Verify after download
        if (!await verifyArchive(cachePath)) {
          fs.unlinkSync(cachePath);
          throw new Error('Archive verification failed');
        }
      }, `Download consensus ${monthStr}`);
      
      console.log(`    ✓ Downloaded consensus ${monthStr}`);
      return cachePath;
    } catch (e: any) {
      console.log(`    ✗ Failed to download consensus ${monthStr}: ${e.message}`);
      return null;
    }
  });
}

async function ensureDescriptorArchive(year: number, month: number): Promise<string | null> {
  const monthStr = `${year}-${String(month).padStart(2, '0')}`;
  const cachePath = path.join(CACHE_DIR, `server-descriptors-${monthStr}.tar.xz`);
  
  // Use lock to prevent multiple parallel downloads of the same file
  return withLock(downloadLocks, `descriptors-${monthStr}`, async () => {
    // Check if already downloaded and valid
    if (fs.existsSync(cachePath) && fs.statSync(cachePath).size > 1000) {
      // Verify integrity
      if (await verifyArchive(cachePath)) {
        return cachePath;
      }
      console.log(`    ⚠ Corrupted descriptors archive ${monthStr}, re-downloading...`);
      fs.unlinkSync(cachePath);
    }
    
    console.log(`    📥 Downloading server descriptors ${monthStr} (~400MB)...`);
    const url = `https://collector.torproject.org/archive/relay-descriptors/server-descriptors/server-descriptors-${monthStr}.tar.xz`;
    
    try {
      await withRetry(async () => {
        await downloadFile(url, cachePath);
        // Verify after download
        if (!await verifyArchive(cachePath)) {
          fs.unlinkSync(cachePath);
          throw new Error('Archive verification failed');
        }
      }, `Download descriptors ${monthStr}`);
      
      console.log(`    ✓ Downloaded server descriptors ${monthStr}`);
      return cachePath;
    } catch (e: any) {
      console.log(`    ✗ Failed to download descriptors ${monthStr}: ${e.message}`);
      return null;
    }
  });
}

// Per-day bandwidth entry: { date: "YYYY-MM-DD", bandwidth: number }
interface BandwidthEntry {
  date: string;
  bandwidth: number;
}

// Cache for parsed descriptor bandwidth data (fingerprint -> timestamped bandwidths)
// Each relay has multiple bandwidth entries from descriptors published throughout the month
const descriptorBandwidthCache: Map<string, Map<string, BandwidthEntry[]>> = new Map();

/**
 * Get bandwidth for a specific relay on a specific date.
 * Finds the most recent descriptor published on or before the target date.
 */
function getBandwidthForDate(
  bandwidthMap: Map<string, BandwidthEntry[]>,
  fingerprint: string,
  targetDate: string
): number | undefined {
  const entries = bandwidthMap.get(fingerprint);
  if (!entries || entries.length === 0) return undefined;
  
  // Entries are sorted by date ascending
  // Find the last entry where date <= targetDate
  let result: BandwidthEntry | undefined;
  for (const entry of entries) {
    if (entry.date <= targetDate) {
      result = entry;
    } else {
      break; // Past target date, stop searching
    }
  }
  
  // If no entry found before target date, use the first available
  // (relay may have published its first descriptor mid-month)
  return result?.bandwidth ?? entries[0]?.bandwidth;
}

// Cache for extracted consensus directories (monthStr -> extracted dir path)
const extractedConsensusCache: Map<string, string> = new Map();

/**
 * Extract entire consensus archive once per month to a temp directory.
 * This is much faster than extracting individual days (7.7s once vs 7.7s × N days).
 * XZ decompression is the bottleneck - it must decompress the entire stream regardless
 * of which files are extracted, so extracting everything at once is optimal.
 */
async function ensureExtractedConsensus(year: number, month: number): Promise<string | null> {
  const monthStr = `${year}-${String(month).padStart(2, '0')}`;
  
  // Return cached if already extracted
  if (extractedConsensusCache.has(monthStr)) {
    return extractedConsensusCache.get(monthStr)!;
  }
  
  // Use lock to prevent multiple parallel extractions of the same archive
  return withLock(extractionLocks, `consensus-${monthStr}`, async () => {
    // Double-check cache after acquiring lock
    if (extractedConsensusCache.has(monthStr)) {
      return extractedConsensusCache.get(monthStr)!;
    }
    
    // First ensure the archive exists
    const archivePath = await ensureConsensusArchive(year, month);
    if (!archivePath) return null;
    
    // Extract to temp directory
    const extractDir = path.join(CACHE_DIR, `extracted-consensuses-${monthStr}`);
    const expectedDir = path.join(extractDir, `consensuses-${monthStr}`);
    
    // Check if already extracted (from previous run)
    if (fs.existsSync(expectedDir)) {
      const files = fs.readdirSync(expectedDir);
      if (files.length > 0) {
        console.log(`    ✓ Using cached extracted consensus for ${monthStr}`);
        extractedConsensusCache.set(monthStr, expectedDir);
        return expectedDir;
      }
    }
    
    console.log(`    📦 Extracting full consensus archive ${monthStr} (one-time)...`);
    const extractStart = Date.now();
    
    try {
      // Clean up any partial extraction
      if (fs.existsSync(extractDir)) {
        fs.rmSync(extractDir, { recursive: true });
      }
      fs.mkdirSync(extractDir, { recursive: true });
      
      // Extract entire archive at once (xz decompression happens once)
      await withRetry(async () => {
        await execAsync(
          `tar -xf "${archivePath}" --xz -C "${extractDir}"`,
          { maxBuffer: 10 * 1024 * 1024 }
        );
        
        // Verify extraction succeeded
        if (!fs.existsSync(expectedDir)) {
          throw new Error('Extraction produced unexpected directory structure');
        }
      }, `Extract consensus ${monthStr}`);
      
      const elapsed = ((Date.now() - extractStart) / 1000).toFixed(1);
      console.log(`    ✓ Extracted consensus archive ${monthStr} (${elapsed}s)`);
      
      extractedConsensusCache.set(monthStr, expectedDir);
      return expectedDir;
    } catch (e: any) {
      console.log(`    ✗ Failed to extract consensus ${monthStr}: ${e.message}`);
      // Clean up failed extraction
      if (fs.existsSync(extractDir)) {
        fs.rmSync(extractDir, { recursive: true });
      }
      return null;
    }
  });
}

async function loadDescriptorBandwidth(year: number, month: number): Promise<Map<string, BandwidthEntry[]>> {
  const monthStr = `${year}-${String(month).padStart(2, '0')}`;
  
  // Return in-memory cached if available (fastest - same process)
  if (descriptorBandwidthCache.has(monthStr)) {
    return descriptorBandwidthCache.get(monthStr)!;
  }
  
  // Use lock to prevent multiple parallel workers from parsing the same archive
  // This prevents 8× RAM usage and 8× duplicate work when workers start simultaneously
  const lockKey = `descriptor-parse-${monthStr}`;
  const existingLock = descriptorParseLocks.get(lockKey);
  if (existingLock) {
    console.log(`    ⏳ Waiting for descriptor parse (another worker is processing)...`);
    return existingLock;
  }
  
  // Start the parsing operation and store promise for other workers to await
  const parsePromise = loadDescriptorBandwidthInternal(year, month, monthStr);
  descriptorParseLocks.set(lockKey, parsePromise);
  
  try {
    return await parsePromise;
  } finally {
    descriptorParseLocks.delete(lockKey);
  }
}

async function loadDescriptorBandwidthInternal(year: number, month: number, monthStr: string): Promise<Map<string, BandwidthEntry[]>> {
  // Double-check in-memory cache after acquiring lock (another worker may have finished)
  if (descriptorBandwidthCache.has(monthStr)) {
    console.log(`    ✓ Using in-memory cache (populated by another worker)`);
    return descriptorBandwidthCache.get(monthStr)!;
  }
  
  // OPTIMIZATION 2: Check for JSON cache file (fast - ~50ms vs ~100s parsing)
  // Use v2 suffix to differentiate from old single-value cache format
  const jsonCachePath = path.join(CACHE_DIR, `bandwidth-cache-v2-${monthStr}.json`);
  const archivePath = path.join(CACHE_DIR, `server-descriptors-${monthStr}.tar.xz`);
  
  if (fs.existsSync(jsonCachePath)) {
    try {
      const cacheStats = fs.statSync(jsonCachePath);
      // Validate cache is newer than archive (if archive exists)
      const archiveExists = fs.existsSync(archivePath);
      const archiveStats = archiveExists ? fs.statSync(archivePath) : null;
      
      if (!archiveExists || cacheStats.mtime > archiveStats!.mtime) {
        const loadStart = Date.now();
        const data: Record<string, BandwidthEntry[]> = JSON.parse(fs.readFileSync(jsonCachePath, 'utf-8'));
        const bandwidthMap = new Map<string, BandwidthEntry[]>(Object.entries(data));
        const elapsed = Date.now() - loadStart;
        // Count total descriptors
        let totalDesc = 0;
        for (const entries of bandwidthMap.values()) totalDesc += entries.length;
        console.log(`    ✓ Loaded bandwidth cache for ${monthStr} (${totalDesc} descriptors, ${bandwidthMap.size} relays, ${elapsed}ms)`);
        descriptorBandwidthCache.set(monthStr, bandwidthMap);
        return bandwidthMap;
      }
    } catch (e: any) {
      console.log(`    ⚠ Invalid bandwidth cache, will re-parse: ${e.message}`);
    }
  }
  
  // Need to download/parse - ensure archive exists
  const downloadedPath = await ensureDescriptorArchive(year, month);
  if (!downloadedPath) {
    return new Map();
  }
  
  // OPTIMIZATION 1: Use multi-threaded XZ decompression
  // Testing showed -T4 and -T0 have identical speed (~72s total), but:
  // -T4: 6GB peak RAM, -T0: 9GB peak RAM → -T4 is default
  // Configurable via --threads=N (0 = all cores)
  const threadArg = XZ_THREADS === 0 ? '-T0' : `-T${XZ_THREADS}`;
  console.log(`    📄 Parsing server descriptors for ${monthStr} (xz ${threadArg}, single worker)...`);
  const parseStart = Date.now();
  
  // New structure: fingerprint -> array of {date, bandwidth} entries
  const bandwidthMap = new Map<string, BandwidthEntry[]>();
  
  return new Promise((resolve) => {
    // Parse lock ensures only 1 xz runs at a time
    const xz = spawn('xz', [threadArg, '-dc', downloadedPath]);
    const tar = spawn('tar', ['-xf', '-', '-O']);
    
    // Pipe xz output to tar input
    xz.stdout.pipe(tar.stdin);
    
    xz.on('error', (err) => {
      console.log(`    ⚠ xz error: ${err.message}, falling back to single-threaded`);
      // Fallback handled by tar error
    });
    
    tar.on('error', (err) => {
      console.log(`    ⚠ Failed to spawn tar: ${err.message}`);
      resolve(new Map());
    });

    const rl = readline.createInterface({
      input: tar.stdout,
      crlfDelay: Infinity
    });

    // Track current descriptor being parsed
    let currentFingerprint: string | null = null;
    let currentPublished: string | null = null;
    let currentBandwidth: number | null = null;
    let totalDescriptors = 0;

    rl.on('line', (line) => {
      // Optimization: check start of line before running regex
      if (line.startsWith('@type ')) {
        // Save previous descriptor if complete
        if (currentFingerprint && currentPublished && currentBandwidth !== null) {
          if (!bandwidthMap.has(currentFingerprint)) {
            bandwidthMap.set(currentFingerprint, []);
          }
          bandwidthMap.get(currentFingerprint)!.push({
            date: currentPublished,
            bandwidth: currentBandwidth,
          });
          totalDescriptors++;
        }
        // Reset for new descriptor
        currentFingerprint = null;
        currentPublished = null;
        currentBandwidth = null;
      } else if (line.startsWith('fingerprint ')) {
        const match = line.match(/^fingerprint\s+([\dA-F\s]+)/i);
        if (match) {
          currentFingerprint = match[1].trim().replace(/\s+/g, '').toUpperCase();
        }
      } else if (line.startsWith('published ')) {
        // Format: published YYYY-MM-DD HH:MM:SS
        const match = line.match(/^published\s+(\d{4}-\d{2}-\d{2})/);
        if (match) {
          currentPublished = match[1];
        }
      } else if (line.startsWith('bandwidth ') && currentFingerprint) {
        const match = line.match(/^bandwidth\s+\d+\s+\d+\s+(\d+)/);
        if (match) {
          const observedBandwidth = parseInt(match[1], 10);
          // Filter out bogus values: INT_MAX (2^31-1 = 2147483647) indicates overflow
          if (observedBandwidth < 2147483647) {
            currentBandwidth = observedBandwidth;
          }
        }
      }
    });

    rl.on('close', () => {
      // Don't forget the last descriptor
      if (currentFingerprint && currentPublished && currentBandwidth !== null) {
        if (!bandwidthMap.has(currentFingerprint)) {
          bandwidthMap.set(currentFingerprint, []);
        }
        bandwidthMap.get(currentFingerprint)!.push({
          date: currentPublished,
          bandwidth: currentBandwidth,
        });
        totalDescriptors++;
      }
      
      // Sort each relay's entries by date for efficient lookup
      for (const entries of bandwidthMap.values()) {
        entries.sort((a, b) => a.date.localeCompare(b.date));
      }
      
      const elapsed = ((Date.now() - parseStart) / 1000).toFixed(1);
      console.log(`    ✓ Parsed ${totalDescriptors} descriptors for ${bandwidthMap.size} relays (${elapsed}s)`);
      
      // OPTIMIZATION 2: Save to JSON cache for future runs
      if (bandwidthMap.size > 0) {
        try {
          // Convert Map to serializable object
          const cacheData: Record<string, BandwidthEntry[]> = {};
          for (const [fp, entries] of bandwidthMap) {
            cacheData[fp] = entries;
          }
          fs.writeFileSync(jsonCachePath, JSON.stringify(cacheData));
          const cacheSizeKB = Math.round(fs.statSync(jsonCachePath).size / 1024);
          console.log(`    ✓ Saved bandwidth cache (${cacheSizeKB}KB)`);
        } catch (e: any) {
          console.log(`    ⚠ Failed to save bandwidth cache: ${e.message}`);
        }
      }
      
      descriptorBandwidthCache.set(monthStr, bandwidthMap);
      resolve(bandwidthMap);
    });
    
    // Consume stderr to prevent blocking
    xz.stderr.on('data', () => {});
    tar.stderr.on('data', () => {});
  });
}

function parseConsensus(text: string): { nickname: string; fingerprint: string; ip: string; port: string; flags: string; bandwidth: number }[] {
  const relays: any[] = [];
  const lines = text.split('\n');
  let current: any = null;
  
  for (const line of lines) {
    if (line.startsWith('r ')) {
      if (current) relays.push(current);
      const p = line.split(' ');
      if (p.length >= 9) {
        current = {
          nickname: p[1],
          fingerprint: base64ToHex(p[2]),
          ip: p[6],
          port: p[7],
          flags: 'M',
          bandwidth: 0,
        };
      }
    } else if (line.startsWith('s ') && current) {
      const f = line.substring(2).split(' ');
      current.flags = 
        (f.includes('Running') ? 'M' : '') +
        (f.includes('Guard') ? 'G' : '') +
        (f.includes('Exit') ? 'E' : '') +
        (f.includes('HSDir') ? 'H' : '') || 'M';
    } else if (line.startsWith('w ') && current) {
      const m = line.match(/Bandwidth=(\d+)/);
      if (m) current.bandwidth = parseInt(m[1]);
    }
  }
  if (current) relays.push(current);
  return relays;
}

/**
 * Find consensus file in a specific directory matching the target prefix.
 */
function findConsensusFileInDir(dirPath: string, targetPrefix: string): string | null {
  if (!fs.existsSync(dirPath)) return null;
  const files = fs.readdirSync(dirPath)
    .filter(file => file.startsWith(targetPrefix))
    .sort();
  if (files.length === 0) return null;
  return path.join(dirPath, files[0]);
}

/**
 * Recursively search for consensus file matching the target prefix.
 */
function searchConsensusRecursively(dirPath: string, targetPrefix: string, depth: number = 0): string | null {
  if (!fs.existsSync(dirPath)) return null;
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        const nested = searchConsensusRecursively(fullPath, targetPrefix, depth + 1);
        if (nested) return nested;
      } else if (entry.isFile() && entry.name.startsWith(targetPrefix)) {
        return fullPath;
      }
    }
  } catch {}
  return null;
}

/**
 * Robust consensus file resolution with multiple fallback strategies.
 */
function resolveConsensusFile(extractedDir: string, dateStr: string): string | null {
  const [, , dayRaw] = dateStr.split('-');
  const dayStr = dayRaw?.padStart(2, '0') || '01';
  const targetPrefix = `${dateStr}-`;
  const triedDirs = new Set<string>();
  
  const addCandidate = (offset: number) => {
    const numericDay = parseInt(dayStr, 10) + offset;
    if (numericDay >= 1 && numericDay <= 31) {
      triedDirs.add(String(numericDay).padStart(2, '0'));
    }
  };
  
  // Try exact day first, then adjacent days
  addCandidate(0);
  for (const offset of [1, -1, 2, -2]) {
    addCandidate(offset);
  }
  
  // Search candidate directories
  for (const dir of triedDirs) {
    const match = findConsensusFileInDir(path.join(extractedDir, dir), targetPrefix);
    if (match) return match;
  }
  
  // Scan all subdirectories
  try {
    const entries = fs.readdirSync(extractedDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const match = findConsensusFileInDir(path.join(extractedDir, entry.name), targetPrefix);
      if (match) return match;
    }
  } catch {}
  
  // Last resort: recursive search
  const recursiveMatch = searchConsensusRecursively(extractedDir, targetPrefix);
  if (recursiveMatch) return recursiveMatch;
  
  return null;
}

async function fetchCollectorRelays(dateStr: string): Promise<ProcessedRelayData | null> {
  return fetchCollectorRelaysWithTiming(dateStr, []);
}

async function fetchCollectorRelaysWithTiming(dateStr: string, steps: StepTiming[]): Promise<ProcessedRelayData | null> {
  const [year, month] = dateStr.split('-').map(Number);
  
  // Ensure consensus is extracted (one-time per month, much faster than per-day extraction)
  const archiveStart = Date.now();
  const extractedDir = await ensureExtractedConsensus(year, month);
  steps.push({ step: 'consensus-extract-all', durationMs: Date.now() - archiveStart });
  
  if (!extractedDir) return null;
  
  // Load real bandwidth from server descriptors
  const descStart = Date.now();
  const bandwidthMap = await loadDescriptorBandwidth(year, month);
  steps.push({ step: 'descriptor-load', durationMs: Date.now() - descStart });
  
  try {
    // Find consensus file for this day using robust resolution
    const findStart = Date.now();
    const consensusFile = resolveConsensusFile(extractedDir, dateStr);
    steps.push({ step: 'consensus-find', durationMs: Date.now() - findStart });
    
    if (!consensusFile) {
      console.log(`    ✗ No consensus for ${dateStr}`);
      return null;
    }
    
    // Read consensus from extracted file (very fast - just file I/O, no decompression)
    const readStart = Date.now();
    const consensusText = fs.readFileSync(consensusFile, 'utf-8');
    steps.push({ step: 'consensus-read', durationMs: Date.now() - readStart });
    
    // Parse consensus (gets relay list with fingerprints)
    const parseStart = Date.now();
    const relays = parseConsensus(consensusText);
    steps.push({ step: 'consensus-parse', durationMs: Date.now() - parseStart });
    
    if (relays.length === 0) return null;
    
    // Single-pass: bandwidth lookup + maxBw calculation + geolocate + aggregate
    const geoStart = Date.now();
    
    // Pass 1: Get bandwidth for each relay and find maxBw
    let matchedBandwidth = 0;
    let maxBw = 0;
    for (const relay of relays) {
      const realBw = getBandwidthForDate(bandwidthMap, relay.fingerprint, dateStr);
      if (realBw !== undefined) {
        relay.bandwidth = realBw;
        matchedBandwidth++;
      }
      maxBw = Math.max(maxBw, relay.bandwidth || 0);
    }
    if (maxBw === 0) maxBw = 1; // Avoid division by zero
    
    // Pass 2: Geolocate and aggregate (uses maxBw for normalization)
    const aggregated: Map<string, { lat: number; lng: number; relays: RelayInfo[] }> = new Map();
    let geolocated = 0;
    
    for (const relay of relays) {
      const geo = geolocateIP(relay.ip);
      const lat = geo?.lat ?? getCountryCoords().lat;
      const lng = geo?.lng ?? getCountryCoords().lng;
      if (geo) geolocated++;
      
      const key = `${lat.toFixed(2)},${lng.toFixed(2)}`;
      if (!aggregated.has(key)) {
        aggregated.set(key, { lat, lng, relays: [] });
      }
      
      aggregated.get(key)!.relays.push({
        nickname: (relay.nickname || '').replace(/,/g, ''),
        fingerprint: relay.fingerprint,
        bandwidth: (relay.bandwidth || 0) / maxBw,
        flags: relay.flags || 'M',
        ip: relay.ip,
        port: relay.port,
      });
    }
    steps.push({ step: 'geolocate', durationMs: Date.now() - geoStart });
    
    console.log(`    ✓ Matched ${matchedBandwidth}/${relays.length} relays with real bandwidth`);
    
    status.totalGeolocated += geolocated;
    status.totalRelays += relays.length;
    
    return buildProcessedData(aggregated, dateStr, 'collector', relays.length, geolocated);
  } catch (e: any) {
    console.log(`    ✗ Error processing ${dateStr}: ${e.message}`);
    return null;
  }
}

// ============================================================================
// Data Source: Tor Metrics (Country Data) - Batch Monthly Fetching
// ============================================================================

// Cache for monthly country data: monthStr -> Map<dateStr, CountryData>
const monthlyCountryCache: Map<string, Map<string, CountryData>> = new Map();

// Flag to control batch vs daily country fetching
// Set based on total days being processed (batch is only efficient for multi-day runs)
let USE_BATCH_COUNTRY_FETCH = true;

/**
 * Fetch country data for an entire month in one request.
 * Much more efficient than daily requests (1 request vs ~30 requests).
 */
function fetchMonthlyCountryDataOnce(year: number, month: number): Promise<Map<string, CountryData>> {
  return new Promise((resolve, reject) => {
    const monthStr = `${year}-${String(month).padStart(2, '0')}`;
    const startDate = `${monthStr}-01`;
    
    // Get last day of month
    const lastDay = new Date(year, month, 0).getDate();
    const endDate = `${monthStr}-${String(lastDay).padStart(2, '0')}`;
    
    const url = `https://metrics.torproject.org/userstats-relay-country.csv?start=${startDate}&end=${endDate}`;
    
    // Set a longer timeout for monthly requests (Tor Metrics API can be slow)
    const req = https.get(url, { timeout: COUNTRY_FETCH_TIMEOUT_MS }, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const lines = data.split('\n').filter(l => 
          l && !l.startsWith('#') && !l.startsWith('date,')
        );
        
        // Group by date: { "2025-01-01": { countries: {}, totalUsers: 0 }, ... }
        const byDate: Map<string, { countries: { [code: string]: number }; totalUsers: number; countrySum: number }> = new Map();
        
        for (const line of lines) {
          const parts = line.split(',');
          if (parts.length < 3) continue;
          
          const [dateStr, countryRaw = '', usersStr] = parts;
          const users = parseInt(usersStr, 10);
          if (isNaN(users) || !dateStr) continue;
          
          // Initialize date entry if needed
          if (!byDate.has(dateStr)) {
            byDate.set(dateStr, { countries: {}, totalUsers: 0, countrySum: 0 });
          }
          const entry = byDate.get(dateStr)!;
          
          const country = countryRaw.trim();
          
          // Empty country field is the aggregate total
          if (country === '') {
            entry.totalUsers = users;
            continue;
          }
          
          // Skip unknown countries
          const normalized = country.toUpperCase();
          if (normalized === '??' || normalized === '') continue;
          
          entry.countries[normalized] = users;
          entry.countrySum += users;
        }
        
        // Convert to CountryData objects
        const result = new Map<string, CountryData>();
        for (const [dateStr, entry] of byDate) {
          result.set(dateStr, {
            version: VERSION,
            generatedAt: new Date().toISOString(),
            date: dateStr,
            totalUsers: entry.totalUsers || entry.countrySum,
            countries: entry.countries,
          });
        }
        
        resolve(result);
      });
    });
    
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Request timeout (${COUNTRY_FETCH_TIMEOUT_MS / 1000}s)`));
    });
  });
}

/**
 * Fetch country data for a single day (fallback when batch fails).
 */
function fetchDailyCountryDataOnce(date: string): Promise<CountryData> {
  return new Promise((resolve, reject) => {
    const url = `https://metrics.torproject.org/userstats-relay-country.csv?start=${date}&end=${date}`;
    
    https.get(url, { timeout: 30000 }, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const lines = data.split('\n').filter(l => 
          l && !l.startsWith('#') && !l.startsWith('date,')
        );
        
        const countries: { [code: string]: number } = {};
        let totalUsers = 0;
        let hasAggregateRow = false;
        let countrySum = 0;
        
        for (const line of lines) {
          const parts = line.split(',');
          if (parts.length < 3) continue;
          
          const [, countryRaw = '', usersStr] = parts;
          const users = parseInt(usersStr, 10);
          if (isNaN(users)) continue;
          
          const country = countryRaw.trim();
          
          if (country === '') {
            totalUsers = users;
            hasAggregateRow = true;
            continue;
          }
          
          const normalized = country.toUpperCase();
          if (normalized === '??' || normalized === '') continue;
          
          countries[normalized] = users;
          countrySum += users;
        }
        
        if (!hasAggregateRow) {
          totalUsers = countrySum;
        }
        
        resolve({
          version: VERSION,
          generatedAt: new Date().toISOString(),
          date,
          totalUsers,
          countries,
        });
      });
    }).on('error', reject);
  });
}

/**
 * Load monthly country data with caching.
 * Uses lock to prevent duplicate fetches and semaphore to limit concurrency.
 * Tries batch request first, falls back to daily if batch fails.
 */
async function loadMonthlyCountryData(year: number, month: number): Promise<Map<string, CountryData>> {
  const monthStr = `${year}-${String(month).padStart(2, '0')}`;
  
  // Return from cache if available
  if (monthlyCountryCache.has(monthStr)) {
    return monthlyCountryCache.get(monthStr)!;
  }
  
  // Use lock to prevent duplicate fetches of the same month
  return withLock(countryFetchLocks, monthStr, async () => {
    // Double-check cache after acquiring lock (another worker may have populated it)
    if (monthlyCountryCache.has(monthStr)) {
      return monthlyCountryCache.get(monthStr)!;
    }
    
    // Use semaphore to limit concurrent country fetches
    return withCountryFetchLimit(async () => {
      // Try batch request with retries
      try {
        const data = await withRetry(
          () => fetchMonthlyCountryDataOnce(year, month),
          `Monthly country data ${monthStr}`,
          3  // 3 retries for batch
        );
        
        if (data.size > 0) {
          console.log(`    ✓ Loaded country data for ${monthStr} (${data.size} days, batch)`);
          monthlyCountryCache.set(monthStr, data);
          return data;
        }
      } catch (e: any) {
        console.log(`    ⚠ Batch country fetch failed for ${monthStr}: ${e.message}`);
        console.log(`    ↳ Falling back to daily requests`);
      }
      
      // Return empty map - will fall back to daily requests
      const emptyMap = new Map<string, CountryData>();
      monthlyCountryCache.set(monthStr, emptyMap);
      return emptyMap;
    });
  });
}

/**
 * Get country data for a specific date.
 * For multi-day runs: uses batch monthly requests with caching.
 * For single-day runs: uses direct daily request (more efficient).
 */
async function fetchCountryClients(date: string): Promise<CountryData> {
  // For single-day runs, skip batch and fetch directly
  if (!USE_BATCH_COUNTRY_FETCH) {
    return withRetry(() => fetchDailyCountryDataOnce(date), `Country data ${date}`, 2);
  }
  
  const [year, month] = date.split('-').map(Number);
  
  // Try to get from monthly cache
  const monthlyData = await loadMonthlyCountryData(year, month);
  
  if (monthlyData.has(date)) {
    return monthlyData.get(date)!;
  }
  
  // Fallback to daily request with retries
  return withRetry(() => fetchDailyCountryDataOnce(date), `Country data ${date}`, 2);
}

// ============================================================================
// Data Processing
// ============================================================================

function buildProcessedData(
  aggregated: Map<string, { lat: number; lng: number; relays: RelayInfo[] }>,
  published: string,
  source: 'onionoo' | 'collector',
  relayCount: number,
  geolocatedCount: number
): ProcessedRelayData {
  let totalBandwidth = 0;
  for (const bucket of aggregated.values()) {
    for (const relay of bucket.relays) {
      totalBandwidth += relay.bandwidth;
    }
  }
  
  const nodes: AggregatedNode[] = [];
  let minBw = Infinity, maxBwNode = 0;
  
  for (const bucket of aggregated.values()) {
    const bandwidth = bucket.relays.reduce((sum, r) => sum + r.bandwidth, 0);
    const pos = getNormalizedPosition(bucket.lat, bucket.lng);
    
    const label = bucket.relays.length === 1
      ? bucket.relays[0].nickname
      : `${bucket.relays.length} relays at location`;
    
    minBw = Math.min(minBw, bandwidth);
    maxBwNode = Math.max(maxBwNode, bandwidth);
    
    bucket.relays.sort((a, b) => b.bandwidth - a.bandwidth);
    
    // Pre-calculate node properties for efficient client rendering
    const isExit = bucket.relays.some(r => r.flags.includes('E'));
    const isGuard = bucket.relays.some(r => r.flags.includes('G'));
    const isHSDir = bucket.relays.some(r => r.flags.includes('H'));
    
    const type = isExit ? 'exit' : (isGuard ? 'guard' : 'middle');
    
    nodes.push({
      lat: bucket.lat,
      lng: bucket.lng,
      x: pos.x,
      y: pos.y,
      bandwidth,
      normalized_bandwidth: totalBandwidth > 0 ? bandwidth / totalBandwidth : 0,
      label,
      relays: bucket.relays,
      type,
      isHSDir,
    });
  }
  
  nodes.sort((a, b) => b.bandwidth - a.bandwidth);
  
  return {
    version: VERSION,
    generatedAt: new Date().toISOString(),
    source,
    geoip: {
      provider: geoipMetadata.provider,
      version: geoipMetadata.version,
      buildDate: geoipMetadata.buildDate,
    },
    published,
    nodes,
    bandwidth: totalBandwidth,
    relayCount,
    geolocatedCount,
    minMax: { min: minBw === Infinity ? 0 : minBw, max: maxBwNode },
  };
}

// ============================================================================
// Index Management
// ============================================================================

function updateIndex(): void {
  const indexPath = path.join(OUTPUT_DIR, 'index.json');
  const jsonFiles = fs.readdirSync(OUTPUT_DIR)
    .filter(f => f.startsWith('relays-') && f.endsWith('.json'))
    .sort();
  
  const dates: string[] = [];
  const bandwidths: number[] = [];
  
  for (const file of jsonFiles) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(OUTPUT_DIR, file), 'utf-8'));
      const dateStr = file.replace('relays-', '').replace('.json', '');
      dates.push(dateStr);
      bandwidths.push(data.bandwidth || 0);
    } catch {}
  }
  
  const index: DateIndex = {
    version: VERSION,
    lastUpdated: new Date().toISOString(),
    dates,
    bandwidths,
  };
  
  // Atomic write: write to temp file, then rename (avoids race condition with rclone)
  const tempPath = indexPath + '.tmp';
  fs.writeFileSync(tempPath, JSON.stringify(index, null, 2));
  fs.renameSync(tempPath, indexPath);
}

// ============================================================================
// Parallel Processing
// ============================================================================

async function runParallel<T>(tasks: (() => Promise<T>)[], concurrency: number): Promise<T[]> {
  const results: Promise<T>[] = [];
  const executing: Set<Promise<T>> = new Set();
  
  for (const task of tasks) {
    const p = task().then(r => { executing.delete(p); return r; });
    results.push(p);
    executing.add(p);
    if (executing.size >= concurrency) await Promise.race(executing);
  }
  
  return Promise.all(results);
}

// ============================================================================
// Cleanup Extracted Files
// ============================================================================

function cleanupExtractedFiles(): void {
  for (const [monthStr, extractedDir] of extractedConsensusCache.entries()) {
    const parentDir = path.dirname(extractedDir);
    if (fs.existsSync(parentDir)) {
      try {
        fs.rmSync(parentDir, { recursive: true });
        console.log(`  ✓ Cleaned up extracted consensus ${monthStr}`);
      } catch (e: any) {
        console.log(`  ⚠ Failed to cleanup ${monthStr}: ${e.message}`);
      }
    }
  }
  extractedConsensusCache.clear();
}

// ============================================================================
// Main Processing Per Date
// ============================================================================

async function processDate(dateStr: string): Promise<void> {
  const relayPath = path.join(OUTPUT_DIR, `relays-${dateStr}.json`);
  const countryPath = path.join(OUTPUT_DIR, `countries-${dateStr}.json`);
  const dateStartTime = Date.now();
  const steps: StepTiming[] = [];
  
  // Skip if already exists
  if (fs.existsSync(relayPath) && fs.existsSync(countryPath)) {
    console.log(`  ○ ${dateStr} - already exists, skipping`);
    status.skipped++;
    return;
  }
  
  console.log(`\n  ▶ Processing ${dateStr}...`);
  
  // Fetch relay data from appropriate source
  let relayData: ProcessedRelayData | null = null;
  
  if (isRecentDate(dateStr)) {
    // Use Onionoo for recent dates
    const stepStart = Date.now();
    try {
      const onionooData = await fetchOnionooRelays();
      steps.push({ step: 'onionoo-fetch', durationMs: Date.now() - stepStart });
      
      const processStart = Date.now();
      relayData = await processOnionooRelays(onionooData);
      steps.push({ step: 'onionoo-process', durationMs: Date.now() - processStart });
    } catch (e: any) {
      steps.push({ step: 'onionoo-fetch-failed', durationMs: Date.now() - stepStart });
      console.log(`    ✗ Onionoo failed: ${e.message}, trying Collector...`);
      relayData = await fetchCollectorRelaysWithTiming(dateStr, steps);
    }
  } else {
    // Use Collector for historical dates
    relayData = await fetchCollectorRelaysWithTiming(dateStr, steps);
  }
  
  if (relayData) {
    const writeStart = Date.now();
    fs.writeFileSync(relayPath, JSON.stringify(relayData, null, 2));
    steps.push({ step: 'relay-write', durationMs: Date.now() - writeStart });
    console.log(`    ✓ Relay data saved (${relayData.nodes.length} locations, ${relayData.relayCount} relays, ${relayData.geolocatedCount} geolocated)`);
    status.relayFiles++;
  } else {
    console.log(`    ✗ No relay data for ${dateStr}`);
    status.failed++;
  }
  
  // Fetch country data from Tor Metrics (always available for historical dates)
  const countryStart = Date.now();
  try {
    let countryData = await fetchCountryClients(dateStr);
    steps.push({ step: 'country-fetch', durationMs: Date.now() - countryStart });
    
    // Fallback to previous day if no country data (some dates have gaps in Tor Metrics)
    if (Object.keys(countryData.countries).length === 0) {
      const prevDate = new Date(dateStr);
      prevDate.setDate(prevDate.getDate() - 1);
      const prevDateStr = prevDate.toISOString().slice(0, 10);
      const prevPath = path.join(OUTPUT_DIR, `countries-${prevDateStr}.json`);
      
      if (fs.existsSync(prevPath)) {
        try {
          countryData = JSON.parse(fs.readFileSync(prevPath, 'utf-8'));
          console.log(`    ⚠ No country data for ${dateStr}, using ${prevDateStr}`);
        } catch {
          // Keep empty data if fallback fails
        }
      }
    }
    
    const writeStart = Date.now();
    fs.writeFileSync(countryPath, JSON.stringify(countryData, null, 2));
    steps.push({ step: 'country-write', durationMs: Date.now() - writeStart });
    console.log(`    ✓ Country data saved (${Object.keys(countryData.countries).length} countries, ${countryData.totalUsers.toLocaleString()} users)`);
    status.countryFiles++;
  } catch (e: any) {
    steps.push({ step: 'country-fetch-failed', durationMs: Date.now() - countryStart });
    console.log(`    ⚠ Country data not available: ${e.message}`);
  }
  
  const totalMs = Date.now() - dateStartTime;
  timings.push({ date: dateStr, totalMs, steps });
  
  // Print timing summary for this date
  const stepSummary = steps.map(s => `${s.step}:${formatDuration(s.durationMs)}`).join(' ');
  console.log(`    ⏱ Total: ${formatDuration(totalMs)} [${stepSummary}]`);
  
  // Incrementally update index after each successful day
  if (relayData) {
    updateIndex();
  }
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log(`║   RouteFluxMap Unified Data Fetcher v${VERSION}                     ║`);
  console.log('╚════════════════════════════════════════════════════════════════╝\n');
  
  // Parse arguments
  const args = process.argv.slice(2);
  let dateRange: DateRange;
  let parallelOverride: number | null = null;
  
  // Extract options
  for (const arg of args) {
    if (arg.startsWith('--parallel=')) {
      parallelOverride = parseInt(arg.slice(11)) || null;
    } else if (arg.startsWith('--threads=')) {
      const threads = parseInt(arg.slice(10));
      if (!isNaN(threads) && threads >= 0) {
        XZ_THREADS = threads;
      }
    } else if (arg.startsWith('--geoip=')) {
      GEOIP_DB_PATH = arg.slice(8);
    }
  }
  
  // Parse date range
  const dateArg = args.find(a => !a.startsWith('--') || a.startsWith('--date='));
  if (dateArg) {
    dateRange = parseDateRange(dateArg);
  } else {
    const today = new Date();
    dateRange = {
      start: today,
      end: today,
      mode: 'day',
      description: today.toISOString().slice(0, 10) + ' (current day)',
    };
  }
  
  // Set parallel based on mode (can be overridden)
  let parallel: number;
  if (parallelOverride !== null) {
    parallel = parallelOverride;
  } else {
    switch (dateRange.mode) {
      case 'year':
        parallel = DEFAULT_PARALLEL_YEAR;
        break;
      case 'month':
        parallel = DEFAULT_PARALLEL_MONTH;
        break;
      default:
        parallel = DEFAULT_PARALLEL_DAY;
    }
  }
  
  const targetDates = generateDatesInRange(dateRange);
  
  // Use batch country fetching for multi-day runs (7+ days), daily for single/few days
  USE_BATCH_COUNTRY_FETCH = targetDates.length >= 7;
  
  console.log('  Configuration:');
  console.log(`    Version:         ${VERSION}`);
  console.log(`    Date range:      ${dateRange.description}`);
  console.log(`    Dates to fetch:  ${targetDates.length}`);
  console.log(`    Parallel:        ${parallel}`);
  console.log(`    XZ threads:      ${XZ_THREADS === 0 ? '0 (all cores)' : XZ_THREADS}`);
  console.log(`    Country fetch:   ${USE_BATCH_COUNTRY_FETCH ? 'batch (monthly)' : 'daily'}`);
  console.log(`    GeoIP database:  ${GEOIP_DB_PATH}`);
  console.log(`    Cache:           ${CACHE_DIR}`);
  console.log(`    Output:          ${OUTPUT_DIR}`);
  
  // Data sources info
  console.log('\n  Data Sources:');
  console.log('    • Onionoo API      → Live relay data (last 2 days)');
  console.log('    • Collector        → Historical relay archives');
  console.log('    • Tor Metrics      → Country client estimates');
  console.log('    • MaxMind GeoLite2 → IP geolocation (primary)');
  console.log('    • geoip-lite       → IP geolocation (fallback)');
  
  // Ensure directories exist
  [CACHE_DIR, OUTPUT_DIR].forEach(d => {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  });
  
  // Initialize GeoIP providers (MaxMind → geoip-lite → country centroids)
  console.log('\n━━━ Initialization ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  await initializeGeoIP();
  
  const startTime = Date.now();
  
  // Process dates
  console.log('\n━━━ Fetching Data ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  
  if (targetDates.length === 1) {
    // Single date - process directly
    await processDate(targetDates[0]);
  } else {
    // Multiple dates - process in parallel
    await runParallel(
      targetDates.map(date => () => processDate(date)),
      parallel
    );
  }
  
  // Cleanup extracted files (optional - saves disk space)
  console.log('\n━━━ Cleanup ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  cleanupExtractedFiles();
  
  // Update index (final update ensures consistency after parallel processing)
  console.log('\n━━━ Updating Index ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  updateIndex();
  console.log('  ✓ Index updated');
  
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  
  // Calculate timing statistics
  const processedTimings = timings.filter(t => t.steps.length > 0);
  let avgMs = 0, minMs = Infinity, maxMs = 0;
  const stepTotals: Record<string, { count: number; totalMs: number }> = {};
  
  for (const t of processedTimings) {
    avgMs += t.totalMs;
    minMs = Math.min(minMs, t.totalMs);
    maxMs = Math.max(maxMs, t.totalMs);
    
    for (const step of t.steps) {
      if (!stepTotals[step.step]) stepTotals[step.step] = { count: 0, totalMs: 0 };
      stepTotals[step.step].count++;
      stepTotals[step.step].totalMs += step.durationMs;
    }
  }
  
  if (processedTimings.length > 0) avgMs /= processedTimings.length;
  
  console.log('\n════════════════════════════════════════════════════════════════════');
  console.log('  Summary:');
  console.log(`    📅 Relay files:     ${status.relayFiles} created`);
  console.log(`    🌍 Country files:   ${status.countryFiles} created`);
  console.log(`    ○  Skipped:         ${status.skipped} (already exist)`);
  console.log(`    ✗  Failed:          ${status.failed}`);
  console.log(`    🔄 Total relays:    ${status.totalRelays.toLocaleString()}`);
  console.log(`    📍 Geolocated:      ${status.totalGeolocated.toLocaleString()}`);
  console.log(`    🔢 Version:         ${VERSION}`);
  console.log(`    ⏱  Total time:      ${elapsed}s`);
  
  if (processedTimings.length > 0) {
    console.log('\n  Per-date timing (processed):');
    console.log(`    📊 Average:  ${formatDuration(avgMs)}`);
    console.log(`    ⬇️  Min:      ${formatDuration(minMs)}`);
    console.log(`    ⬆️  Max:      ${formatDuration(maxMs)}`);
    
    console.log('\n  Per-step timing (averages):');
    const stepOrder = ['consensus-extract-all', 'descriptor-load', 'consensus-find', 'consensus-read', 
                       'consensus-parse', 'geolocate', 'relay-write', 'country-fetch', 'country-write',
                       'onionoo-fetch', 'onionoo-process'];
    for (const stepName of stepOrder) {
      const s = stepTotals[stepName];
      if (s && s.count > 0) {
        const avg = Math.round(s.totalMs / s.count);
        console.log(`    ${stepName.padEnd(18)} ${formatDuration(avg).padStart(8)} avg (${s.count}x)`);
      }
    }
  }
  
  console.log('════════════════════════════════════════════════════════════════════\n');
}

main().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
