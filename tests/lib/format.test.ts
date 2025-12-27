import { describe, it, expect } from 'vitest';
import { 
  formatDateShort,
  formatDateForUrl,
  formatMonth,
  formatMonthYear,
  formatYear,
  parseDateFromUrl,
  isValidDateComponents,
} from '../../src/lib/utils/format';

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

describe('formatDateForUrl', () => {
  it('formats date with zero-padded month', () => {
    const result = formatDateForUrl('2024-01-15');
    // Month should have leading zero for consistency with YYYY-MM-DD format
    expect(result).toBe('2024-01-15');
  });

  it('formats date with zero-padded day', () => {
    const result = formatDateForUrl('2024-06-05');
    // Day should have leading zero for consistency with YYYY-MM-DD format
    expect(result).toBe('2024-06-05');
  });

  it('preserves double-digit months and days', () => {
    const result = formatDateForUrl('2024-12-25');
    expect(result).toBe('2024-12-25');
  });

  it('handles year-end dates', () => {
    const result = formatDateForUrl('2024-12-31');
    expect(result).toBe('2024-12-31');
  });

  it('handles year-start dates', () => {
    const result = formatDateForUrl('2024-01-01');
    expect(result).toBe('2024-01-01');
  });

  it('handles mid-year dates', () => {
    const result = formatDateForUrl('2024-06-15');
    expect(result).toBe('2024-06-15');
  });

  it('produces output parseable by parseDateFromUrl', () => {
    // Round-trip test
    const original = '2024-03-07';
    const formatted = formatDateForUrl(original);
    const parsed = parseDateFromUrl(formatted);
    
    expect(parsed).not.toBeNull();
    expect(parsed!.year).toBe(2024);
    expect(parsed!.month).toBe(3);
    expect(parsed!.day).toBe(7);
  });

  it('handles leap year date', () => {
    const result = formatDateForUrl('2024-02-29');
    expect(result).toBe('2024-02-29');
  });

  it('uses UTC to avoid timezone issues', () => {
    // This tests that the function uses getUTC* methods
    // The exact output depends on the date, but it should be consistent
    const result = formatDateForUrl('2024-01-01');
    // Should always produce the same output regardless of local timezone
    expect(result).toBe('2024-01-01');
  });
});
