# Top 10 Code Optimizations for RouteFluxMap

## Overview
This report identifies optimization opportunities to reduce code complexity, improve performance, and enhance readability in the RouteFluxMap codebase.

---

## 1. **Consolidate Duplicate Date Formatting Functions**
**Impact:** High | **Complexity:** Low | **Effort:** Low

**Issue:** Date formatting functions (`formatDate`, `formatDateShort`) are duplicated across:
- `src/lib/utils/format.ts` (centralized)
- `src/components/ui/DateSlider.tsx` (duplicate)
- `src/components/ui/DateSliderChart.tsx` (duplicate)

**Solution:**
- Remove local implementations from DateSlider and DateSliderChart
- Import from `src/lib/utils/format.ts` instead
- Ensures consistent formatting and reduces maintenance burden

**Files to modify:**
- `src/components/ui/DateSlider.tsx` (lines 15-31)
- `src/components/ui/DateSliderChart.tsx` (lines 24-40)

**Benefits:**
- Single source of truth for date formatting
- Easier to maintain and update formatting logic
- Reduces bundle size slightly

---

## 2. **Optimize Probabilistic Node Selection with Binary Search**
**Impact:** High | **Complexity:** Medium | **Effort:** Medium

**Issue:** `getProbabilisticIndex()` uses linear search O(n) in:
- `src/lib/particles/particle-system.ts` (lines 84-92)
- `src/components/map/ParticleLayer.ts` (lines 207-215)

For large node arrays (500+ nodes), this is called thousands of times per frame, causing performance bottlenecks.

**Solution:**
- Pre-compute cumulative probability array once when nodes change
- Use binary search O(log n) for selection
- Cache the cumulative array in ParticleSystem state

**Example:**
```typescript
// Pre-compute once
private cumulativeProbs: number[] = [];

private buildCumulativeProbs() {
  let sum = 0;
  this.cumulativeProbs = this.nodes.map(n => {
    sum += n.normalized_bandwidth;
    return sum;
  });
}

// Binary search
private getProbabilisticIndex(): number {
  const rnd = Math.random() * this.cumulativeProbs[this.cumulativeProbs.length - 1];
  let left = 0, right = this.cumulativeProbs.length - 1;
  while (left < right) {
    const mid = Math.floor((left + right) / 2);
    if (this.cumulativeProbs[mid] < rnd) left = mid + 1;
    else right = mid;
  }
  return left;
}
```

**Benefits:**
- 10-100x faster for large node arrays
- Reduces CPU usage during particle animation
- Smoother frame rates

---

## 3. **Extract Complex Radius Calculation Logic**
**Impact:** Medium | **Complexity:** Medium | **Effort:** Low

**Issue:** The `getRadius` function in `TorMap.tsx` (lines 341-368) contains complex nested logic that's hard to read and test:
- Multiple zoom-based calculations
- Log scaling
- Bandwidth normalization
- Combined weighting factors

**Solution:**
- Extract to a separate utility function: `calculateNodeRadius(node, zoom, maxRelayCount, minMax)`
- Move to `src/lib/utils/geo.ts` or create `src/lib/utils/node-sizing.ts`
- Add unit tests for edge cases

**Benefits:**
- More readable TorMap component
- Testable in isolation
- Reusable if needed elsewhere

---

## 4. **Consolidate Country Centroid Data**
**Impact:** Medium | **Complexity:** Low | **Effort:** Low

**Issue:** Country centroids are duplicated in:
- `scripts/fetch-tor-data.ts` (lines 89-108)
- `src/lib/utils/geo.ts` (lines 99-118)

**Solution:**
- Keep single source in `src/lib/utils/geo.ts`
- Import in fetch script: `import { countryCentroids } from '../src/lib/utils/geo'`
- Or create shared data file: `src/lib/data/country-centroids.ts`

**Benefits:**
- Single source of truth
- Easier to update/maintain
- Reduces risk of inconsistencies

---

## 5. **Optimize Particle Path Aggregation**
**Impact:** Medium | **Complexity:** Medium | **Effort:** Medium

**Issue:** `getActivePaths()` in `particle-system.ts` (lines 173-201) creates string keys for every particle on every call:
- String concatenation: `${startLng.toFixed(4)},${startLat.toFixed(4)}|...`
- Map operations for 50,000+ particles
- Called every 30 frames (~0.5s)

**Solution:**
- Use numeric hash instead of string keys
- Cache path counts in a Map with numeric keys
- Only update paths that changed (incremental updates)

**Example:**
```typescript
// Use numeric hash
private hashPath(startLng: number, startLat: number, endLng: number, endLat: number): number {
  return Math.floor(startLng * 10000) * 1000000000 +
         Math.floor(startLat * 10000) * 1000000 +
         Math.floor(endLng * 10000) * 1000 +
         Math.floor(endLat * 10000);
}
```

**Benefits:**
- 5-10x faster path aggregation
- Lower memory allocation
- Smoother performance

---

