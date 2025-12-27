/**
 * Relay Search Utilities
 * Provides search index building and matching logic for relay autocomplete
 */

import type { AggregatedNode } from '../types';

// Constants
export const SEARCH_DEBOUNCE_MS = 150;
export const MAX_AUTOCOMPLETE_RESULTS = 20;
export const MIN_QUERY_LENGTH = 2;
export const MAX_QUERY_LENGTH = 100; // Prevent excessively long input
export const GROUP_THRESHOLD = 5;
export const EXPANDED_GROUP_LIMIT = 20;
export const MIN_FINGERPRINT_LENGTH = 6;

/**
 * Individual relay in the search index
 */
export interface SearchItem {
  nickname: string;
  nicknameLower: string;
  fingerprint: string;
  fingerprintClean: string;
  nodeIndex: number;
  relayIndex: number;
  node: AggregatedNode;
  flags: string;
}

/**
 * Search result - either individual relay or grouped relays
 */
export type SearchResult =
  | { type: 'relay'; item: SearchItem }
  | { type: 'group'; nickname: string; count: number; items: SearchItem[] };

/**
 * Clean fingerprint by removing common formatting characters
 * Exported for reuse in other components
 * 
 * Security: Sanitizes input and enforces maximum length
 * Note: Does NOT filter to hex-only, as that's done at validation time
 */
export function cleanFingerprint(fingerprint: string): string {
  if (!fingerprint || typeof fingerprint !== 'string') {
    return '';
  }
  // Limit length to prevent DoS (40 chars for fingerprint + some tolerance for formatting)
  const limited = fingerprint.slice(0, 60);
  // Remove common formatting characters and convert to uppercase
  // Keeps alphanumeric characters for search flexibility (validation happens elsewhere)
  return limited
    .replace(/[$:\s-]/g, '')
    .replace(/[\x00-\x1f\x7f]/g, '')  // Remove control characters
    .toUpperCase();
}

/**
 * Check if a cleaned string is all hex characters
 */
function isHexString(str: string): boolean {
  for (let i = 0, len = str.length; i < len; i++) {
    const c = str.charCodeAt(i);
    // 0-9: 48-57, A-F: 65-70, a-f: 97-102
    if (!((c >= 48 && c <= 57) || (c >= 65 && c <= 70) || (c >= 97 && c <= 102))) {
      return false;
    }
  }
  return true;
}

/**
 * Check if query looks like a fingerprint (6+ consecutive hex chars)
 * Uses pre-cleaned string if available to avoid redundant work
 */
export function isLikelyFingerprint(queryClean: string): boolean {
  return queryClean.length >= MIN_FINGERPRINT_LENGTH && isHexString(queryClean);
}

/**
 * Build a flat searchable index from relay data
 */
export function buildSearchIndex(nodes: AggregatedNode[]): SearchItem[] {
  const items: SearchItem[] = [];
  const nodeCount = nodes.length;

  for (let nodeIndex = 0; nodeIndex < nodeCount; nodeIndex++) {
    const node = nodes[nodeIndex];
    const relays = node.relays;
    const relayCount = relays.length;
    
    for (let relayIndex = 0; relayIndex < relayCount; relayIndex++) {
      const relay = relays[relayIndex];
      items.push({
        nickname: relay.nickname,
        nicknameLower: relay.nickname.toLowerCase(),
        fingerprint: relay.fingerprint,
        fingerprintClean: cleanFingerprint(relay.fingerprint),
        nodeIndex,
        relayIndex,
        node,
        flags: relay.flags,
      });
    }
  }

  return items;
}

/**
 * Score a search item against a query
 * Higher score = better match, 0 = no match
 */
function scoreMatch(item: SearchItem, queryLower: string, queryClean: string, queryCleanLen: number): number {
  // Fingerprint matching (highest priority)
  if (queryCleanLen >= MIN_FINGERPRINT_LENGTH) {
    if (item.fingerprintClean === queryClean) return 1000;
    if (item.fingerprintClean.startsWith(queryClean)) return 900 + queryCleanLen;
  }

  // Nickname exact match
  if (item.nicknameLower === queryLower) return 800;

  // Nickname prefix match
  if (item.nicknameLower.startsWith(queryLower)) return 700 + queryLower.length * 5;

  // Nickname substring match
  const substringIndex = item.nicknameLower.indexOf(queryLower);
  if (substringIndex !== -1) return 500 - substringIndex;

  // Fingerprint substring (lower priority, requires 4+ chars)
  if (queryCleanLen >= 4 && item.fingerprintClean.includes(queryClean)) {
    return 300;
  }

  return 0;
}

/**
 * Search relays with grouping for duplicate nicknames
 */
