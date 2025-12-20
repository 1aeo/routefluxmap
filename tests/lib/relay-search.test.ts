import { describe, it, expect } from 'vitest';
import {
  cleanFingerprint,
  isLikelyFingerprint,
  buildSearchIndex,
  searchRelays,
  filterByNicknameAndFingerprint,
  getRelayCountForNickname,
  SEARCH_DEBOUNCE_MS,
  MAX_AUTOCOMPLETE_RESULTS,
  MIN_QUERY_LENGTH,
  MAX_QUERY_LENGTH,
  GROUP_THRESHOLD,
  EXPANDED_GROUP_LIMIT,
  MIN_FINGERPRINT_LENGTH,
  type SearchItem,
  type SearchResult,
} from '../../src/lib/utils/relay-search';
import type { AggregatedNode, RelayInfo } from '../../src/lib/types';

// ============================================================================
// Test Helpers
// ============================================================================

function createRelay(overrides: Partial<RelayInfo> = {}): RelayInfo {
  return {
    nickname: 'TestRelay',
    fingerprint: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    bandwidth: 1000000,
    flags: 'MG',
    ip: '1.2.3.4',
    port: '9001',
    ...overrides,
  };
}

function createNode(relays: RelayInfo[], lat = 0, lng = 0): AggregatedNode {
  return {
    lat,
    lng,
    x: 0,
    y: 0,
    bandwidth: relays.reduce((sum, r) => sum + r.bandwidth, 0),
    selectionWeight: 0.1,
    label: relays.length === 1 ? relays[0].nickname : `${relays.length} relays`,
    relays,
  };
}

function createTestIndex(): SearchItem[] {
  const nodes: AggregatedNode[] = [
    createNode([
      createRelay({ nickname: 'AlphaRelay', fingerprint: 'A1B2C3D4E5F6A1B2C3D4E5F6A1B2C3D4E5F6A1B2' }),
      createRelay({ nickname: 'BetaRelay', fingerprint: 'B2C3D4E5F6A1B2C3D4E5F6A1B2C3D4E5F6A1B2C3' }),
    ], 40.7128, -74.0060),
    createNode([
      createRelay({ nickname: 'GammaNode', fingerprint: 'C3D4E5F6A1B2C3D4E5F6A1B2C3D4E5F6A1B2C3D4' }),
    ], 51.5074, -0.1278),
    createNode([
      createRelay({ nickname: 'DeltaGuard', fingerprint: 'D4E5F6A1B2C3D4E5F6A1B2C3D4E5F6A1B2C3D4E5', flags: 'G' }),
    ], 48.8566, 2.3522),
  ];
  return buildSearchIndex(nodes);
}

// Create index with many relays sharing same nickname (like "psrv")
function createGroupedIndex(groupSize: number = 10): SearchItem[] {
  const relays: RelayInfo[] = [];
  for (let i = 0; i < groupSize; i++) {
    const hex = i.toString(16).padStart(2, '0').toUpperCase();
    relays.push(createRelay({
      nickname: 'psrv',
      fingerprint: `${hex}${'A'.repeat(38)}`,
    }));
  }
  const nodes = [createNode(relays, 52.52, 13.405)];
  return buildSearchIndex(nodes);
}

// ============================================================================
// Constants Tests
// ============================================================================

describe('relay-search constants', () => {
  it('has reasonable debounce duration', () => {
    expect(SEARCH_DEBOUNCE_MS).toBeGreaterThanOrEqual(100);
    expect(SEARCH_DEBOUNCE_MS).toBeLessThanOrEqual(500);
  });

  it('has sensible autocomplete limit', () => {
    expect(MAX_AUTOCOMPLETE_RESULTS).toBeGreaterThanOrEqual(10);
    expect(MAX_AUTOCOMPLETE_RESULTS).toBeLessThanOrEqual(50);
  });

  it('has minimum query length >= 1', () => {
    expect(MIN_QUERY_LENGTH).toBeGreaterThanOrEqual(1);
    expect(MIN_QUERY_LENGTH).toBeLessThanOrEqual(3);
  });

  it('has maximum query length for security', () => {
    expect(MAX_QUERY_LENGTH).toBeGreaterThanOrEqual(40); // Fingerprints are 40 chars
    expect(MAX_QUERY_LENGTH).toBeLessThanOrEqual(200);
  });

  it('has group threshold greater than 1', () => {
    expect(GROUP_THRESHOLD).toBeGreaterThan(1);
    expect(GROUP_THRESHOLD).toBeLessThan(20);
  });

  it('has expanded group limit greater than group threshold', () => {
    expect(EXPANDED_GROUP_LIMIT).toBeGreaterThan(GROUP_THRESHOLD);
  });

  it('has minimum fingerprint length for detection', () => {
    expect(MIN_FINGERPRINT_LENGTH).toBeGreaterThanOrEqual(4);
    expect(MIN_FINGERPRINT_LENGTH).toBeLessThanOrEqual(8);
  });
});

