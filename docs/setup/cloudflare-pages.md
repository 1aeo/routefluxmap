# Cloudflare Pages Deployment

RouteFluxMap is deployed as a static site on Cloudflare Pages.

## Prerequisites

- Cloudflare account
- GitHub repository access

## Setup Steps

### 1. Connect Repository

1. Go to Cloudflare Dashboard → **Workers & Pages** → **Create Application**
2. Select the **Pages** tab
3. Click **Connect to Git**
4. Authorize Cloudflare to access your GitHub account
5. Select the `routefluxmap` repository

### 2. Configure Build Settings

| Setting | Value |
|---------|-------|
| Framework preset | Astro |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Root directory | `/` |

### 3. Environment Variables

Add these in the Cloudflare Pages dashboard under **Settings** → **Environment variables**:

| Variable | Value | Description |
|----------|-------|-------------|
| `PUBLIC_DATA_URL` | `https://data.routefluxmap.1aeo.com` | Where data JSON files are served from |
| `NODE_VERSION` | `20` | Node.js version to use for builds |

### 4. Custom Domain

1. Go to your Pages project → **Custom domains**
2. Click **Set up a custom domain**
3. Enter: `routefluxmap.1aeo.com`
4. Cloudflare will auto-provision SSL

## Build Configuration

The Astro config is already set for static output:

```javascript
// astro.config.mjs
export default defineConfig({
  output: 'static',
  build: {
    assets: 'assets',
  },
});
```

No additional `wrangler.toml` is needed for static Pages deployment.

## Deployment Triggers

Cloudflare Pages automatically deploys when:
- You push to the main branch
- A pull request is opened (preview deployment)

## Preview Deployments

Every pull request gets a unique preview URL like:
```
https://abc123.routefluxmap.pages.dev
```

This lets you test changes before merging.

## Troubleshooting

### Build fails with TypeScript errors

Run locally first to check:
```bash
npm run build
```

### Assets not loading

Check that `PUBLIC_DATA_URL` is set correctly and the data files exist at that URL.

### Slow builds

Cloudflare Pages builds can be slow for larger projects. Consider:
- Using a build cache (automatic for npm)
- Optimizing dependencies

