import { describe, it, expect } from 'vitest';
import { 
  formatNumber, 
  formatCompact, 
  formatBandwidth, 
  formatDate, 
  formatDateShort,
  formatMonth,
  formatMonthYear,
  formatYear,
  parseDateFromUrl 
} from '../../src/lib/utils/format';

describe('formatNumber', () => {
  it('formats small numbers without change', () => {
    expect(formatNumber(42)).toBe('42');
  });

  it('adds thousands separators to large numbers', () => {
    // Note: This depends on locale, so we just check it contains the digits
    const result = formatNumber(1234567);
    expect(result).toContain('1');
    expect(result).toContain('234');
    expect(result).toContain('567');
  });
});

describe('formatCompact', () => {
  it('formats numbers under 1000 as-is', () => {
    expect(formatCompact(999)).toBe('999');
  });

  it('formats thousands with K suffix', () => {
    expect(formatCompact(1500)).toBe('1.5K');
    expect(formatCompact(12000)).toBe('12.0K');
  });

  it('formats millions with M suffix', () => {
    expect(formatCompact(1500000)).toBe('1.5M');
    expect(formatCompact(12000000)).toBe('12.0M');
  });

  it('formats billions with B suffix', () => {
    expect(formatCompact(1500000000)).toBe('1.5B');
  });
});

describe('formatBandwidth', () => {
  it('formats small values in Bits', () => {
    expect(formatBandwidth(500)).toBe('500 Bits');
  });

  it('formats kilobits', () => {
    expect(formatBandwidth(1500)).toBe('1.50 KBits');
  });

  it('formats megabits', () => {
    expect(formatBandwidth(1500000)).toBe('1.50 MBits');
  });

  it('formats gigabits', () => {
    expect(formatBandwidth(1500000000)).toBe('1.50 GBits');
  });
});

describe('formatDate', () => {
  it('formats ISO date to long format', () => {
    const result = formatDate('2024-01-15');
    expect(result).toContain('January');
    // Date may vary by timezone, check range
    expect(result).toMatch(/1[45]/); // 14 or 15 depending on timezone
    expect(result).toContain('2024');
  });
});

describe('formatDateShort', () => {
  it('formats ISO date to short format', () => {
    const result = formatDateShort('2024-01-15');
    expect(result).toContain('Jan');
    // Date may vary by timezone, check range
    expect(result).toMatch(/1[45]/); // 14 or 15 depending on timezone
    expect(result).toContain('2024');
  });
});

describe('parseDateFromUrl', () => {
  it('parses valid date string', () => {
    const result = parseDateFromUrl('2024-1-15');
    expect(result).toEqual({ year: 2024, month: 1, day: 15 });
  });

  it('parses date with leading zeros', () => {
    const result = parseDateFromUrl('2024-01-05');
    expect(result).toEqual({ year: 2024, month: 1, day: 5 });
  });

  it('returns null for invalid string', () => {
    expect(parseDateFromUrl('invalid')).toBeNull();
    expect(parseDateFromUrl('')).toBeNull();
  });

  it('extracts date from hash with other content', () => {
    const result = parseDateFromUrl('date=2024-6-20&other=stuff');
    expect(result).toEqual({ year: 2024, month: 6, day: 20 });
  });
});

describe('formatMonth', () => {
  it('formats YYYY-MM to month year', () => {
    const result = formatMonth('2024-12');
    expect(result).toContain('Dec');
    expect(result).toContain('2024');
  });

  it('handles single digit months', () => {
    const result = formatMonth('2024-01');
    expect(result).toContain('Jan');
    expect(result).toContain('2024');
  });
});

describe('formatMonthYear', () => {
  it('formats full date to month year only', () => {
    const result = formatMonthYear('2024-12-15');
    expect(result).toContain('Dec');
    expect(result).toContain('2024');
    // Should NOT contain the day
    expect(result).not.toContain('15');
  });
});

describe('formatYear', () => {
  it('returns year as-is', () => {
    expect(formatYear('2024')).toBe('2024');
    expect(formatYear('2023')).toBe('2023');
  });
});