export function searchRelays(
  query: string,
  index: SearchItem[],
  options?: {
    limit?: number;
    groupThreshold?: number;
  }
): SearchResult[] {
  const limit = options?.limit ?? MAX_AUTOCOMPLETE_RESULTS;
  const groupThreshold = options?.groupThreshold ?? GROUP_THRESHOLD;

  // Enforce query length bounds for security and performance
  if (query.length < MIN_QUERY_LENGTH || query.length > MAX_QUERY_LENGTH) {
    return [];
  }

  const queryLower = query.toLowerCase().trim();
  
  // Check trimmed length - whitespace-only queries should return no results
  if (queryLower.length < MIN_QUERY_LENGTH) {
    return [];
  }
  const queryClean = cleanFingerprint(query);
  const queryCleanLen = queryClean.length;
  const isFingerprintQuery = isLikelyFingerprint(queryClean);

  // Score and filter items in single pass
  const scored: { item: SearchItem; score: number }[] = [];
  for (let i = 0, len = index.length; i < len; i++) {
    const item = index[i];
    const score = scoreMatch(item, queryLower, queryClean, queryCleanLen);
    if (score > 0) {
      scored.push({ item, score });
    }
  }

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  // Fingerprint query: return individual results without grouping
  if (isFingerprintQuery) {
    const results: SearchResult[] = [];
    const count = Math.min(scored.length, limit);
    for (let i = 0; i < count; i++) {
      results.push({ type: 'relay', item: scored[i].item });
    }
    return results;
  }

  // Group by nickname for non-fingerprint queries
  const nicknameGroups = new Map<string, { items: SearchItem[]; score: number }>();

  for (let i = 0, len = scored.length; i < len; i++) {
    const { item, score } = scored[i];
    const key = item.nicknameLower;
    const group = nicknameGroups.get(key);
    if (group) {
      group.items.push(item);
    } else {
      nicknameGroups.set(key, { items: [item], score });
    }
  }

  // Build results from groups, sorted by best score
  const sortedGroups = Array.from(nicknameGroups.values()).sort((a, b) => b.score - a.score);
  const results: SearchResult[] = [];

  for (let i = 0, len = sortedGroups.length; i < len && results.length < limit; i++) {
    const { items } = sortedGroups[i];
    
    if (items.length > groupThreshold) {
      results.push({
        type: 'group',
        nickname: items[0].nickname,
        count: items.length,
        items: items.length > EXPANDED_GROUP_LIMIT ? items.slice(0, EXPANDED_GROUP_LIMIT) : items,
      });
    } else {
      for (let j = 0, jLen = items.length; j < jLen && results.length < limit; j++) {
        results.push({ type: 'relay', item: items[j] });
      }
    }
  }

  return results;
}

/**
 * Filter within a specific nickname (for expanded group filtering)
 */
export function filterByNicknameAndFingerprint(
  nickname: string,
  fingerprintQuery: string,
  index: SearchItem[],
  limit: number = EXPANDED_GROUP_LIMIT
): SearchItem[] {
  const nicknameLower = nickname.toLowerCase();
  const fpQueryClean = fingerprintQuery ? cleanFingerprint(fingerprintQuery) : '';
  const hasFpQuery = fpQueryClean.length > 0;

  // If no fingerprint filter, collect all matching nickname items up to limit
  if (!hasFpQuery) {
    const results: SearchItem[] = [];
    for (let i = 0, len = index.length; i < len && results.length < limit; i++) {
      if (index[i].nicknameLower === nicknameLower) {
        results.push(index[i]);
      }
    }
    return results;
  }

  // Score by fingerprint match
  const matches: { item: SearchItem; score: number }[] = [];
  for (let i = 0, len = index.length; i < len; i++) {
    const item = index[i];
    if (item.nicknameLower !== nicknameLower) continue;

    if (item.fingerprintClean.startsWith(fpQueryClean)) {
      matches.push({ item, score: 100 + fpQueryClean.length });
    } else if (item.fingerprintClean.includes(fpQueryClean)) {
      matches.push({ item, score: 50 });
    }
  }

  // Sort and return top results
  matches.sort((a, b) => b.score - a.score || a.item.fingerprintClean.localeCompare(b.item.fingerprintClean));
  
  const results: SearchItem[] = [];
  const count = Math.min(matches.length, limit);
  for (let i = 0; i < count; i++) {
    results.push(matches[i].item);
  }
  return results;
}

/**
 * Count relays for a nickname
 */
export function getRelayCountForNickname(nickname: string, index: SearchItem[]): number {
  const nicknameLower = nickname.toLowerCase();
  let count = 0;
  for (let i = 0, len = index.length; i < len; i++) {
    if (index[i].nicknameLower === nicknameLower) count++;
  }
  return count;
}

/**
 * Find a relay by its fingerprint (exact match)
 * Used for URL deep linking - linear search is acceptable since this is only called on URL load/hash changes
 * 
 * @param index - Search index to search through
 * @param fingerprint - Fingerprint to find (will be cleaned and uppercased)
 * @returns SearchItem if found, null otherwise
 */
export function findRelayByFingerprint(index: SearchItem[], fingerprint: string): SearchItem | null {
  const cleaned = cleanFingerprint(fingerprint);
  
  for (let i = 0, len = index.length; i < len; i++) {
    if (index[i].fingerprintClean === cleaned) {
      return index[i];
    }
  }
  
  return null;
}