// ============================================================================
// cleanFingerprint Tests
// ============================================================================

describe('cleanFingerprint', () => {
  it('removes $ prefix', () => {
    expect(cleanFingerprint('$ABC123')).toBe('ABC123');
  });

  it('removes colons', () => {
    expect(cleanFingerprint('AA:BB:CC')).toBe('AABBCC');
  });

  it('removes spaces', () => {
    expect(cleanFingerprint('AA BB CC')).toBe('AABBCC');
  });

  it('removes hyphens', () => {
    expect(cleanFingerprint('AA-BB-CC')).toBe('AABBCC');
  });

  it('converts to uppercase', () => {
    expect(cleanFingerprint('abcdef')).toBe('ABCDEF');
  });

  it('handles mixed formatting', () => {
    expect(cleanFingerprint('$aa:bb-cc dd')).toBe('AABBCCDD');
  });

  it('handles empty string', () => {
    expect(cleanFingerprint('')).toBe('');
  });

  it('handles already clean fingerprint', () => {
    const clean = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    expect(cleanFingerprint(clean)).toBe(clean);
  });

  it('handles full fingerprint with colons', () => {
    const fp = 'AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD';
    expect(cleanFingerprint(fp)).toBe('AABBCCDDEEFF00112233445566778899AABBCCDD');
  });

  it('handles $ prefix with colons', () => {
    expect(cleanFingerprint('$AA:BB:CC')).toBe('AABBCC');
  });
});

// ============================================================================
// isLikelyFingerprint Tests
// ============================================================================

describe('isLikelyFingerprint', () => {
  it('returns true for hex strings >= MIN_FINGERPRINT_LENGTH', () => {
    expect(isLikelyFingerprint('AABBCC')).toBe(true); // 6 chars
    expect(isLikelyFingerprint('AABBCCDD')).toBe(true); // 8 chars
  });

  it('returns false for short hex strings', () => {
    expect(isLikelyFingerprint('AABB')).toBe(false); // 4 chars
    expect(isLikelyFingerprint('ABC')).toBe(false); // 3 chars
  });

  it('returns true for full 40-char fingerprint', () => {
    const fp = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    expect(isLikelyFingerprint(fp)).toBe(true);
  });

  it('returns false for non-hex characters', () => {
    expect(isLikelyFingerprint('GHIJKL')).toBe(false);
    expect(isLikelyFingerprint('ZZZZZZ')).toBe(false);
  });

  it('returns true for lowercase hex (assumes pre-cleaned)', () => {
    // isLikelyFingerprint accepts lowercase since hex check includes a-f
    expect(isLikelyFingerprint('aabbcc')).toBe(true);
  });

  it('returns false for mixed non-hex content', () => {
    expect(isLikelyFingerprint('ABC123XYZ')).toBe(false);
  });

  it('returns true for numeric-only hex', () => {
    expect(isLikelyFingerprint('123456')).toBe(true);
    expect(isLikelyFingerprint('000000')).toBe(true);
  });

  it('returns false for empty string', () => {
    expect(isLikelyFingerprint('')).toBe(false);
  });

  it('handles boundary cases around MIN_FINGERPRINT_LENGTH', () => {
    const len = MIN_FINGERPRINT_LENGTH;
    expect(isLikelyFingerprint('A'.repeat(len - 1))).toBe(false);
    expect(isLikelyFingerprint('A'.repeat(len))).toBe(true);
    expect(isLikelyFingerprint('A'.repeat(len + 1))).toBe(true);
  });
});

// ============================================================================
// buildSearchIndex Tests
// ============================================================================

