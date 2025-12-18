/**
 * Date Slider Utility Functions
 * Extracted from DateSliderChart for testability and reuse
 */

/**
 * Format bandwidth value to human-readable string (Gbps/Tbps)
 * Different from format.ts formatBandwidth which uses Bits
 */
export function formatBandwidthGbps(gbits: number): string {
  if (gbits >= 1000) {
    return `${(gbits / 1000).toFixed(2)} Tbps`;
  }
  return `${gbits.toFixed(0)} Gbps`;
}

/**
 * Extract month key (YYYY-MM) from date string
 */
export function getMonthKey(dateStr: string): string {
  return dateStr.slice(0, 7);
}

/**
 * Extract year key (YYYY) from date string
 */
export function getYearKey(dateStr: string): string {
  return dateStr.slice(0, 4);
}

/**
 * Interpolate between two hex colors
 * @param color1 - Start color in hex format (e.g., '#004d29')
 * @param color2 - End color in hex format (e.g., '#00ff88')
 * @param factor - Interpolation factor (0-1)
 * @returns RGB color string (e.g., 'rgb(0, 128, 68)')
 */
export function interpolateColor(color1: string, color2: string, factor: number): string {
  const c1 = parseInt(color1.slice(1), 16);
  const c2 = parseInt(color2.slice(1), 16);

  const r1 = (c1 >> 16) & 0xff;
  const g1 = (c1 >> 8) & 0xff;
  const b1 = c1 & 0xff;

  const r2 = (c2 >> 16) & 0xff;
  const g2 = (c2 >> 8) & 0xff;
  const b2 = c2 & 0xff;

  const r = Math.round(r1 + (r2 - r1) * factor);
  const g = Math.round(g1 + (g2 - g1) * factor);
  const b = Math.round(b1 + (b2 - b1) * factor);

  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * Aggregated data point for timeline display
 */
export interface AggregatedData {
  key: string;
  label: string;
  bandwidth: number;
  dates: string[];
  startDate: string;
  endDate: string;
}

/**
 * Generic aggregation function for dates by period
 * @param dates - Array of date strings (YYYY-MM-DD)
 * @param bandwidths - Array of bandwidth values corresponding to dates
 * @param getKey - Function to extract period key from date (e.g., getMonthKey)
 * @param formatLabel - Function to format the key for display
 * @returns Array of aggregated data points
 */
export function aggregateByPeriod(
  dates: string[],
  bandwidths: number[],
  getKey: (date: string) => string,
  formatLabel: (key: string) => string
): AggregatedData[] {
  const map = new Map<string, AggregatedData>();

  for (let i = 0; i < dates.length; i++) {
    const date = dates[i];
    const key = getKey(date);
    const bw = bandwidths[i] || 0;

    let entry = map.get(key);
    if (!entry) {
      entry = {
        key,
        label: formatLabel(key),
        bandwidth: 0,
        dates: [],
        startDate: date,
        endDate: date,
      };
      map.set(key, entry);
    }

    entry.bandwidth += bw;
    entry.dates.push(date);
    entry.endDate = date;
  }

  // Convert sum to average
  for (const entry of map.values()) {
    entry.bandwidth /= entry.dates.length;
  }

  return Array.from(map.values());
}

/**
 * Determine aggregation mode based on data volume
 */
export type AggregationMode = 'days' | 'months' | 'years';

export const AGGREGATION_THRESHOLDS = {
  MAX_DAYS_DISPLAY: 120,
  MAX_MONTHS_DISPLAY: 36,
} as const;

/**
 * Determine the appropriate aggregation mode for a date range
 */
export function determineAggregationMode(dateCount: number): AggregationMode {
  if (dateCount <= AGGREGATION_THRESHOLDS.MAX_DAYS_DISPLAY) {
    return 'days';
  }
  // Estimate month count (roughly dates / 30)
  const estimatedMonths = Math.ceil(dateCount / 30);
  if (estimatedMonths <= AGGREGATION_THRESHOLDS.MAX_MONTHS_DISPLAY) {
    return 'months';
  }
  return 'years';
}

