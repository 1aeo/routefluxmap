# RouteFluxMap Astro Migration - Implementation Plan

## Executive Summary

This document outlines the complete migration of RouteFluxMap from a 2016-era Express.js + MySQL + Browserify stack to a modern Astro + Static Hosting architecture.

**Current Stack (2016):**
- Express.js 4.13 (Node.js server)
- MySQL 2.9 (relational database)
- Jade/Pug (server-side templates)
- Browserify + Gulp 3.9 (bundling)
- Bower (frontend dependencies)
- jQuery + D3.js + Leaflet (frontend)
- Custom WebGL (esper library) for particles
- Handlebars (client-side templates)

**Target Stack (2025):**
- Astro 5 (static site generator)
- Cloudflare Pages or any static host (hosting)
- Cloudflare R2 + DigitalOcean Spaces (data storage - dual upload)
- React islands (interactive components)
- Deck.gl + MapLibre GL (visualization)
- Tailwind CSS (styling)
- Local cron job on Debian/Ubuntu server (data pipeline)

**Domain:** `routefluxmap.1aeo.com`
**Data API:** `https://data.routefluxmap.1aeo.com` (or Spaces/R2 CDN)

---

## Quick Start: Priority Path to Browser Display

**Goal:** Get a working visualization in the browser ASAP, then iterate.

### Phase 0: Minimal Viable Display (Priority 1)

```bash
# 1. Install dependencies
cd /home/tor/routefluxmap
pnpm install

# 2. Copy existing CSV data and convert to JSON
node scripts/convert-csv-to-json.js ../torflow/data/current/relays-*.csv

# 3. Start dev server
pnpm dev
```

**Deliverables (Day 1-2):**
1. ✅ Static map with relay markers from existing data
2. ✅ Basic date slider (hardcoded dates initially)
3. ✅ Click on marker to see relay details

**Then iterate:** Add particles → Add countries → Add charts → Add controls

---

## Color Theme: 1aeo.com Style

**Primary Palette (Black + Green):**
```css
--tor-black: #0a0a0a;
--tor-darker: #050505;
--tor-green: #00ff88;        /* Primary accent */
--tor-green-dim: #00cc6a;    /* Hover states */
--tor-green-dark: #004d29;   /* Backgrounds */
--tor-purple: #8b5cf6;       /* Secondary accent */
--tor-gray: #888888;
--tor-gray-dark: #333333;
```

**Particle Colors:**
```typescript
particleHiddenColor: [1.0, 0.5, 0.0],    // Orange for hidden services
particleGeneralColor: [0.0, 1.0, 0.53],  // Green (#00ff88) for general
```

---

## Project Structure

```
routefluxmap/
├── src/
│   ├── components/
│   │   ├── map/
│   │   │   ├── TorMap.tsx           # Main map component (React island)
│   │   │   ├── ParticleLayer.tsx    # WebGL particle visualization
│   │   │   ├── RelayMarkers.tsx     # Relay node markers with popup
│   │   │   └── CountryLayer.tsx     # Country choropleth
│   │   ├── ui/
│   │   │   ├── DateSlider.tsx
│   │   │   ├── DateChart.tsx
│   │   │   ├── RelayPopup.tsx       # Shows relay list with links
│   │   │   └── ...
│   │   └── layout/
│   ├── layouts/
│   ├── pages/
│   ├── lib/
│   │   ├── config.ts
│   │   ├── types.ts
│   │   └── utils/
│   └── styles/
├── public/
│   ├── data/                        # Local dev data (gitignored)
│   └── ...
├── scripts/
│   ├── fetch-tor-data.ts            # Current data from Onionoo
│   ├── fetch-historical-data.ts     # Historical from Collector
│   ├── convert-csv-to-json.ts       # Convert existing CSVs
│   ├── upload-to-storage.ts         # Upload to R2 AND/OR Spaces
│   └── cron-update.sh               # Cron wrapper script
├── config.env.template              # Template (committed to git)
├── config.env                       # Actual config (gitignored)
├── .gitignore
├── astro.config.mjs
└── package.json
```