describe('buildSearchIndex', () => {
  it('creates empty index from empty nodes', () => {
    const index = buildSearchIndex([]);
    expect(index).toEqual([]);
  });

  it('creates index with correct item count', () => {
    const nodes = [
      createNode([createRelay(), createRelay()]),
      createNode([createRelay()]),
    ];
    const index = buildSearchIndex(nodes);
    expect(index).toHaveLength(3);
  });

  it('stores correct node and relay indices', () => {
    const nodes = [
      createNode([createRelay({ nickname: 'First' }), createRelay({ nickname: 'Second' })]),
      createNode([createRelay({ nickname: 'Third' })]),
    ];
    const index = buildSearchIndex(nodes);
    
    expect(index[0].nodeIndex).toBe(0);
    expect(index[0].relayIndex).toBe(0);
    expect(index[1].nodeIndex).toBe(0);
    expect(index[1].relayIndex).toBe(1);
    expect(index[2].nodeIndex).toBe(1);
    expect(index[2].relayIndex).toBe(0);
  });

  it('stores lowercase nickname for matching', () => {
    const nodes = [createNode([createRelay({ nickname: 'MyRelay' })])];
    const index = buildSearchIndex(nodes);
    expect(index[0].nickname).toBe('MyRelay');
    expect(index[0].nicknameLower).toBe('myrelay');
  });

  it('stores cleaned fingerprint for matching', () => {
    const nodes = [createNode([createRelay({ fingerprint: 'AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD' })])];
    const index = buildSearchIndex(nodes);
    expect(index[0].fingerprintClean).toBe('AABBCCDDEEFF00112233445566778899AABBCCDD');
  });

  it('stores node reference for location access', () => {
    const node = createNode([createRelay()], 52.52, 13.405);
    const index = buildSearchIndex([node]);
    expect(index[0].node).toBe(node);
    expect(index[0].node.lat).toBe(52.52);
    expect(index[0].node.lng).toBe(13.405);
  });

  it('stores flags for relay type identification', () => {
    const nodes = [createNode([createRelay({ flags: 'GE' })])];
    const index = buildSearchIndex(nodes);
    expect(index[0].flags).toBe('GE');
  });
});

// ============================================================================
// searchRelays Tests - Basic Functionality
// ============================================================================

describe('searchRelays - basic functionality', () => {
  const index = createTestIndex();

  it('returns empty array for query shorter than MIN_QUERY_LENGTH', () => {
    expect(searchRelays('a', index)).toEqual([]);
    if (MIN_QUERY_LENGTH >= 2) {
      expect(searchRelays('', index)).toEqual([]);
    }
  });

  it('returns empty array for query longer than MAX_QUERY_LENGTH', () => {
    const longQuery = 'a'.repeat(MAX_QUERY_LENGTH + 1);
    expect(searchRelays(longQuery, index)).toEqual([]);
  });

  it('returns empty array for empty index', () => {
    expect(searchRelays('test', [])).toEqual([]);
  });

  it('returns results for matching nickname', () => {
    const results = searchRelays('alpha', index);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].type).toBe('relay');
    if (results[0].type === 'relay') {
      expect(results[0].item.nickname).toBe('AlphaRelay');
    }
  });

  it('is case insensitive for nickname search', () => {
    const lower = searchRelays('alpha', index);
    const upper = searchRelays('ALPHA', index);
    const mixed = searchRelays('AlPhA', index);
    expect(lower.length).toBe(upper.length);
    expect(lower.length).toBe(mixed.length);
  });

  it('trims whitespace from query', () => {
    const results = searchRelays('  alpha  ', index);
    expect(results.length).toBeGreaterThan(0);
  });

  it('respects limit option', () => {
    const results = searchRelays('relay', index, { limit: 1 });
    expect(results.length).toBeLessThanOrEqual(1);
  });
});

// ============================================================================
// searchRelays Tests - Scoring and Ranking
// ============================================================================

