#!/usr/bin/env npx tsx
/**
 * Fast parallel historical Tor relay data fetcher (WEEKLY data points)
 * 
 * Features:
 * - Parallel downloads from collector.torproject.org
 * - TRUE parallel processing (async tar extraction)
 * - WEEKLY data points (4 per month: days 1, 8, 15, 22)
 * - MaxMind for instant geolocation
 * - Local archive cache (preserves downloaded .tar.xz files)
 * - Outputs JSON for web visualization
 * 
 * Usage:
 *   npx tsx scripts/fetch-historical-data.ts --start=2024-01 --end=2024-12 --parallel=10
 *   npx tsx scripts/fetch-historical-data.ts --days=7          # Last 7 days
 *   npx tsx scripts/fetch-historical-data.ts --reprocess       # Skip downloads, just reprocess
 */

import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// Configuration
const PROJECT_DIR = process.cwd();
const CACHE_DIR = path.join(PROJECT_DIR, 'data', 'cache');
const OUTPUT_DIR = path.join(PROJECT_DIR, 'public', 'data');
const GEOIP_DB_PATH = path.join(PROJECT_DIR, 'data', 'geoip', 'GeoLite2-City.mmdb');

// Country centroids for fallback (lng, lat)
const COUNTRY_CENTROIDS: Record<string, [number, number]> = {
  'US': [-95.71, 37.09], 'DE': [10.45, 51.17], 'FR': [2.21, 46.23], 'NL': [5.29, 52.13],
  'GB': [-3.44, 55.38], 'CA': [-106.35, 56.13], 'SE': [18.64, 60.13], 'CH': [8.23, 46.82],
  'RU': [105.32, 61.52], 'AU': [133.78, -25.27], 'JP': [138.25, 36.20], 'IT': [12.57, 41.87],
  'ES': [-3.75, 40.46], 'PL': [19.15, 51.92], 'BR': [-51.93, -14.24], 'AT': [14.55, 47.52],
  'FI': [25.75, 61.92], 'RO': [24.97, 45.94], 'CZ': [15.47, 49.82], 'NO': [8.47, 60.47],
};

// Types
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

// Global state
let geoReader: any = null;
const status = {
  downloaded: 0,
  cached: 0,
  failed: 0,
  processed: 0,
  skipped: 0,
  totalRelays: 0,
  totalGeo: 0,
  active: new Set<string>(),
};

// Status display
function updateStatus(phase: string, total: number): void {
  const active = Array.from(status.active).sort().slice(0, 6).join(' ');
  const more = status.active.size > 6 ? ` +${status.active.size - 6}` : '';
  
  if (phase === 'download') {
    const done = status.downloaded + status.cached + status.failed;
    process.stdout.write(`\r  [${done}/${total}] ✓${status.downloaded} ◆${status.cached} ✗${status.failed} | ${active}${more}                    `);
  } else {
    const done = status.processed + status.skipped;
    process.stdout.write(`\r  [${done}/${total}] ✓${status.processed} ○${status.skipped} | ${status.totalRelays.toLocaleString()} relays | ${active}${more}                    `);
  }
}

// Mercator projection
function getNormalizedPosition(lat: number, lng: number): { x: number; y: number } {
  const x = (lng + 180) / 360;
  const latRad = lat * (Math.PI / 180);
  const mercN = Math.log(Math.tan(Math.PI / 4 + latRad / 2));
  const y = 0.5 + mercN / (2 * Math.PI);
  return { x, y };
}

