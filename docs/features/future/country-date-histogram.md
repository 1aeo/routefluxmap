# Feature: Per-Country Date Histogram

**Status:** Proposed  
**Priority:** Medium  
**Complexity:** Medium

## Overview

The DateHistogram component shows **client connection trends over time** for a selected country. While the OutlierChart highlights anomalies, this histogram provides the full picture of how Tor usage in a country has evolved.

## Use Cases

- **Long-term trend analysis** - Is Tor usage growing or declining in a region?
- **Event correlation** - How did specific events affect usage?
- **Seasonal patterns** - Are there recurring patterns (holidays, elections)?
- **Policy impact** - How do censorship policies affect usage over months/years?
- **Comparative analysis** - Understanding baseline before looking at outliers

## Visual Design

### Chart Characteristics

- **Bucketed data**: Groups dates into buckets (adaptive merging based on value similarity)
- **Y-axis**: Uses `sqrt` scale for better visual distribution of large values
- **X-axis**: Shows evenly-spaced date labels with binned ranges
- **Color gradient**: Based on connection count (low → high)
- **Active date highlighting**: Current global date has special styling
- **Hover tooltips**: Show date range and average count for bucket
- **Click navigation**: Clicking a bar navigates the main date slider

### Chart Title Format

```
"Guard Client Connections by Date (USA)"
```

### Axis Labels

- Y-axis: "Connections"
- X-axis: "Dates (Binned)"

### Chart Layout

```
Guard Client Connections by Date (USA)

Connections
   ▲
   │                          ▓▓▓▓
   │              ▓▓▓▓  ▓▓▓▓  ▓▓▓▓  ▓▓▓▓
   │  ▓▓▓▓  ▓▓▓▓  ▓▓▓▓  ▓▓▓▓  ▓▓▓▓  ▓▓▓▓  ▓▓▓▓
   │  ▓▓▓▓  ▓▓▓▓  ▓▓▓▓  ▓▓▓▓  ▓▓▓▓  ▓▓▓▓  ▓▓▓▓  ▓▓▓▓
   │  ▓▓▓▓  ▓▓▓▓  ▓▓▓▓  ▓▓▓▓  ▓▓▓▓  ▓▓▓▓  ▓▓▓▓  ▓▓▓▓
   └───────────────────────────────────────────────────►
      Jan     Feb     Mar     Apr     May     Jun     Jul
      2024    2024    2024    2024    2024    2024    2024
      
                        Dates (Binned)
```

### Hover Tooltip

```
┌─────────────────────────────────┐
│ Date Range: Jan 1 - Jan 15     │
│ Avg Count: 445,000             │
└─────────────────────────────────┘
```

### Color Scheme

Gradient from low to high counts (green theme):

```typescript
// Dark green → Bright green
const colorRamp = ['#004d29', '#00ff88'];
```

## User Flow

1. User clicks on a country in the map
2. Country modal opens with two charts:
   - **OutlierChart** - Anomalous days (described in separate doc)
   - **DateHistogram** - Full timeline (this feature)
3. User can:
   - Hover bars to see date range and average connections
   - Click bars to navigate to that time period
   - Scroll/pan through historical data

## Data Requirements

### Input

Historical country client data:

```typescript
interface CountryTimelineEntry {
  date: string;   // ISO date: "2024-01-15"
  count: number;  // Client connections that day
}
```

### Processed (Bucketed)

```typescript
interface DateBucket {
  x: string;              // Center date formatted: "Jan 15th, 2024"
  from: number;           // Start timestamp
  to: number;             // End timestamp
  y: number;              // Average count for bucket
}

interface DateHistogramData {
  buckets: DateBucket[];
  min: number;            // Min count across all buckets
  max: number;            // Max count across all buckets
}
```

### Bucketing Algorithm

Adaptive bucketing to reduce visual noise:

1. Sort data points by date
2. Start with individual days as buckets
3. Iteratively merge adjacent buckets if value delta < threshold × range
4. Cap bucket size at maxBucketSize days (default: 30)
5. For merged buckets, use average count as y-value

**Parameters:**
- `threshold`: 0.15 (merge if values are within 15% of total range)
- `maxBucketSize`: 30 (maximum days per bucket)

**Pseudocode:**

```
function bucketData(data, threshold, maxBucketSize):
    sorted = sortByDate(data)
    range = max(data) - min(data)
    buckets = data.map(d => [d])  // Start with 1 item per bucket
    
    while canMerge:
        for each adjacent pair (a, b):
            delta = abs(avg(a) - avg(b)) / range
            if delta < threshold and size(a) + size(b) <= maxBucketSize:
                merge(a, b)
                break
    
    return buckets.map(b => {
        x: centerDate(b),
        from: firstDate(b),
        to: lastDate(b),
        y: average(b)
    })
```

## Component Structure

```tsx
interface DateHistogramProps {
  countryCode: string;
  countryCode3: string;
  currentDate: string;
  onDateSelect: (date: string) => void;
}

export default function DateHistogram(props: DateHistogramProps) {
  // 1. Fetch country history data
  // 2. Apply bucketing algorithm
  // 3. Render bar chart with:
  //    - sqrt Y scale
  //    - color gradient
  //    - click handlers
  //    - active date highlighting
}
```

### Rendering Approach

Use D3-style SVG rendering or a React chart library:

- **Scales**: Band scale for X (categorical buckets), sqrt scale for Y
- **Bars**: Rectangles with color based on normalized value
- **Axes**: X-axis with rotated date labels, Y-axis with formatted numbers
- **Interaction**: Click handlers on bars, hover tooltips

## Integration with Country Modal

The DateHistogram appears alongside the OutlierChart in the country statistics modal:

```tsx
<div className="country-stats-modal">
  <header>
    <h2>{countryName} ({countryCode3})</h2>
  </header>
  
  <div className="charts-container grid grid-cols-1 lg:grid-cols-2 gap-4">
    <OutlierChart {...props} />
    <DateHistogram {...props} />
  </div>
</div>
```

## Implementation Steps

1. [ ] Create `src/lib/utils/bucket.ts` - Bucketing algorithm
2. [ ] Create `src/components/ui/DateHistogram.tsx` - Main component
3. [ ] Add chart rendering (D3 or native SVG)
4. [ ] Style with theme colors (green gradient)
5. [ ] Add hover tooltips with date range info
6. [ ] Add click handler for date navigation
7. [ ] Add active date highlighting
8. [ ] Integrate into country statistics modal
9. [ ] Add responsive sizing (container width aware)

## Dependencies

- Country history data available
- OutlierChart component (for modal integration)
- Date slider date-change callback
- D3 or equivalent charting utilities

## Mobile Considerations

- Reduce number of x-axis labels (3-4 instead of 7)
- Larger touch targets for bars
- Horizontal scroll for long timelines
- Simplified tooltips (tap instead of hover)

## Files to Create

- `src/lib/utils/bucket.ts` - Bucketing algorithm
- `src/components/ui/DateHistogram.tsx` - Chart component
- `src/components/ui/CountryStatsModal.tsx` - Combined modal (if not exists)

## Future Enhancements

- Zoom/pan for exploring long timelines
- Overlay multiple countries for comparison
- Export as image/CSV
- Annotations for known events
- Moving average trend line

## Reference

Inspired by [TorFlow](https://github.com/unchartedsoftware/torflow)'s date histogram visualization.
