# Data Sources

RouteFluxMap aggregates data from multiple Tor Project APIs.

## Relay Data: Onionoo API

**Endpoint:** https://onionoo.torproject.org/details

The primary source for relay information.

### Request

```
GET https://onionoo.torproject.org/details?type=relay&running=true
```

### Response Fields Used

| Field | Description |
|-------|-------------|
| `nickname` | Relay operator-chosen name |
| `fingerprint` | 40-char hex SHA-1 hash (unique identifier) |
| `or_addresses` | IP:port combinations (IPv4 and IPv6) |
| `country` | Two-letter country code |
| `flags` | Status flags: Running, Guard, Exit, HSDir, etc. |
| `observed_bandwidth` | Measured bandwidth in bytes/sec |
| `relays_published` | Timestamp of consensus snapshot |

### Rate Limits

- No official rate limit
- Recommended: once per hour maximum
- Data updates every ~hour

### Documentation

- https://metrics.torproject.org/onionoo.html
- https://gitweb.torproject.org/onionoo.git

---

## Country Client Data: Tor Metrics API

**Endpoint:** https://metrics.torproject.org/userstats-relay-country.csv

Estimated daily Tor users per country.

### Request

```
GET https://metrics.torproject.org/userstats-relay-country.csv?start=YYYY-MM-DD&end=YYYY-MM-DD
```

### Parameters

| Parameter | Description |
|-----------|-------------|
| `start` | Start date (YYYY-MM-DD) |
| `end` | End date (YYYY-MM-DD) |
| `country` | Optional: filter by country code (lowercase) |

### Response Format

```csv
date,country,users,lower,upper,frac
2024-01-01,us,444507,258260,593164,72
2024-01-01,de,224891,130000,310000,72
```

| Column | Description |
|--------|-------------|
| `date` | Date (YYYY-MM-DD) |
| `country` | Two-letter country code (lowercase) |
| `users` | Estimated daily users |
| `lower` | Lower confidence bound |
| `upper` | Upper confidence bound |
| `frac` | Fraction of directory requests observed (%) |

### Notes

- First row (empty country) contains total global users
- Country `??` represents unknown/unclassified
- Data is derived from directory request analysis
- Estimates have significant uncertainty (see lower/upper bounds)

### Documentation

- https://metrics.torproject.org/userstats-relay-country.html

---

## IP Geolocation: MaxMind GeoLite2

**Database:** GeoLite2-City.mmdb

Used to convert relay IP addresses to geographic coordinates.

### Accuracy

| Level | Typical Accuracy |
|-------|------------------|
| Country | 99%+ |
| Region/State | 70-80% |
| City | 50-70% |
| Coordinates | Within 50km of actual location |

### Fields Used

| Field | Description |
|-------|-------------|
| `location.latitude` | Approximate latitude |
| `location.longitude` | Approximate longitude |
| `country.iso_code` | Two-letter country code |
| `city.names.en` | City name (English) |

### Fallback

When MaxMind lookup fails (invalid IP, private range, etc.), we fall back to country centroids with random jitter to prevent visual stacking.

### Documentation

- https://dev.maxmind.com/geoip/geolite2-free-geolocation-data
- https://github.com/maxmind/MaxMind-DB-Reader-nodejs

---

## Historical Data: Tor Collector

**Endpoint:** https://collector.torproject.org/archive/relay-descriptors/consensuses/

Used for historical data only (not real-time).

### Structure

```
consensuses-YYYY-MM.tar.xz
  └── consensuses/
      └── YYYY-MM-DD-HH-MM-SS-consensus
```

### Processing

1. Download monthly archives
2. Extract consensus files for target dates (weekly: days 1, 8, 15, 22)
3. Parse relay entries (r, s, w lines)
4. Convert fingerprints from Base64 to hex
5. Geolocate and aggregate

### Documentation

- https://collector.torproject.org/
- https://gitweb.torproject.org/torspec.git/tree/dir-spec.txt

---

## Data Freshness

| Data Type | Update Frequency | Typical Delay |
|-----------|------------------|---------------|
| Relay data | ~1 hour | 15-60 minutes |
| Country clients | ~1 day | 24-48 hours |
| MaxMind DB | Weekly | 0-7 days |

---

## Country Boundaries: GeoJSON (Choropleth)

RouteFluxMap uses a world countries polygon GeoJSON for the country choropleth layer.

See `docs/sources/country-boundaries.md` for detailed provenance notes (including pinned fallback commit + raw URL).

### Primary (bundled with the site)

- **Path:** `public/data/countries.geojson` (served as `/data/countries.geojson`)
- **Source:** Natural Earth “Admin 0 – Countries” (10m cultural vectors)
- **Notes:** Natural Earth is public domain; attribution is appreciated.

### Fallback (runtime fetch if local asset is missing)

If the bundled file is unavailable, the app may fetch a pinned fallback:

- **Repo:** `datasets/geo-countries`
- **Pinned commit:** `b0b7794e15e7ec4374bf183dd73cce5b92e1c0ae`
- **File:** `data/countries.geojson`
- **License (dataset packaging):** ODC-PDDL-1.0 (as declared by the dataset’s `datapackage.json`)

