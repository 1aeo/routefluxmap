# Feature: Country Outlier Chart

**Status:** Proposed  
**Priority:** Medium  
**Complexity:** Medium

## Overview

The OutlierChart component shows **anomalous days** for a selected country - days where client connections significantly deviated from the norm. This enables users to identify significant events in Tor usage patterns.

## Use Cases

This feature helps identify:

- **Censorship events** - Sudden drops in users (e.g., Iran, Russia blocks)
- **Mass adoption events** - Sudden spikes (e.g., VPN crackdowns driving users to Tor)
- **Infrastructure changes** - New bridges, relay deployments
- **Potential attacks** - Unusual traffic patterns
- **Seasonal patterns** - Holidays, events affecting usage

## Visual Design

### Chart Characteristics

- **Vertical bar chart** with bars representing outlier days
- **Color gradient**: Blue (positive/high) → Gray (average) → Red (negative/low)
- **Y-axis**: Uses `sqrt` scale for better distribution of large values
- **X-axis**: Rotated labels (-45°) for date readability
- **Average line**: Shows the mean as a reference bar in the center
- **Active date highlighting**: Current date bar has special styling

### Interaction Features

- **Hover tooltips**: Show date and exact count
- **Click to navigate**: Clicking a bar navigates the main date slider
- **URL deep linking**: Country selection persists in URL hash (`?C=us,USA`)

## User Flow

1. User enables Country layer in Layer Controls
2. User clicks on a country in the map
3. Modal opens showing country statistics
4. User sees:
   - Summary stats (mean, stdDev, data points)
   - Timeline sparkline with outliers highlighted
   - Outlier bar chart (top highs and lows around average)
5. User can click an outlier date to navigate the date slider
6. URL updates with country code for bookmarking

## Data Requirements

### Input

Historical country client data for the selected country:

```typescript
interface CountryTimeline {
  date: string;
  count: number;
}
```

### Computed

```typescript
interface CountryStats {
  countryCode: string;    // 2-letter (US)
  countryCode3: string;   // 3-letter (USA) - for display
  countryName: string;
  mean: number;           // Average daily users
  stdDev: number;         // Standard deviation
  outliers: CountryOutlier[];
  timeline: CountryTimeline[];
}

interface CountryOutlier {
  position: number;       // Rank: positive = above avg, negative = below avg, 0 = average
  date: string;
  client_count: number;
  deviation?: number;     // Standard deviations from mean
}
```

### Outlier Detection Algorithm

**Ranking-based approach (simpler):**

1. Sort all data by count (descending)
2. Take top N as "high outliers" (position: N, N-1, ..., 1)
3. Calculate average (position: 0)
4. Take bottom N as "low outliers" (position: -1, -2, ..., -N)
5. Return combined array: [high outliers] + [average] + [low outliers]

Default N = 10 (5 on mobile).

**Alternative: Standard Deviation Method**

For more statistically rigorous detection:

1. Calculate mean and stdDev of historical data
2. Flag any day where `|count - mean| / stdDev > 1.5`
3. Rank by absolute deviation
4. Return top 20

## Visual Layout

### Outlier Bar Chart

```
Guard Client Connection Outliers by Date (USA)
                     
Connections          
   ▲                 
   │  ▓▓             
   │  ▓▓  ▓▓         
   │  ▓▓  ▓▓  ▓▓     
   │  ▓▓  ▓▓  ▓▓  ░░  ░░  ░░
   │  ▓▓  ▓▓  ▓▓  ░░  ░░  ░░  ░░
   │  ▓▓  ▓▓  ▓▓  ░░  ░░  ░░  ░░  ░░
   └──────────────────────────────────►
      Mar  Jan  Feb  Avg  Nov  Jul  Dec
      22   15   8        3    4    25
      
   🔵 Above average     ⚪ Average     🔴 Below average
```

### Modal Layout

```
┌─────────────────────────────────────────────────────────┐
│  📊 United States - Client Statistics              [×]  │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌─────────────┬─────────────┬─────────────┐           │
│  │ Avg Users   │ Std Dev     │ Data Points │           │
│  │ 445,000/day │ ±52,000     │ 365 days    │           │
│  └─────────────┴─────────────┴─────────────┘           │
│                                                         │
│  Timeline (1 year) - mini sparkline                     │
│  ▓▓▓▓▓▓▓▓▓▓░░░░░░▓▓▓▓░░░░░▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░  │
│       ▲              ▼                    ▼             │
│     outlier        outlier              outlier         │
│                                                         │
│  Top Outliers                                           │
│  ┌────────────────────────────────────────────────────┐│
│  │ 🔵 Mar 22, 2024  614,000  ▲ +5 position  [+38%]  ▸││
│  │ 🔵 Jan 15, 2024  587,000  ▲ +4 position  [+32%]  ▸││
│  │ ⚪ Average       445,000  ○ baseline              ││
│  │ 🔴 Jul 4, 2024   320,000  ▼ -1 position  [-28%]  ▸││
│  │ 🔴 Nov 3, 2024   287,000  ▼ -2 position  [-36%]  ▸││
│  └────────────────────────────────────────────────────┘│
│                                                         │
│                              [View All Dates]           │
└─────────────────────────────────────────────────────────┘
```

