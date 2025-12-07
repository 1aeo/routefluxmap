# Cloudflare Pages Deployment Guide

This guide covers deploying RouteFluxMap to Cloudflare Pages using the local Wrangler-based deploy method (similar to allium-deploy).

## Overview

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  DEPLOY SERVER                                                  │
│  ├── git pull                         (get latest code)        │
│  ├── npm run build                    (build static site)      │
│  ├── ./deploy/scripts/pages-deploy.sh (push to CF Pages)       │
│  └── Modifies dist/_headers, _redirects before deploy          │
└────────────────────────┬────────────────────────────────────────┘
                         │ wrangler pages deploy
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│  CLOUDFLARE PAGES                                               │
│  ├── Static files served globally via Cloudflare CDN           │
│  ├── Custom headers from _headers                              │
│  └── Redirects/proxies from _redirects                         │
│  URL: https://your-project.pages.dev (or custom domain)        │
└────────────────────────┬────────────────────────────────────────┘
                         │ fetches data
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│  CLOUDFLARE R2 / DO Spaces (Data Storage)                       │
│  URL: https://your-data-url                                    │
│  Files: index.json, relays-*.json                              │
└─────────────────────────────────────────────────────────────────┘
```

### Two Separate Pipelines

1. **Static Site Deploy** (this guide) - Builds and deploys the Astro/React frontend
2. **Data Pipeline** (see [cron.md](cron.md)) - Fetches Tor data and uploads to R2/Spaces

## Prerequisites

- Node.js 20+
- Cloudflare account
- Cloudflare API token with Pages:Edit permission

## Initial Setup

### 1. Clone the Repository

```bash
git clone git@github.com:1aeo/routefluxmap.git
cd routefluxmap
```

### 2. Run Setup Script

```bash
./deploy/scripts/pages-setup.sh
```

This will:
- Install npm dependencies
- Install wrangler CLI
- Create `deploy/config.env` from template
- Test the build

### 3. Get Cloudflare Credentials

#### Account ID

1. Log in to [Cloudflare Dashboard](https://dash.cloudflare.com)
2. Click on any domain or "Workers & Pages"
3. Find "Account ID" in the right sidebar
4. Copy it

#### API Token

1. Go to [My Profile → API Tokens](https://dash.cloudflare.com/profile/api-tokens)
2. Click **Create Token**
3. Use the **"Edit Cloudflare Workers"** template, OR create custom:
   - Permission: `Account` → `Cloudflare Pages` → `Edit`
   - Account Resources: Include → Your Account
4. Click **Continue to summary** → **Create Token**
5. Copy the token (shown only once!)

### 4. Configure Credentials

Edit `deploy/config.env`:

```bash
nano deploy/config.env
```

Set these values:

```bash
# Required
CLOUDFLARE_ACCOUNT_ID=abc123def456...
CLOUDFLARE_API_TOKEN=your_token_here

# Project name (creates on first deploy if doesn't exist)
CF_PAGES_PROJECT=routefluxmap

# Data URL baked into the build
PUBLIC_DATA_URL=https://your-data-url
```

## Deploying

### Standard Deploy

```bash
./deploy/scripts/pages-deploy.sh
```

This will:
1. Build the Astro site (`npm run build`)
2. Copy custom `_headers` and `_redirects` to `dist/`
3. Deploy via `wrangler pages deploy`

### Dry Run (Test Build)

```bash
./deploy/scripts/pages-deploy.sh --dry-run
```

Builds everything but doesn't deploy. Useful for testing.

### Deploy Without Rebuilding

```bash
./deploy/scripts/pages-deploy.sh --skip-build
```

Deploys the existing `dist/` directory.

## Custom Routing

### HTTP Headers (`deploy/pages/_headers`)

Control caching, security headers, CORS, etc:

```
# Cache static assets for 1 year
/assets/*
  Cache-Control: public, max-age=31536000, immutable

# Security headers
/*
  X-Frame-Options: DENY
  X-Content-Type-Options: nosniff
```

### URL Redirects (`deploy/pages/_redirects`)

Redirect or proxy requests:

```
# Permanent redirect
/old-page /new-page 301

# Proxy data through same origin (avoids CORS)
/data/* https://your-data-url/:splat 200

# Fallback for SPA (not needed for Astro static)
/* /index.html 200
```

### Switching Data Sources

To switch from R2 to DO Spaces (or vice versa) without rebuilding:

1. Edit `deploy/pages/_redirects`:
   ```
   /data/* https://your-backup-data-url/:splat 200
   ```

2. Deploy:
   ```bash
   ./deploy/scripts/pages-deploy.sh --skip-build
   ```

This proxies `/data/*` requests to a different backend.

## Custom Domain Setup

After the first deploy, set up your custom domain:

1. Go to [Cloudflare Dashboard → Workers & Pages](https://dash.cloudflare.com)
2. Click your project (`routefluxmap`)
3. Go to **Custom domains** tab
4. Click **Set up a custom domain**
5. Enter your custom domain
6. Cloudflare will auto-configure DNS and SSL

## CI/CD Integration (Optional)

### GitHub Actions

Create `.github/workflows/deploy-pages.yml`:

```yaml
name: Deploy to Cloudflare Pages

on:
  push:
    branches: [main]
  workflow_dispatch:  # Manual trigger

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      
      - run: npm ci
      
      - run: npm run build
        env:
          PUBLIC_DATA_URL: ${{ secrets.PUBLIC_DATA_URL }}
      
      - name: Copy custom files
        run: |
          cp deploy/pages/_headers dist/
          cp deploy/pages/_redirects dist/
      
      - name: Deploy to Cloudflare Pages
        uses: cloudflare/pages-action@v1
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          projectName: routefluxmap
          directory: dist
```

Add secrets in GitHub:
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

## Troubleshooting

### "Project not found"

The project is created automatically on first deploy. If you get this error:
- Make sure `CF_PAGES_PROJECT` matches what you expect
- Check API token has correct permissions

### "Authentication failed"

- Verify `CLOUDFLARE_API_TOKEN` is correct
- Ensure token has `Pages:Edit` permission
- Token must include your account

### Build fails with memory error

For large builds:

```bash
NODE_OPTIONS='--max-old-space-size=8192' npm run build
```

### "wrangler: command not found"

Install it:

```bash
npm install -D wrangler
```

### Preview deployments

Deploy to a preview URL (not production):

```bash
./deploy/scripts/pages-deploy.sh  # with CF_PAGES_BRANCH=preview
```

Or manually:

```bash
npx wrangler pages deploy dist --project-name=routefluxmap --branch=preview
```

## File Reference

```
deploy/
├── config.env.template    # All credentials template
├── config.env             # Your credentials (gitignored)
├── pages/
│   ├── _headers           # HTTP headers
│   └── _redirects         # URL redirects/proxies
├── scripts/
│   ├── pages-setup.sh     # One-time setup
│   ├── pages-build.sh     # Build wrapper
│   ├── pages-deploy.sh    # Deploy to CF Pages
│   ├── update.sh          # Data pipeline
│   ├── upload-r2.sh       # Upload to R2
│   └── upload-do.sh       # Upload to DO Spaces
└── README.md              # Quick reference
```

## See Also

- [Deploy README](../../deploy/README.md) - Quick reference
- [Cloudflare Pages docs](https://developers.cloudflare.com/pages/)
- [Headers configuration](https://developers.cloudflare.com/pages/configuration/headers/)
- [Redirects configuration](https://developers.cloudflare.com/pages/configuration/redirects/)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/)

