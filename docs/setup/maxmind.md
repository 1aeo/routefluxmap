# MaxMind GeoIP Setup

RouteFluxMap uses MaxMind's GeoLite2-City database for IP geolocation. This guide explains how to set it up.

## Step 1: Create MaxMind Account

1. Go to https://www.maxmind.com/en/geolite2/signup
2. Create a free account (GeoLite2 is free for non-commercial use)
3. Verify your email

## Step 2: Generate License Key

1. Log in to your MaxMind account
2. Go to **Account** → **Manage License Keys**
3. Click **Generate new license key**
4. Give it a name (e.g., "RouteFluxMap")
5. Copy the license key and save it in your `deploy/config.env`:
   ```env
   MAXMIND_LICENSE_KEY=your_license_key_here
   ```

## Step 3: Download Database

### Option A: Manual Download

1. Go to https://www.maxmind.com/en/accounts/current/geoip/downloads
2. Download **GeoLite2 City** (mmdb format)
3. Extract and place in `data/geoip/GeoLite2-City.mmdb`

### Option B: Automated Download

Add this to your setup or cron script:

```bash
#!/bin/bash
# Download latest GeoLite2-City database

MAXMIND_LICENSE_KEY="${MAXMIND_LICENSE_KEY:?Set MAXMIND_LICENSE_KEY}"
GEOIP_DIR="${GEOIP_DIR:-./data/geoip}"

mkdir -p "$GEOIP_DIR"

echo "Downloading GeoLite2-City database..."
curl -sL "https://download.maxmind.com/app/geoip_download?edition_id=GeoLite2-City&license_key=${MAXMIND_LICENSE_KEY}&suffix=tar.gz" \
  | tar xz --strip-components=1 -C "$GEOIP_DIR" --wildcards "*.mmdb"

echo "✓ Database saved to $GEOIP_DIR/GeoLite2-City.mmdb"
```

## Step 4: Keep Database Updated

MaxMind updates GeoLite2 weekly (Tuesdays). Add a weekly cron job:

```bash
# Weekly database update (Sundays at 3am)
0 3 * * 0 /home/tor/routefluxmap/scripts/update-geoip.sh >> /var/log/geoip-update.log 2>&1
```

Create `scripts/update-geoip.sh`:

```bash
#!/bin/bash
set -e

cd "$(dirname "$0")/.."
source deploy/config.env

./scripts/download-geoip.sh

echo "$(date): GeoIP database updated"
```

## Fallback Behavior

If the MaxMind database is not found, RouteFluxMap falls back to country centroids based on the relay's reported country code. This is less accurate but ensures the visualization still works.

## Troubleshooting

### "MaxMind database not found"

Check that the file exists at the configured path:
```bash
ls -la data/geoip/GeoLite2-City.mmdb
```

### "Invalid license key"

1. Verify the key in your MaxMind account
2. Make sure there are no trailing spaces in config.env
3. Regenerate the key if necessary

### "Rate limited"

MaxMind limits downloads to 2000/day. If you're hitting this:
- Don't run the download script more than once per day
- Use a local copy for development