---

## Configuration: config.env Approach

### config.env.template (Committed to Git)
```env
# RouteFluxMap Configuration Template
# Copy to config.env and fill in your values

# ===========================================
# Data Sources
# ===========================================
GEOIP_DB_PATH=./data/geoip/GeoLite2-City.mmdb
DATA_OUTPUT_DIR=./data/output

# ===========================================
# Storage: Cloudflare R2
# ===========================================
R2_ENABLED=true
R2_ENDPOINT=https://YOUR_ACCOUNT_ID.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=your_r2_access_key
R2_SECRET_ACCESS_KEY=your_r2_secret_key
R2_BUCKET_NAME=routefluxmap-data
R2_PUBLIC_URL=https://data.routefluxmap.1aeo.com

# ===========================================
# Storage: DigitalOcean Spaces
# ===========================================
SPACES_ENABLED=true
SPACES_ENDPOINT=https://nyc3.digitaloceanspaces.com
SPACES_ACCESS_KEY_ID=your_spaces_access_key
SPACES_SECRET_ACCESS_KEY=your_spaces_secret_key
SPACES_BUCKET_NAME=routefluxmap-data
SPACES_CDN_URL=https://routefluxmap-data.nyc3.cdn.digitaloceanspaces.com

# ===========================================
# Site Configuration
# ===========================================
SITE_URL=https://routefluxmap.1aeo.com
METRICS_URL=https://metrics.1aeo.com
PUBLIC_DATA_URL=https://data.routefluxmap.1aeo.com

# ===========================================
# MaxMind (for downloading fresh DB)
# ===========================================
MAXMIND_LICENSE_KEY=your_maxmind_license_key
```

### config.env (Gitignored - Your Actual Config)
```env
# Your actual values go here
R2_ENABLED=true
R2_ENDPOINT=https://abc123.r2.cloudflarestorage.com
# ... etc
```

---

## Data Architecture

### Relay Data with Individual Relay Info

**relays-YYYY-MM-DD.json:**
```typescript
interface RelayData {
  published: string;
  nodes: AggregatedNode[];
  bandwidth: number;
  minMax: { min: number; max: number };
}

interface AggregatedNode {
  lat: number;
  lng: number;
  x: number;                        // Normalized [0,1]
  y: number;                        // Normalized [0,1]
  bandwidth: number;
  normalized_bandwidth: number;
  label: string;                    // Summary label
  relays: RelayInfo[];              // Individual relays at this location
}

interface RelayInfo {
  nickname: string;
  fingerprint: string;              // For link to metrics.1aeo.com/relay/{fp}
  bandwidth: number;
  flags: string;                    // M, G, E, H
  ip: string;
  port: string;
}
```

**UI Display:**
- Hover on marker → Show "32 relays at location"
- Click on marker → Popup with list of relays:
  ```
  ┌─────────────────────────────────────┐
  │ 32 Relays at Frankfurt, DE          │
  ├─────────────────────────────────────┤
  │ 🟢 TorRelay1 [G E] - 150 Mbit/s     │
  │    → View on Metrics                │
  │ 🟢 AnonRelay [G] - 89 Mbit/s        │
  │    → View on Metrics                │
  │ ... (scrollable)                    │
  └─────────────────────────────────────┘
  ```

---

## Storage: Dual Upload (R2 + Spaces)

The upload script supports uploading to both R2 and DigitalOcean Spaces simultaneously.

```typescript
// scripts/upload-to-storage.ts

interface StorageConfig {
  enabled: boolean;
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  publicUrl: string;
}

async function uploadToAllStorages(file: string, key: string) {
  const uploads = [];
  
  if (config.r2.enabled) {
    uploads.push(uploadToR2(file, key));
  }
  
  if (config.spaces.enabled) {
    uploads.push(uploadToSpaces(file, key));
  }
  
  // Upload in parallel
  await Promise.all(uploads);
}
```

---

## Data Pipeline: Local Cron

### Cron Setup (Debian/Ubuntu)

