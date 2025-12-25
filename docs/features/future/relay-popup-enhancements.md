# Feature: Enhanced Relay Popup Information

**Status:** Proposed  
**Priority:** Medium  
**Complexity:** Low-Medium

## Overview

The relay popup currently shows minimal information. Onionoo provides many additional fields we could display to give users deeper insight into individual relays.

> **Important:** Most enhanced fields are only available for **current data** (via Onionoo API). Historical dates use Collector consensus files which contain minimal information.

---

## Data Source Comparison

We fetch relay data from two sources depending on the date:

| Source | Used For | Fields Available |
|--------|----------|------------------|
| **Onionoo API** | Today, yesterday | Full details (50+ fields) |
| **Collector** | Historical dates | Minimal (6 fields from consensus) |

### Fields from Collector (Historical)

Consensus files only contain:

| Field | Description | Available Historically? |
|-------|-------------|:----------------------:|
| `nickname` | Relay name | ✅ Yes |
| `fingerprint` | Unique ID (base64→hex) | ✅ Yes |
| `ip` | IPv4 address | ✅ Yes |
| `port` | OR port | ✅ Yes |
| `flags` | Running, Guard, Exit, HSDir | ✅ Yes |
| `bandwidth` | Consensus weight | ✅ Yes |

### Fields from Onionoo Only (Current)

All enhanced fields below are **only available for current/recent dates**:

| Field | Available Historically? |
|-------|:----------------------:|
| `as`, `as_name` | ❌ No |
| `version`, `platform` | ❌ No |
| `contact` | ❌ No |
| `first_seen`, `last_seen` | ❌ No |
| `measured`, `consensus_weight` | ❌ No |
| `effective_family` | ❌ No |
| `exit_policy_summary` | ❌ No |
| `overload_general_timestamp` | ❌ No |
| `host_name` | ❌ No |

### Implication for UI

When viewing historical dates, the relay popup should:
- Hide fields that aren't available
- Show a subtle indicator: "Limited info (historical data)"
- Only display: nickname, IP:port, flags, bandwidth, metrics link

---

## Current State

When clicking a relay node, the popup shows:

| Field | Source |
|-------|--------|
| Nickname | Onionoo |
| Coordinates | MaxMind GeoLite2-City |
| Country name | GeoJSON lookup |
| IP:Port | Onionoo `or_addresses` |
| Relay type | Derived from `flags` (Exit/Guard/Middle) |
| HSDir badge | Derived from `flags` |
| Network share % | Calculated from bandwidth |
| Metrics link | Generated from fingerprint |

---

## Available from Onionoo (Not Currently Used)

Onionoo's `/details` endpoint provides many fields we ignore:

### Network Identity

| Field | Description | Example |
|-------|-------------|---------|
| `as` | AS number | `"AS24940"` |
| `as_name` | AS organization | `"Hetzner Online GmbH"` |
| `host_name` | Reverse DNS (if available) | `"tor-exit.example.com"` |
| `contact` | Operator contact info | `"email@example.com"` |

### Relay Metadata

| Field | Description | Example |
|-------|-------------|---------|
| `platform` | OS and Tor version | `"Tor 0.4.8.10 on Linux"` |
| `version` | Tor version only | `"0.4.8.10"` |
| `first_seen` | First consensus appearance | `"2019-03-15 12:00:00"` |
| `last_seen` | Last consensus appearance | `"2024-12-14 08:00:00"` |
| `last_restarted` | Last restart time | `"2024-12-01 03:22:00"` |

### Performance & Health

| Field | Description | Example |
|-------|-------------|---------|
| `consensus_weight` | Weight in path selection | `42000` |
| `measured` | Bandwidth measured by authorities | `true` |
| `bandwidth_rate` | Self-reported rate limit (B/s) | `104857600` |
| `bandwidth_burst` | Self-reported burst limit (B/s) | `209715200` |
| `overload_general_timestamp` | When overload was reported | `"2024-12-10"` |

### Relay Relationships

| Field | Description | Example |
|-------|-------------|---------|
| `effective_family` | Verified mutual family members | `["$ABC...", "$DEF..."]` |
| `alleged_family` | Self-declared (unverified) family | `["$GHI..."]` |

### Exit Policy

| Field | Description | Example |
|-------|-------------|---------|
| `exit_policy_summary` | Summarized exit policy | `{"accept": ["80", "443"]}` |
| `exit_policy_v6_summary` | IPv6 exit policy | `{"reject": ["1-65535"]}` |

---

## Proposed Enhancements

### Tier 1: Quick Wins (Low Effort, High Value)

#### 1. AS Information

Show hosting provider info — useful for understanding network diversity. Link AS numbers to detailed AS analytics on metrics.1aeo.com.

