# Multi-Source Geolocation

## Problem Statement

Different geolocation sources report different locations for the same relay IP address. This can happen because:

- Databases use different data sources and methodologies
- Some databases update more frequently than others
- IP block assignments change over time
- VPNs/proxies may be detected differently
- Some databases are more accurate for certain regions

Currently, RouteFluxMap uses MaxMind GeoLite2 as the sole coordinate source, falling back to country centroids when MaxMind fails. This means:

1. Users can't see when sources disagree
2. Users can't choose their preferred source
3. Onionoo's country data (which we already fetch) is discarded

## Proposed Solution

Combine two approaches for maximum transparency and usability:

### Option A: Global Source Toggle

Add a settings panel control to switch the entire network visualization between geolocation sources.

```
┌─────────────────────────────────────────┐
│ ⚙️ Geolocation Source                   │
│ ┌─────────────────────────────────────┐ │
│ │ MaxMind GeoLite2              ▼     │ │
│ └─────────────────────────────────────┘ │
│ ℹ️ 847 relays have conflicting locations │
└─────────────────────────────────────────┘
```

Available sources:
- **MaxMind GeoLite2** (default) - lat/lng coordinates
- **IP2Location Lite** - lat/lng coordinates (future)
- **Onionoo Country** - country centroid coordinates
- *(Future: ipinfo.io, DB-IP, etc.)*

When source changes, nodes re-aggregate based on the selected source's coordinates.

### Option B: Popup Discrepancy Display

Show all available location sources in the relay popup, highlighting the selected source and any discrepancies.

```
┌─────────────────────────────────────────┐
│ TorRelay1                          [↗]  │
│ Frankfurt, Germany                      │
│ Bandwidth: 45.2 MB/s  │  Flags: MGE     │
├─────────────────────────────────────────┤
│ 📍 Locations by Source                  │
│                                         │
│ ● MaxMind      50.110, 8.682  DE        │
│ ○ IP2Location  50.092, 8.651  DE        │
│ ○ Onionoo      [country only]  DE       │
│                                         │
│ ✓ All sources agree: Germany            │
└─────────────────────────────────────────┘
```

When sources disagree:

```
┌─────────────────────────────────────────┐
│ SuspiciousRelay                    [↗]  │
│ Amsterdam, Netherlands                  │
│ Bandwidth: 12.1 MB/s  │  Flags: MG      │
├─────────────────────────────────────────┤
│ 📍 Locations by Source                  │
│                                         │
│ ● MaxMind      52.370, 4.895  NL        │
│ ○ IP2Location  51.441, 5.470  NL        │
│ ○ Onionoo      [country only]  DE    ⚠️ │
│                                         │
│ ⚠️ Country mismatch: MaxMind/IP2L → NL, │
│    Onionoo → DE                         │
└─────────────────────────────────────────┘
```

---

## Data Architecture

### Current State

Onionoo provides country data that we're **not storing**:

```typescript
// Onionoo API response (already fetched)
interface OnionooRelay {
  nickname: string;
  fingerprint: string;
  or_addresses: string[];
  country?: string;        // "de" - NOT STORED
  country_name?: string;   // "Germany" - NOT STORED
  as?: string;             // "AS3209" - NOT STORED
  as_name?: string;        // "Vodafone GmbH" - NOT STORED
  // ...
}

// Current output (missing country data)
interface RelayInfo {
  nickname: string;
  fingerprint: string;
  bandwidth: number;
  flags: string;
  ip: string;
  port: string;
  // No location data stored per relay!
}
```

### Proposed Data Structure

Store granular location data from all available sources:

