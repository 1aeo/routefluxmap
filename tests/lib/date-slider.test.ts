import { describe, it, expect } from 'vitest';
import {
  formatBandwidthGbps,
  getMonthKey,
  getYearKey,
  interpolateColor,
  aggregateByPeriod,
  determineAggregationMode,
  AGGREGATION_THRESHOLDS,
} from '../../src/lib/utils/date-slider';

describe('formatBandwidthGbps', () => {
  it('formats values under 1000 as Gbps', () => {
    expect(formatBandwidthGbps(500)).toBe('500 Gbps');
    expect(formatBandwidthGbps(999)).toBe('999 Gbps');
  });

  it('formats values at 1000 as Tbps', () => {
    expect(formatBandwidthGbps(1000)).toBe('1.00 Tbps');
  });

  it('formats values over 1000 as Tbps', () => {
    expect(formatBandwidthGbps(1500)).toBe('1.50 Tbps');
    expect(formatBandwidthGbps(2500)).toBe('2.50 Tbps');
  });

  it('handles decimal Gbps values', () => {
    expect(formatBandwidthGbps(123.456)).toBe('123 Gbps');
  });

  it('handles large Tbps values', () => {
    expect(formatBandwidthGbps(10000)).toBe('10.00 Tbps');
  });

  it('handles zero', () => {
    expect(formatBandwidthGbps(0)).toBe('0 Gbps');
  });
});

describe('getMonthKey', () => {
  it('extracts YYYY-MM from full date string', () => {
    expect(getMonthKey('2024-12-15')).toBe('2024-12');
    expect(getMonthKey('2024-01-01')).toBe('2024-01');
  });

  it('handles various date formats', () => {
    expect(getMonthKey('2025-06-30')).toBe('2025-06');
    expect(getMonthKey('1999-12-31')).toBe('1999-12');
  });

  it('returns first 7 characters', () => {
    // Even if given a longer string
    expect(getMonthKey('2024-12-15T00:00:00Z')).toBe('2024-12');
  });
});

describe('getYearKey', () => {
  it('extracts YYYY from full date string', () => {
    expect(getYearKey('2024-12-15')).toBe('2024');
    expect(getYearKey('2025-01-01')).toBe('2025');
  });

  it('handles various date formats', () => {
    expect(getYearKey('1999-12-31')).toBe('1999');
    expect(getYearKey('2000-01-01')).toBe('2000');
  });

  it('returns first 4 characters', () => {
    expect(getYearKey('2024-12-15T00:00:00Z')).toBe('2024');
  });
});

describe('interpolateColor', () => {
  it('returns first color when factor is 0', () => {
    expect(interpolateColor('#000000', '#ffffff', 0)).toBe('rgb(0, 0, 0)');
  });

  it('returns second color when factor is 1', () => {
    expect(interpolateColor('#000000', '#ffffff', 1)).toBe('rgb(255, 255, 255)');
  });

  it('interpolates midpoint correctly', () => {
    expect(interpolateColor('#000000', '#ffffff', 0.5)).toBe('rgb(128, 128, 128)');
  });

  it('interpolates green channel', () => {
    expect(interpolateColor('#000000', '#00ff00', 0.5)).toBe('rgb(0, 128, 0)');
  });

  it('interpolates blue channel', () => {
    expect(interpolateColor('#000000', '#0000ff', 0.5)).toBe('rgb(0, 0, 128)');
  });

  it('interpolates red channel', () => {
    expect(interpolateColor('#000000', '#ff0000', 0.5)).toBe('rgb(128, 0, 0)');
  });

  it('interpolates theme colors correctly', () => {
    // Test with actual theme colors used in the app
    const result = interpolateColor('#004d29', '#00ff88', 0);
    expect(result).toBe('rgb(0, 77, 41)');
    
    const result2 = interpolateColor('#004d29', '#00ff88', 1);
    expect(result2).toBe('rgb(0, 255, 136)');
  });

  it('handles partial interpolation', () => {
    const result = interpolateColor('#004d29', '#00ff88', 0.25);
    // Check it's between the two colors
    expect(result).toMatch(/^rgb\(\d+, \d+, \d+\)$/);
  });

  it('rounds to nearest integer', () => {
    // When factor results in non-integer RGB values
    const result = interpolateColor('#000000', '#ffffff', 0.333);
    // 255 * 0.333 = 84.915, should round to 85
    expect(result).toBe('rgb(85, 85, 85)');
  });
});