## Component Structure

```tsx
interface OutlierChartProps {
  countryCode: string;     // 2-letter code
  countryCode3: string;    // 3-letter code
  countryName: string;
  currentDate: string;     // To highlight active date
  onClose: () => void;
  onDateSelect: (date: string) => void;
}

export default function OutlierChart(props: OutlierChartProps) {
  // 1. Fetch country history
  // 2. Calculate outlier stats
  // 3. Update URL hash for deep linking
  // 4. Render modal with stats and chart
}
```

### Bar Color Function

```typescript
function getBarColor(position: number, maxPosition: number): string {
  if (position === 0) return 'gray';  // Average
  
  const normalized = position / maxPosition;
  if (position > 0) {
    // Blue gradient for high values
    return interpolate('#808080', '#0000ff', Math.sqrt(normalized));
  } else {
    // Red gradient for low values
    return interpolate('#808080', '#ff0000', Math.sqrt(Math.abs(normalized)));
  }
}
```

### Y-Scale

Use sqrt scale for better value distribution:

```typescript
const yScale = d3.scaleSqrt()
  .domain([0, maxCount])
  .range([height, 0]);
```

## Data Fetching

### Option A: Pre-computed (Recommended)

Generate `country-history/{CC}.json` files during data fetch:

```json
{
  "countryCode": "US",
  "countryCode3": "USA",
  "lastUpdated": "2024-12-07T00:00:00Z",
  "timeline": [
    { "date": "2024-01-01", "count": 444507 },
    { "date": "2024-01-02", "count": 436066 }
  ]
}
```

### Option B: On-demand from Tor Metrics

```
https://metrics.torproject.org/userstats-relay-country.csv?start=2024-01-01&end=2024-12-31&country=us
```

### Option C: Aggregate existing daily files

Read all `countries-YYYY-MM-DD.json` files and extract the specific country.

## URL Deep Linking

Country selection persists in URL for bookmarking:

```
https://example.com/#/2024-12-01?C=us,USA
```

**Pseudocode:**

```
function updateUrlWithCountry(cc2, cc3):
    hash = window.location.hash
    countryParam = "C=" + cc2 + "," + cc3
    
    if hash contains "?":
        if hash contains "C=":
            replace existing C param
        else:
            append "&" + countryParam
    else:
        append "?" + countryParam

function getCountryFromUrl():
    match = hash.match(/C=([^,&]+),([^&]+)/)
    return match ? { cc2: match[1], cc3: match[2] } : null
```

## Implementation Steps

1. [ ] Create `OutlierChart.tsx` component
2. [ ] Create `OutlierBarChart.tsx` with D3-style bar rendering
3. [ ] Add `calculateOutlierStats()` utility function
4. [ ] Add country code 2→3 letter mapping utility
5. [ ] Integrate with CountryLayer click handler in TorMap
6. [ ] Add URL hash update/parse for country deep linking
7. [ ] Add country history data to fetch pipeline (`fetch-country-history.ts`)
8. [ ] Style with color scheme (blue/gray/red gradient)
9. [ ] Add date navigation callback

## Dependencies

- Country data fetch working (`countries-YYYY-MM-DD.json`)
- CountryLayer click handler
- Date slider date-change callback
- Country code 2↔3 letter mapping

## Files to Create

- `src/components/ui/OutlierChart.tsx` - Main modal component
- `src/components/ui/OutlierBarChart.tsx` - D3-style bar chart
- `src/lib/utils/country-codes.ts` - 2↔3 letter mapping
- `scripts/fetch-country-history.ts` - Historical data fetcher

## Future Enhancements

- Compare multiple countries side-by-side
- Export data as CSV
- Annotate known events (e.g., "Iran block 2023")
- Trend analysis / prediction
- Mobile-optimized layout (fewer outliers, touch-friendly bars)

## Reference

Inspired by [TorFlow](https://github.com/unchartedsoftware/torflow)'s outlier chart for anomaly detection.