```tsx
// In RelayPopup.tsx
{relay.as && (
  <div className="text-xs text-gray-500">
    <a
      href={`https://metrics.1aeo.com/AS/${relay.as.replace('AS', '')}`}
      target="_blank"
      rel="noopener noreferrer"
      className="text-tor-green hover:underline"
      title={`View all relays in ${relay.as}`}
    >
      {relay.as}
    </a>
    {relay.asName && <span className="text-gray-400"> — {relay.asName}</span>}
  </div>
)}
```

**Why link to metrics.1aeo.com/AS/?**
- Shows all relays hosted by this AS (network diversity analysis)
- Historical AS relay counts and bandwidth contribution
- Helps identify hosting concentration risks

**Data pipeline change:**
```typescript
// In OnionooRelay interface (scripts/fetch-all-data.ts)
interface OnionooRelay {
  // ... existing fields
  as?: string;      // e.g., "AS24940"
  as_name?: string; // e.g., "Hetzner Online GmbH"
}
```

#### 2. Tor Version

Show what version the relay is running.

```tsx
<span className="text-xs text-gray-600">
  Tor {relay.version}
</span>
```

#### 3. Uptime Indicator

Show how long the relay has been running.

```tsx
// Calculate from first_seen
const uptime = formatDuration(Date.now() - new Date(relay.first_seen).getTime());
// "Running for 2 years, 3 months"
```

---

### Tier 2: Moderate Value

#### 4. Contact Info (Sanitized)

Show operator contact if available (with privacy considerations).

```tsx
{relay.contact && (
  <div className="text-xs text-gray-500 truncate" title={relay.contact}>
    Operator: {sanitizeContact(relay.contact)}
  </div>
)}
```

**Note:** Contact info may contain email addresses — consider obfuscation.

#### 5. Exit Policy Summary

For exit relays, show what ports they allow.

```tsx
{isExit && relay.exit_policy_summary && (
  <div className="text-xs">
    <span className="text-green-400">Accepts:</span> 
    {relay.exit_policy_summary.accept?.slice(0, 5).join(', ')}
    {relay.exit_policy_summary.accept?.length > 5 && '...'}
  </div>
)}
```

#### 6. Health Indicators

Show if relay is measured, overloaded, etc.

```tsx
<div className="flex gap-1">
  {relay.measured && (
    <span className="text-xs text-green-400" title="Bandwidth measured by authorities">✓ Measured</span>
  )}
  {relay.overload_general_timestamp && (
    <span className="text-xs text-yellow-400" title="Relay reported overload">⚠ Overloaded</span>
  )}
</div>
```

---

### Tier 3: Advanced Features

#### 7. Family Visualization

Show related relays in the same family.

```tsx
{relay.effective_family?.length > 0 && (
  <div className="text-xs">
    <span className="text-purple-400">Family:</span> 
    {relay.effective_family.length} related relays
  </div>
)}
```

Future: Click to highlight family members on the map.

#### 8. Bandwidth Graph (Sparkline)

Fetch historical bandwidth from Onionoo's bandwidth endpoint and show a mini graph.

**Note:** Requires additional API call per relay — should be on-demand only.

---

## Data Pipeline Changes

### 1. Update OnionooRelay Interface

```typescript
interface OnionooRelay {
  nickname: string;
  fingerprint: string;
  or_addresses: string[];
  country?: string;
  flags?: string[];
  observed_bandwidth?: number;
  
  // New fields
  as?: string;
  as_name?: string;
  version?: string;
  platform?: string;
  contact?: string;
  first_seen?: string;
  last_seen?: string;
  last_restarted?: string;
  measured?: boolean;
  consensus_weight?: number;
  effective_family?: string[];
  exit_policy_summary?: {
    accept?: string[];
    reject?: string[];
  };
  overload_general_timestamp?: string;
}
```

### 2. Update RelayInfo Interface

```typescript
interface RelayInfo {
  nickname: string;
  fingerprint: string;
  bandwidth: number;
  flags: string;
  ip: string;
  port: string;
  
