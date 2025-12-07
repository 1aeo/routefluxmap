# Feature: Per-Country Date Histogram

**Status:** Proposed  
**Priority:** Medium  
**Complexity:** Medium  
**Reference:** TorFlow `public/javascripts/ui/datehistogram.js`

## Overview

The DateHistogram component shows **client connection trends over time** for a selected country. While the OutlierChart highlights anomalies, this histogram provides the full picture of how Tor usage in a country has evolved.

## Use Cases

- **Long-term trend analysis** - Is Tor usage growing or declining in a region?
- **Event correlation** - How did specific events affect usage?
- **Seasonal patterns** - Are there recurring patterns (holidays, elections)?
- **Policy impact** - How do censorship policies affect usage over months/years?
- **Comparative analysis** - Understanding baseline before looking at outliers

## TorFlow Reference Implementation

### Visual Design (from TorFlow)

TorFlow's DateHistogram has these characteristics:

- **Bucketed data**: Groups dates into buckets (threshold: 0.15, max bucket size: 30)
- **Y-axis**: Uses `sqrt` scale for better visual distribution
- **X-axis**: Shows ~7 evenly-spaced date labels with binned ranges
- **Color gradient**: Based on connection count (low → high)
- **Active date highlighting**: Current global date has special styling
- **Hover tooltips**: Show date range and average count for bucket
- **Click navigation**: Clicking a bar navigates the main date slider

### Data Processing

```javascript
// TorFlow bucketing algorithm (util/bucket.js)
var bucket = require('../util/bucket');

var res = bucket({
  data: data,                        // Array of {date, count}
  xExtractor: function(value) {
    return moment.utc(value.date).valueOf();
  },
  yExtractor: function(value) {
    return value.count;
  },
  threshold: 0.15,                   // Bucket merging threshold
  maxBucketSize: 30                  // Max days per bucket
});

// Result: { buckets: [...], min, max }
// Each bucket: { x: centerDate, from: startDate, to: endDate, y: avgCount }
```

### Chart Title Format

```
"Guard Client Connections by Date (USA)"
```

### Axis Labels

- Y-axis: "Connections"
- X-axis: "Dates (Binned)"

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
  xRange: DateRange;      // Twix-style range object
  y: number;              // Average count for bucket
}

interface DateHistogramData {
  buckets: DateBucket[];
  min: number;            // Min count across all buckets
  max: number;            // Max count across all buckets
  range: number;          // max - min
}
```

### Bucketing Algorithm

Simple adaptive bucketing:
1. Sort data points by date
2. Start with individual days
3. Merge adjacent buckets if delta < threshold × range
4. Cap bucket size at maxBucketSize days
5. For merged buckets, use average count as y-value

## Visual Design

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

Gradient from low to high counts (TorFlow uses connections_color_ramp):
```typescript
const colorRamp = d3.scaleSqrt()
  .range(['rgb(64,0,128)', 'rgb(30,115,223)'])  // Purple → Blue
  .domain([0, 1]);

// For RouteFluxMap, adapt to green theme:
const colorRamp = d3.scaleSqrt()
  .range(['#004d29', '#00ff88'])  // Dark green → Bright green
  .domain([0, 1]);
```

## Component Structure

```tsx
// src/components/ui/DateHistogram.tsx

interface DateHistogramProps {
  countryCode: string;
  countryCode3: string;
  currentDate: string;
  onDateSelect: (date: string) => void;
}