describe('searchRelays - scoring and ranking', () => {
  it('ranks exact nickname match highest', () => {
    const nodes = [
      createNode([createRelay({ nickname: 'test' })]),
      createNode([createRelay({ nickname: 'testing' })]),
      createNode([createRelay({ nickname: 'mytest' })]),
    ];
    const index = buildSearchIndex(nodes);
    const results = searchRelays('test', index);
    
    expect(results.length).toBe(3);
    expect(results[0].type).toBe('relay');
    if (results[0].type === 'relay') {
      expect(results[0].item.nickname).toBe('test');
    }
  });

  it('ranks prefix match before substring match', () => {
    const nodes = [
      createNode([createRelay({ nickname: 'mytorrelay' })]),
      createNode([createRelay({ nickname: 'torrelay' })]),
    ];
    const index = buildSearchIndex(nodes);
    const results = searchRelays('tor', index);
    
    expect(results.length).toBe(2);
    if (results[0].type === 'relay') {
      expect(results[0].item.nickname).toBe('torrelay');
    }
  });

  it('ranks earlier substring matches higher', () => {
    const nodes = [
      createNode([createRelay({ nickname: 'zzzzrelay' })]), // 'relay' at index 4
      createNode([createRelay({ nickname: 'zrelay' })]), // 'relay' at index 1
    ];
    const index = buildSearchIndex(nodes);
    const results = searchRelays('relay', index);
    
    expect(results.length).toBe(2);
    if (results[0].type === 'relay') {
      expect(results[0].item.nickname).toBe('zrelay');
    }
  });
});

// ============================================================================
// searchRelays Tests - Fingerprint Search
// ============================================================================

describe('searchRelays - fingerprint search', () => {
  it('matches fingerprint prefix', () => {
    const nodes = [createNode([createRelay({ fingerprint: 'AABBCC1122334455667788990011223344556677' })])];
    const index = buildSearchIndex(nodes);
    const results = searchRelays('AABBCC', index);
    
    expect(results.length).toBe(1);
    expect(results[0].type).toBe('relay');
  });

  it('matches fingerprint with $ prefix', () => {
    const nodes = [createNode([createRelay({ fingerprint: 'AABBCC1122334455667788990011223344556677' })])];
    const index = buildSearchIndex(nodes);
    const results = searchRelays('$AABBCC', index);
    
    expect(results.length).toBe(1);
  });

  it('matches fingerprint case insensitively', () => {
    const nodes = [createNode([createRelay({ fingerprint: 'AABBCC1122334455667788990011223344556677' })])];
    const index = buildSearchIndex(nodes);
    const results = searchRelays('aabbcc', index);
    
    expect(results.length).toBe(1);
  });

  it('does not group results for fingerprint queries', () => {
    // Create multiple relays with same fingerprint prefix but different nicknames
    const nodes = [
      createNode([createRelay({ nickname: 'Relay1', fingerprint: 'AA11BB22CC334455667788990011223344556677' })]),
      createNode([createRelay({ nickname: 'Relay2', fingerprint: 'AA11CC22DD334455667788990011223344556677' })]),
    ];
    const index = buildSearchIndex(nodes);
    const results = searchRelays('AA11', index);
    
    // Both should be individual results, not grouped
    expect(results.every(r => r.type === 'relay')).toBe(true);
    expect(results.length).toBe(2);
  });

  it('ranks exact fingerprint match highest', () => {
    const exactFp = 'AABBCCDD1122334455667788990011223344EEFF';
    const nodes = [
      createNode([createRelay({ fingerprint: 'AABBCCDDEE11223344556677889900112233FF00' })]),
      createNode([createRelay({ fingerprint: exactFp })]),
    ];
    const index = buildSearchIndex(nodes);
    const results = searchRelays(exactFp, index);
    
    expect(results[0].type).toBe('relay');
    if (results[0].type === 'relay') {
      expect(results[0].item.fingerprint).toBe(exactFp);
    }
  });
});

// ============================================================================
// searchRelays Tests - Grouping Behavior
// ============================================================================

