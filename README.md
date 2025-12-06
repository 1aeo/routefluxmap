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
| Data Pipeline | [GitHub Actions](https://github.com/features/actions) |

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

### Environment Variables

Create a `.env` file for local development:

```env
# Data source URL (defaults to Cloudflare R2)
PUBLIC_DATA_URL=https://data.routefluxmap.1aeo.com
```

For the data pipeline (GitHub Actions secrets):

```env
# MaxMind GeoIP
MAXMIND_LICENSE_KEY=your_license_key

# Cloudflare R2
R2_ENDPOINT=https://xxx.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=your_access_key
R2_SECRET_ACCESS_KEY=your_secret_key
R2_BUCKET_NAME=routefluxmap-data
```

## 📊 Data Pipeline

The data is fetched hourly from the [Tor Onionoo API](https://onionoo.torproject.org/) and processed via GitHub Actions:

1. **Fetch**: Download relay data from Onionoo
2. **Geolocate**: Look up IP coordinates using MaxMind GeoLite2
3. **Aggregate**: Group relays by location
4. **Upload**: Store processed JSON in Cloudflare R2

### Manual Data Fetch

```bash
# Fetch and process data locally
pnpm run fetch-data

# Upload to R2 (requires credentials)
pnpm run upload-data
```

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
├── scripts/             # Data pipeline scripts
└── .github/workflows/   # GitHub Actions
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
│  GitHub Actions (Data Pipeline)                         │
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

