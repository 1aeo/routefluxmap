#!/usr/bin/env npx tsx
/**
 * Fetch Tor relay data from Onionoo API and convert to JSON format
 * Includes individual relay details for metrics links
 * Uses MaxMind GeoLite2-City for fast parallel IP geolocation
 */

import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';

// Types
interface OnionooRelay {
  nickname: string;
  fingerprint: string;
  or_addresses: string[];
  country?: string;
  flags?: string[];
  observed_bandwidth?: number;
  consensus_weight?: number;
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

interface ProcessedData {
  published: string;
  nodes: AggregatedNode[];
  bandwidth: number;
  minMax: { min: number; max: number };
}

interface DateIndex {
  lastUpdated: string;
  dates: string[];
  bandwidths: number[];
  min: { date: string; bandwidth: number };
  max: { date: string; bandwidth: number };
  relayCount: number;
}

// Load config from config.env
function loadConfig(): Record<string, string> {
  const config: Record<string, string> = {};
  const configPath = path.join(process.cwd(), 'config.env');
  
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
  }
  
  return config;
}

const envConfig = loadConfig();
const GEOIP_DB_PATH = envConfig.GEOIP_DB_PATH || path.join(process.cwd(), 'data', 'geoip', 'GeoLite2-City.mmdb');
const OUTPUT_DIR = path.join(process.cwd(), 'public', 'data');

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

// Mercator projection
function getNormalizedPosition(lat: number, lng: number): { x: number; y: number } {
  const x = (lng + 180) / 360;
  const latRad = lat * (Math.PI / 180);
  const mercN = Math.log(Math.tan(Math.PI / 4 + latRad / 2));
  const y = 0.5 + mercN / (2 * Math.PI);
  return { x, y };
}

// Map Onionoo flags to RouteFluxMap format
function mapFlags(flags?: string[]): string {
  if (!flags) return 'M';
  let result = '';
  if (flags.includes('Running')) result += 'M';
  if (flags.includes('Guard')) result += 'G';
  if (flags.includes('Exit')) result += 'E';
  if (flags.includes('HSDir')) result += 'H';
  return result || 'M';
}

// Parse IP from or_addresses
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

// Get fallback coordinates from country code
function getCountryCoords(countryCode?: string): { lat: number; lng: number } {
  const cc = (countryCode || 'US').toUpperCase();
  const coords = COUNTRY_CENTROIDS[cc] || COUNTRY_CENTROIDS['US'];
  return {
    lat: coords[1] + (Math.random() - 0.5) * 2,
    lng: coords[0] + (Math.random() - 0.5) * 2,
  };
}

// Fetch relays from Onionoo
function fetchRelays(): Promise<OnionooResponse> {
  console.time('fetchRelays');
  return new Promise((resolve, reject) => {
    console.log('Fetching relay data from Onionoo API...');
    
    const options = {
      hostname: 'onionoo.torproject.org',
      path: '/details?type=relay&running=true',
      method: 'GET',
      headers: { 'User-Agent': 'RouteFluxMap-DataFetcher/2.0' },
    };
    
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          console.timeEnd('fetchRelays');
          resolve(JSON.parse(data));
        } catch (e) {
          console.timeEnd('fetchRelays');
          reject(e);
        }
      });
    });
    
    req.on('error', (e) => {
      console.timeEnd('fetchRelays');
      reject(e);
    });
    req.end();
  });
}

// Validate and normalize fingerprint to 40-char uppercase hex format
// Tor relay fingerprints are SHA-1 hashes of the relay's identity key
function normalizeFingerprint(fp: string): string {
  if (!fp) return '';
  
  // Step 1: Clean common formatting issues
  // Remove $ prefix (sometimes used in Tor contexts)
  // Remove spaces (log format: "7E AA C4...")
  // Remove colons (old Arm/Nyx format: "7E:AA:C4:")
  // Remove dashes (sometimes used as separators)
  let clean = fp.trim().replace(/[$:\s-]/g, '');
  
  // Step 2: If it looks like a 40-char hex string, return uppercase
  if (/^[0-9a-fA-F]{40}$/.test(clean)) {
    return clean.toUpperCase();
  }
  
  // Step 3: If it looks like Base64 (27-28 chars), try to convert
  // Standard Base64 for 20 bytes (SHA1) is 28 chars with padding, 27 without
  if (/^[a-zA-Z0-9+/]{27,28}=*$/.test(clean)) {
    try {
      const hex = Buffer.from(clean, 'base64').toString('hex').toUpperCase();
      if (/^[0-9A-F]{40}$/.test(hex)) {
        return hex;
      }
    } catch (e) {
      console.warn(`Failed to convert potential Base64 fingerprint: ${clean}`);
    }
  }
  
  // Step 4: Log warning for invalid fingerprints
  console.warn(`Invalid fingerprint format (not 40-char hex): ${fp}`);
  return clean.toUpperCase(); // Return cleaned version, let downstream handle error
}

