/**
 * RelaySearch - Autocomplete search for relays by nickname or fingerprint
 * Features inline expansion for grouped results (e.g., operators with many relays)
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  searchRelays,
  filterByNicknameAndFingerprint,
  getRelayCountForNickname,
  SEARCH_DEBOUNCE_MS,
  EXPANDED_GROUP_LIMIT,
  MAX_QUERY_LENGTH,
  type SearchItem,
  type SearchResult,
} from '../../lib/utils/relay-search';
import { config } from '../../lib/config';

// Pre-computed relay type colors (computed once at module load)
const RELAY_TYPE_COLORS = {
  exit: `rgb(${config.relayColors.exit.slice(0, 3).join(',')})`,
  guard: `rgb(${config.relayColors.guard.slice(0, 3).join(',')})`,
  middle: `rgb(${config.relayColors.middle.slice(0, 3).join(',')})`,
} as const;

// Type labels
const TYPE_LABELS = { exit: 'Exit', guard: 'Guard', middle: 'Middle' } as const;

interface RelaySearchProps {
  searchIndex: SearchItem[];
  onSelectRelay: (nodeIndex: number, relayIndex: number, fingerprint: string) => void;
  disabled?: boolean;
}

// Inline SVG paths as constants to avoid recreating
const CHEVRON_PATH = "M9 5l7 7-7 7";
const SEARCH_PATH = "M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z";
const CLOSE_PATH = "M6 18L18 6M6 6l12 12";

function getRelayType(flags: string): 'exit' | 'guard' | 'middle' {
  if (flags.includes('E')) return 'exit';
  if (flags.includes('G')) return 'guard';
  return 'middle';
}

// Flat item type for keyboard navigation
type FlatItem = 
  | { type: 'group'; nickname: string; count: number }
  | { type: 'relay' | 'expanded'; item: SearchItem };

export default function RelaySearch({ searchIndex, onSelectRelay, disabled = false }: RelaySearchProps) {
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [expandedNickname, setExpandedNickname] = useState<string | null>(null);
  const [expandedItems, setExpandedItems] = useState<SearchItem[]>([]);
  const [expandedTotalCount, setExpandedTotalCount] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const selectedItemRef = useRef<HTMLDivElement>(null);

  // Debounce query updates
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  // Perform search when debounced query changes
  useEffect(() => {
    const trimmedQuery = debouncedQuery.trim();
    if (!trimmedQuery) {
      setResults([]);
      setExpandedNickname(null);
      setExpandedItems([]);
      setExpandedTotalCount(0);
      return;
    }

    // Check if filtering within an expanded group
    if (expandedNickname) {
      const spaceIndex = debouncedQuery.indexOf(' ');
      const nickname = spaceIndex === -1 ? debouncedQuery : debouncedQuery.slice(0, spaceIndex);
      
      if (nickname.toLowerCase() === expandedNickname.toLowerCase()) {
        const fingerprintPart = spaceIndex === -1 ? '' : debouncedQuery.slice(spaceIndex + 1).replace(/\s+/g, '');
        const filtered = filterByNicknameAndFingerprint(expandedNickname, fingerprintPart, searchIndex);
        setExpandedItems(filtered);
        setSelectedIndex(0);
        return;
      }
      // Query changed to different nickname, collapse
      setExpandedNickname(null);
      setExpandedItems([]);
      setExpandedTotalCount(0);
    }

    setResults(searchRelays(debouncedQuery, searchIndex));
    setSelectedIndex(0);
  }, [debouncedQuery, searchIndex, expandedNickname]);

  // Flat list for keyboard navigation (memoized)
  const flatItems = useMemo((): FlatItem[] => {
    if (expandedNickname && expandedItems.length > 0) {
      const items: FlatItem[] = [{ type: 'group', nickname: expandedNickname, count: expandedTotalCount }];
      for (let i = 0; i < expandedItems.length; i++) {
        items.push({ type: 'expanded', item: expandedItems[i] });
      }
      return items;
    }
    
    const items: FlatItem[] = [];
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.type === 'relay') {
        items.push({ type: 'relay', item: result.item });
      } else {
        items.push({ type: 'group', nickname: result.nickname, count: result.count });
      }
    }
    return items;
  }, [results, expandedNickname, expandedItems, expandedTotalCount]);

  // Scroll selected item into view
  useEffect(() => {
    selectedItemRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selectedIndex]);

  // Handle item selection
  const handleSelectItem = useCallback((item: FlatItem) => {
    if (item.type === 'group') {
      const items = filterByNicknameAndFingerprint(item.nickname, '', searchIndex);
      const totalCount = getRelayCountForNickname(item.nickname, searchIndex);
      setExpandedNickname(item.nickname);
      setExpandedItems(items);
      setExpandedTotalCount(totalCount);
      setSelectedIndex(1);
      setQuery(item.nickname);
    } else {
      onSelectRelay(item.item.nodeIndex, item.item.relayIndex, item.item.fingerprint);
      setIsOpen(false);
      setQuery('');
      setExpandedNickname(null);
      setExpandedItems([]);
      setExpandedTotalCount(0);
      inputRef.current?.blur();
    }
  }, [searchIndex, onSelectRelay]);

  // Keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    const itemCount = flatItems.length;
    
    if (!isOpen && e.key !== 'Escape') {
      if (query.trim() && (e.key === 'ArrowDown' || e.key === 'Enter')) {
        setIsOpen(true);
        e.preventDefault();
        return;
      }
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex(i => Math.min(i + 1, itemCount - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex(i => Math.max(i - 1, 0));
        break;
      case 'Enter':
        e.preventDefault();
        if (itemCount > 0 && selectedIndex < itemCount) {
          handleSelectItem(flatItems[selectedIndex]);
        }
        break;
      case 'Escape':
        e.preventDefault();
        if (expandedNickname) {
          setExpandedNickname(null);
          setExpandedItems([]);
          setExpandedTotalCount(0);
          const baseQuery = query.split(/\s+/)[0];
          if (baseQuery !== query) setQuery(baseQuery);
        } else if (isOpen) {
          setIsOpen(false);
        } else {
          setQuery('');
        }
        break;
      case 'Tab':
        setIsOpen(false);
        break;
    }
  }, [isOpen, flatItems, selectedIndex, query, expandedNickname, handleSelectItem]);

  // Click outside to close
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (dropdownRef.current?.contains(target) || inputRef.current?.contains(target)) return;
      setIsOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleFocus = useCallback(() => {
    if (query.trim() && flatItems.length > 0) setIsOpen(true);
  }, [query, flatItems.length]);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setQuery(value);
    if (value.trim()) {
      setIsOpen(true);
    } else {
      setIsOpen(false);
      setExpandedNickname(null);
      setExpandedItems([]);
      setExpandedTotalCount(0);
    }
  }, []);

  const handleClear = useCallback(() => {
    setQuery('');
    setIsOpen(false);
    setExpandedNickname(null);
    setExpandedItems([]);
    setExpandedTotalCount(0);
    inputRef.current?.focus();
  }, []);

  const showDropdown = isOpen && flatItems.length > 0;
  const showNoResults = isOpen && query.trim().length >= 2 && flatItems.length === 0 && !disabled;
  const showMoreFooter = expandedNickname && expandedItems.length >= EXPANDED_GROUP_LIMIT;
  const moreCount = showMoreFooter ? expandedTotalCount - expandedItems.length : 0;

  return (
    <div className="relative">
      {/* Search input */}
      <div className="relative">
        <div className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
          <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={SEARCH_PATH} />
          </svg>
        </div>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onFocus={handleFocus}
          placeholder="Search by nickname or fingerprint..."
          disabled={disabled}
          maxLength={MAX_QUERY_LENGTH}
          autoComplete="off"
          spellCheck={false}
          className={`w-full pl-9 pr-8 py-2 bg-black/40 backdrop-blur-md border border-tor-green/20 rounded-lg text-white text-sm placeholder-gray-500 placeholder:text-xs focus:outline-none focus:border-tor-green/50 transition-colors ${
            disabled ? 'opacity-50 cursor-not-allowed' : ''
          }`}
        />
        {query && (
          <button
            onClick={handleClear}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-white transition-colors"
            aria-label="Clear search"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={CLOSE_PATH} />
            </svg>
          </button>
        )}
      </div>

      {/* Dropdown */}
      {showDropdown && (
        <div
          ref={dropdownRef}
          className="absolute top-full left-0 right-0 mt-1 bg-black/90 backdrop-blur-md border border-tor-green/30 rounded-lg shadow-xl overflow-hidden z-50 max-h-80 overflow-y-auto"
        >
          {flatItems.map((item, index) => {
            const isSelected = index === selectedIndex;
            
            if (item.type === 'group') {
              const isExpanded = expandedNickname === item.nickname;
              return (
                <div
                  key={`g-${item.nickname}`}
                  ref={isSelected ? selectedItemRef : undefined}
                  onClick={() => handleSelectItem(item)}
                  className={`flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors ${
                    isExpanded ? 'bg-white/10' : isSelected ? 'bg-white/5' : 'hover:bg-white/5'
                  }`}
                >
                  <svg
                    className={`w-4 h-4 transition-transform duration-200 ${isExpanded ? 'rotate-90 text-tor-green' : 'text-gray-400'}`}
                    fill="none" stroke="currentColor" viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={CHEVRON_PATH} />
                  </svg>
                  <span className={`font-medium ${isExpanded ? 'text-tor-green' : 'text-white'}`}>{item.nickname}</span>
                  <span className="text-gray-500 text-xs">({item.count} relays)</span>
                </div>
              );
            }
            
            const { item: searchItem } = item;
            const type = getRelayType(searchItem.flags);
            const color = RELAY_TYPE_COLORS[type];
            const isExpanded = item.type === 'expanded';
            
            return (
              <div
                key={`r-${searchItem.fingerprint}`}
                ref={isSelected ? selectedItemRef : undefined}
                onClick={() => handleSelectItem(item)}
                className={`flex items-center gap-2 px-3 cursor-pointer transition-colors ${
                  isExpanded ? 'py-1.5 pl-8' : 'py-2'
                } ${isSelected ? 'bg-tor-green/20' : 'hover:bg-white/5'}`}
              >
                {isExpanded ? (
                  <>
                    <code className="text-tor-green font-mono text-sm">{searchItem.fingerprint.slice(0, 16)}...</code>
                    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded" style={{ color, backgroundColor: `${color}20` }}>
                      {TYPE_LABELS[type]}
                    </span>
                  </>
                ) : (
                  <>
                    <span className="text-white font-medium truncate flex-1">{searchItem.nickname}</span>
                    <code className="text-gray-500 text-xs font-mono">{searchItem.fingerprint.slice(0, 12)}...</code>
                    <span className="text-xs font-medium px-1.5 py-0.5 rounded" style={{ color, backgroundColor: `${color}20` }}>
                      {TYPE_LABELS[type]}
                    </span>
                  </>
                )}
              </div>
            );
          })}
          
          {showMoreFooter && moreCount > 0 && (
            <div className="px-3 py-1.5 pl-8 text-gray-500 text-xs italic border-t border-white/10">
              ... and {moreCount} more — type fingerprint to filter
            </div>
          )}
        </div>
      )}

      {/* No results */}
      {showNoResults && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-black/90 backdrop-blur-md border border-tor-green/30 rounded-lg shadow-xl p-4 z-50">
          <p className="text-gray-400 text-sm text-center">No relays found</p>
        </div>
      )}
    </div>
  );
}
