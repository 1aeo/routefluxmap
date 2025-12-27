/**
 * Data Validation Utilities
 * 
 * Provides runtime validation for external data to prevent
 * type confusion attacks and malformed data issues.
 */

/**
 * Validate that a value is a plain object (not null, array, or primitive)
 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validate that a value is a non-empty string
 */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * Validate that a value is a finite number
 */
export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Validate that a value is a valid date string (YYYY-MM-DD)
 */
export function isValidDateString(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  
  const [, year, month, day] = match;
  const y = parseInt(year, 10);
  const m = parseInt(month, 10);
  const d = parseInt(day, 10);
  
  return y >= 2000 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31;
}

/**
 * Validate relay data structure from API
 */
export function validateRelayData(data: unknown): boolean {
  if (!isPlainObject(data)) return false;
  
  // Check required fields
  if (!Array.isArray(data.nodes)) return false;
  if (typeof data.bandwidth !== 'number') return false;
  
  // Validate first few nodes (sample validation for performance)
  const nodesToCheck = Math.min(data.nodes.length, 10);
  for (let i = 0; i < nodesToCheck; i++) {
    const node = data.nodes[i];
    if (!isPlainObject(node)) return false;
    if (!isFiniteNumber(node.lat) || !isFiniteNumber(node.lng)) return false;
    if (!Array.isArray(node.relays)) return false;
  }
  
  return true;
}

/**
 * Validate date index structure from API
 */
export function validateDateIndex(data: unknown): boolean {
  if (!isPlainObject(data)) return false;
  
  if (!Array.isArray(data.dates)) return false;
  if (!Array.isArray(data.bandwidths)) return false;
  
  // Validate dates are valid format
  const datesToCheck = Math.min(data.dates.length, 10);
  for (let i = 0; i < datesToCheck; i++) {
    if (!isValidDateString(data.dates[i])) return false;
  }
  
  return true;
}

/**
 * Validate country data structure from API
 */
export function validateCountryData(data: unknown): boolean {
  if (!isPlainObject(data)) return false;
  
  // Countries should be an object with country codes as keys
  if (!isPlainObject(data.countries)) return false;
  
  // Validate a sample of country entries
  const entries = Object.entries(data.countries);
  const entriesToCheck = Math.min(entries.length, 10);
  
  for (let i = 0; i < entriesToCheck; i++) {
    const [code, value] = entries[i];
    
    // Country code should be 2 uppercase letters
    if (!/^[A-Z]{2}$/.test(code)) return false;
    
    // Value should be number or object with count
    if (typeof value !== 'number' && !isPlainObject(value)) return false;
    if (isPlainObject(value) && typeof value.count !== 'number') return false;
  }
  
  return true;
}

/**
 * Sanitize a string for display (prevent XSS in edge cases)
 */
export function sanitizeDisplayString(input: string, maxLength = 100): string {
  if (typeof input !== 'string') return '';
  return input
    .slice(0, maxLength)
    .replace(/[<>&"']/g, (char) => {
      const entities: Record<string, string> = {
        '<': '&lt;',
        '>': '&gt;',
        '&': '&amp;',
        '"': '&quot;',
        "'": '&#x27;',
      };
      return entities[char] || char;
    });
}
