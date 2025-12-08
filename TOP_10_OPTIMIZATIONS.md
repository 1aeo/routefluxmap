# Top 10 Code Base Optimizations for RouteFluxMap

**Generated:** December 8, 2025  
**Analysis Scope:** main branch codebase, docs/features/future, optimization branches

---

## Executive Summary

After reviewing the current codebase in `main`, the future feature documentation, and the three optimization branches, here are the top 10 recommended optimizations prioritized by **impact vs effort**.

### Priority Matrix

| # | Optimization | Impact | Effort | Type |
|---|-------------|--------|--------|------|
| 1 | Binary Search for Node Selection | **High** | Medium | Performance |
| 2 | Map Location URL Persistence | **High** | Low | Feature/UX |
| 3 | Consolidate Duplicate Date Formatting | Medium | **Low** | Code Quality |
| 4 | Reduce Particle Layer React Re-renders | **High** | **Low** | Performance |
| 5 | Web Worker for Particle Generation | Medium | Medium | Performance |
| 6 | Memoize TorMap Expensive Calculations | Medium | **Low** | Performance |
| 7 | Legend Component | Medium | **Low** | UX |
| 8 | Country Outlier Chart | **High** | Medium | Feature |
| 9 | Bezier Curve Particle Paths | Medium | High | Visual Polish |
| 10 | Share Button / Social Sharing | Medium | **Low** | Growth |

---

## 1. Binary Search for Probabilistic Node Selection

**Impact:** High | **Effort:** Medium | **Category:** Performance

### Problem

The `getProbabilisticIndex()` method in `particle-system.ts` uses **O(n) linear search** to select nodes based on bandwidth probability. With 500+ nodes and 50,000+ particles being created/reset, this is called thousands of times per second.

### Current Implementation

```typescript:83:95:src/lib/particles/particle-system.ts
  private getProbabilisticIndex(): number {
    let rnd = Math.random();
    let i = 0;
    while (i < this.nodes.length && rnd > this.nodes[i].normalized_bandwidth) {
      rnd -= this.nodes[i].normalized_bandwidth;
      i++;
    }
    return Math.min(i, this.nodes.length - 1);
  }
```

### Optimized Solution (from Gemini branch)

```typescript
// Pre-compute cumulative probabilities once
private cumulativeProbs: number[] = [];

private buildCumulativeProbs(): void {
  let sum = 0;
  this.cumulativeProbs = this.nodes.map(n => {
    sum += n.normalized_bandwidth;
    return sum;
  });
}

// O(log n) binary search
private getProbabilisticIndex(): number {
  if (this.cumulativeProbs.length === 0) return 0;
  
  const total = this.cumulativeProbs[this.cumulativeProbs.length - 1];
  const rnd = Math.random() * total;
  
  let left = 0, right = this.cumulativeProbs.length - 1;
  while (left < right) {
    const mid = Math.floor((left + right) / 2);
    if (this.cumulativeProbs[mid] < rnd) left = mid + 1;
    else right = mid;
  }
  return Math.min(left, this.nodes.length - 1);
}
```

### Expected Benefit
- **10-100x faster** node selection for large node arrays
- Smoother particle animations, especially on lower-end devices
- Noticeable improvement when 500+ nodes are displayed

### Files to Modify
- `src/lib/particles/particle-system.ts`

---

## 2. Map Location URL Persistence

**Impact:** High | **Effort:** Low | **Category:** Feature/UX

### Problem

Users cannot bookmark or share specific map views. The URL only contains the date, not the map position (center coordinates and zoom level).

### Solution

Persist map location in URL hash, following TorFlow's pattern:

```
https://routefluxmap.com/#date=2024-12-01&ML=-40.5,30.2,4
```

### Implementation

Already have URL utilities in `src/lib/utils/url.ts`. Just need to:

1. Add `onViewStateChange` handler to update URL
2. Parse `ML` parameter on initial load
3. Debounce URL updates during map pan/zoom