## 6. **Extract URL Hash Parsing to Utility**
**Impact:** Low | **Complexity:** Low | **Effort:** Low

**Issue:** `parseUrlHash()` is defined locally in `TorMap.tsx` (lines 34-45) but could be reused.

**Solution:**
- Move to `src/lib/utils/format.ts` or create `src/lib/utils/url.ts`
- Export as `parseUrlHash()` and `updateUrlHash()`
- Use in DateSlider/DateSliderChart components

**Benefits:**
- Consistent URL handling
- Reusable across components
- Easier to test

---

## 7. **Reduce Particle System React State Updates**
**Impact:** High | **Complexity:** Low | **Effort:** Low

**Issue:** In `ParticleOverlay.tsx`, particle positions update every 2 frames (line 106), but the animation loop runs every frame. This causes:
- Unnecessary React re-renders
- Potential frame drops
- Higher CPU usage

**Solution:**
- Use refs for particle positions (already done)
- Only update React state when user-interactive elements need updates
- Consider using `requestAnimationFrame` directly in Deck.gl layer instead of React state

**Current:** Updates `tick` state every 2 frames
**Better:** Update only when layer visibility or settings change, let Deck.gl handle animation

**Benefits:**
- Fewer React re-renders
- Better performance
- Smoother animations

---

## 8. **Simplify Layer Creation with Factory Functions**
**Impact:** Medium | **Complexity:** Medium | **Effort:** Medium

**Issue:** The `baseLayers` useMemo in `TorMap.tsx` (lines 297-391) contains complex nested logic mixing:
- Country layer creation
- Relay layer configuration
- Zoom-based calculations
- Color logic

**Solution:**
- Extract layer creation to separate functions:
  - `createCountryLayer()` (already exists, but improve)
  - `createRelayLayer(nodes, zoom, visibility, handlers)`
- Move to `src/lib/layers/` directory
- Keep TorMap focused on composition

**Benefits:**
- More readable TorMap component
- Easier to test individual layers
- Better separation of concerns

---

## 9. **Memoize Expensive Calculations in TorMap**
**Impact:** Medium | **Complexity:** Low | **Effort:** Low

**Issue:** Several calculations in `TorMap.tsx` are recomputed on every render:
- `maxRelayCount` (line 316) - recalculated even when relayData hasn't changed
- Zoom scale calculations (line 321) - could be memoized
- Color calculations in getFillColor (lines 370-377)

**Solution:**
- Use `useMemo` for `maxRelayCount`
- Memoize zoom-based scale factors
- Consider pre-computing relay colors if they don't change

**Example:**
```typescript
const maxRelayCount = useMemo(() => 
  relayData ? Math.max(...relayData.nodes.map(n => n.relays.length), 1) : 1,
  [relayData]
);
```

**Benefits:**
- Fewer recalculations
- Better performance on zoom/pan
- Cleaner code

---

## 10. **Remove Mock Country Data Generation**
**Impact:** Low | **Complexity:** Low | **Effort:** Low

**Issue:** In `TorMap.tsx` (lines 169-195), mock country data is generated from relay locations using rough approximations. This is:
- Not accurate (just for demo)
- Adds unnecessary processing
- Should come from real Tor metrics API

**Solution:**
- Remove the mock generation code
- Add TODO comment pointing to real implementation
- Or fetch from metrics API if available
- Keep country layer disabled by default until real data is available

**Benefits:**
- Removes dead/complex code
- Clearer intent
- Better performance (no unnecessary processing)

---

## Implementation Priority

### Quick Wins (Do First)
1. Consolidate date formatting (#1)
2. Extract URL hash parsing (#6)
3. Remove mock country data (#10)
4. Consolidate country centroids (#4)

### High Impact (Do Next)
5. Optimize probabilistic selection (#2)
6. Reduce particle state updates (#7)
7. Optimize path aggregation (#5)

### Code Quality (Do When Refactoring)
8. Extract radius calculation (#3)
9. Simplify layer creation (#8)
10. Memoize expensive calculations (#9)

---

## Estimated Impact Summary

| Optimization | Performance Gain | Code Reduction | Readability |
|-------------|------------------|----------------|-------------|
| #1 Date formatting | Low | ~40 lines | High |
| #2 Binary search | High | ~10 lines | Medium |
| #3 Radius extraction | Low | 0 lines | High |
| #4 Country centroids | Low | ~100 lines | Medium |
| #5 Path aggregation | Medium | ~5 lines | Medium |
| #6 URL parsing | Low | ~10 lines | Medium |
| #7 State updates | High | ~5 lines | Medium |
| #8 Layer factories | Low | 0 lines | High |
| #9 Memoization | Medium | ~10 lines | Medium |
| #10 Mock data | Low | ~25 lines | High |

**Total estimated:**
- **Lines removed:** ~205
- **Performance improvement:** 20-50% for particle animations
- **Readability:** Significantly improved

---

## Notes

- All optimizations maintain existing functionality
- No breaking changes to public APIs
- Backward compatible with existing data formats
- Can be implemented incrementally
