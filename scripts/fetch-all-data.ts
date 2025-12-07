#!/usr/bin/env npx tsx
/**
 * RouteFluxMap - Unified Data Fetcher
 * 
 * Fetches all data in a single pass:
 * 1. Relay data from Onionoo API
 * 2. Country client data from Tor Metrics API
 * 3. Geolocation via MaxMind GeoLite2
 * 
 * Outputs:
 * - relays-YYYY-MM-DD.json (relay locations + individual relay info)
 * - countries-YYYY-MM-DD.json (client counts by country)
 * - index.json (date index with bandwidth stats)
 * 
 * Usage:
 *   npx tsx scripts/fetch-all-data.ts
 *   npx tsx scripts/fetch-all-data.ts --date=2024-01-15
 */

import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';

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
  published: string;
  nodes: AggregatedNode[];
  bandwidth: number;
  minMax: { min: number; max: number };
}

interface CountryData {
  date: string;
  totalUsers: number;
  countries: { [code: string]: number };
}

interface DateIndex {
  lastUpdated: string;
  dates: string[];
  bandwidths: number[];
  min: { date: string; bandwidth: number };
  max: { date: string; bandwidth: number };
  relayCount: number;
}

// ============================================================================
// Configuration
// ============================================================================

function loadConfig(): Record<string, string> {
  const config: Record<string, string> = {};
  
  // Try deploy/config.env first, then project root
  const configPaths = [
    path.join(process.cwd(), 'deploy', 'config.env'),
    path.join(process.cwd(), 'config.env'),
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
      if (/^[0-9A-F]{40}$/.test(hex)) {
        return hex;
      }
    } catch (e) {
      // Ignore
    }
  }
  return clean.toUpperCase();
}

function getCountryCoords(countryCode?: string): { lat: number; lng: number } {
  const cc = (countryCode || 'US').toUpperCase();
  const coords = COUNTRY_CENTROIDS[cc] || COUNTRY_CENTROIDS['US'];
  return {
    lat: coords[1] + (Math.random() - 0.5) * 2,
    lng: coords[0] + (Math.random() - 0.5) * 2,
  };
}

// ============================================================================
// API Fetchers (run in parallel)
// ============================================================================

function fetchOnionooRelays(): Promise<OnionooResponse> {
  return new Promise((resolve, reject) => {
    console.log('  📡 Fetching relay data from Onionoo API...');
    const startTime = Date.now();
    
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
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
          console.log(`  ✓ Onionoo response received (${elapsed}s)`);
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    });
    
    req.on('error', reject);
    req.end();
  });
}

function fetchCountryClients(date: string): Promise<CountryData> {
  return new Promise((resolve, reject) => {
    console.log('  📡 Fetching country client data from Tor Metrics...');
    const startTime = Date.now();
    
    const url = `https://metrics.torproject.org/userstats-relay-country.csv?start=${date}&end=${date}`;
    
    https.get(url, (res) => {
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
        
        for (const line of lines) {
          const parts = line.split(',');
          if (parts.length < 3) continue;
          
          const [, country, usersStr] = parts;
          const users = parseInt(usersStr, 10);
          
          if (!country || isNaN(users)) continue;
          
          if (country === '') {
            totalUsers = users;
            continue;
          }
          
          if (country !== '??') {
            countries[country.toUpperCase()] = users;
          }
        }
        
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`  ✓ Country data received (${elapsed}s, ${Object.keys(countries).length} countries)`);
        
        resolve({ date, totalUsers, countries });
      });
    }).on('error', reject);
  });
}

// ============================================================================
// Processing
// ============================================================================

