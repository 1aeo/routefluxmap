# Cron Setup for Data Updates

RouteFluxMap uses a local cron job to fetch and upload data periodically.

## Quick Setup

```bash
# 1. Copy config template
cd ~/routefluxmap/deploy
cp config.env.template config.env

# 2. Edit config with your credentials
nano config.env

# 3. Make scripts executable
chmod +x scripts/*.sh

# 4. Add cron job
crontab -e
```

Add this line:
```
0 */4 * * * /home/tor/routefluxmap/deploy/scripts/update.sh >> /home/tor/routefluxmap/deploy/logs/update.log 2>&1
```

## Cron Schedule Options

| Schedule | Cron Expression | Description |
|----------|-----------------|-------------|
| Every 4 hours | `0 */4 * * *` | Recommended for production |
| Every hour | `0 * * * *` | More frequent updates |
| Every 30 min | `*/30 * * * *` | Near real-time (high API load) |
| Daily at 6am | `0 6 * * *` | Once per day |

## What the Update Script Does

1. **Fetches relay data** from Onionoo API (~8,000+ relays)
2. **Fetches country client data** from Tor Metrics API (~200 countries)
3. **Geolocates IPs** using MaxMind database (instant with local DB)
4. **Writes JSON files** to `public/data/`
5. **Uploads to R2 and/or Spaces** (in parallel)

## Monitoring

### View Logs

```bash
# Watch live updates
tail -f ~/routefluxmap/deploy/logs/update.log

# Last 50 lines
tail -50 ~/routefluxmap/deploy/logs/update.log
```

### Check Cron Status

```bash
# List current cron jobs
crontab -l

# Check if cron is running
systemctl status cron
```

### Manual Run

```bash
# Run update manually
~/routefluxmap/deploy/scripts/update.sh
```

## Troubleshooting

### Cron job not running

1. Check cron is installed and running:
   ```bash
   systemctl status cron
   ```

2. Check the log file exists and is writable:
   ```bash
   touch ~/routefluxmap/deploy/logs/update.log
   ```

3. Verify the script path is absolute, not relative

### Script fails silently

Add error logging:
```bash
set -euo pipefail
exec 2>&1
```

### Permission issues

Make sure scripts are executable:
```bash
chmod +x ~/routefluxmap/deploy/scripts/*.sh
```

## Environment

Cron runs with a minimal environment. If you need specific paths:

```bash
# At the top of update.sh
export PATH="/usr/local/bin:/usr/bin:/bin:$HOME/.local/bin:$HOME/bin"
export HOME="/home/tor"
```