  // New optional fields
  as?: string;
  asName?: string;
  version?: string;
  contact?: string;
  firstSeen?: string;
  measured?: boolean;
  familySize?: number;
  exitPorts?: string[];
}
```

### 3. Data Size Considerations

Adding all fields increases JSON payload size significantly:

| Fields | Approx Size per Relay | Total (~8000 relays) |
|--------|----------------------|----------------------|
| Current | ~150 bytes | ~1.2 MB |
| + Tier 1 | ~200 bytes | ~1.6 MB |
| + Tier 2 | ~300 bytes | ~2.4 MB |
| + All | ~500 bytes | ~4 MB |

**Recommendation:** Implement Tier 1 fields only initially. Consider lazy-loading additional details on popup open.

---

## UI/UX Considerations

### Popup Size

Current max height is 380px. With more fields, consider:
- Collapsible sections
- Tabs (Overview / Technical / Network)
- "Show more" toggle

### Mobile

Popup is already constrained. Consider:
- Hiding less important fields on mobile
- Full-screen detail view on tap

### Performance

- Don't fetch additional data until popup opens
- Cache relay details client-side
- Consider IndexedDB for historical relay data

---

## Implementation Priority

| Enhancement | Priority | Effort | Value | Historical? |
|-------------|----------|--------|-------|:-----------:|
| AS info (`as`, `as_name`) | High | Low | High | ❌ |
| Tor version | High | Low | Medium | ❌ |
| Uptime (from `first_seen`) | Medium | Low | Medium | ❌ |
| Health indicators | Medium | Low | Medium | ❌ |
| Contact info | Low | Low | Low | ❌ |
| Exit policy | Low | Medium | Medium | ❌ |
| Family info | Low | Medium | Medium | ❌ |
| Bandwidth sparkline | Very Low | High | Medium | ❌ |

> **Note:** All enhancements are Onionoo-only. Historical dates will show basic info only.

---

## Files to Modify

- `scripts/fetch-all-data.ts` — Add new fields to Onionoo interface and processing
- `src/lib/types.ts` — Update `RelayInfo` type
- `src/components/ui/RelayPopup.tsx` — Display new fields
- `src/lib/utils/format.ts` — Add formatters for new data types

---

## Implementation Guide: AS Information

Detailed step-by-step for implementing AS information (Tier 1 enhancement).

### Step 1: Update Data Fetching (`scripts/fetch-all-data.ts`)

**1a. Add fields to OnionooRelay interface (~line 93):**

```typescript
interface OnionooRelay {
  nickname: string;
  fingerprint: string;
  or_addresses: string[];
  country?: string;
  flags?: string[];
  observed_bandwidth?: number;
  as?: string;       // ADD: e.g., "AS24940"
  as_name?: string;  // ADD: e.g., "Hetzner Online GmbH"
}
```

**1b. Extract AS fields in processOnionooRelays (~line 557):**

```typescript
aggregated.get(key)!.relays.push({
  nickname: relay.nickname || 'Unnamed',
  fingerprint: normalizeFingerprint(relay.fingerprint),
  bandwidth: (relay.observed_bandwidth || 0) / maxBw,
  flags: mapFlags(relay.flags),
  ip: addr.ip,
  port: addr.port,
  as: relay.as,           // ADD
  asName: relay.as_name,  // ADD
});
```

### Step 2: Update Type Definitions (`src/lib/types.ts`)

**Add optional AS fields to RelayInfo (~line 6):**

```typescript
export interface RelayInfo {
  nickname: string;
  fingerprint: string;
  bandwidth: number;
  flags: string;
  ip: string;
  port: string;
  as?: string;      // ADD: AS number (e.g., "AS24940")
  asName?: string;  // ADD: AS organization name
}
```

### Step 3: Update Config for AS Metrics URL (`src/lib/config.ts`)

**Add AS metrics URL helper:**

```typescript
// Add near getRelayMetricsUrl function
export function getASMetricsUrl(as: string): string {
  // Strip "AS" prefix if present for URL
  const asNumber = as.replace(/^AS/i, '');
  return `https://metrics.1aeo.com/AS/${asNumber}`;
}
```

### Step 4: Update Relay Popup (`src/components/ui/RelayPopup.tsx`)

**4a. Import the new helper:**

```typescript
import { config, getRelayMetricsUrl, getASMetricsUrl } from '../../lib/config';
```

**4b. Add AS display in the relay item (~after line 144, inside the relay map):**

```tsx
<div className="ml-6 space-y-1">
  <div className="text-xs text-gray-500 font-mono">{relay.ip}:{relay.port}</div>
  
  {/* ADD: AS Information with link */}
  {relay.as && (
    <div className="text-xs">
      <a
        href={getASMetricsUrl(relay.as)}
        target="_blank"
        rel="noopener noreferrer"
        className="text-tor-green hover:underline"
        title={`View all relays in ${relay.as}`}
      >
        {relay.as}
      </a>
      {relay.asName && <span className="text-gray-500"> — {relay.asName}</span>}
    </div>
  )}
  
  <a
    href={getRelayMetricsUrl(relay.fingerprint)}
    // ... existing metrics link
```

### Step 5: Handle Historical Data Gracefully

AS information is only available from Onionoo (current/recent dates), not from Collector (historical). The UI should gracefully hide the AS row when data isn't available:

```tsx
{/* AS info - only shows when available (Onionoo data) */}
{relay.as && (
  // ... AS display component
)}
```

No special handling needed — the conditional render already handles missing data.

### Data Flow Summary

```
Onionoo API ──► fetch-all-data.ts ──► relays-YYYY-MM-DD.json ──► RelayPopup.tsx
    │                  │                        │                      │
    │ as: "AS24940"    │ Extract & store        │ as: "AS24940"        │ Display with
    │ as_name: "..."   │ in RelayInfo           │ asName: "..."        │ link to metrics
```

### Testing Checklist

- [ ] Current date shows AS info with clickable link
- [ ] Historical date hides AS row (no errors)
- [ ] AS link opens metrics.1aeo.com/AS/{number} correctly
- [ ] AS number without "AS" prefix works in URL
- [ ] Long AS names truncate properly
- [ ] Mobile layout handles AS row

---

## References

- Onionoo Protocol: https://metrics.torproject.org/onionoo.html
- Onionoo Details Doc: https://onionoo.torproject.org/details
- AS Metrics (1aeo): https://metrics.1aeo.com/AS/{number} — Detailed AS relay analytics
- Current RelayPopup: `src/components/ui/RelayPopup.tsx`