// Parse consensus file
// Convert base64 to hex fingerprint
function base64ToHex(base64: string): string {
  try {
    // Add padding if needed
    const padded = base64 + '='.repeat((4 - base64.length % 4) % 4);
    const binary = Buffer.from(padded, 'base64');
    return binary.toString('hex').toUpperCase();
  } catch {
    return base64; // Return original if conversion fails
  }
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
        // Convert base64 fingerprint to hex
        const hexFingerprint = base64ToHex(p[2]);
        current = {
          nickname: p[1],
          fingerprint: hexFingerprint,
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

// Geolocate IP using MaxMind
function geolocateIP(ip: string): { lat: number; lng: number } | null {
  if (!geoReader) return null;
  try {
    const r = geoReader.get(ip);
    if (r && r.location) {
      return { lat: r.location.latitude, lng: r.location.longitude };
    }
  } catch (e) {}
  return null;
}

// Get fallback coords with jitter
function getFallback(): { lat: number; lng: number } {
  const keys = Object.keys(COUNTRY_CENTROIDS);
  const c = COUNTRY_CENTROIDS[keys[Math.floor(Math.random() * keys.length)]];
  return {
    lat: c[1] + (Math.random() - 0.5) * 4,
    lng: c[0] + (Math.random() - 0.5) * 4,
  };
}

// Convert parsed relays to JSON format
function relaysToJSON(relays: any[], dateStr: string): ProcessedData {
  const maxBw = Math.max(...relays.map(r => r.bandwidth || 0), 1);
  
  // Aggregate by location
  const aggregated: Map<string, { lat: number; lng: number; relays: RelayInfo[] }> = new Map();
  let geoCount = 0;
  
  for (const relay of relays) {
    let geo = geolocateIP(relay.ip);
    if (geo) {
      geoCount++;
    } else {
      geo = getFallback();
    }
    
    const key = `${geo.lat.toFixed(2)},${geo.lng.toFixed(2)}`;
    
    if (!aggregated.has(key)) {
      aggregated.set(key, { lat: geo.lat, lng: geo.lng, relays: [] });
    }
    
    aggregated.get(key)!.relays.push({
      nickname: (relay.nickname || '').replace(/,/g, ''),
      fingerprint: relay.fingerprint || '',
      bandwidth: (relay.bandwidth || 0) / maxBw,
      flags: relay.flags || 'M',
      ip: relay.ip || '0.0.0.0',
      port: relay.port || '9001',
    });
  }
  
  status.totalGeo += geoCount;
  
  // Calculate total bandwidth
  let totalBandwidth = 0;
  for (const bucket of aggregated.values()) {
    for (const r of bucket.relays) {
      totalBandwidth += r.bandwidth;
    }
  }
  
  // Convert to nodes array
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
    published: dateStr,
    nodes,
    bandwidth: totalBandwidth,
    minMax: { min: minBw === Infinity ? 0 : minBw, max: maxBwNode },
  };
}

// Download file with promise
function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, res => {
      if (res.statusCode !== 200) {
        fs.unlinkSync(dest);
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
    }).on('error', e => {
      fs.unlink(dest, () => {});
      reject(e);
    });
  });
}

// Download archive (async)
async function downloadArchive(year: number, month: number, total: number): Promise<{ monthStr: string; cachePath: string | null; cached?: boolean }> {
  const monthStr = `${year}-${String(month).padStart(2, '0')}`;
  const cachePath = path.join(CACHE_DIR, `consensuses-${monthStr}.tar.xz`);
  
  status.active.add(monthStr);
  updateStatus('download', total);
  
  try {
    if (fs.existsSync(cachePath) && fs.statSync(cachePath).size > 1000) {
      status.cached++;
      status.active.delete(monthStr);
      updateStatus('download', total);
      return { monthStr, cachePath, cached: true };
    }
    
    const url = `https://collector.torproject.org/archive/relay-descriptors/consensuses/consensuses-${monthStr}.tar.xz`;
    await downloadFile(url, cachePath);
    status.downloaded++;
  } catch (e) {
    status.failed++;
  }
  
  status.active.delete(monthStr);
  updateStatus('download', total);
  return { monthStr, cachePath: fs.existsSync(cachePath) ? cachePath : null };
}

// Weekly target days (approximately every 7 days)
const WEEKLY_DAYS = [1, 8, 15, 22];