```bash
# Edit crontab
crontab -e

# Add hourly job (at :05 past each hour)
5 * * * * /home/tor/routefluxmap/scripts/cron-update.sh >> /var/log/routefluxmap-cron.log 2>&1
```

### scripts/cron-update.sh
```bash
#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

# Load config
source config.env

# Run fetch and upload
echo "$(date): Starting RouteFluxMap data update..."

# Fetch current data from Onionoo
node --loader ts-node/esm scripts/fetch-tor-data.ts

# Upload to storage(s)
node --loader ts-node/esm scripts/upload-to-storage.ts

echo "$(date): Update complete!"
```

### Historical Data Fetch

Reference existing script: `bin/fetch-historical-data`

Key features already implemented:
- ✅ Parallel downloads (configurable concurrency)
- ✅ Parallel MaxMind geolocating (local DB = instant)
- ✅ Local archive cache (won't re-download)
- ✅ Real-time status updates

Port to TypeScript and add JSON output + storage upload.

---

## Component Implementation Priority

### Day 1-2: Get Map Displaying
1. **TorMap.tsx** - Basic map with MapLibre
2. **RelayMarkers.tsx** - ScatterplotLayer showing relay locations
3. **RelayPopup.tsx** - Click to see relay list with metrics links
4. **Convert existing CSV** to JSON for dev

### Day 3-4: Add Interactivity
5. **DateSlider.tsx** - Navigate between dates
6. **Data fetching** - Load from local JSON or remote storage
7. **URL state** - Date in hash for bookmarking

### Day 5-6: Visual Polish
8. **CountryLayer.tsx** - Choropleth of client connections
9. **DateChart.tsx** - Bandwidth histogram
10. **LayerControls.tsx** - Opacity, visibility toggles

### Day 7+: Advanced Features
11. **ParticleLayer.tsx** - Animated data flow
12. **OutlierChart.tsx** - Country statistics
13. **Mobile optimization**

---

## Phase 1: Project Setup

### 1.1 Initialize Project

```bash
cd /home/tor/routefluxmap
pnpm install
```

### 1.2 Configure .gitignore

```gitignore
# Dependencies
node_modules/

# Build
dist/

# Environment (IMPORTANT: keep credentials out of git)
config.env
.env
.env.local

# Local data
public/data/
data/output/
data/cache/
data/geoip/

# IDE
.vscode/
.idea/

# OS
.DS_Store
```

### 1.3 Tailwind Theme Update

```javascript
// tailwind.config.mjs
export default {
  theme: {
    extend: {
      colors: {
        // 1aeo.com theme: Black + Green
        'tor-black': '#0a0a0a',
        'tor-darker': '#050505',
        'tor-green': '#00ff88',
        'tor-green-dim': '#00cc6a',
        'tor-green-dark': '#004d29',
        'tor-purple': '#8b5cf6',
        'tor-orange': '#ff6600',
        'tor-gray': '#888888',
      },
    },
  },
};
```

---

## Phase 2: Data Pipeline

### 2.1 Fetch Current Data

Port `bin/fetch-tor-data` with these enhancements:
- Output JSON with individual relay info (not just aggregated)
- Include fingerprints for metrics links
- Parallel MaxMind lookups (already fast with local DB)

### 2.2 Fetch Historical Data

Port `bin/fetch-historical-data` to TypeScript:
- Same parallel download/process approach
- Output to JSON format
- Add upload to R2/Spaces after processing

### 2.3 Upload Script

New `scripts/upload-to-storage.ts`:
- Read config.env for credentials
- Upload to R2 if enabled
- Upload to Spaces if enabled
- Support both simultaneously

---

## Phase 3: Components

### 3.1 TorMap.tsx

```tsx
import DeckGL from '@deck.gl/react';
import { Map } from 'react-map-gl/maplibre';
import { ScatterplotLayer } from '@deck.gl/layers';

export default function TorMap({ data, onRelayClick }) {
  const layers = [
    new ScatterplotLayer({
      id: 'relays',
      data: data.nodes,
      getPosition: d => [d.lng, d.lat],
      getRadius: d => Math.sqrt(d.bandwidth) * 500,
      getFillColor: [0, 255, 136, 200], // Green theme
      pickable: true,
      onClick: ({ object }) => onRelayClick(object),
    }),
  ];

  return (
    <DeckGL layers={layers} controller>
      <Map mapStyle="https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json" />
    </DeckGL>
  );
}
```

### 3.2 RelayPopup.tsx

```tsx
interface RelayPopupProps {
  node: AggregatedNode;
  metricsUrl: string; // https://metrics.1aeo.com
  onClose: () => void;
}

export default function RelayPopup({ node, metricsUrl, onClose }) {
  return (
    <div className="bg-tor-darker border border-tor-green/30 rounded-lg p-4 max-h-80 overflow-y-auto">
      <h3 className="text-tor-green font-bold mb-3">
        {node.relays.length} Relays at Location
      </h3>
      <ul className="space-y-2">
        {node.relays.map(relay => (
          <li key={relay.fingerprint} className="border-b border-tor-gray/20 pb-2">
            <div className="flex items-center gap-2">
              <span className="text-tor-green">●</span>
              <span className="font-medium">{relay.nickname}</span>
              <span className="text-tor-gray text-sm">[{relay.flags}]</span>
            </div>
            <div className="text-sm text-tor-gray">
              {formatBandwidth(relay.bandwidth)}
            </div>
            <a 
              href={`${metricsUrl}/relay/${relay.fingerprint}`}
              target="_blank"
              className="text-tor-green hover:underline text-sm"
            >
              View on Metrics →
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

---

## Phase 4: Testing & Validation

### Visual Checklist
- [ ] Map renders with dark theme
- [ ] Relay markers sized by bandwidth
- [ ] Green color theme matches 1aeo.com
- [ ] Click marker shows relay popup
- [ ] Relay links go to metrics.1aeo.com/relay/{fp}
- [ ] Date slider navigates dates
- [ ] Mobile layout works

### Data Validation
- [ ] Relay count matches Onionoo
- [ ] Fingerprints are correct for links
- [ ] GeoIP coordinates accurate
- [ ] Historical data loads correctly

---

## Recommended Next Steps (Priority Order)

### Immediate (Today):

1. **Update config files** with green theme
2. **Create convert-csv-to-json.ts** to use existing data
3. **Implement basic TorMap.tsx** with ScatterplotLayer
4. **Run `pnpm dev`** and see relays on map

### This Week:

5. **Add RelayPopup** with metrics links
6. **Add DateSlider** for navigation
7. **Update fetch-tor-data.ts** to output JSON with relay details
8. **Create upload-to-storage.ts** with R2 + Spaces support
9. **Set up local cron**

### Next Week:

10. **Port fetch-historical-data** to TypeScript
11. **Add CountryLayer** choropleth
12. **Add DateChart** histogram
13. **Add ParticleLayer** animation

---

## File Migration Map

### From Original RouteFluxMap

| Original | New Location | Status |
|----------|--------------|--------|
| `bin/fetch-tor-data` | `scripts/fetch-tor-data.ts` | 🔄 Port |
| `bin/fetch-historical-data` | `scripts/fetch-historical-data.ts` | 🔄 Port |
| `public/javascripts/config.js` | `src/lib/config.ts` | ✅ Done |
| `public/javascripts/layers/*` | `src/components/map/*` | 🔄 Rewrite |
| `public/shaders/*` | `public/shaders/*` | 📋 Copy if needed |
| `data/current/*.csv` | Convert to JSON | 🔄 Script |
| `data/historical/*.csv` | Convert to JSON | 🔄 Script |

---

## Success Criteria

1. **Working visualization in browser** within 2 days
2. **Click relay → see details with metrics link**
3. **Green/black theme** matching 1aeo.com
4. **Dual storage upload** (R2 + Spaces)
5. **Local cron** instead of GitHub Actions
6. **config.env** approach (no credentials in git)
7. **Individual relay info** visible, not just aggregated counts

---

*Document Version: 2.0*
*Created: December 6, 2025*
*Last Updated: December 6, 2025*
