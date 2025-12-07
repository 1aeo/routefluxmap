# Feature Implementation Priority Guide

This document provides a recommended order for implementing remaining TorFlow features in RouteFluxMap, based on **impact vs effort** analysis.

---

## Priority Matrix

| Priority | Feature | Impact | Effort | Doc |
|:--------:|---------|:------:|:------:|-----|
| 🥇 1 | Map Location URL | High | Low | [Additional Controls](./additional-controls.md#1-map-location-url-persistence) |
| 🥈 2 | Country Outlier Chart | High | Medium | [Country Outlier](./country-outlier.md) |
| 🥉 3 | Country Date Histogram | High | Medium | [Country Date Histogram](./country-date-histogram.md) |
| 4 | Legend Component | Medium | Low | [Additional Controls](./additional-controls.md#9-legend-component) |
| 5 | Social Sharing | Medium | Low | [Additional Controls](./additional-controls.md#8-social-sharing) |
| 6 | Bezier Path Curves | Medium | High | [Bezier Path Offset](./bezier-path-offset.md) |
| 7 | Web Worker | Low | Medium | [Particle Web Worker](./particle-web-worker.md) |
| 8 | Node/Country Sliders | Low | Low | [Additional Controls](./additional-controls.md#2-node-count-slider) |
| 9 | Scaling Toggles | Low | Low | [Additional Controls](./additional-controls.md#4-scale-by-bandwidth-toggle-nodes) |
| 10 | Other Controls | Very Low | Low | [Additional Controls](./additional-controls.md) |

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
- **Highest analytical value** - TorFlow's killer feature for researchers
- **Data pipeline ready** - `calculateOutliers()` already exists in fetch scripts
- **Enables anomaly detection** - Identify censorship events, usage spikes
- **Clear TorFlow reference** - Well-documented existing implementation
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

### Priority 4: Legend Component

**Document:** [Additional Controls → Legend](./additional-controls.md#9-legend-component)

**Why #4:**
- **Improves comprehension** - Users understand what colors mean
- **Low effort** - Simple gradient + labels
- **Professional polish** - Expected in data visualizations
- **Reusable** - Same component for bandwidth, connections, etc.

**Implementation time:** ~1-2 hours

---

### Priority 5: Social Sharing

**Document:** [Additional Controls → Social Sharing](./additional-controls.md#8-social-sharing)

**Why #5:**
- **Helps discoverability** - Users can share interesting findings
- **Low effort** - Just share URLs to social platforms
- **Works with Map URL** - Shares specific views (after #1)
- **Community building** - Privacy/Tor community engagement

**Implementation time:** ~1-2 hours

**Dependencies:**
- Map Location URL (#1) for meaningful shares

---

### Priority 6: Bezier Path Curves

**Document:** [Bezier Path Offset](./bezier-path-offset.md)

**Why #6:**
- **Visual polish** - Makes particle paths look like flight routes
- **TorFlow signature look** - The curved arcs are distinctive
- **Higher complexity** - Requires shader work or CPU bezier math
- **Not blocking anything** - Straight lines work fine

**Implementation time:** ~6-10 hours

**Recommendation:** Start with CPU-based approximation (Option B in doc), upgrade to GPU shader later if performance allows.

---

### Priority 7: Web Worker for Particles

**Document:** [Particle Web Worker](./particle-web-worker.md)

**Why #7:**
- **Performance optimization** - Prevents UI freeze during init
- **Current system works** - Only noticeable with 400K+ particles
- **Medium complexity** - Worker communication, ArrayBuffer transfer
- **Nice to have** - Not blocking any user workflows

**Implementation time:** ~3-4 hours

**When to prioritize higher:**
- If users complain about initial load stutter
- If targeting lower-end devices
- If increasing default particle count

---

### Priority 8: Node/Country Count Sliders

**Document:** [Additional Controls → Node Count](./additional-controls.md#2-node-count-slider), [Country Count](./additional-controls.md#3-country-count-slider)

**Why #8:**
- **Power user feature** - Most users won't adjust
- **Low effort** - Simple slider + filter
- **Performance tuning** - Useful for slow devices
- **Current defaults work** - Show all nodes is fine

**Implementation time:** ~2 hours for both

---

### Priority 9: Scaling Toggles

**Document:** [Additional Controls → Scaling Options](./additional-controls.md#4-scale-by-bandwidth-toggle-nodes)

**Why #9:**
- **Niche use cases** - Most users prefer default scaling
- **Low effort** - Just toggles
- **Current behavior is good** - Scaling enabled by default

Includes:
- Scale nodes by bandwidth toggle
- Scale particles by zoom toggle
- Scale particle count by bandwidth toggle

**Implementation time:** ~2 hours for all

---

### Priority 10: Other Controls

**Document:** [Additional Controls](./additional-controls.md)

**Why #10:**
- **Very niche features** - Rarely used in TorFlow
- **Polish items** - Nice to have, not essential

Includes:
- Base map brightness slider
- Particle size slider (partially done)
- Summary/info modal
- Draggable modal dialogs

**Implementation time:** ~3-4 hours for all

---

## Quick Wins (< 2 hours each)

If you have limited time, these deliver the most value quickly:

1. ✅ **Map Location URL** - 1 hour, high impact
2. ✅ **Legend Component** - 1-2 hours, improves UX
3. ✅ **Social Sharing** - 1-2 hours, helps growth

---

## Medium Projects (half day)

1. 🔧 **Country Outlier Chart** - 4-6 hours, highest analytical value
2. 🔧 **Country Date Histogram** - 3-4 hours, completes country analytics
3. 🔧 **Web Worker** - 3-4 hours, performance boost

---

## Larger Projects (full day+)

1. 🏗️ **Bezier Path Curves** - 6-10 hours, visual signature feature

---

## Suggested Sprint Plan

### Sprint 1: Foundation (1 day)
- [ ] Map Location URL
- [ ] Legend Component  
- [ ] Social Sharing

### Sprint 2: Country Analytics (2 days)
- [ ] Country Outlier Chart
- [ ] Country Date Histogram
- [ ] Country code mapping utility

### Sprint 3: Polish (1-2 days)
- [ ] Bezier Path Curves
- [ ] Web Worker (if needed)

### Sprint 4: Power User (1 day)
- [ ] Node/Country count sliders
- [ ] Scaling toggles
- [ ] Remaining controls

---

## Feature Dependencies Graph

```
Map Location URL (#1)
    └── Social Sharing (#5) [shares meaningful URLs]
    └── Country URL linking [future enhancement]

Country Outlier Chart (#2)
    ├── Country history data [data pipeline]
    └── Country Date Histogram (#3) [shares modal]

Bezier Paths (#6)
    └── Web Worker (#7) [if generating curve params]
```

---

## What NOT to Implement

These TorFlow features were intentionally excluded:

| Feature | Reason |
|---------|--------|
| Traffic Type Toggle | User requested skip |
| MySQL Backend | Static site architecture |
| Docker Deployment | Cloudflare Pages hosting |
| Bower/Gulp Build | Modern npm/Vite tooling |
| jsSocials Library | Native share URLs instead |

---

## Current State Summary

**Already Implemented:**
- Core map visualization ✅
- Particle animation ✅
- Traffic path lines ✅
- Real country data ✅
- Date slider/histogram ✅
- Relay popup with Metrics links ✅
- Settings panel ✅
- Keyboard navigation ✅
- Layer controls ✅
- About page ✅
- Automated data pipeline ✅

**Remaining (by priority):**
1. Map URL (trivial)
2. Outlier Chart (medium)
3. Date Histogram (medium)
4. Legend (easy)
5. Sharing (easy)
6. Bezier Paths (complex)
7. Web Worker (medium)
8-10. Various controls (easy)