async function processRelays(data: OnionooResponse): Promise<ProcessedRelayData> {
  const relays = data.relays || [];
  console.log(`  🔄 Processing ${relays.length} relays...`);
  
  // Try to load MaxMind database
  let geoReader: any = null;
  try {
    if (fs.existsSync(GEOIP_DB_PATH)) {
      const maxmind = await import('maxmind');
      geoReader = await maxmind.open(GEOIP_DB_PATH);
      console.log('  ✓ MaxMind database loaded');
    } else {
      console.log(`  ⚠ MaxMind database not found at ${GEOIP_DB_PATH}`);
      console.log('    Using country centroids as fallback');
    }
  } catch (e) {
    console.log('  ⚠ MaxMind not available, using country centroids');
  }
  
  const maxBw = Math.max(...relays.map(r => r.observed_bandwidth || 0), 1);
  
  // Aggregate relays by location
  const aggregated: Map<string, {
    lat: number;
    lng: number;
    relays: RelayInfo[];
  }> = new Map();
  
  let geolocated = 0;
  let fallback = 0;
  
  for (const relay of relays) {
    const addr = parseAddress(relay.or_addresses);
    let lat: number, lng: number;
    
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
    
    // Round to 2 decimal places for aggregation
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
  
  console.log(`    ✓ MaxMind lookup: ${geolocated} IPs`);
  console.log(`    ○ Country fallback: ${fallback} IPs`);
  console.log(`    → Aggregated into ${aggregated.size} locations`);
  
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
  
  nodes.sort((a, b) => b.bandwidth - a.bandwidth);
  
  return {
    published: data.relays_published,
    nodes,
    bandwidth: totalBandwidth,
    minMax: { min: minBw === Infinity ? 0 : minBw, max: maxBwNode },
  };
}

// ============================================================================
// Index Management
// ============================================================================

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

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║   RouteFluxMap Unified Data Fetcher                        ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');
  
  // Parse arguments
  const args = process.argv.slice(2);
  let targetDate = new Date().toISOString().slice(0, 10);
  
  for (const arg of args) {
    if (arg.startsWith('--date=')) {
      targetDate = arg.slice(7);
    }
  }
  
  console.log(`  Date: ${targetDate}`);
  console.log(`  Output: ${OUTPUT_DIR}\n`);
  
  // Ensure output directory exists
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }
  
  // Fetch data in parallel
  console.log('━━━ Phase 1: Fetch Data (Parallel) ━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  const startTime = Date.now();
  
  const [onionooData, countryData] = await Promise.all([
    fetchOnionooRelays(),
    fetchCountryClients(targetDate).catch(err => {
      console.log(`  ⚠ Country data fetch failed: ${err.message}`);
      return null;
    }),
  ]);
  
  // Process relay data
  console.log('\n━━━ Phase 2: Process & Geolocate ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  const processedRelays = await processRelays(onionooData);
  
  // Extract date from published timestamp
  const dateMatch = processedRelays.published.match(/(\d{4})-(\d{2})-(\d{2})/);
  const dateStr = dateMatch
    ? `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`
    : targetDate;
  
  // Write outputs
  console.log('\n━━━ Phase 3: Write Outputs ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  // Relay data
  const relayPath = path.join(OUTPUT_DIR, `relays-${dateStr}.json`);
  fs.writeFileSync(relayPath, JSON.stringify(processedRelays, null, 2));
  console.log(`  ✓ Relay data: ${relayPath}`);
  
  // Country data
  if (countryData) {
    const countryPath = path.join(OUTPUT_DIR, `countries-${dateStr}.json`);
    fs.writeFileSync(countryPath, JSON.stringify(countryData, null, 2));
    console.log(`  ✓ Country data: ${countryPath}`);
  }
  
  // Update index
  const totalRelays = processedRelays.nodes.reduce((sum, n) => sum + n.relays.length, 0);
  updateIndex(dateStr, processedRelays.bandwidth, totalRelays);
  console.log(`  ✓ Index updated`);
  
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  
  console.log('\n════════════════════════════════════════════════════════════════');
  console.log(`  📍 Locations: ${processedRelays.nodes.length}`);
  console.log(`  🔄 Total relays: ${totalRelays}`);
  if (countryData) {
    console.log(`  🌍 Countries: ${Object.keys(countryData.countries).length}`);
    console.log(`  👥 Est. users: ${countryData.totalUsers.toLocaleString()}`);
  }
  console.log(`  📅 Published: ${processedRelays.published}`);
  console.log(`  ⏱  Time: ${elapsed}s`);
  console.log('════════════════════════════════════════════════════════════════\n');
}

main().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});

