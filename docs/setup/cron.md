# Cron Setup for Data Updates

RouteFluxMap uses cron to fetch and upload data periodically.

## Quick Setup

We use `/etc/cron.d/` drop-in files instead of user crontab. This is safer - each project's cron jobs are isolated and can't accidentally overwrite each other.

```bash
# Install cron jobs (requires sudo)
sudo ./deploy/scripts/cron-manage.sh install

# Verify installation
./deploy/scripts/cron-manage.sh verify
```

That's it! The cron job will run every 4 hours.

## Why /etc/cron.d/ Instead of User Crontab?

| Aspect | User Crontab | /etc/cron.d/ |
|--------|--------------|--------------|
| Isolation | All jobs in one file | Per-project files |
| Overwrite risk | `crontab file` wipes everything | Each project separate |
| Version control | Not in git | Template tracked in repo |
| Recovery | Need backups | Just re-run install |
| Visibility | `crontab -l` | `cat /etc/cron.d/routefluxmap` |

## Cron Management Commands

```bash
# Install cron jobs to /etc/cron.d/ (requires sudo)
sudo ./deploy/scripts/cron-manage.sh install

# Verify cron jobs are installed (returns exit code for monitoring)
./deploy/scripts/cron-manage.sh verify

# Show all cron configuration and recent logs
./deploy/scripts/cron-manage.sh show

# Backup current user crontab
./deploy/scripts/cron-manage.sh backup

# Migrate entries from user crontab to /etc/cron.d/
./deploy/scripts/cron-manage.sh migrate

# Remove cron jobs (requires sudo)
sudo ./deploy/scripts/cron-manage.sh remove
```

## Cron Schedule Options

The default schedule is every 4 hours (`0 */4 * * *`). To change it, edit `deploy/configs/routefluxmap.cron.d`:

| Schedule | Cron Expression | Description |
|----------|-----------------|-------------|
| Every 4 hours | `0 */4 * * *` | **Default** |
| Every hour | `0 * * * *` | More frequent updates |
| Every 30 min | `*/30 * * * *` | Near real-time (high API load) |
| Daily at 4am | `0 4 * * *` | Once per day |

After editing, re-run: `sudo ./deploy/scripts/cron-manage.sh install`

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

# Show recent logs + cron config
./deploy/scripts/cron-manage.sh show
```

### Verify Cron (for external monitoring)

The `verify` command returns exit code 0 if cron is installed, 1 if not:

```bash
./deploy/scripts/cron-manage.sh verify
echo $?  # 0 = OK, 1 = problem
```

### Manual Run

```bash
~/routefluxmap/deploy/scripts/update.sh
```

## Troubleshooting

### Cron job not running

```bash
# Full status check
./deploy/scripts/cron-manage.sh verify

# Check cron service
systemctl status cron

# Check syslog for cron errors
grep CRON /var/log/syslog | tail -20
```

### Duplicate entries (user crontab + cron.d)

If you previously used user crontab, migrate to cron.d:

```bash
./deploy/scripts/cron-manage.sh migrate
```

This backs up and removes routefluxmap entries from user crontab.

### Permission issues

The cron.d file must be owned by root with mode 644:

```bash
sudo chown root:root /etc/cron.d/routefluxmap
sudo chmod 644 /etc/cron.d/routefluxmap
```

## Environment

Cron runs with a minimal environment. The update script handles this by setting PATH explicitly. If you need additional environment variables, add them to `deploy/config.env`.
