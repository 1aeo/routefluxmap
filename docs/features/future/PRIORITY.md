# Feature Implementation Priority Guide

This document provides a recommended order for implementing remaining RouteFluxMap features, based on **impact vs effort** analysis.

---

## Priority Matrix

| Priority | Feature | Impact | Effort | Doc |
|:--------:|---------|:------:|:------:|-----|
| 🥇 1 | Map Location URL | High | Low | [Additional Controls](./additional-controls.md#1-map-location-url-persistence) |
| 🥈 2 | Country Outlier Chart | High | Medium | [Country Outlier](./country-outlier.md) |
| 🥉 3 | Country Date Histogram | High | Medium | [Country Date Histogram](./country-date-histogram.md) |
| 4 | Multi-Source Geolocation (Phase 1) | High | Low | [Multi-Source Geolocation](./multi-source-geolocation.md) |
| 5 | Legend Component | Medium | Low | [Additional Controls](./additional-controls.md#9-legend-component) |
| 6 | Social Sharing | Medium | Low | [Additional Controls](./additional-controls.md#8-social-sharing) |
| 7 | Multi-Source Geolocation (Phase 2-3) | Medium | Medium | [Multi-Source Geolocation](./multi-source-geolocation.md) |
| 8 | Bezier Path Curves | Medium | High | [Bezier Path Offset](./bezier-path-offset.md) |
| 9 | Node/Country Sliders | Low | Low | [Additional Controls](./additional-controls.md#2-node-count-slider) |
| 10 | Scaling Toggles | Low | Low | [Additional Controls](./additional-controls.md#4-scale-by-bandwidth-toggle-nodes) |
| 11 | Other Controls | Very Low | Low | [Additional Controls](./additional-controls.md) |

---

## Detailed Rationale

### 🥇 Priority 1: Map Location URL Persistence

**Document:** [Additional Controls → Map Location URL](./additional-controls.md#1-map-location-url-persistence)

**Why #1:**
- **Extremely low effort** - Just URL hash manipulation
- **High user value** - Users can bookmark and share specific views
- **Already partially done** - Date is already in URL hash, just add `&ML=lng,lat,zoom`
- **Zero visual changes** - No UI work needed
- **Foundation for other features** - Country deep-linking builds on this

**Implementation time:** ~1 hour

---

### 🥈 Priority 2: Country Outlier Chart

**Document:** [Country Outlier Chart](./country-outlier.md)

**Why #2:**
- **Highest analytical value** - Key feature for researchers
- **Data pipeline ready** - `calculateOutliers()` already exists in fetch scripts
- **Enables anomaly detection** - Identify censorship events, usage spikes
- **Completes country click** - Currently just logs to console

**Implementation time:** ~4-6 hours

**Dependencies:**
- Country history data fetching
- Country code 2↔3 letter mapping

---

### 🥉 Priority 3: Country Date Histogram

**Document:** [Country Date Histogram](./country-date-histogram.md)

**Why #3:**
- **Completes country analytics** - Natural companion to outlier chart
- **Shows trends over time** - Answers "how has usage changed?"
- **Reuses same data** - Same country history data as outliers
- **Modal integration** - Goes in same popup as outlier chart
- **Bucketing algorithm documented** - Clear implementation path

**Implementation time:** ~3-4 hours

**Dependencies:**
- Country Outlier Chart (shares modal)
- Bucketing utility

---

### Priority 4: Multi-Source Geolocation (Phase 1)

**Document:** [Multi-Source Geolocation](./multi-source-geolocation.md)

**Why #4:**
- **Zero additional cost** - Onionoo already provides country data we're discarding
- **Research value** - Detect discrepancies between sources
- **Foundation for future** - Enables toggle feature (Phase 2-3)
- **Transparency** - Users can see when sources disagree
- **AS info for free** - Includes hosting provider data

**Phase 1 includes:**
- Store Onionoo country, countryName, AS, asName per relay
- Derive MaxMind country from coordinates
- Calculate countryMismatch boolean
- Update data structures

**Implementation time:** ~2-4 hours

---

### Priority 5: Legend Component

**Document:** [Additional Controls → Legend](./additional-controls.md#9-legend-component)

**Why #5:**
- **Improves comprehension** - Users understand what colors mean
- **Low effort** - Simple gradient + labels
- **Professional polish** - Expected in data visualizations
- **Reusable** - Same component for bandwidth, connections, etc.

**Implementation time:** ~1-2 hours

---

### Priority 6: Social Sharing

**Document:** [Additional Controls → Social Sharing](./additional-controls.md#8-social-sharing)

**Why #6:**
- **Helps discoverability** - Users can share interesting findings
- **Low effort** - Just share URLs to social platforms
- **Works with Map URL** - Shares specific views (after #1)
- **Community building** - Privacy/Tor community engagement

**Implementation time:** ~1-2 hours

**Dependencies:**
- Map Location URL (#1) for meaningful shares

---

### Priority 7: Multi-Source Geolocation (Phase 2-3)

**Document:** [Multi-Source Geolocation](./multi-source-geolocation.md)

**Why #7:**
- **Full transparency** - Toggle between sources network-wide
- **Research capabilities** - Compare database accuracy
- **User choice** - Let users pick their preferred source
- **Popup enhancement** - Show all sources with discrepancy indicators

**Phase 2-3 includes:**
- Enhanced popup showing all geo sources
- Settings toggle to switch visualization source
- Re-aggregate nodes based on selected source
- Optional: Add IP2Location as second coordinate source

**Implementation time:** ~8-12 hours (both phases)

**Dependencies:**
- Multi-Source Geolocation Phase 1 (#4)

---

### Priority 8: Bezier Path Curves

**Document:** [Bezier Path Offset](./bezier-path-offset.md)

**Why #8:**
- **Visual polish** - Makes particle paths look like flight routes
- **Distinctive look** - Curved arcs are visually appealing
- **Higher complexity** - Requires shader work or CPU bezier math
- **Not blocking anything** - Straight lines work fine

**Implementation time:** ~6-10 hours

**Recommendation:** Start with CPU-based approximation (Option B in doc), upgrade to GPU shader later if performance allows.

---

### Priority 9: Node/Country Count Sliders

**Document:** [Additional Controls → Node Count](./additional-controls.md#2-node-count-slider), [Country Count](./additional-controls.md#3-country-count-slider)

**Why #9:**
- **Power user feature** - Most users won't adjust
- **Low effort** - Simple slider + filter
- **Performance tuning** - Useful for slow devices
- **Current defaults work** - Show all nodes is fine

**Implementation time:** ~2 hours for both

---

### Priority 10: Scaling Toggles

**Document:** [Additional Controls → Scaling Options](./additional-controls.md#4-scale-by-bandwidth-toggle-nodes)

**Why #10:**
- **Niche use cases** - Most users prefer default scaling
- **Low effort** - Just toggles
- **Current behavior is good** - Scaling enabled by default

Includes:
- Scale nodes by bandwidth toggle
- Scale particles by zoom toggle
- Scale particle count by bandwidth toggle

**Implementation time:** ~2 hours for all

---

### Priority 11: Other Controls

**Document:** [Additional Controls](./additional-controls.md)

**Why #11:**
- **Very niche features** - Rarely needed
- **Polish items** - Nice to have, not essential

Includes:
- Base map brightness slider
- Particle size slider (partially done)
- Summary/info modal
- Draggable modal dialogs

**Implementation time:** ~3-4 hours for all

---

## Quick Wins (< 4 hours each)

If you have limited time, these deliver the most value quickly:

1. ✅ **Map Location URL** - 1 hour, high impact
2. ✅ **Multi-Source Geo Phase 1** - 2-4 hours, stores data we already fetch
3. ✅ **Legend Component** - 1-2 hours, improves UX
4. ✅ **Social Sharing** - 1-2 hours, helps growth

---

## Medium Projects (half day)

1. 🔧 **Country Outlier Chart** - 4-6 hours, highest analytical value
2. 🔧 **Country Date Histogram** - 3-4 hours, completes country analytics

---

## Larger Projects (full day+)

1. 🏗️ **Bezier Path Curves** - 6-10 hours, visual signature feature

---

## Suggested Sprint Plan

### Sprint 1: Foundation (1 day)
- [ ] Map Location URL
- [ ] Multi-Source Geo Phase 1 (store Onionoo data)
- [ ] Legend Component  
- [ ] Social Sharing

### Sprint 2: Country Analytics (2 days)
- [ ] Country Outlier Chart
- [ ] Country Date Histogram
- [ ] Country code mapping utility

### Sprint 3: Geolocation Transparency (1-2 days)
- [ ] Multi-Source Geo Phase 2 (popup enhancement)
- [ ] Multi-Source Geo Phase 3 (settings toggle)

### Sprint 4: Polish (1-2 days)
- [ ] Bezier Path Curves
- [ ] Any remaining controls

---

## Feature Dependencies Graph

```
Map Location URL (#1)
    └── Social Sharing (#6) [shares meaningful URLs]
    └── Country URL linking [future enhancement]

Country Outlier Chart (#2)
    ├── Country history data [data pipeline]
    └── Country Date Histogram (#3) [shares modal]

Multi-Source Geo Phase 1 (#4)
    └── Multi-Source Geo Phase 2-3 (#7) [requires data in files]
        ├── Popup geo source display
        └── Settings source toggle

Bezier Paths (#8)
    └── (No dependencies)
```

---

## What NOT to Implement

These features were intentionally excluded:

| Feature | Reason |
|---------|--------|
| Traffic Type Toggle | User requested skip |
| MySQL Backend | Static site architecture |
| Docker Deployment | Cloudflare Pages hosting |
| Legacy Build Tools | Modern npm/Vite tooling |

---

## Current State Summary

**Already Implemented:**
- Core map visualization ✅
- Particle animation ✅
- Web Worker particle generation ✅
- Traffic path lines ✅
- Real country data ✅
- Date slider/histogram ✅
- Relay popup with Metrics links ✅
- Settings panel ✅
- Keyboard navigation ✅
- Layer controls ✅
- About page ✅
- Automated data pipeline ✅
- Loading bar ✅

**Remaining (by priority):**
1. Map URL (trivial)
2. Outlier Chart (medium)
3. Date Histogram (medium)
4. Multi-Source Geo Phase 1 (easy - store existing data)
5. Legend (easy)
6. Sharing (easy)
7. Multi-Source Geo Phase 2-3 (medium)
8. Bezier Paths (complex)
9-11. Various controls (easy)