```typescript
interface GeoLocation {
  lat: number;
  lng: number;
  country?: string;        // ISO 2-letter code
  city?: string;
  region?: string;
  accuracy?: number;       // Radius in km (if provided)
  confidence?: number;     // 0-100 score (if provided)
}

interface RelayInfo {
  nickname: string;
  fingerprint: string;
  bandwidth: number;
  flags: string;
  ip: string;
  port: string;
  
  // NEW: Multi-source geolocation
  geo: {
    // Coordinate-based sources (most granular)
    maxmind?: GeoLocation;
    ip2location?: GeoLocation;
    // Future: ipinfo, dbip, etc.
    
    // Country-only sources
    onionoo: {
      country: string;       // "DE" - always available
      countryName: string;   // "Germany"
      as?: string;           // "AS3209"
      asName?: string;       // "Vodafone GmbH"
    };
    
    // Computed fields
    primarySource: 'maxmind' | 'ip2location' | 'onionoo';
    countryMismatch?: boolean;
    maxDiscrepancyKm?: number;
  };
}
```

### Aggregated Node Changes

```typescript
interface AggregatedNode {
  // Primary location (based on user-selected source)
  lat: number;
  lng: number;
  x: number;
  y: number;
  bandwidth: number;
  selectionWeight: number;
  label: string;
  relays: RelayInfo[];
  
  // NEW: Discrepancy stats for this cluster
  discrepancy?: {
    maxKm: number;              // Largest coordinate disagreement
    countryMismatchCount: number;  // Relays where countries disagree
    sourceCoverage: {           // Which sources have data
      maxmind: number;
      ip2location: number;
      onionoo: number;
    };
  };
}
```

### File-Level Metadata

```typescript
interface ProcessedRelayData {
  version: string;
  generatedAt: string;
  source: 'onionoo' | 'collector';
  
  // NEW: Track all geolocation sources used
  geoSources: {
    maxmind?: {
      provider: 'maxmind';
      database: 'GeoLite2-City';
      buildDate: string;
    };
    ip2location?: {
      provider: 'ip2location';
      database: 'IP2LOCATION-LITE-DB11';
      buildDate: string;
    };
    onionoo: {
      provider: 'onionoo';
      // Always available from API
    };
  };
  
  // Aggregate discrepancy stats
  discrepancyStats: {
    totalRelays: number;
    countryMismatches: number;
    avgDiscrepancyKm: number;
    maxDiscrepancyKm: number;
  };
  
  published: string;
  nodes: AggregatedNode[];
  bandwidth: number;
  relayCount: number;
  geolocatedCount: number;
  minMax: { min: number; max: number };
}
```

---

## Available Data Sources

### Comparison Criteria

When evaluating IP geolocation providers for RouteFluxMap's use case, we consider:

| Criteria | Description | Target |
|----------|-------------|--------|
| **Cost** | Free tiers or low-cost plans | ~8k lookups/day (≈2.9M/year, ~58M over 20 years) |
| **Accuracy** | Quality of location data | City-level preferred; country-level acceptable |
| **Offline Support** | Downloadable databases for self-hosting | Essential for historical batch processing |
| **Scalability** | Handle large volumes without performance issues | 58M+ lookups over project lifetime |

### Currently Available (No Additional Setup)

| Source | Data Available | Granularity | Update Freq |
|--------|---------------|-------------|-------------|
| **MaxMind GeoLite2** | lat, lng, country, city, region | Coordinates | Weekly |
| **Onionoo API** | country, country_name, as, as_name | Country only | Real-time |

---

### Top 10 IP Geolocation Providers (Ranked for RouteFluxMap)

#### 1. MaxMind GeoIP – Industry Standard, Free Database Option ⭐ CURRENT

**Cost**: 
- GeoLite2: **Free** (unlimited queries via local DB)
- GeoIP2 Precision API: ~$20/month for basic volumes
- Enterprise: Contact sales

**Accuracy**:
- Country: ~95-99%
- City: ~55-80% (GeoLite2), ~85-90% (GeoIP2 paid)
- Updated daily (paid) or weekly (free)

**Offline Support**: ✅ **Yes** – Downloadable MMDB databases, covers >99.99% of IPs

**Scalability**: ⭐⭐⭐⭐⭐ Excellent – Locally hosted databases scale to virtually any volume with no API fees

**RouteFluxMap Status**: Currently integrated. Ideal for cost-effective, large-scale offline use.

