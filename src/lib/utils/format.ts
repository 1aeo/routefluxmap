/**
 * Formatting utility functions
 * Migrated from util/format.js
 */

// Shared date validation constants
const MIN_YEAR = 2000;
const MAX_YEAR = 2100;

/**
 * Validate date components are within reasonable ranges
 * Shared validation logic used by multiple date functions
 */
export function isValidDateComponents(year: number, month: number, day: number): boolean {
  return year >= MIN_YEAR && year <= MAX_YEAR && 
         month >= 1 && month <= 12 && 
         day >= 1 && day <= 31;
}

/**
 * Format a number with locale-aware thousands separators
 */
export function formatNumber(value: number): string {
  return value.toLocaleString();
}

/**
 * Format a large number with K/M/B suffix
 */
export function formatCompact(value: number): string {
  if (value >= 1_000_000_000) {
    return (value / 1_000_000_000).toFixed(1) + 'B';
  }
  if (value >= 1_000_000) {
    return (value / 1_000_000).toFixed(1) + 'M';
  }
  if (value >= 1_000) {
    return (value / 1_000).toFixed(1) + 'K';
  }
  return value.toString();
}

/**
 * Format bandwidth in appropriate units
 */
export function formatBandwidth(bytes: number): string {
  if (bytes >= 1_000_000_000) {
    return (bytes / 1_000_000_000).toFixed(2) + ' GBits';
  }
  if (bytes >= 1_000_000) {
    return (bytes / 1_000_000).toFixed(2) + ' MBits';
  }
  if (bytes >= 1_000) {
    return (bytes / 1_000).toFixed(2) + ' KBits';
  }
  return bytes.toString() + ' Bits';
}

/**
 * Format a date string to friendly format
 */
export function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/**
 * Format a date string to short format
 */
export function formatDateShort(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/**
 * Format a date for URL hash
 */
export function formatDateForUrl(dateStr: string): string {
  const date = new Date(dateStr);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  return `${year}-${month}-${day}`;
}

/**
 * Parse a date from URL hash
 * Validates date components are within reasonable ranges
 */
export function parseDateFromUrl(hash: string): { year: number; month: number; day: number } | null {
  if (!hash || typeof hash !== 'string') return null;
  
  // Limit input length to prevent ReDoS
  const limited = hash.slice(0, 50);
  const match = limited.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!match) return null;
  
  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const day = parseInt(match[3], 10);
  
  if (!isValidDateComponents(year, month, day)) return null;
  
  return { year, month, day };
}

/**
 * Format a month key (YYYY-MM) to display format
 * @example formatMonth('2024-12') // 'Dec 2024'
 */
export function formatMonth(monthKey: string): string {
  const [year, month] = monthKey.split('-');
  const date = new Date(parseInt(year), parseInt(month) - 1, 1);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    year: 'numeric',
  });
}

/**
 * Format a full date string to month + year only
 * @example formatMonthYear('2024-12-01') // 'Dec 2024'
 */
export function formatMonthYear(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    year: 'numeric',
  });
}

/**
 * Format a year key for display (passthrough)
 * @example formatYear('2024') // '2024'
 */
export function formatYear(yearKey: string): string {
  return yearKey;
}

