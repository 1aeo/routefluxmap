# Feature: Simplified Country Boundaries

**Status:** Proposed  
**Priority:** Low  
**Complexity:** Low  

## Overview

Replace the detailed world countries GeoJSON (~14 MB) with a simplified version (~1-3 MB) to reduce memory usage by ~80%.

## Current State

| Metric | Value |
|--------|-------|
| GeoJSON size | ~14 MB |
| JS heap | ~15-20 MB |
| GPU memory | ~10-20 MB |
| **Total** | **~25-40 MB** |

## Proposed Solution

Use Natural Earth's simplified boundaries at 110m or 50m resolution:

| Resolution | File Size | Detail Level |
|------------|-----------|--------------|
| 110m (low) | ~500 KB | Good for zoom ≤5 |
| 50m (medium) | ~2 MB | Good for zoom ≤8 |
| 10m (current) | ~14 MB | Full detail |

## Source

```
https://github.com/nvkelso/natural-earth-vector/tree/master/geojson
```

Files:
- `ne_110m_admin_0_countries.geojson` - smallest
- `ne_50m_admin_0_countries.geojson` - balanced

## Implementation

1. Download simplified GeoJSON to `public/data/countries.geojson`
2. No code changes needed

## Expected Result

| Metric | Before | After (50m) |
|--------|--------|-------------|
| Total memory | ~30 MB | ~5-8 MB |
| Toggle lag | None* | None |

*Already fixed by keeping layer always loaded.

## Trade-offs

- Slightly less detailed coastlines at high zoom
- Not noticeable at typical usage zoom levels (2-6)