export default function DateHistogram({
  countryCode,
  countryCode3,
  currentDate,
  onDateSelect,
}: DateHistogramProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [data, setData] = useState<DateHistogramData | null>(null);
  
  // Fetch and bucket data
  useEffect(() => {
    fetchCountryHistory(countryCode).then(timeline => {
      const bucketed = bucketData(timeline, {
        threshold: 0.15,
        maxBucketSize: 30,
      });
      setData(bucketed);
    });
  }, [countryCode]);
  
  // Render chart with D3 or native SVG
  useEffect(() => {
    if (!data || !containerRef.current) return;
    renderChart(containerRef.current, data, currentDate, onDateSelect);
  }, [data, currentDate, onDateSelect]);
  
  return (
    <div className="date-histogram">
      <h3 className="text-sm font-medium text-gray-400 mb-2">
        Guard Client Connections by Date ({countryCode3.toUpperCase()})
      </h3>
      <div ref={containerRef} className="h-48 w-full" />
    </div>
  );
}
```

### Render Function (D3-style)

```typescript
function renderChart(
  container: HTMLElement,
  data: DateHistogramData,
  activeDate: string,
  onClick: (date: string) => void
) {
  const margin = { top: 10, right: 10, bottom: 40, left: 50 };
  const width = container.clientWidth - margin.left - margin.right;
  const height = container.clientHeight - margin.top - margin.bottom;
  
  // Clear previous
  container.innerHTML = '';
  
  // Create scales
  const x = d3.scaleBand()
    .domain(data.buckets.map(d => d.x))
    .range([0, width])
    .padding(0.1);
  
  const y = d3.scaleSqrt()  // sqrt scale like TorFlow
    .domain([0, data.max])
    .range([height, 0]);
  
  const color = d3.scaleSqrt()
    .domain([0, 1])
    .range(['#004d29', '#00ff88']);
  
  // Create SVG
  const svg = d3.select(container)
    .append('svg')
    .attr('width', width + margin.left + margin.right)
    .attr('height', height + margin.top + margin.bottom)
    .append('g')
    .attr('transform', `translate(${margin.left},${margin.top})`);
  
  // Add axes
  // ... (x-axis with rotated labels, y-axis with tick marks)
  
  // Add bars
  svg.selectAll('.bar')
    .data(data.buckets)
    .enter()
    .append('rect')
    .attr('class', d => `bar ${d.xRange.contains(activeDate) ? 'active' : ''}`)
    .attr('x', d => x(d.x))
    .attr('width', x.bandwidth())
    .attr('y', d => y(d.y))
    .attr('height', d => height - y(d.y))
    .attr('fill', d => color((d.y - data.min) / data.range))
    .on('click', (event, d) => onClick(d.x));
}
```

## Integration with Country Modal

The DateHistogram appears alongside the OutlierChart in the country statistics modal:

```tsx
// In CountryStatsModal.tsx
<div className="country-stats-modal">
  <header>
    <h2>{countryName} ({countryCode3})</h2>
    <button onClick={onClose}>×</button>
  </header>
  
  <div className="stats-grid">
    {/* Summary cards */}
    <StatCards stats={stats} />
  </div>
  
  <div className="charts-container grid grid-cols-1 lg:grid-cols-2 gap-4">
    {/* Outlier chart - shows anomalies */}
    <OutlierChart 
      countryCode={countryCode}
      currentDate={currentDate}
      onDateSelect={onDateSelect}
    />
    
    {/* Date histogram - shows full timeline */}
    <DateHistogram
      countryCode={countryCode}
      countryCode3={countryCode3}
      currentDate={currentDate}
      onDateSelect={onDateSelect}
    />
  </div>
</div>
```

## Bucketing Utility

```typescript
// src/lib/utils/bucket.ts

interface BucketOptions {
  threshold?: number;     // 0-1, default 0.15
  maxBucketSize?: number; // Max items per bucket, default 30
}

interface BucketResult<T> {
  buckets: {
    x: number;           // Center timestamp
    from: number;        // Start timestamp
    to: number;          // End timestamp
    y: number;           // Averaged value
    items: T[];          // Original items in bucket
  }[];
  min: number;
  max: number;
}

export function bucketData<T>(
  data: T[],
  xExtractor: (item: T) => number,
  yExtractor: (item: T) => number,
  options: BucketOptions = {}
): BucketResult<T> {
  const threshold = options.threshold ?? 0.15;
  const maxBucketSize = options.maxBucketSize ?? 30;
  
  // Sort by x value
  const sorted = [...data].sort((a, b) => xExtractor(a) - xExtractor(b));
  
  // Find range
  const yValues = sorted.map(yExtractor);
  const min = Math.min(...yValues);
  const max = Math.max(...yValues);
  const range = max - min || 1;
  
  // Build initial buckets (one item each)
  let buckets = sorted.map(item => ({
    items: [item],
    y: yExtractor(item),
  }));
  
  // Merge adjacent buckets if delta is small
  let merged = true;
  while (merged) {
    merged = false;
    for (let i = 0; i < buckets.length - 1; i++) {
      const delta = Math.abs(buckets[i].y - buckets[i + 1].y) / range;
      const combinedSize = buckets[i].items.length + buckets[i + 1].items.length;
      
      if (delta < threshold && combinedSize <= maxBucketSize) {
        // Merge buckets
        const allItems = [...buckets[i].items, ...buckets[i + 1].items];
        const avgY = allItems.reduce((sum, item) => sum + yExtractor(item), 0) / allItems.length;
        buckets[i] = { items: allItems, y: avgY };
        buckets.splice(i + 1, 1);
        merged = true;
        break;
      }
    }
  }
  
  // Convert to final format
  return {
    buckets: buckets.map(b => ({
      x: xExtractor(b.items[Math.floor(b.items.length / 2)]),
      from: xExtractor(b.items[0]),
      to: xExtractor(b.items[b.items.length - 1]),
      y: b.y,
      items: b.items,
    })),
    min,
    max,
  };
}
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

