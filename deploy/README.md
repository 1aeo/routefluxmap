# RouteFluxMap Deploy

This directory contains everything needed to deploy RouteFluxMap:

1. **Data Pipeline** - Fetch Tor data and upload to R2/DO Spaces
2. **Static Site** - Build and deploy frontend to Cloudflare Pages

## Directory Structure

```
deploy/
├── config.env.template    # All credentials template (copy to config.env)
├── config.env             # Your credentials (gitignored)
├── logs/                  # Upload logs
├── pages/                 # Custom CF Pages files
│   ├── _headers           # HTTP header rules
│   └── _redirects         # URL redirect/rewrite rules
├── public/                # Generated data (if using local output)
├── scripts/
│   ├── update.sh          # Main data pipeline script
│   ├── upload-common.sh   # Shared upload functions
│   ├── upload-r2.sh       # Upload to Cloudflare R2
│   ├── upload-do.sh       # Upload to DO Spaces
│   ├── pages-setup.sh     # One-time Pages setup
│   ├── pages-build.sh     # Build static site
│   └── pages-deploy.sh    # Deploy to CF Pages
└── README.md              # This file
```

## Quick Start

### 1. Configure

```bash
cp config.env.template config.env
nano config.env
```

### 2. Data Pipeline (fetch + upload data)

```bash
./scripts/update.sh
```

### 3. Static Site (build + deploy frontend)

```bash
# One-time setup
./scripts/pages-setup.sh

# Deploy
./scripts/pages-deploy.sh
```

---

## Data Pipeline

Fetches Tor relay data and uploads to storage backends.

### Scripts

| Script | Description |
|--------|-------------|
| `update.sh` | Main pipeline: fetch data → upload to R2/DO |
| `upload-r2.sh` | Upload to Cloudflare R2 |
| `upload-do.sh` | Upload to DigitalOcean Spaces |
| `upload-common.sh` | Shared functions |

### Configuration

Set in `config.env`:

```bash
# Storage backends
STORAGE_ORDER=r2,do
R2_ENABLED=true
DO_ENABLED=true

# R2 credentials
CLOUDFLARE_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET=routefluxmap-data

# DO Spaces credentials
DO_SPACES_KEY=...
DO_SPACES_SECRET=...
DO_SPACES_REGION=nyc3
DO_SPACES_BUCKET=routefluxmap-data
```

### Cron Setup

Add to crontab for automatic updates:

```bash
# Every 4 hours
0 */4 * * * /path/to/routefluxmap/deploy/scripts/update.sh >> /path/to/routefluxmap/deploy/logs/update.log 2>&1
```

---

## Cloudflare Pages Deploy

Builds the static site locally and deploys via Wrangler (allium-deploy style).

### Why Local Deploy?

Instead of connecting Cloudflare Pages directly to GitHub, we build locally and push via Wrangler:

- **Full control** over the build process
- **Custom routing** via `_headers` and `_redirects`
- **Switch data sources** without rebuilding
- **Test builds** before they go live
- **Deploy from any server**

### Scripts

| Script | Description |
|--------|-------------|
| `pages-setup.sh` | One-time setup for new server |
| `pages-build.sh` | Build with config loaded |
| `pages-deploy.sh` | Build and deploy to CF Pages |

### Configuration

Set in `config.env` (same file as data pipeline):

```bash
# CF Pages credentials
CLOUDFLARE_ACCOUNT_ID=...
CLOUDFLARE_API_TOKEN=...

# Project settings
CF_PAGES_PROJECT=routefluxmap
CF_PAGES_BRANCH=main
# Storage priority (first = primary, second = fallback)
STORAGE_ORDER=do,r2

# Site URLs
PUBLIC_SITE_URL=https://your-site-url
PUBLIC_METRICS_URL=https://your-metrics-url
CUSTOM_DOMAIN=yourdomain.com

# Custom domains for data URLs (optional)
DO_SPACES_CUSTOM_DOMAIN=data.yourdomain.com
R2_CUSTOM_DOMAIN=data-r2.yourdomain.com

# Optional: proxy data through Pages
ENABLE_DATA_PROXY=false
```

### Deploy Commands

```bash
# Build and deploy
./deploy/scripts/pages-deploy.sh

# Dry run (build only)
./deploy/scripts/pages-deploy.sh --dry-run

# Deploy existing dist/ without rebuilding
./deploy/scripts/pages-deploy.sh --skip-build

# Or via npm
npm run deploy:pages
```

### Custom Routing

#### Headers (`pages/_headers`)

```
/assets/*
  Cache-Control: public, max-age=31536000, immutable

/*
  X-Frame-Options: DENY
```

#### Redirects (`pages/_redirects`)

```
# Proxy data through same origin
/data/* https://your-data-url/:splat 200

# Redirect old URLs
/old-page /new-page 301
```

### Getting Cloudflare Credentials

**Account ID:**
1. Cloudflare Dashboard → any domain → right sidebar

**API Token:**
1. My Profile → API Tokens → Create Token
2. Use "Edit Cloudflare Workers" template or create custom:
   - Permission: Account → Cloudflare Pages → Edit
3. Copy token (shown only once!)

---

## See Also

- [Cloudflare Pages Deploy Guide](../docs/setup/cloudflare-pages-deploy.md)
- [Cron Setup](../docs/setup/cron.md)
- [MaxMind GeoIP](../docs/setup/maxmind.md)

