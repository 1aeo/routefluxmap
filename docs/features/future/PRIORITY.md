# Feature Implementation Priority Guide

This document provides a recommended order for implementing remaining RouteFluxMap features, based on **impact vs effort** analysis.

**Last Updated:** December 2024

---

## ✅ Recently Implemented

The following features from this priority list have been completed:

| Feature | Status | Implementation |
|---------|:------:|----------------|
| Map Location URL | ✅ Done | `ML=lng,lat,zoom` and `CC=code` in URL hash via `url.ts` |
| Legend Component | ✅ Done | `MapLegend.tsx` with relay type colors |
| Keyboard Shortcuts | ✅ Done | `useHotkeys` hook + `KeyboardShortcutsHelp.tsx` modal |
| Relay Search | ✅ Done | `RelaySearch.tsx` with autocomplete + focus ring |
| Cinema Mode | ✅ Done | `H` key hides all UI for presentations |
| Adaptive Preloading | ✅ Done | LRU cache (12 dates) with playback-aware prefetching in `useRelays.ts` |
| WebGL Error Handling | ✅ Done | `useWebGL` hook + `WebGLError.tsx` component |
| Component Refactor | ✅ Done | 13 custom hooks, layer factories, clean separation |

---

## Priority Matrix (Remaining Features)