---

#### 2. DB-IP – Best Free Alternative for Cross-Validation ⭐ RECOMMENDED NEXT

**Cost**:
- DB-IP Lite: **Free** (monthly updates, requires attribution)
- Premium: ~€200-1,800/year depending on data depth

**Accuracy**:
- Country: High (~98%)
- City: Moderate (free) to Good (paid) – ~70-75%
- Premium version updated daily

**Offline Support**: ✅ **Yes** – CSV and MMDB formats (same format as MaxMind!)

**Scalability**: ⭐⭐⭐⭐⭐ Excellent – Unlimited local lookups, same library compatibility as MaxMind

**Why Recommended**: Uses identical MMDB format as MaxMind, requiring minimal code changes. No registration required for lite version. Provides different data source for cross-validation.

**Download URLs**:
- City Lite: `https://download.db-ip.com/free/dbip-city-lite-YYYY-MM.mmdb.gz`
- Country Lite: `https://download.db-ip.com/free/dbip-country-lite-YYYY-MM.mmdb.gz`

---

#### 3. IP2Location – Comprehensive Data, Rich Field Coverage

**Cost**:
- IP2Location LITE: **Free** (monthly updates)
- API: Free tier ~50k requests/month
- Paid: $49/month for 150k queries (~$3.26 per 10k lookups)
- Full enterprise packages: up to ~$30k/year for all data

**Accuracy**:
- Country: 99.5%+
- City: ~75-80% (premium)
- Includes detailed fields: latitude/longitude, ISP, domain, weather station info
- Note: Updates can be slow – some IP changes take months to reflect

**Offline Support**: ✅ **Yes** – BIN/CSV formats (requires different library than MaxMind)

**Scalability**: ⭐⭐⭐⭐⭐ Excellent – Self-hosted DB handles unlimited queries

**Trade-off**: Different file format (BIN) requires `ip2location` library instead of `maxminddb`.

---

#### 4. IPinfo – Highest Accuracy (Premium Cost)

**Cost**:
- IPinfo Lite: **Free unlimited** (country-level only)
- Full city data: ~$99-499/month for 150k+ lookups
- Enterprise: Up to $2,000/month

**Accuracy**: ⭐⭐⭐⭐⭐ **Industry-leading**
- Daily-updated proprietary probe network
- Very precise city and ZIP code data
- Includes ISP, ASN, carrier info, VPN detection

**Offline Support**: ✅ **Yes** – Full dataset downloads on paid plans (updated daily)

**Scalability**: ⭐⭐⭐⭐⭐ Unlimited via offline data; API handles high volume at higher cost

**Best For**: Applications where maximum accuracy is critical (fraud detection, content personalization). Cost-prohibitive for this project unless funded.

---

#### 5. IPLocate – Balanced Accuracy, Generous Free Tier

**Cost**:
- Free: 1,000 requests/day (no card required)
- Paid: $49/month for 300k queries, up to $249/month for 2M queries
- ~$1.25 per 10k lookups at higher tiers

**Accuracy**: ⭐⭐⭐⭐ High
- Proprietary algorithms, daily-updated data
- Precise city-level data with "confidence area" estimates
- Comparable to MaxMind and IPinfo

**Offline Support**: ✅ **Yes** – Free IP-to-Country database (daily updates), commercial city-level DB available

**Scalability**: ⭐⭐⭐⭐⭐ Unlimited via DB; API on globally distributed infrastructure

---

#### 6. IPGeolocation.io – Developer-Friendly, Large Free Tier

**Cost**:
- Free: 30,000 requests/month (~1,000/day)
- Paid: $15/month for 150k, up to $500/month for 20M queries

**Accuracy**: ⭐⭐⭐⭐ Good
- City-level with extras (timezone, currency, ASN)
- Updated daily
- Some issues with cloud hosting IP identification

**Offline Support**: ⚠️ **Yes (Enterprise)** – Local DB available on request for enterprise clients