// Process archive for WEEKLY data points (4 per month)
async function processArchive(monthStr: string, cachePath: string | null, total: number): Promise<{ monthStr: string; success?: boolean; skipped?: boolean; relays?: number; weeks?: number }> {
  status.active.add(monthStr);
  updateStatus('process', total);
  
  if (!cachePath || !fs.existsSync(cachePath)) {
    status.skipped++;
    status.active.delete(monthStr);
    updateStatus('process', total);
    return { monthStr, skipped: true };
  }
  
  let weeksProcessed = 0;
  let totalRelaysThisMonth = 0;
  
  try {
    // Get list of all consensus files in the archive
    const { stdout: fileListRaw } = await execAsync(
      `tar -tf "${cachePath}" --xz 2>/dev/null | grep -E "${monthStr}-[0-9]{2}-" | sort`,
      { maxBuffer: 5 * 1024 * 1024 }
    );
    const allFiles = fileListRaw.trim().split('\n').filter(f => f);
    
    if (allFiles.length === 0) {
      status.skipped++;
      status.active.delete(monthStr);
      updateStatus('process', total);
      return { monthStr, skipped: true };
    }
    
    // Process each weekly target day
    for (const targetDay of WEEKLY_DAYS) {
      const dayStr = String(targetDay).padStart(2, '0');
      const dateStr = `${monthStr}-${dayStr}`;
      const jsonPath = path.join(OUTPUT_DIR, `relays-${dateStr}.json`);
      
      // Skip if already processed
      if (fs.existsSync(jsonPath)) {
        weeksProcessed++;
        continue;
      }
      
      // Find a consensus file for this target day (or closest available)
      const dayPattern = `${monthStr}-${dayStr}-`;
      let consensusFile = allFiles.find(f => f.includes(dayPattern));
      
      // If exact day not found, try adjacent days
      if (!consensusFile) {
        for (const offset of [1, -1, 2, -2]) {
          const altDay = String(targetDay + offset).padStart(2, '0');
          const altPattern = `${monthStr}-${altDay}-`;
          consensusFile = allFiles.find(f => f.includes(altPattern));
          if (consensusFile) break;
        }
      }
      
      if (!consensusFile) continue;
      
      try {
        // Extract and parse consensus
        const { stdout: consensusText } = await execAsync(
          `tar -xf "${cachePath}" --xz -O "${consensusFile}" 2>/dev/null`,
          { maxBuffer: 50 * 1024 * 1024 }
        );
        
        const relays = parseConsensus(consensusText);
        if (relays.length === 0) continue;
        
        // Convert to JSON with the actual target date
        const jsonData = relaysToJSON(relays, dateStr);
        fs.writeFileSync(jsonPath, JSON.stringify(jsonData, null, 2));
        
        weeksProcessed++;
        totalRelaysThisMonth += relays.length;
      } catch (e) {
        // Skip this week if extraction fails
      }
    }
    
    if (weeksProcessed > 0) {
      status.processed++;
      status.totalRelays += totalRelaysThisMonth;
    } else {
      status.skipped++;
    }
    
    status.active.delete(monthStr);
    updateStatus('process', total);
    
    return { monthStr, success: weeksProcessed > 0, relays: totalRelaysThisMonth, weeks: weeksProcessed };
  } catch (e: any) {
    status.skipped++;
    status.active.delete(monthStr);
    updateStatus('process', total);
    return { monthStr, skipped: true };
  }
}

// Parallel task runner
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

// Generate months list
function generateMonths(startYear: number, startMonth: number, endYear: number, endMonth: number): { year: number; month: number }[] {
  const months: { year: number; month: number }[] = [];
  let y = startYear, m = startMonth;
  
  while (y < endYear || (y === endYear && m <= endMonth)) {
    months.push({ year: y, month: m });
    if (++m > 12) { m = 1; y++; }
  }
  
  return months;
}

// Generate recent days
function generateRecentDays(days: number): { year: number; month: number }[] {
  const months = new Set<string>();
  const now = new Date();
  
  for (let i = 0; i < days; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = `${d.getFullYear()}-${d.getMonth() + 1}`;
    months.add(key);
  }
  
  return Array.from(months).map(m => {
    const [y, mo] = m.split('-');
    return { year: parseInt(y), month: parseInt(mo) };
  });
}

// Update index.json with all dates
function updateIndex(): void {
  const indexPath = path.join(OUTPUT_DIR, 'index.json');
  const jsonFiles = fs.readdirSync(OUTPUT_DIR)
    .filter(f => f.startsWith('relays-') && f.endsWith('.json'))
    .sort();
  
  const dates: string[] = [];
  const bandwidths: number[] = [];
  let totalRelays = 0;
  
  for (const file of jsonFiles) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(OUTPUT_DIR, file), 'utf-8'));
      const dateStr = file.replace('relays-', '').replace('.json', '');
      dates.push(dateStr);
      bandwidths.push(data.bandwidth || 0);
      totalRelays = Math.max(totalRelays, data.nodes?.reduce((s: number, n: any) => s + n.relays.length, 0) || 0);
    } catch (e) {}
  }
  
  const minBw = Math.min(...bandwidths.filter(b => b > 0));
  const maxBw = Math.max(...bandwidths);
  
  const index = {
    lastUpdated: new Date().toISOString(),
    dates,
    bandwidths,
    min: { date: dates[bandwidths.indexOf(minBw)] || dates[0], bandwidth: minBw },
    max: { date: dates[bandwidths.indexOf(maxBw)] || dates[0], bandwidth: maxBw },
    relayCount: totalRelays,
  };
  
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));
  console.log(`  ✓ Index updated with ${dates.length} dates`);
}