// Parallel processing helper
async function runParallel<T, R>(items: T[], fn: (item: T) => R, batchSize = 1000): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    // MaxMind lookups are sync and instant, so we just process in batches for progress tracking
    results.push(...batch.map(fn));
    if (i % 2000 === 0 && i > 0) {
      process.stdout.write(`\r  Geolocating... ${i}/${items.length}`);
    }
  }
  return results;
}

// Process relays into aggregated nodes with individual relay details
async function processRelays(data: OnionooResponse): Promise<ProcessedData> {
  console.time('processRelays');
  const relays = data.relays || [];
  console.log(`Processing ${relays.length} relays...`);
  
  // Try to load MaxMind database
  let geoReader: any = null;
  try {
    console.time('loadMaxMind');
    const maxmind = await import('maxmind');
    if (fs.existsSync(GEOIP_DB_PATH)) {
      console.log(`Loading MaxMind database from ${GEOIP_DB_PATH}...`);
      geoReader = await maxmind.open(GEOIP_DB_PATH);
      console.log('✓ MaxMind database loaded');
    } else {
      console.log(`⚠ MaxMind database not found at ${GEOIP_DB_PATH}`);
      console.log('  Using country centroids as fallback');
    }
    console.timeEnd('loadMaxMind');
  } catch (e) {
    console.log('⚠ MaxMind not available, using country centroids');
    console.timeEnd('loadMaxMind');
  }
  
  // Find max bandwidth for normalization
  const maxBw = Math.max(...relays.map(r => r.observed_bandwidth || 0), 1);
  
  // Aggregate relays by location
  const aggregated: Map<string, {
    lat: number;
    lng: number;
    relays: RelayInfo[];
  }> = new Map();
  
  let geolocated = 0;
  let fallback = 0;
  
  console.log('  Geolocating all relay IPs (parallel batch processing)...');
  console.time('geolocation');
  
  // Process relays - MaxMind is sync and instant with local DB
  for (const relay of relays) {
    const addr = parseAddress(relay.or_addresses);
    let lat: number, lng: number;
    
    // Try GeoIP lookup (instant with local DB)
    if (geoReader) {
      try {
        const result = geoReader.get(addr.ip);
        if (result?.location) {
          lat = result.location.latitude;
          lng = result.location.longitude;
          geolocated++;
        } else {
          const coords = getCountryCoords(relay.country);
          lat = coords.lat;
          lng = coords.lng;
          fallback++;
        }
      } catch {
        const coords = getCountryCoords(relay.country);
        lat = coords.lat;
        lng = coords.lng;
        fallback++;
      }
    } else {
      const coords = getCountryCoords(relay.country);
      lat = coords.lat;
      lng = coords.lng;
      fallback++;
    }
    
    // Round to 2 decimal places for aggregation (~1km precision)
    const key = `${lat.toFixed(2)},${lng.toFixed(2)}`;
    
    if (!aggregated.has(key)) {
      aggregated.set(key, { lat, lng, relays: [] });
    }
    
    // Add relay info with fingerprint for metrics links
    aggregated.get(key)!.relays.push({
      nickname: relay.nickname || 'Unnamed',
      fingerprint: normalizeFingerprint(relay.fingerprint),
      bandwidth: (relay.observed_bandwidth || 0) / maxBw,
      flags: mapFlags(relay.flags),
      ip: addr.ip,
      port: addr.port,
    });
  }
  
  console.log(`\n  Geolocation results:`);
  console.timeEnd('geolocation');
  console.log(`    ✓ MaxMind lookup: ${geolocated} IPs (city-level accuracy)`);
  console.log(`    ○ Country fallback: ${fallback} IPs`);
  console.log(`  Aggregated into ${aggregated.size} unique locations`);
  
  // Calculate total bandwidth for normalization
  let totalBandwidth = 0;
  for (const bucket of aggregated.values()) {
    for (const relay of bucket.relays) {
      totalBandwidth += relay.bandwidth;
    }
  }
  
  // Convert to node array
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
    
    // Sort relays by bandwidth descending
    bucket.relays.sort((a, b) => b.bandwidth - a.bandwidth);
    
    nodes.push({
      lat: bucket.lat,
      lng: bucket.lng,
      x: pos.x,
      y: pos.y,
      bandwidth,
      normalized_bandwidth: totalBandwidth > 0 ? bandwidth / totalBandwidth : 0,
      label,
      relays: bucket.relays,
    });
  }
  
  // Sort by bandwidth descending
  nodes.sort((a, b) => b.bandwidth - a.bandwidth);
  
  console.timeEnd('processRelays');
  return {
    published: data.relays_published,
    nodes,
    bandwidth: totalBandwidth,
    minMax: { min: minBw === Infinity ? 0 : minBw, max: maxBwNode },
  };
}