**Scalability**: ⭐⭐⭐⭐⭐ Up to 20M/month on standard plans; offline option for more

---

#### 7. IPStack (Apilayer) – Reliable Enterprise API

**Cost**:
- Free: 1,000 requests/month (testing only)
- Paid: $11.99/month for 50k, up to $79.99/month for 2M queries
- Slightly more expensive at scale than competitors

**Accuracy**: ⭐⭐⭐⭐ Very reliable
- Trusted by large enterprises
- IPv4/IPv6 support
- City accuracy: ~50-80%

**Offline Support**: ❌ **No** – Cloud API only, no downloadable database

**Scalability**: ⭐⭐⭐⭐ Good via API – Scales to millions, but requires internet connectivity

---

#### 8. IP-API – Best Value for High-Volume API

**Cost**:
- Free: 45 requests/minute (~64k/day) – non-commercial only
- Paid: **$15/month for unlimited requests** (flat rate!)

**Accuracy**: ⭐⭐⭐ Moderate
- Good city accuracy for basics
- Fewer data fields than premium providers
- Country: ~98%, City: ~50-80%

**Offline Support**: ❌ **No** – API service only

**Scalability**: ⭐⭐⭐⭐⭐ Excellent – Unlimited queries at flat rate, <50ms response times

**Best For**: Budget-conscious scenarios needing massive scale via API (not offline).

---

#### 9. BigDataCloud – Advanced Accuracy Technology

**Cost**:
- Free: 10,000 requests/month
- Paid: $29.95/month for 100k queries (~$3 per 10k)
- Enterprise: Hundreds to thousands per month

**Accuracy**: ⭐⭐⭐⭐⭐ Very High
- Patented "Next Generation IP Geolocation" technology
- Daily-updated via globally distributed network
- Provides "confidence area" radius for location estimates
- Publishes daily accuracy comparison reports

**Offline Support**: ❌ **No** – Proprietary cloud service, no public DB downloads

**Scalability**: ⭐⭐⭐⭐ Very good as cloud service; no offline option

---

#### 10. IPData (ipdata.co) – Security-Focused

**Cost**:
- Free: 1,500 requests/day (non-commercial)
- Paid: $10/month for ~75k, up to $120/month for 3M lookups

**Accuracy**: ⭐⭐⭐⭐ Reliable
- Standard geolocation fields plus threat intelligence data
- Time zone, currency, security threat flags included
- Regular updates

**Offline Support**: ❌ **No** – API only, no downloadable databases

**Scalability**: ⭐⭐⭐⭐ Up to 100k/day on standard plans; enterprise options available

---

### Enterprise-Grade Providers (Cost No Object)

For maximum accuracy when budget is unlimited:

| Provider | City Accuracy | Annual Cost | Notes |
|----------|---------------|-------------|-------|
| **Digital Element (NetAcuity)** | ~95% | $10,000-50,000+ | Industry gold standard. Used by Google, Facebook, major ad networks. |
| **Neustar IP GeoPoint** | ~93-97% | Enterprise $$$ | Strong in fraud prevention, part of TransUnion |
| **IPinfo (Full)** | ~90-95% | ~$6,000-12,000 | Best modern option with excellent API |

**Digital Element** is generally considered the most accurate provider globally, combining ISP partnerships, WiFi positioning, user-verified data, and proprietary algorithms.

---

### Summary Comparison Table