// Main
async function main() {
  const args = process.argv.slice(2);
  let startYear = 2024, startMonth = 1;
  let endYear = 2024, endMonth = 12;
  let parallel = 10;
  let reprocess = false;
  let days = 0;
  
  // Parse arguments
  args.forEach(a => {
    if (a.startsWith('--start=')) {
      const [y, m] = a.slice(8).split('-');
      startYear = parseInt(y);
      startMonth = parseInt(m) || 1;
    } else if (a.startsWith('--end=')) {
      const [y, m] = a.slice(6).split('-');
      endYear = parseInt(y);
      endMonth = parseInt(m) || 12;
    } else if (a.startsWith('--parallel=')) {
      parallel = parseInt(a.slice(11)) || 10;
    } else if (a.startsWith('--days=')) {
      days = parseInt(a.slice(7)) || 7;
    } else if (a === '--reprocess') {
      reprocess = true;
    }
  });
  
  // Ensure directories exist
  [CACHE_DIR, OUTPUT_DIR].forEach(d => {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  });
  
  // Check MaxMind
  if (!fs.existsSync(GEOIP_DB_PATH)) {
    console.error(`\n⚠ MaxMind DB not found at ${GEOIP_DB_PATH}`);
    console.error('  Download from: https://dev.maxmind.com/geoip/geolite2-free-geolocation-data');
    console.error('  Place GeoLite2-City.mmdb in data/geoip/\n');
    console.error('  Continuing with country centroid fallback...\n');
  } else {
    try {
      const maxmind = await import('maxmind');
      geoReader = await maxmind.open(GEOIP_DB_PATH);
    } catch (e) {
      console.log('⚠ Could not load MaxMind, using fallback');
    }
  }
  
  console.log('\n╔═══════════════════════════════════════════════════════════════╗');
  console.log('║   RouteFluxMap Historical Fetcher (WEEKLY Data + MaxMind)         ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝\n');
  
  if (geoReader) console.log('  ✓ MaxMind loaded\n');
  
  // Generate month list
  const months = days > 0
    ? generateRecentDays(days)
    : generateMonths(startYear, startMonth, endYear, endMonth);
  
  console.log(`  Range:     ${days > 0 ? `Last ${days} days` : `${startYear}-${String(startMonth).padStart(2, '0')} → ${endYear}-${String(endMonth).padStart(2, '0')}`} (${months.length} months → ~${months.length * 4} weeks)`);
  console.log(`  Parallel:  ${parallel} concurrent`);
  console.log(`  Cache:     ${CACHE_DIR}`);
  console.log(`  Output:    ${OUTPUT_DIR}\n`);
  
  const startTime = Date.now();
  
  // Phase 1: Downloads
  if (!reprocess) {
    console.log('━━━ Phase 1: Parallel Downloads ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    Object.assign(status, { downloaded: 0, cached: 0, failed: 0, active: new Set() });
    
    await runParallel(
      months.map(({ year, month }) => () => downloadArchive(year, month, months.length)),
      parallel
    );
    console.log(`\n\n  ✓ Done: ${status.downloaded} new, ${status.cached} cached, ${status.failed} failed\n`);
  }
  
  // Phase 2: Process (TRUE PARALLEL with async exec!)
  console.log('━━━ Phase 2: Parallel Processing (MaxMind) ━━━━━━━━━━━━━━━━━━━━━\n');
  Object.assign(status, { processed: 0, skipped: 0, totalRelays: 0, totalGeo: 0, active: new Set() });
  
  await runParallel(
    months.map(({ year, month }) => () => {
      const ms = `${year}-${String(month).padStart(2, '0')}`;
      return processArchive(ms, path.join(CACHE_DIR, `consensuses-${ms}.tar.xz`), months.length);
    }),
    parallel
  );
  
  // Update index
  console.log('\n\n━━━ Phase 3: Update Index ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  updateIndex();
  
  const elapsed = Math.round((Date.now() - startTime) / 1000);
  const pct = status.totalRelays ? Math.round(status.totalGeo / status.totalRelays * 100) : 0;
  
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  ✓ Processed:   ${status.processed} months (weekly data points)`);
  console.log(`  ○ Skipped:     ${status.skipped} months`);
  console.log(`  📅 Weeks/mo:   4 data points per month (days 1, 8, 15, 22)`);
  console.log(`  ⚡ Relays:      ${status.totalRelays.toLocaleString()}`);
  console.log(`  🌍 Geolocated:  ${status.totalGeo.toLocaleString()} (${pct}%)`);
  console.log(`  ⏱  Time:        ${Math.floor(elapsed / 60)}m ${elapsed % 60}s`);
  console.log(`  📁 Cache:       ${CACHE_DIR}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

main().catch(console.error);