describe('searchRelays - grouping behavior', () => {
  it('groups relays with same nickname when count > threshold', () => {
    const index = createGroupedIndex(GROUP_THRESHOLD + 5);
    const results = searchRelays('psrv', index);
    
    expect(results.length).toBe(1);
    expect(results[0].type).toBe('group');
    if (results[0].type === 'group') {
      expect(results[0].nickname).toBe('psrv');
      expect(results[0].count).toBe(GROUP_THRESHOLD + 5);
    }
  });

  it('does not group relays when count <= threshold', () => {
    const index = createGroupedIndex(GROUP_THRESHOLD);
    const results = searchRelays('psrv', index);
    
    // Should be individual relay results
    expect(results.every(r => r.type === 'relay')).toBe(true);
    expect(results.length).toBe(GROUP_THRESHOLD);
  });

  it('respects custom groupThreshold option', () => {
    const index = createGroupedIndex(10);
    
    // With threshold=5, should group
    const grouped = searchRelays('psrv', index, { groupThreshold: 5 });
    expect(grouped.length).toBe(1);
    expect(grouped[0].type).toBe('group');
    
    // With threshold=15, should not group
    const ungrouped = searchRelays('psrv', index, { groupThreshold: 15 });
    expect(ungrouped.every(r => r.type === 'relay')).toBe(true);
  });

  it('limits items in group to EXPANDED_GROUP_LIMIT', () => {
    const index = createGroupedIndex(EXPANDED_GROUP_LIMIT + 10);
    const results = searchRelays('psrv', index);
    
    expect(results[0].type).toBe('group');
    if (results[0].type === 'group') {
      expect(results[0].items.length).toBeLessThanOrEqual(EXPANDED_GROUP_LIMIT);
      expect(results[0].count).toBe(EXPANDED_GROUP_LIMIT + 10); // Full count preserved
    }
  });

  it('preserves original nickname casing in group', () => {
    // Create relays with mixed case nicknames that lowercase to same value
    const relays = Array(10).fill(null).map((_, i) => 
      createRelay({ 
        nickname: i % 2 === 0 ? 'TestRelay' : 'testrelay',
        fingerprint: `${i.toString(16).padStart(2, '0')}${'A'.repeat(38)}`
      })
    );
    const nodes = [createNode(relays)];
    const index = buildSearchIndex(nodes);
    const results = searchRelays('testrelay', index);
    
    expect(results[0].type).toBe('group');
    if (results[0].type === 'group') {
      // Should use first item's casing
      expect(['TestRelay', 'testrelay']).toContain(results[0].nickname);
    }
  });
});

// ============================================================================
// searchRelays Tests - Mixed Results
// ============================================================================

describe('searchRelays - mixed results', () => {
  it('returns both groups and individual relays', () => {
    // Create some grouped relays and some individual ones
    const groupedRelays = Array(10).fill(null).map((_, i) => 
      createRelay({ 
        nickname: 'popular',
        fingerprint: `${i.toString(16).padStart(2, '0')}${'A'.repeat(38)}`
      })
    );
    const nodes = [
      createNode(groupedRelays),
      createNode([createRelay({ nickname: 'popularnew' })]), // Matches 'popular' substring
    ];
    const index = buildSearchIndex(nodes);
    const results = searchRelays('popular', index);
    
    const groups = results.filter(r => r.type === 'group');
    const relays = results.filter(r => r.type === 'relay');
    
    expect(groups.length).toBe(1);
    expect(relays.length).toBeGreaterThanOrEqual(1);
  });

  it('sorts groups by best match score', () => {
    // Create two groups where one has exact match, other has prefix match
    const exactRelays = Array(10).fill(null).map((_, i) => 
      createRelay({ nickname: 'test', fingerprint: `1${i}${'A'.repeat(37)}` })
    );
    const prefixRelays = Array(10).fill(null).map((_, i) => 
      createRelay({ nickname: 'testing', fingerprint: `2${i}${'A'.repeat(37)}` })
    );
    const nodes = [
      createNode(prefixRelays),
      createNode(exactRelays),
    ];
    const index = buildSearchIndex(nodes);
    const results = searchRelays('test', index);
    
    // Exact match group should come first
    expect(results[0].type).toBe('group');
    if (results[0].type === 'group') {
      expect(results[0].nickname).toBe('test');
    }
  });
});

// ============================================================================
// filterByNicknameAndFingerprint Tests
// ============================================================================