| Provider | Cost (@ ~8k/day) | Accuracy | Offline | Scalability | Format |
|----------|------------------|----------|---------|-------------|--------|
| **MaxMind GeoLite2** ⭐ | Free | ~99% country, ~70% city | ✅ Yes | ⭐⭐⭐⭐⭐ | MMDB |
| **DB-IP Lite** ⭐ | Free | ~98% country, ~70% city | ✅ Yes | ⭐⭐⭐⭐⭐ | MMDB |
| **IP2Location LITE** | Free | ~99.5% country, ~75% city | ✅ Yes | ⭐⭐⭐⭐⭐ | BIN |
| **IPinfo** | $99-499/mo | ~99% country, ~90% city | ✅ Yes (paid) | ⭐⭐⭐⭐⭐ | MMDB |
| **IPLocate** | $25-249/mo | Very high | ✅ Yes | ⭐⭐⭐⭐⭐ | Custom |
| **IPGeolocation** | Free 30k/mo | Good | ⚠️ Enterprise | ⭐⭐⭐⭐⭐ | - |
| **IPStack** | $12-80/mo | High | ❌ No | ⭐⭐⭐⭐ | - |
| **IP-API** | $15/mo unlimited | Moderate | ❌ No | ⭐⭐⭐⭐⭐ | - |
| **BigDataCloud** | $30/mo (100k) | Very high | ❌ No | ⭐⭐⭐⭐ | - |
| **IPData** | $10-120/mo | High | ❌ No | ⭐⭐⭐⭐ | - |

---

### Integration Priority Recommendation

Based on RouteFluxMap's requirements (20 years × 8k relays/day = ~58M lookups, offline processing, cost-sensitive):

#### Phase 1: Store Onionoo Country Data ✅ (Zero Cost)
- Already fetching this data from the API
- Provides country-level cross-validation with MaxMind
- **Effort**: 2-4 hours

#### Phase 2: Add DB-IP Lite ⭐ RECOMMENDED
- **Why DB-IP over IP2Location?**
  - Same MMDB format as MaxMind (uses identical `maxminddb` library)
  - No registration required
  - No attribution required for visualization (only for redistribution)
  - Different underlying data source for meaningful cross-validation
- **Integration approach**:
  ```typescript
  // Same API as MaxMind - minimal code changes
  import { open } from 'maxminddb';
  const dbipReader = await open('dbip-city-lite.mmdb');
  const result = dbipReader.get(ip);
  ```
- **Effort**: 4-6 hours

#### Phase 3: Consider IP2Location Lite (Optional)
- Adds a third independent data source
- Requires new library (`ip2location-nodejs`)
- Slightly higher accuracy than DB-IP
- **Effort**: 6-8 hours

#### Phase 4: API Sources for Validation (Future)
- IPinfo Lite for country-level validation (free, unlimited)
- Only consider paid APIs if funded for research purposes

---

### Volume Calculation

```
20 years × 365 days × 8,000 relays = 58,400,000 lookups total

With offline database (MaxMind/DB-IP):
- Lookup speed: ~50,000-100,000 lookups/second
- Total processing time: ~10-20 minutes for entire dataset
- Cost: $0
```

---

### Quick Integration Code (DB-IP)

```typescript
// Since DB-IP uses MMDB format, integration is trivial
import { Reader } from 'maxminddb';

interface GeoResult {
  maxmind?: GeoLocation;
  dbip?: GeoLocation;
}

async function lookupIP(ip: string): Promise<GeoResult> {
  const [maxmindResult, dbipResult] = await Promise.all([
    maxmindReader.get(ip),
    dbipReader.get(ip),  // Same API!
  ]);
  
  return {
    maxmind: maxmindResult ? parseMaxMind(maxmindResult) : undefined,
    dbip: dbipResult ? parseDbip(dbipResult) : undefined,
  };
}
```

---

## Implementation Plan

### Phase 1: Store Existing Data (Low Effort)

**Goal**: Store Onionoo country data we're already fetching

**Changes**:
1. Update `RelayInfo` interface to include `onionooCountry`, `onionooCountryName`, `as`, `asName`
2. Modify fetch script to store these fields
3. Derive `maxmindCountry` from coordinates
4. Calculate `countryMismatch` boolean

**Files to modify**:
- `scripts/fetch-all-data.ts` - Store country data
- `src/lib/types.ts` - Update interfaces

**Estimated effort**: 2-4 hours

### Phase 2: Popup Enhancement (Medium Effort)

**Goal**: Show all sources in relay popup with discrepancy indicators

**Changes**:
1. Update `RelayPopup.tsx` to display geo sources
2. Add visual indicator for mismatches
3. Show country flags for each source