describe('aggregateByPeriod', () => {
  const mockFormatLabel = (key: string) => `Label: ${key}`;

  it('aggregates dates by month', () => {
    const dates = ['2024-01-01', '2024-01-15', '2024-02-01'];
    const bandwidths = [100, 200, 150];
    
    const result = aggregateByPeriod(dates, bandwidths, getMonthKey, mockFormatLabel);
    
    expect(result).toHaveLength(2);
    expect(result[0].key).toBe('2024-01');
    expect(result[0].bandwidth).toBe(150); // Average of 100 and 200
    expect(result[0].dates).toHaveLength(2);
    expect(result[1].key).toBe('2024-02');
    expect(result[1].bandwidth).toBe(150);
  });

  it('aggregates dates by year', () => {
    const dates = ['2023-06-15', '2023-12-31', '2024-01-01', '2024-06-15'];
    const bandwidths = [100, 200, 300, 400];
    
    const result = aggregateByPeriod(dates, bandwidths, getYearKey, mockFormatLabel);
    
    expect(result).toHaveLength(2);
    expect(result[0].key).toBe('2023');
    expect(result[0].bandwidth).toBe(150); // Average of 100 and 200
    expect(result[1].key).toBe('2024');
    expect(result[1].bandwidth).toBe(350); // Average of 300 and 400
  });

  it('sets start and end dates correctly', () => {
    const dates = ['2024-01-01', '2024-01-15', '2024-01-31'];
    const bandwidths = [100, 200, 300];
    
    const result = aggregateByPeriod(dates, bandwidths, getMonthKey, mockFormatLabel);
    
    expect(result[0].startDate).toBe('2024-01-01');
    expect(result[0].endDate).toBe('2024-01-31');
  });

  it('applies format label function', () => {
    const dates = ['2024-01-01'];
    const bandwidths = [100];
    
    const result = aggregateByPeriod(dates, bandwidths, getMonthKey, mockFormatLabel);
    
    expect(result[0].label).toBe('Label: 2024-01');
  });

  it('handles empty arrays', () => {
    const result = aggregateByPeriod([], [], getMonthKey, mockFormatLabel);
    expect(result).toHaveLength(0);
  });

  it('handles single date', () => {
    const dates = ['2024-01-15'];
    const bandwidths = [500];
    
    const result = aggregateByPeriod(dates, bandwidths, getMonthKey, mockFormatLabel);
    
    expect(result).toHaveLength(1);
    expect(result[0].bandwidth).toBe(500);
    expect(result[0].dates).toEqual(['2024-01-15']);
  });

  it('handles missing bandwidth values with default of 0', () => {
    const dates = ['2024-01-01', '2024-01-15'];
    const bandwidths = [100]; // Only one value for two dates
    
    const result = aggregateByPeriod(dates, bandwidths, getMonthKey, mockFormatLabel);
    
    expect(result[0].bandwidth).toBe(50); // Average of 100 and 0
  });

  it('preserves date order within groups', () => {
    const dates = ['2024-01-01', '2024-01-15', '2024-01-10'];
    const bandwidths = [100, 200, 150];
    
    const result = aggregateByPeriod(dates, bandwidths, getMonthKey, mockFormatLabel);
    
    // Dates should be in insertion order
    expect(result[0].dates).toEqual(['2024-01-01', '2024-01-15', '2024-01-10']);
  });

  it('calculates average bandwidth correctly for large groups', () => {
    const dates = Array.from({ length: 30 }, (_, i) => 
      `2024-01-${String(i + 1).padStart(2, '0')}`
    );
    const bandwidths = dates.map(() => 100);
    
    const result = aggregateByPeriod(dates, bandwidths, getMonthKey, mockFormatLabel);
    
    expect(result[0].bandwidth).toBe(100); // All same, so average is same
    expect(result[0].dates).toHaveLength(30);
  });
});

describe('determineAggregationMode', () => {
  it('returns days for small date counts', () => {
    expect(determineAggregationMode(30)).toBe('days');
    expect(determineAggregationMode(100)).toBe('days');
    expect(determineAggregationMode(AGGREGATION_THRESHOLDS.MAX_DAYS_DISPLAY)).toBe('days');
  });

  it('returns months for medium date counts', () => {
    expect(determineAggregationMode(121)).toBe('months');
    expect(determineAggregationMode(365)).toBe('months');
    expect(determineAggregationMode(500)).toBe('months');
  });

  it('returns years for large date counts', () => {
    // More than 36 months worth of daily data
    expect(determineAggregationMode(1100)).toBe('years');
    expect(determineAggregationMode(2000)).toBe('years');
  });

  it('handles edge cases', () => {
    expect(determineAggregationMode(0)).toBe('days');
    expect(determineAggregationMode(1)).toBe('days');
  });

  it('threshold values are consistent', () => {
    expect(AGGREGATION_THRESHOLDS.MAX_DAYS_DISPLAY).toBe(120);
    expect(AGGREGATION_THRESHOLDS.MAX_MONTHS_DISPLAY).toBe(36);
  });
});