```typescript
// In TorMap.tsx
const handleViewStateChange = useCallback(({ viewState }) => {
  setViewState(viewState);
  
  // Debounced URL update
  const { longitude, latitude, zoom } = viewState;
  updateUrlHash('ML', `${longitude.toFixed(2)},${latitude.toFixed(2)},${zoom.toFixed(1)}`);
}, []);

// On mount, parse ML from URL
useEffect(() => {
  const params = parseUrlHash();
  if (params.ML) {
    const [lng, lat, zoom] = params.ML.split(',').map(parseFloat);
    if (!isNaN(lng) && !isNaN(lat) && !isNaN(zoom)) {
      setViewState(prev => ({ ...prev, longitude: lng, latitude: lat, zoom }));
    }
  }
}, []);
```

### Expected Benefit
- Users can bookmark specific views
- Shareable links to interesting locations
- Foundation for country deep-linking

### Files to Modify
- `src/components/map/TorMap.tsx`
- `src/lib/utils/url.ts` (add debounce helper)

---

## 3. Consolidate Duplicate Date Formatting

**Impact:** Medium | **Effort:** Low | **Category:** Code Quality

### Problem

Date formatting functions are duplicated between:
- `src/lib/utils/format.ts` (centralized)
- `src/components/ui/DateSliderChart.tsx` (lines 54-85)

### Current State

```typescript:54:85:src/components/ui/DateSliderChart.tsx
// Format date for display
function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

// Format month for display
function formatMonth(monthKey: string): string {
  const [year, month] = monthKey.split('-');
  const date = new Date(parseInt(year), parseInt(month) - 1, 1);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    year: 'numeric',
  });
}
// ... more duplicated functions
```

### Solution

1. Remove local implementations from `DateSliderChart.tsx`
2. Import from `src/lib/utils/format.ts`
3. Add any missing format functions to the centralized file

```typescript
// In DateSliderChart.tsx
import { formatDate, formatDateShort, formatMonth, formatYear } from '../../lib/utils/format';
```

### Expected Benefit
- Single source of truth for date formatting
- ~30 fewer lines of duplicate code
- Easier maintenance and consistent formatting

### Files to Modify
- `src/components/ui/DateSliderChart.tsx`
- `src/lib/utils/format.ts` (add `formatMonth`, `formatYear`)

---

## 4. Reduce Particle Layer React Re-renders

**Impact:** High | **Effort:** Low | **Category:** Performance

### Problem

In `ParticleOverlay.tsx`, the `tick` state updates every 2 frames to trigger React re-renders. This causes unnecessary component reconciliation when only particle positions change.

### Current Implementation

```typescript:166:186:src/components/map/ParticleOverlay.tsx
    const animate = (currentTime: number) => {
      // ...
      frameCount++;
      
      // Only trigger React update every UPDATE_INTERVAL frames
      if (frameCount % UPDATE_INTERVAL === 0) {
        setTick(t => t + 1);  // Causes React re-render
      }
      // ...
    };
```

### Optimized Solution

1. Increase `UPDATE_INTERVAL` from 2 to 3-4 frames (still smooth at 60fps)
2. Use `requestAnimationFrame` directly for deck.gl layer updates
3. Memoize filtered positions more aggressively

```typescript
// Increase update interval
const UPDATE_INTERVAL = 3; // Every 3 frames = 20 updates/sec, still smooth

// Or better: use Deck.gl's animation system
// by using `extensions: [DataFilterExtension]` or custom shaders
```

### Expected Benefit
- 33-50% fewer React reconciliations
- Lower CPU usage during animation
- Smoother performance on mobile

### Files to Modify
- `src/components/map/ParticleOverlay.tsx`

---

## 5. Web Worker for Particle Generation

**Impact:** Medium | **Effort:** Medium | **Category:** Performance

### Problem

Particle initialization runs on the main thread, causing UI freeze of 100-500ms with 50,000+ particles. This blocks user interaction during initial load and date changes.

### Reference

Detailed implementation plan exists in:

```37:37:docs/features/future/particle-web-worker.md
...
```

### Solution Summary

1. Create `src/lib/particles/particle-worker.ts`
2. Generate particles off main thread
3. Transfer ArrayBuffer back (zero-copy)
4. Show loading progress bar

### Expected Benefit
- Smooth initial load (no UI freeze)
- Progress feedback (0-100%)
- Better UX on slower devices