**Files to modify**:
- `src/components/ui/RelayPopup.tsx`

**Estimated effort**: 4-6 hours

### Phase 3: Settings Toggle (Medium Effort)

**Goal**: Add global source selector in settings panel

**Changes**:
1. Add `geoSource` to `LayerSettings` in types
2. Add dropdown to `SettingsPanel.tsx`
3. Re-aggregate nodes when source changes (runtime)
4. Store preference in URL state

**Files to modify**:
- `src/lib/types.ts` - Add setting
- `src/components/map/SettingsPanel.tsx` - Add UI
- `src/components/map/TorMap.tsx` - Handle re-aggregation
- `src/lib/utils/url.ts` - Persist preference

**Estimated effort**: 6-8 hours

### Phase 4: Add IP2Location (Optional)

**Goal**: Add second coordinate source for comparison

**Changes**:
1. Download and integrate IP2Location Lite database
2. Add lookup in fetch script
3. Store coordinates in `geo.ip2location`
4. Update discrepancy calculations

**Files to modify**:
- `scripts/fetch-all-data.ts`
- `package.json` (add ip2location dependency)
- `docs/setup/` (add setup instructions)

**Estimated effort**: 4-6 hours

### Phase 5: Visual Map Indicators (Optional)

**Goal**: Show discrepancies directly on map

**Changes**:
1. Add subtle visual indicator for relays with mismatches
2. Add aggregate stats to settings panel
3. Optional: filter to show only mismatched relays

**Estimated effort**: 4-6 hours

---

## File Size Impact

Rough estimates for storing additional geo data:

| Configuration | Per Relay | 8,000 relays | Notes |
|---------------|-----------|--------------|-------|
| Current | ~200 bytes | ~1.6 MB | No per-relay geo |
| +Onionoo country | +40 bytes | +320 KB | country, as, asName |
| +MaxMind full | +60 bytes | +480 KB | lat, lng, country, city |
| +IP2Location | +60 bytes | +480 KB | lat, lng, country, city |
| **Total (all sources)** | ~360 bytes | ~2.9 MB | ~80% increase |

Acceptable tradeoff for transparency and research value.

---

## UI Mockups

### Settings Panel Addition

```
┌─────────────────────────────────────────────────────────────┐
│ ⚙️ Settings                                           [×]   │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│ 📍 Geolocation Source                                       │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ MaxMind GeoLite2                                    ▼   │ │
│ └─────────────────────────────────────────────────────────┘ │
│   ├─ MaxMind GeoLite2 (coordinates)          ← default      │
│   ├─ IP2Location Lite (coordinates)                         │
│   └─ Onionoo Country (country centroids)                    │
│                                                             │
│ ℹ️ 847 of 8,234 relays have location discrepancies          │
│                                                             │
│ ─────────────────────────────────────────────────────────── │
│                                                             │
│ 🎚️ Display Options                                          │
│ ...existing settings...                                     │
└─────────────────────────────────────────────────────────────┘
```

### Enhanced Relay Popup

```
┌─────────────────────────────────────────────────────────────┐
│ TorRelay1                                              [↗]  │
│ Frankfurt, Germany                                          │
├─────────────────────────────────────────────────────────────┤
│ Bandwidth    45.2 MB/s        Flags    M G E                │
│ IP           203.0.113.42     Port     9001                 │
│ AS           AS3209           Vodafone GmbH                 │
├─────────────────────────────────────────────────────────────┤
│ 📍 Location Sources                                         │
│                                                             │
│ ● MaxMind       50.1100, 8.6820   🇩🇪 DE  Frankfurt        │
│ ○ IP2Location   50.0920, 8.6510   🇩🇪 DE  Frankfurt        │
│ ○ Onionoo       [country only]    🇩🇪 DE                   │
│                                                             │
│ ✓ All sources agree: Germany (DE)                           │
│ △ Coordinate variance: 2.3 km                               │
└─────────────────────────────────────────────────────────────┘
```

