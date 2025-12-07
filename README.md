# RouteFluxMap - Tor Network Visualization

A modern, real-time visualization of the Tor network showing relay bandwidth and data flow patterns.

![RouteFluxMap Screenshot](public/sample.png)

## 🚀 Features

- **Interactive Map**: Explore Tor relays worldwide with WebGL-powered visualization
- **Particle Flow Animation**: Watch simulated traffic flow between relays
- **Historical Data**: Navigate through historical snapshots of the network
- **Country Statistics**: Click on countries to see connection statistics and outliers
- **Mobile Friendly**: Responsive design works on all devices
- **Zero Maintenance**: Static site with automated data updates

## 🛠 Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | [Astro](https://astro.build) |
| Interactive UI | [React](https://react.dev) |
| Visualization | [Deck.gl](https://deck.gl) |
| Maps | [MapLibre GL](https://maplibre.org) |
| Styling | [Tailwind CSS](https://tailwindcss.com) |
| Hosting | [Cloudflare Pages](https://pages.cloudflare.com) |
| Data Storage | [Cloudflare R2](https://www.cloudflare.com/r2) |
| Data Pipeline | Local Cron Job |

## 📦 Quick Start

### Prerequisites

- Node.js 20+
- pnpm (recommended) or npm

### Development

```bash
# Clone the repository
git clone https://github.com/1aeo/routefluxmap.git
cd routefluxmap

# Install dependencies
pnpm install

# Start development server
pnpm dev
```

Visit `http://localhost:4321` to see the app.

### Build

```bash
# Build for production
pnpm build

# Preview production build
pnpm preview
```

## 🔧 Configuration

All configuration is in `deploy/config.env`:

```bash
cp deploy/config.env.template deploy/config.env
nano deploy/config.env
```

Key settings:

```bash
# Storage priority (first = primary for frontend, second = fallback)
STORAGE_ORDER=do,r2

# Site URLs
PUBLIC_SITE_URL=https://your-site-url
PUBLIC_METRICS_URL=https://your-metrics-url

# Storage credentials
DO_SPACES_BUCKET=your-bucket
DO_SPACES_REGION=nyc3
R2_BUCKET=your-bucket
R2_CUSTOM_DOMAIN=data.yourdomain.com
```

The frontend automatically tries the primary storage first, then falls back to the secondary if primary fails.

## 📊 Data Pipeline

The data is fetched hourly from the [Tor Onionoo API](https://onionoo.torproject.org/) via a local cron job:

1. **Fetch**: Download relay data from Onionoo
2. **Geolocate**: Look up IP coordinates using MaxMind GeoLite2
3. **Aggregate**: Group relays by location
4. **Upload**: Store processed JSON in Cloudflare R2

### Manual Data Fetch

```bash
# Fetch relay data + country data + geolocate (all in one)
npm run fetch-data

# Upload to R2 and/or DO Spaces
./deploy/scripts/update.sh
```

### Historical Data Processing

The script can fetch historical data from Tor Collector archives:

```bash
# Fetch a specific day (mm/dd/yy)
npx tsx scripts/fetch-all-data.ts 12/07/25

# Fetch an entire month (mm/yy)
npx tsx scripts/fetch-all-data.ts 11/25

# Fetch an entire year (yy)
npx tsx scripts/fetch-all-data.ts 25

# With custom parallelism and thread settings
npx tsx scripts/fetch-all-data.ts 11/25 --parallel=4 --threads=2
```

#### Resource Requirements

Historical data processing downloads and parses large archive files (~400MB compressed). Resource usage depends on the `--threads` setting:

| Setting | RAM Usage | Speed | Notes |
|---------|-----------|-------|-------|
| `--threads=1` | ~4GB | Slowest | Minimum memory systems |
| `--threads=4` | ~6GB | Fast | **Default, recommended** |
| `--threads=0` | ~9GB | Fast | All CPU cores (same speed as -T4) |

**Typical processing times:**
- 1 day: ~3 seconds
- 1 month: ~70 seconds (first run), ~23 seconds (cached)
- 1 year: ~15 minutes (first run)

**Caching:** The script caches bandwidth data per month (~500KB JSON). Subsequent runs for the same month are ~3x faster.

**Low-memory systems:** Use `--threads=1 --parallel=1` for systems with <8GB RAM.

## 🚀 Deployment

### Static Site (Cloudflare Pages)

Deploy the frontend using the local Wrangler-based deploy (allium-deploy style):

```bash
# One-time setup (on deploy server)
./deploy/scripts/pages-setup.sh

# Edit credentials
nano deploy/config.env

# Deploy
./deploy/scripts/pages-deploy.sh

# Or via npm
npm run deploy:pages
```

See [deploy/README.md](deploy/README.md) for detailed setup.

### Setup Guides

See [docs/setup/](docs/setup/) for detailed guides:
- [Cloudflare Pages Deploy](docs/setup/cloudflare-pages-deploy.md) - Local Wrangler deploy
- [MaxMind GeoIP](docs/setup/maxmind.md)
- [Cron Setup](docs/setup/cron.md)

## 🏗 Project Structure

```
routefluxmap/
├── src/
│   ├── components/      # React components
│   │   ├── map/         # Map visualization
│   │   ├── ui/          # UI controls
│   │   └── layout/      # Layout components
│   ├── lib/             # Utilities and config
│   ├── layouts/         # Astro layouts
│   ├── pages/           # Routes
│   └── styles/          # Global CSS
├── public/              # Static assets
├── scripts/             # Data fetch scripts
├── deploy/              # All deployment (data + static site)
│   ├── scripts/         # Data upload + Pages deploy scripts
│   ├── pages/           # CF Pages _headers, _redirects
│   └── config.env       # All credentials (gitignored)
├── docs/                # Documentation
│   ├── setup/           # Setup guides
│   └── features/        # Feature specs
└── tests/               # Unit tests
```

## 🗺 Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Cloudflare Pages (Static Site)                         │
│  └── Astro + React + Deck.gl + MapLibre                │
└────────────────────────┬────────────────────────────────┘
                         │ fetch JSON
                         ▼
┌─────────────────────────────────────────────────────────┐
│  Cloudflare R2 (Data Storage)                           │
│  ├── index.json       # Date index                      │
│  ├── current/*.json   # Daily relay snapshots           │
│  └── geo/*.json       # Country boundaries              │
└────────────────────────┬────────────────────────────────┘
                         ▲ hourly upload
                         │
┌─────────────────────────────────────────────────────────┐
│  Local Cron Job (Data Pipeline)                         │
│  └── Fetch Onionoo → GeoIP → Aggregate → Upload        │
└─────────────────────────────────────────────────────────┘
```

## 📜 License

This project is licensed under the [Apache License 2.0](LICENSE).

## 🙏 Credits

- Originally created by [Uncharted Software](https://uncharted.software) (2015)
- Modernized by the RouteFluxMap community (2025)
- Data from [The Tor Project](https://www.torproject.org/)
- GeoIP data from [MaxMind](https://www.maxmind.com/)
- Map tiles from [CartoDB](https://carto.com/)

## 🔗 Links

- [Live Demo](https://routefluxmap.1aeo.com)
- [Original TorFlow](https://github.com/unchartedsoftware/torflow)
- [Tor Project](https://www.torproject.org/)
- [Onionoo API](https://onionoo.torproject.org/)