### Files to Create/Modify
- `src/lib/particles/particle-worker.ts` (new)
- `src/lib/particles/use-particle-worker.ts` (new)
- `src/components/map/ParticleOverlay.tsx`
- `src/components/ui/LoadingBar.tsx` (new)

---

## 6. Memoize TorMap Expensive Calculations

**Impact:** Medium | **Effort:** Low | **Category:** Performance

### Problem

Several calculations in `TorMap.tsx` are recomputed on every render:
- `maxRelayCount` - recalculated even when `relayData` hasn't changed
- Zoom scale calculations in layer props

### Current Code

```typescript:377:379:src/components/map/TorMap.tsx
      const maxRelayCount = Math.max(...relayData.nodes.map(n => n.relays.length), 1);
      const maxBandwidth = relayData.minMax.max;
```

### Solution

```typescript
const maxRelayCount = useMemo(() => 
  relayData ? Math.max(...relayData.nodes.map(n => n.relays.length), 1) : 1,
  [relayData]
);

const maxBandwidth = useMemo(() => 
  relayData?.minMax.max ?? 0,
  [relayData]
);

const { zoomScale, baseMinPixels, baseMaxPixels } = useMemo(() => ({
  zoomScale: calculateZoomScale(viewState.zoom),
  ...getZoomPixelConstraints(viewState.zoom),
}), [viewState.zoom]);
```

### Expected Benefit
- Fewer recalculations during pan/zoom
- Lower CPU usage
- More responsive UI

### Files to Modify
- `src/components/map/TorMap.tsx`

---

## 7. Legend Component

**Impact:** Medium | **Effort:** Low | **Category:** UX

### Problem

No visual legend explains what the colors represent. Users don't immediately understand:
- What green vs orange particles mean
- What node colors indicate (Exit/Guard/Middle)
- What the country choropleth colors mean

### Solution

Create a collapsible legend component:

```tsx
// src/components/ui/Legend.tsx
interface LegendProps {
  label: string;
  colorRamp: [string, string];
  min?: string;
  max?: string;
}

function Legend({ label, colorRamp, min, max }: LegendProps) {
  return (
    <div className="text-xs">
      <div className="text-gray-400 mb-1">{label}</div>
      <div 
        className="h-2 rounded"
        style={{
          background: `linear-gradient(to right, ${colorRamp[0]}, ${colorRamp[1]})`
        }}
      />
      <div className="flex justify-between text-gray-500 mt-0.5">
        <span>{min || 'Low'}</span>
        <span>{max || 'High'}</span>
      </div>
    </div>
  );
}
```

### Reference

See:

```339:392:docs/features/future/additional-controls.md
...
```

### Expected Benefit
- Improved comprehension for new users
- Professional polish
- Better accessibility

### Files to Create
- `src/components/ui/Legend.tsx`

---

## 8. Country Outlier Chart

**Impact:** High | **Effort:** Medium | **Category:** Feature

### Problem

Country click currently just logs to console:

```typescript:336:338:src/components/map/TorMap.tsx
  const handleCountryClick = useCallback((code: string, name: string) => {
    console.log(`Country clicked: ${name} (${code})`);
    // TODO: Show country statistics popup
  }, []);
```

This is TorFlow's most valuable analytical feature - identifying anomalous days (censorship events, mass adoption, etc.).

### Reference

Detailed implementation plan:

```1:359:docs/features/future/country-outlier.md
...
```

### Solution Summary

1. Create `OutlierChart.tsx` modal component
2. Fetch country history data
3. Calculate outliers (top N high, average, bottom N low)
4. Render D3-style bar chart
5. Click bars to navigate to that date

### Expected Benefit
- Major analytical value for researchers
- Identify censorship events
- Complete the country interaction story

### Files to Create
- `src/components/ui/OutlierChart.tsx`
- `src/components/ui/OutlierBarChart.tsx`
- `src/lib/utils/outliers.ts`
- `scripts/fetch-country-history.ts`

---

## 9. Bezier Curve Particle Paths

**Impact:** Medium | **Effort:** High | **Category:** Visual Polish

### Problem

Particles travel in straight lines on the Mercator projection. TorFlow uses curved Bezier paths that arc over the globe like flight paths - this is a distinctive visual signature.