With mismatch:

```
┌─────────────────────────────────────────────────────────────┐
│ SuspiciousRelay                                        [↗]  │
│ Amsterdam, Netherlands                                      │
├─────────────────────────────────────────────────────────────┤
│ ...                                                         │
├─────────────────────────────────────────────────────────────┤
│ 📍 Location Sources                                         │
│                                                             │
│ ● MaxMind       52.3700, 4.8950   🇳🇱 NL  Amsterdam        │
│ ○ IP2Location   51.4410, 5.4700   🇳🇱 NL  Eindhoven        │
│ ○ Onionoo       [country only]    🇩🇪 DE              ⚠️   │
│                                                             │
│ ⚠️ Country mismatch detected                                │
│    MaxMind/IP2Location → Netherlands (NL)                   │
│    Onionoo self-report → Germany (DE)                       │
│                                                             │
│ △ Coordinate variance: 103.4 km                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Research Value

This feature enables several research use cases:

1. **Database Accuracy Comparison**: Which geolocation source is most accurate for Tor relays?
2. **VPN/Proxy Detection**: Relays where Onionoo country differs may be using VPNs
3. **Network Topology Analysis**: Are relays concentrated differently by source?
4. **Temporal Analysis**: Do discrepancies correlate with IP reassignments?
5. **Regional Accuracy**: Which sources are best for specific regions?

---

## References

### Primary Sources (Offline Databases)
- [MaxMind GeoLite2](https://dev.maxmind.com/geoip/geolite2-free-geolocation-data) – Current provider
- [DB-IP Lite](https://db-ip.com/db/lite.php) – Recommended second source (MMDB format)
- [IP2Location Lite](https://lite.ip2location.com/) – Alternative with BIN format

### API Providers
- [IPinfo](https://ipinfo.io/) – Industry-leading accuracy, free country-level tier
- [IPLocate](https://www.iplocate.io/) – Balanced accuracy and pricing
- [IPGeolocation.io](https://ipgeolocation.io/) – Large free tier (30k/month)
- [IPStack](https://ipstack.com/) – Enterprise-ready API
- [IP-API](https://ip-api.com/) – Best value ($15/mo unlimited)
- [BigDataCloud](https://www.bigdatacloud.com/) – Advanced accuracy technology
- [IPData](https://ipdata.co/) – Security/threat intelligence focus

### Enterprise Providers
- [Digital Element (NetAcuity)](https://www.digitalelement.com/) – Gold standard accuracy
- [Neustar IP GeoPoint](https://www.home.neustar/resources/product-literature/ip-geopoint) – Fraud prevention focus

### Tor Network
- [Onionoo API Docs](https://metrics.torproject.org/onionoo.html) – Tor relay metadata

### Accuracy Studies
- [IP Geolocation Accuracy Comparison](https://www.bigdatacloud.com/insights/ip-geolocation-accuracy) – BigDataCloud daily reports
- [MaxMind GeoIP2 Accuracy](https://www.maxmind.com/en/geoip2-city-accuracy-comparison) – Official accuracy stats

---

## Decision Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2024-12-14 | Combine Option A (toggle) + Option B (popup) | Best of both: global control + per-relay detail |
| 2024-12-14 | Store most granular data available | Onionoo gives country, MaxMind gives coords - keep both |
| 2024-12-14 | Phase 1 priority: Onionoo country | Already fetching it, zero additional cost |
| 2024-12-14 | Include AS info from Onionoo | Useful for identifying hosting providers |
| 2024-12-14 | Comprehensive provider analysis | Evaluated top 10 providers on cost, accuracy, offline support, scalability |
| 2024-12-14 | DB-IP Lite as second source | Same MMDB format as MaxMind = minimal integration effort, different data source for cross-validation |
| 2024-12-14 | Deprioritize API-only providers | Offline databases essential for 58M+ historical lookups at zero marginal cost |
| 2024-12-14 | Digital Element identified as accuracy leader | If funding available, enterprise option for maximum accuracy (~95% city) |