describe('filterByNicknameAndFingerprint', () => {
  const groupedIndex = createGroupedIndex(20);

  it('returns all relays with matching nickname when no fingerprint query', () => {
    const results = filterByNicknameAndFingerprint('psrv', '', groupedIndex);
    expect(results.length).toBe(20);
  });

  it('filters by fingerprint prefix', () => {
    const results = filterByNicknameAndFingerprint('psrv', '00', groupedIndex);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.every(r => r.fingerprintClean.startsWith('00'))).toBe(true);
  });

  it('filters by fingerprint substring', () => {
    // All our test fingerprints have 'AAA' in them
    const results = filterByNicknameAndFingerprint('psrv', 'AAA', groupedIndex);
    expect(results.length).toBeGreaterThan(0);
  });

  it('is case insensitive for nickname', () => {
    const lower = filterByNicknameAndFingerprint('psrv', '', groupedIndex);
    const upper = filterByNicknameAndFingerprint('PSRV', '', groupedIndex);
    expect(lower.length).toBe(upper.length);
  });

  it('cleans fingerprint query before matching', () => {
    const withColon = filterByNicknameAndFingerprint('psrv', '00:AA', groupedIndex);
    const clean = filterByNicknameAndFingerprint('psrv', '00AA', groupedIndex);
    expect(withColon.length).toBe(clean.length);
  });

  it('ranks prefix matches before substring matches', () => {
    // Create index where some have prefix match, others substring
    const relays = [
      createRelay({ nickname: 'test', fingerprint: 'ABCD' + 'E'.repeat(36) }), // prefix match for 'ABC'
      createRelay({ nickname: 'test', fingerprint: 'EEABCD' + 'F'.repeat(34) }), // substring match for 'ABC'
    ];
    const nodes = [createNode(relays)];
    const index = buildSearchIndex(nodes);
    
    const results = filterByNicknameAndFingerprint('test', 'ABC', index);
    expect(results[0].fingerprintClean.startsWith('ABCD')).toBe(true);
  });

  it('respects limit parameter', () => {
    const results = filterByNicknameAndFingerprint('psrv', '', groupedIndex, 5);
    expect(results.length).toBe(5);
  });

  it('returns empty array for non-matching nickname', () => {
    const results = filterByNicknameAndFingerprint('nonexistent', '', groupedIndex);
    expect(results).toEqual([]);
  });

  it('returns empty array for non-matching fingerprint', () => {
    const results = filterByNicknameAndFingerprint('psrv', 'ZZZZZZ', groupedIndex);
    expect(results).toEqual([]);
  });
});

// ============================================================================
// getRelayCountForNickname Tests
// ============================================================================

describe('getRelayCountForNickname', () => {
  it('returns correct count for existing nickname', () => {
    const index = createGroupedIndex(15);
    expect(getRelayCountForNickname('psrv', index)).toBe(15);
  });

  it('returns 0 for non-existing nickname', () => {
    const index = createGroupedIndex(10);
    expect(getRelayCountForNickname('nonexistent', index)).toBe(0);
  });

  it('is case insensitive', () => {
    const index = createGroupedIndex(10);
    expect(getRelayCountForNickname('PSRV', index)).toBe(10);
    expect(getRelayCountForNickname('PsRv', index)).toBe(10);
  });

  it('returns 0 for empty index', () => {
    expect(getRelayCountForNickname('test', [])).toBe(0);
  });

  it('counts unique relays, not groups', () => {
    const nodes = [
      createNode([
        createRelay({ nickname: 'relay' }),
        createRelay({ nickname: 'relay' }),
      ]),
      createNode([
        createRelay({ nickname: 'relay' }),
      ]),
    ];
    const index = buildSearchIndex(nodes);
    expect(getRelayCountForNickname('relay', index)).toBe(3);
  });
});

// ============================================================================
// Edge Cases and Security Tests
// ============================================================================

describe('edge cases and security', () => {
  it('handles special regex characters in query', () => {
    const nodes = [createNode([createRelay({ nickname: 'test.relay' })])];
    const index = buildSearchIndex(nodes);
    
    // Should not throw or match incorrectly
    expect(() => searchRelays('test.', index)).not.toThrow();
    expect(() => searchRelays('test.*', index)).not.toThrow();
    expect(() => searchRelays('(test)', index)).not.toThrow();
  });

  it('handles unicode characters in query', () => {
    const nodes = [createNode([createRelay({ nickname: 'testüöä' })])];
    const index = buildSearchIndex(nodes);
    
    expect(() => searchRelays('testü', index)).not.toThrow();
    const results = searchRelays('testü', index);
    expect(results.length).toBe(1);
  });

  it('handles emoji in query gracefully', () => {
    expect(() => searchRelays('test🔥', [])).not.toThrow();
  });

  it('handles very long query up to MAX_QUERY_LENGTH', () => {
    const index = createTestIndex();
    const maxQuery = 'a'.repeat(MAX_QUERY_LENGTH);
    expect(() => searchRelays(maxQuery, index)).not.toThrow();
    expect(searchRelays(maxQuery, index)).toEqual([]);
  });

  it('handles whitespace-only query', () => {
    const index = createTestIndex();
    const results = searchRelays('   ', index);
    // Whitespace-only queries should return no results after trimming
    expect(results).toEqual([]);
  });

  it('handles query with only special characters', () => {
    const index = createTestIndex();
    const results = searchRelays('$::-', index);
    expect(results).toEqual([]);
  });

  it('handles null-like values in relay data', () => {
    const relay = createRelay({ nickname: '' });
    const nodes = [createNode([relay])];
    expect(() => buildSearchIndex(nodes)).not.toThrow();
  });
});