### Reference

Detailed implementation plan:

```1:446:docs/features/future/bezier-path-offset.md
...
```

### Recommendation

**Phase 1:** CPU-based Bezier approximation (easier, works with existing Deck.gl layers)
**Phase 2:** GPU shader implementation (better performance)

### Expected Benefit
- Visual signature feature
- More realistic "network flow" appearance
- Matches TorFlow original aesthetic

### Files to Modify
- `src/lib/particles/particle-system.ts`
- `src/lib/particles/bezier-path.ts` (new)
- `src/components/map/TorMap.tsx` (add offset slider)

---

## 10. Share Button / Social Sharing

**Impact:** Medium | **Effort:** Low | **Category:** Growth

### Problem

No easy way to share the visualization on social media. This limits organic discovery by the privacy/Tor research community.

### Solution

Add share button with native share URLs:

```tsx
// src/components/ui/ShareButton.tsx
function ShareButton() {
  const shareUrl = encodeURIComponent(window.location.href);
  const shareTitle = encodeURIComponent('Check out this Tor Network visualization!');
  
  const platforms = [
    { name: 'Twitter', url: `https://twitter.com/intent/tweet?url=${shareUrl}&text=${shareTitle}` },
    { name: 'Reddit', url: `https://reddit.com/submit?url=${shareUrl}&title=${shareTitle}` },
    { name: 'LinkedIn', url: `https://www.linkedin.com/sharing/share-offsite/?url=${shareUrl}` },
  ];
  
  return (
    <div className="relative">
      <button onClick={() => setShowMenu(!showMenu)}>
        <ShareIcon />
      </button>
      {showMenu && (
        <div className="absolute ...">
          {platforms.map(p => (
            <a key={p.name} href={p.url} target="_blank" rel="noopener">
              {p.name}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
```

### Dependencies
- **Requires #2 (Map Location URL)** for meaningful shares

### Expected Benefit
- Increased discoverability
- Community engagement
- Shareable anomaly findings

### Files to Create
- `src/components/ui/ShareButton.tsx`

---

## Implementation Roadmap

### Sprint 1: Quick Wins (1-2 days)
- [ ] **#2** Map Location URL Persistence
- [ ] **#3** Consolidate Date Formatting
- [ ] **#4** Reduce React Re-renders
- [ ] **#6** Memoize Calculations
- [ ] **#7** Legend Component

### Sprint 2: Performance (2-3 days)
- [ ] **#1** Binary Search Node Selection
- [ ] **#5** Web Worker for Particles

### Sprint 3: Features (3-5 days)
- [ ] **#8** Country Outlier Chart
- [ ] **#10** Share Button

### Sprint 4: Polish (3-5 days)
- [ ] **#9** Bezier Curve Paths

---

## What's Already Optimized (No Action Needed)

The following optimizations from the branches are **already implemented** in main:

✅ **URL hash parsing** - Extracted to `src/lib/utils/url.ts`  
✅ **Node radius calculation** - Extracted to `src/lib/utils/node-sizing.ts` with tests  
✅ **Particle position caching** - `positionCache` array reuse in `particle-system.ts`  
✅ **Numeric path hashing** - `hashPath()` method using numeric keys instead of strings  
✅ **Country centroids** - Centralized in `src/lib/utils/geo.ts`  
✅ **Unit tests** - Tests exist for `node-sizing`, `format`, `geo`, `url`, `config`  

---

## Notes

- All optimizations maintain backward compatibility
- No breaking changes to data formats or APIs
- Can be implemented incrementally
- Performance improvements estimated from branch analysis and TorFlow reference

---

## Sources

1. **Gemini Branch Optimization Report:**  
   `origin/cursor/optimize-torflow-astro-code-gemini-3-pro-preview-6ba1:OPTIMIZATION_REPORT.md`

2. **Claude Opus Branch:**  
   `origin/cursor/optimize-torflow-astro-code-claude-4.5-opus-high-thinking-4402`

3. **Claude Sonnet Branch:**  
   `origin/cursor/optimize-torflow-astro-code-claude-4.5-sonnet-thinking-ae9e`

4. **Future Feature Documentation:**  
   `docs/features/future/PRIORITY.md` and related docs