| Priority | Feature | Impact | Effort | Doc |
|:--------:|---------|:------:|:------:|-----|
| 🥇 1 | Country Analytics Modal | High | Medium | [Country Outlier](./country-outlier.md) + [Histogram](./country-date-histogram.md) |
| 🥈 2 | Bezier Path Curves | High | Medium | [Bezier Path Offset](./bezier-path-offset.md) |
| 🥉 3 | Social Sharing + Screenshot | Medium | Low | [Additional Controls](./additional-controls.md#8-social-sharing) |
| 4 | Multi-Source Geolocation | Medium | Medium | [Multi-Source Geolocation](./multi-source-geolocation.md) |
| 5 | Simplified Country Boundaries | Low | Low | [Simplified Boundaries](./simplified-country-boundaries.md) |

---

## Detailed Rationale

### 🥇 Priority 1: Country Analytics Modal

**Documents:** [Country Outlier Chart](./country-outlier.md) + [Country Date Histogram](./country-date-histogram.md)

**Why #1:**
- **Highest analytical value** - Key feature for researchers
- **Data pipeline ready** - Country data already fetched daily via `countries-YYYY-MM-DD.json`
- **Enables anomaly detection** - Identify censorship events, usage spikes
- **Completes country click** - Currently just centers the map and updates URL

**Current State:** Clicking a country centers the map and updates URL (`CC=code`). Need to add modal with:
- Timeline chart with clickable bars to navigate dates
- Outlier highlighting (highs/lows from statistical mean)
- Stats summary (mean, std dev, current value, % change)

**Implementation time:** ~4-6 hours

**Files to create:**
- `src/components/ui/CountryStatsModal.tsx`
- `src/lib/utils/outlier-stats.ts`

---

### 🥈 Priority 2: Bezier Path Curves

**Document:** [Bezier Path Offset](./bezier-path-offset.md)

**Why #2:**
- **Visual signature** - Makes particle paths look like flight routes
- **Distinctive look** - Curved arcs are visually appealing
- **Shader infrastructure ready** - Worker uses WebGL2 with custom shaders

**Current State:** Particle worker in `particle-render.worker.ts` uses straight-line interpolation:
```glsl
vec2 pos = mix(a_start, a_end, st);
```

**Recommended Implementation:** Modify vertex shader to use quadratic bezier:
```glsl
vec2 mid = (a_start + a_end) * 0.5;
vec2 dir = a_end - a_start;
vec2 perp = normalize(vec2(-dir.y, dir.x));
vec2 ctrl = mid + perp * length(dir) * u_curveOffset;
float t = st;
vec2 pos = (1.0-t)*(1.0-t)*a_start + 2.0*(1.0-t)*t*ctrl + t*t*a_end;
```

**Implementation time:** ~4-6 hours

---

### 🥉 Priority 3: Social Sharing + Screenshot

**Document:** [Additional Controls → Social Sharing](./additional-controls.md#8-social-sharing)

**Why #3:**
- **Low effort** - URL sharing already works via `ML`/`CC` params
- **Community building** - Privacy/Tor community engagement
- **Discoverability** - Users can share interesting findings

**Current State:** URLs work perfectly for sharing specific map views. Need to add:
- Share button UI with platform links (Twitter, Reddit, Mastodon)
- Screenshot export button (capture canvas as PNG)

**Implementation:**
```typescript
// Screenshot export
async function exportScreenshot() {
  const canvas = document.querySelector('canvas');
  const dataUrl = canvas?.toDataURL('image/png');
  // Download or copy to clipboard
}
```

**Implementation time:** ~2-3 hours

---

### Priority 4: Multi-Source Geolocation

**Document:** [Multi-Source Geolocation](./multi-source-geolocation.md)

**Why #4:**
- **Research value** - Detect discrepancies between geo databases
- **Transparency** - Users can see when sources disagree
- **AS info available** - Onionoo provides hosting provider data we currently discard

**Phases:**
1. Store Onionoo country + AS data in relay files
2. Show all sources in popup with mismatch indicators
3. Settings toggle to switch visualization source

**Implementation time:** ~8-12 hours (all phases)

---

### Priority 5: Simplified Country Boundaries

**Document:** [Simplified Boundaries](./simplified-country-boundaries.md)

**Why #5:**
- **Memory reduction** - 14MB → ~2MB GeoJSON
- **Low effort** - Just swap the file
- **Minimal visual impact** - Not noticeable at typical zoom levels (2-6)

**Implementation time:** ~30 minutes

---

## ✅ Already Implemented (Full List)

### Core Visualization
- Map with Deck.gl + MapLibre GL ✅
- Particle animation with Web Worker + OffscreenCanvas ✅
- Traffic path lines with bandwidth-proportional routing ✅
- Country choropleth layer ✅

### Data Management
- Unified data pipeline (Onionoo, Collector, Tor Metrics, MaxMind) ✅
- Adaptive preloading with LRU cache (12 dates) ✅
- Playback-aware prefetching (forward-biased during playback) ✅
- Staleness detection for date changes during fetch ✅

### UI Components
- Date slider with histogram sparkline ✅
- Relay popup with Tor Metrics links ✅
- Settings panel (density, opacity, speed, relay size, traffic filter) ✅
- Layer controls (relays, countries, particles) ✅
- Legend with relay type colors ✅
- Loading bar with status text ✅
- Update notification for new data ✅
- No data toast for empty dates ✅

### Navigation & Search
- **Relay search** by nickname/fingerprint with autocomplete ✅
- **Focus ring** highlight for search results ✅
- **Keyboard shortcuts** (full set): ✅
  - `←/→` Navigate dates
  - `Space` Play/pause
  - `Home/End` First/last date
  - `+/-` Zoom
  - `C/R/P` Toggle layers
  - `S` Settings panel
  - `H` Cinema mode
  - `?` Shortcuts help
  - `Esc` Close modals
- **Cinema mode** - hide all UI for presentations ✅
- **URL persistence** (date, map location, country code) ✅

### Architecture
- 13 custom React hooks extracted ✅
- Layer factories separated (`createRelayLayer`, `createFocusRingLayer`) ✅
- WebGL availability detection with error UI ✅
- Mobile responsive layout ✅
- Component tests (Vitest) ✅

---

## Suggested Sprint Plan

### Sprint 1: Country Analytics (1-2 days)
- [ ] Country Analytics Modal (outlier chart + histogram)
- [ ] Outlier stats utility

### Sprint 2: Visual Polish (1 day)
- [ ] Bezier Path Curves (shader modification)
- [ ] Screenshot Export

### Sprint 3: Sharing & Transparency (1 day)
- [ ] Social Sharing buttons
- [ ] Multi-Source Geo Phase 1 (store Onionoo data)

---

## Feature Dependencies Graph

```
Country Analytics Modal (#1)
    ├── Country data (already fetched daily)
    └── Outlier stats utility (new)

Bezier Paths (#2)
    └── Shader modification in particle-render.worker.ts

Social Sharing (#3)
    ├── URL persistence (already done)
    └── Screenshot Export (optional enhancement)

Multi-Source Geo (#4)
    └── Data pipeline changes in fetch-all-data.ts
```

---

## What NOT to Implement

These features were intentionally excluded:

| Feature | Reason |
|---------|--------|
| Node/Country Count Sliders | Density slider covers this use case |
| Scale by Bandwidth Toggle | Always on, better default behavior |
| Base Map Brightness | Low value, adds UI complexity |
| Draggable Modals | Not needed with current modal count |
| Traffic Type Toggle | Hidden service filter exists in settings |
| MySQL Backend | Static site architecture |
| Docker Deployment | Cloudflare Pages hosting |