// Update or create index.json
function updateIndex(dateStr: string, totalBandwidth: number, relayCount: number): void {
  const indexPath = path.join(OUTPUT_DIR, 'index.json');
  let index: DateIndex;
  
  if (fs.existsSync(indexPath)) {
    index = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
  } else {
    index = {
      lastUpdated: new Date().toISOString(),
      dates: [],
      bandwidths: [],
      min: { date: '', bandwidth: Infinity },
      max: { date: '', bandwidth: 0 },
      relayCount: 0,
    };
  }
  
  // Add or update date
  const dateIndex = index.dates.indexOf(dateStr);
  if (dateIndex === -1) {
    index.dates.push(dateStr);
    index.bandwidths.push(totalBandwidth);
  } else {
    index.bandwidths[dateIndex] = totalBandwidth;
  }
  
  // Sort by date
  const sorted = index.dates.map((d, i) => ({ date: d, bw: index.bandwidths[i] }))
    .sort((a, b) => a.date.localeCompare(b.date));
  index.dates = sorted.map(s => s.date);
  index.bandwidths = sorted.map(s => s.bw);
  
  // Update min/max
  const minBw = Math.min(...index.bandwidths);
  const maxBw = Math.max(...index.bandwidths);
  index.min = { date: index.dates[index.bandwidths.indexOf(minBw)], bandwidth: minBw };
  index.max = { date: index.dates[index.bandwidths.indexOf(maxBw)], bandwidth: maxBw };
  index.lastUpdated = new Date().toISOString();
  index.relayCount = relayCount;
  
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));
}

// Main
async function main() {
  console.log('\n╔════════════════════════════════════════════╗');
  console.log('║   RouteFluxMap Data Fetcher v2.1               ║');
  console.log('║   (MaxMind Parallel Geolocation)           ║');
  console.log('╚════════════════════════════════════════════╝\n');
  
  // Ensure output directory exists
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }
  
  // Fetch and process
  const data = await fetchRelays();
  const processed = await processRelays(data);
  
  // Generate filename from published date
  const dateMatch = processed.published.match(/(\d{4})-(\d{2})-(\d{2})/);
  const dateStr = dateMatch
    ? `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`
    : new Date().toISOString().slice(0, 10);
  
  const filename = `relays-${dateStr}.json`;
  const filepath = path.join(OUTPUT_DIR, filename);
  
  // Write output
  fs.writeFileSync(filepath, JSON.stringify(processed, null, 2));
  
  const totalRelays = processed.nodes.reduce((sum, n) => sum + n.relays.length, 0);
  
  // Update index
  updateIndex(dateStr, processed.bandwidth, totalRelays);
  
  console.log(`\n════════════════════════════════════════════`);
  console.log(`  ✓ Data saved to: ${filepath}`);
  console.log(`  ✓ Index updated: ${path.join(OUTPUT_DIR, 'index.json')}`);
  console.log(`  📍 Locations: ${processed.nodes.length}`);
  console.log(`  🔄 Total relays: ${totalRelays}`);
  console.log(`  📅 Published: ${processed.published}`);
  console.log(`════════════════════════════════════════════\n`);
}

main().catch(console.error);
