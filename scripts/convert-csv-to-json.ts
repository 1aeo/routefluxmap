
import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';

// Types matching the new frontend
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

// Validate and normalize fingerprint (ensure 40-char hex)
function normalizeFingerprint(fp: string): string {
  if (!fp) return '';
  
  // Remove any non-alphanumeric characters (except + / = if base64)
  const clean = fp.trim();
  
  // If it looks like a 40-char hex string, return uppercase
  if (/^[0-9a-fA-F]{40}$/.test(clean)) {
    return clean.toUpperCase();
  }
  
  // If it looks like Base64 (27 chars ending with = or not), try to convert
  // Standard Base64 for 20 bytes (SHA1) is 28 chars with padding, 27 without
  if (/^[a-zA-Z0-9+/]{27}=?$/.test(clean)) {
    try {
      return Buffer.from(clean, 'base64').toString('hex').toUpperCase();
    } catch (e) {
      console.warn(`Failed to convert potential Base64 fingerprint: ${clean}`);
    }
  }
  
  return clean; // Return original if we can't fix it
}

// Mercator projection helper (copied from fetch-all-data.ts)
function getNormalizedPosition(lat: number, lng: number): { x: number; y: number } {
  const x = (lng + 180) / 360;
  const latRad = lat * (Math.PI / 180);
  const mercN = Math.log(Math.tan(Math.PI / 4 + latRad / 2));
  const y = 0.5 + mercN / (2 * Math.PI);
  return { x, y };
}

async function convertHistoricalCsvToJson(csvFilePath: string, outputJsonPath: string) {
  console.log(`Converting ${csvFilePath}...`);

  try {
    const csvContent = fs.readFileSync(csvFilePath, 'utf-8');
    const records = parse(csvContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true
    });

    if (records.length === 0) {
      console.warn(`Skipping empty CSV: ${csvFilePath}`);
      return;
    }

    // Extract date from filename (assuming format relays-YYYY-MM-DD.csv or similar)
    const filename = path.basename(csvFilePath);
    const dateMatch = filename.match(/(\d{4}-\d{2}-\d{2})/);
    const dateStr = dateMatch ? dateMatch[1] : new Date().toISOString().split('T')[0];

    // Aggregation map
    const aggregated: Map<string, { lat: number; lng: number; relays: RelayInfo[] }> = new Map();
    let maxBw = 0;

    // Process records
    for (const row of records) {
        // Adapt these column names to match your actual CSV format
        // Common formats: 'fingerprint', 'nickname', 'latitude', 'longitude', 'bandwidth', etc.
        const lat = parseFloat(row.latitude || row.lat || row.Latitude);
        const lng = parseFloat(row.longitude || row.long || row.lng || row.Longitude);
        
        if (isNaN(lat) || isNaN(lng)) continue;

        const bw = parseFloat(row.consensus_weight || row.bandwidth || row.advertised_bandwidth || 0);
        maxBw = Math.max(maxBw, bw);

        // Round location for aggregation
        const key = `${lat.toFixed(2)},${lng.toFixed(2)}`;

        if (!aggregated.has(key)) {
            aggregated.set(key, { lat, lng, relays: [] });
        }

        aggregated.get(key)!.relays.push({
            nickname: row.nickname || row.Nickname || 'Unnamed',
            fingerprint: normalizeFingerprint(row.fingerprint || row.Fingerprint || ''),
            bandwidth: bw,
            flags: row.flags || row.Flags || '',
            ip: row.ip || row.address || row.IP || '',
            port: row.or_port || row.ORPort || ''
        });
    }

    // Build nodes
    const nodes: AggregatedNode[] = [];
    let totalBandwidth = 0;
    let minBw = Infinity;
    let maxNodeBw = 0;

    for (const bucket of aggregated.values()) {
        const bucketBw = bucket.relays.reduce((sum, r) => sum + r.bandwidth, 0);
        totalBandwidth += bucketBw;
        minBw = Math.min(minBw, bucketBw);
        maxNodeBw = Math.max(maxNodeBw, bucketBw);

        const pos = getNormalizedPosition(bucket.lat, bucket.lng);
        
        // Normalize relay bandwidths relative to the max individual relay bandwidth found
        bucket.relays.forEach(r => {
            r.bandwidth = maxBw > 0 ? r.bandwidth / maxBw : 0;
        });

        const label = bucket.relays.length === 1 
            ? bucket.relays[0].nickname 
            : `${bucket.relays.length} relays`;

        nodes.push({
            lat: bucket.lat,
            lng: bucket.lng,
            x: pos.x,
            y: pos.y,
            bandwidth: bucketBw,
            normalized_bandwidth: 0, // Calculated below
            label,
            relays: bucket.relays
        });
    }

    // Final normalization
    nodes.forEach(node => {
        node.normalized_bandwidth = totalBandwidth > 0 ? node.bandwidth / totalBandwidth : 0;
    });

    nodes.sort((a, b) => b.bandwidth - a.bandwidth);

    const outputData: ProcessedData = {
        published: `${dateStr} 12:00:00`,
        nodes,
        bandwidth: totalBandwidth,
        minMax: { min: minBw === Infinity ? 0 : minBw, max: maxNodeBw }
    };

    fs.writeFileSync(outputJsonPath, JSON.stringify(outputData, null, 2));
    console.log(`✓ Converted to ${outputJsonPath}`);

  } catch (error) {
    console.error(`Error converting ${csvFilePath}:`, error);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const inputDir = args[0] || path.join(process.cwd(), 'data/historical_csv');
  const outputDir = args[1] || path.join(process.cwd(), 'public/data');

  if (!fs.existsSync(inputDir)) {
    console.log(`Input directory ${inputDir} does not exist. Creating example...`);
    fs.mkdirSync(inputDir, { recursive: true });
    console.log('Place your CSV files in data/historical_csv/ and run this script again.');
    return;
  }

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const files = fs.readdirSync(inputDir).filter(f => f.endsWith('.csv'));
  console.log(`Found ${files.length} CSV files to process.`);

  for (const file of files) {
    const inputPath = path.join(inputDir, file);
    // Extract date from filename
    const dateMatch = file.match(/(\d{4}-\d{2}-\d{2})/);
    if (!dateMatch) {
        console.warn(`Skipping ${file}: No date found in filename (expected YYYY-MM-DD)`);
        continue;
    }
    const dateStr = dateMatch[1];
    const outputPath = path.join(outputDir, `relays-${dateStr}.json`);
    
    await convertHistoricalCsvToJson(inputPath, outputPath);
  }
}

main().catch(console.error);
