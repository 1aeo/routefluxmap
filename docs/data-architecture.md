# Data Architecture

This document describes the JSON data structures used by RouteFluxMap.

## Output Files

```
public/data/
├── index.json                  # Date index with bandwidth stats
├── relays-YYYY-MM-DD.json      # Relay data for specific date
└── countries-YYYY-MM-DD.json   # Country client data for specific date
```

---

## index.json

Master index of all available dates.

```typescript
interface DateIndex {
  lastUpdated: string;      // ISO timestamp of last update
  dates: string[];          // Available dates (YYYY-MM-DD format)
  bandwidths: number[];     // Total bandwidth for each date
  min: {                    // Date with minimum bandwidth
    date: string;
    bandwidth: number;
  };
  max: {                    // Date with maximum bandwidth
    date: string;
    bandwidth: number;
  };
  relayCount: number;       // Number of relays in latest snapshot
}
```

**Example:**
```json
{
  "lastUpdated": "2025-12-07T00:00:00.000Z",
  "dates": ["2025-12-01", "2025-12-06", "2025-12-07"],
  "bandwidths": [821.62, 1246.36, 909.99],
  "min": { "date": "2025-12-01", "bandwidth": 821.62 },
  "max": { "date": "2025-12-06", "bandwidth": 1246.36 },
  "relayCount": 9393
}
```

---

## relays-YYYY-MM-DD.json

Relay data aggregated by location.

```typescript
interface RelayData {
  published: string;        // Onionoo consensus timestamp
  nodes: AggregatedNode[];  // Locations with relay info
  bandwidth: number;        // Total normalized bandwidth
  minMax: {
    min: number;            // Minimum node bandwidth
    max: number;            // Maximum node bandwidth
  };
}

interface AggregatedNode {
  lat: number;              // Latitude (WGS84)
  lng: number;              // Longitude (WGS84)
  x: number;                // Normalized X [0,1] for WebGL
  y: number;                // Normalized Y [0,1] for WebGL
  bandwidth: number;        // Sum of relay bandwidths at location
  normalized_bandwidth: number;  // Fraction of total network bandwidth
  label: string;            // Display label ("RelayName" or "N relays")
  relays: RelayInfo[];      // Individual relays at this location
}

interface RelayInfo {
  nickname: string;         // Relay operator-chosen name
  fingerprint: string;      // 40-char hex SHA-1 (for metrics links)
  bandwidth: number;        // Normalized bandwidth [0,1]
  flags: string;            // Flag codes: M=Middle, G=Guard, E=Exit, H=HSDir
  ip: string;               // IPv4 or IPv6 address
  port: string;             // OR port
}
```

**Example:**
```json
{
  "published": "2025-12-07 12:00:00",
  "nodes": [
    {
      "lat": 50.11,
      "lng": 8.68,
      "x": 0.524,
      "y": 0.653,
      "bandwidth": 2.45,
      "normalized_bandwidth": 0.0027,
      "label": "3 relays at location",
      "relays": [
        {
          "nickname": "TorRelay1",
          "fingerprint": "7EAAC4D0E1AC54E888C49F2F0C6BF5B2DDFB4C4A",
          "bandwidth": 0.85,
          "flags": "MGE",
          "ip": "203.0.113.42",
          "port": "9001"
        }
      ]
    }
  ],
  "bandwidth": 909.99,
  "minMax": { "min": 0.001, "max": 5.23 }
}
```

---

## countries-YYYY-MM-DD.json

Estimated Tor client counts by country.

```typescript
interface CountryData {
  date: string;             // Date (YYYY-MM-DD)
  totalUsers: number;       // Global estimated users
  countries: {
    [countryCode: string]: number;  // ISO 2-letter code → user count
  };
}
```

**Example:**
```json
{
  "date": "2025-12-07",
  "totalUsers": 3864305,
  "countries": {
    "US": 444507,
    "DE": 224891,
    "FR": 98234,
    "GB": 87654,
    "BR": 28975
  }
}
```

---

## Coordinate Systems

### Geographic (lat/lng)

Standard WGS84 coordinates used by mapping libraries.
- Latitude: -90 to +90 (negative = south)
- Longitude: -180 to +180 (negative = west)

### Normalized (x/y)

Web Mercator projection normalized to [0,1] range for WebGL shaders.
- x: 0 = -180°, 1 = +180°
- y: ~0 = -85°, ~1 = +85° (Mercator has latitude limits)

**Conversion formula:**
```typescript
function getNormalizedPosition(lat: number, lng: number) {
  const x = (lng + 180) / 360;
  const latRad = lat * (Math.PI / 180);
  const mercN = Math.log(Math.tan(Math.PI / 4 + latRad / 2));
  const y = 0.5 + mercN / (2 * Math.PI);
  return { x, y };
}
```

---

## Flag Codes

| Code | Meaning | Description |
|------|---------|-------------|
| M | Middle | Standard relay (included in circuits) |
| G | Guard | Entry node (first hop in circuit) |
| E | Exit | Exit node (final hop, connects to destination) |
| H | HSDir | Hidden Service Directory |

A relay can have multiple flags, e.g., "MGE" = Middle + Guard + Exit.

---

## Fingerprints

Relay fingerprints are SHA-1 hashes of the relay's identity key.

**Format:** 40 hexadecimal characters, uppercase
**Example:** `7EAAC4D0E1AC54E888C49F2F0C6BF5B2DDFB4C4A`

Used to link to detailed relay information:
```
{metricsUrl}/relay/{fingerprint}
```

---

## Bandwidth Normalization

Raw bandwidth from Onionoo is in bytes/second. We normalize it:

1. **Per-relay normalization:** `relay.bandwidth / max_relay_bandwidth`
2. **Per-location aggregation:** Sum of normalized relay bandwidths
3. **Network fraction:** `node.bandwidth / total_network_bandwidth`

This allows consistent visualization across different network states.

