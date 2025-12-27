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
 * Format a date for URL hash (YYYY-MM-DD format)
 */
export function formatDateForUrl(dateStr: string): string {
  const date = new Date(dateStr);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
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

