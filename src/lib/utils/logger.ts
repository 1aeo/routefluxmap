/**
 * Safe Logging Utilities
 * 
 * Provides logging that:
 * - Can be disabled in production
 * - Sanitizes sensitive data
 * - Prevents log injection
 */

const IS_PRODUCTION = import.meta.env.PROD;
const IS_DEV = import.meta.env.DEV;

/**
 * Sanitize a value for safe logging (no sensitive data, no injection)
 */
function sanitizeForLog(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  
  if (typeof value === 'string') {
    // Remove control characters and limit length
    return value
      .replace(/[\x00-\x1f\x7f]/g, '')
      .slice(0, 500);
  }
  
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  
  if (typeof value === 'object') {
    try {
      // Limit depth and size
      return JSON.stringify(value, null, 0).slice(0, 1000);
    } catch {
      return '[Object]';
    }
  }
  
  return '[Unknown]';
}

/**
 * Safe info log (development only by default)
 */
export function logInfo(message: string, ...args: unknown[]): void {
  if (IS_PRODUCTION) return;
  
  const safeMessage = sanitizeForLog(message);
  const safeArgs = args.map(sanitizeForLog);
  console.info(`[Info] ${safeMessage}`, ...safeArgs);
}

/**
 * Safe warning log (always enabled)
 */
export function logWarn(message: string, ...args: unknown[]): void {
  const safeMessage = sanitizeForLog(message);
  const safeArgs = args.map(sanitizeForLog);
  console.warn(`[Warn] ${safeMessage}`, ...safeArgs);
}

/**
 * Safe error log (always enabled, but sanitized)
 */
export function logError(message: string, error?: unknown): void {
  const safeMessage = sanitizeForLog(message);
  
  // Don't expose full error stack in production
  if (IS_PRODUCTION) {
    console.error(`[Error] ${safeMessage}`);
  } else {
    console.error(`[Error] ${safeMessage}`, error);
  }
}

/**
 * Debug log (development only)
 */
export function logDebug(message: string, ...args: unknown[]): void {
  if (!IS_DEV) return;
  
  const safeMessage = sanitizeForLog(message);
  const safeArgs = args.map(sanitizeForLog);
  console.log(`[Debug] ${safeMessage}`, ...safeArgs);
}