// ============================================================================
// Performance Considerations Tests
// ============================================================================

describe('performance characteristics', () => {
  it('handles large index efficiently', () => {
    // Create index with 1000 relays
    const relays = Array(1000).fill(null).map((_, i) => 
      createRelay({ 
        nickname: `Relay${i}`,
        fingerprint: i.toString(16).padStart(40, '0').toUpperCase()
      })
    );
    const nodes = [createNode(relays)];
    const index = buildSearchIndex(nodes);
    
    const start = performance.now();
    searchRelays('relay', index);
    const duration = performance.now() - start;
    
    // Should complete in reasonable time (< 100ms)
    expect(duration).toBeLessThan(100);
  });

  it('early-exits on empty query', () => {
    const index = createGroupedIndex(100);
    const start = performance.now();
    searchRelays('', index);
    const duration = performance.now() - start;
    
    // Should be very fast (< 10ms even with timing variance)
    expect(duration).toBeLessThan(10);
  });

  it('early-exits on too-long query', () => {
    const index = createGroupedIndex(100);
    const start = performance.now();
    searchRelays('x'.repeat(MAX_QUERY_LENGTH + 1), index);
    const duration = performance.now() - start;
    
    // Should be very fast (< 10ms even with timing variance)
    expect(duration).toBeLessThan(10);
  });
});

// ============================================================================
// Integration-style Tests
// ============================================================================

describe('realistic search scenarios', () => {
  it('finds relay by partial nickname "tor"', () => {
    const nodes = [
      createNode([createRelay({ nickname: 'TorRelay1' })]),
      createNode([createRelay({ nickname: 'MyTorNode' })]),
      createNode([createRelay({ nickname: 'FastRelay' })]),
    ];
    const index = buildSearchIndex(nodes);
    const results = searchRelays('tor', index);
    
    expect(results.length).toBe(2);
  });

  it('finds relay by fingerprint prefix from metrics URL', () => {
    const fp = '9695DFC35FFEB861329B9F1AB04C46397020CE31';
    const nodes = [createNode([createRelay({ fingerprint: fp })])];
    const index = buildSearchIndex(nodes);
    
    // User might paste with $
    const results = searchRelays('$9695DF', index);
    expect(results.length).toBe(1);
  });

  it('handles "psrv" operator pattern (many relays, same nickname)', () => {
    // psrv runs hundreds of relays with same nickname
    const index = createGroupedIndex(200);
    const results = searchRelays('psrv', index);
    
    expect(results.length).toBe(1);
    expect(results[0].type).toBe('group');
    if (results[0].type === 'group') {
      expect(results[0].count).toBe(200);
      expect(results[0].items.length).toBeLessThanOrEqual(EXPANDED_GROUP_LIMIT);
    }
  });

  it('allows drilling into group by fingerprint', () => {
    const index = createGroupedIndex(200);
    
    // First, user searches nickname and gets group
    const groupResults = searchRelays('psrv', index);
    expect(groupResults[0].type).toBe('group');
    
    // Then, user filters within group by fingerprint
    const filtered = filterByNicknameAndFingerprint('psrv', '0A', index);
    expect(filtered.length).toBeGreaterThan(0);
    expect(filtered.length).toBeLessThan(200);
  });

  it('prioritizes exact nickname over fingerprint for short queries', () => {
    // Create relay where nickname looks like hex
    const nodes = [
      createNode([createRelay({ nickname: 'AABBCC', fingerprint: 'FFFFFF' + 'A'.repeat(34) })]),
      createNode([createRelay({ nickname: 'Test', fingerprint: 'AABBCC' + 'B'.repeat(34) })]),
    ];
    const index = buildSearchIndex(nodes);
    
    // Query 'AABBCC' matches as exact nickname and fingerprint prefix
    const results = searchRelays('AABBCC', index);
    
    // Fingerprint query path is taken for 6+ hex chars, so both should be results
    expect(results.length).toBe(2);
  });
});

