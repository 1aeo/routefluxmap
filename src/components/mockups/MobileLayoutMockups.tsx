/**
 * Mobile Layout Mockups - Visual demonstrations of different solutions
 * for the search bar / layer toggles overlap issue.
 * 
 * These are standalone mockup components for review purposes.
 */

import { useState } from 'react';

// Shared styles
const mockupContainer = "relative w-[375px] h-[667px] bg-gray-900 rounded-xl overflow-hidden border-4 border-gray-700";
const mockupLabel = "absolute top-2 right-2 bg-black/80 text-white text-xs px-2 py-1 rounded z-50";

// ============================================================================
// OPTION 2: Collapsible Header on Mobile
// ============================================================================
// The header collapses to just an icon button. Tap to expand and see
// logo + layer toggles. Search bar stays at top full-width.

export function Option2_CollapsibleHeader() {
  const [headerExpanded, setHeaderExpanded] = useState(false);

  return (
    <div className={mockupContainer}>
      <div className={mockupLabel}>Option 2: Collapsible Header</div>
      
      {/* Map background placeholder */}
      <div className="absolute inset-0 bg-gradient-to-b from-gray-800 to-gray-900">
        <div className="absolute inset-0 opacity-20">
          {/* Fake map dots */}
          {Array.from({ length: 50 }).map((_, i) => (
            <div
              key={i}
              className="absolute w-1 h-1 bg-green-400 rounded-full"
              style={{
                left: `${Math.random() * 100}%`,
                top: `${Math.random() * 100}%`,
              }}
            />
          ))}
        </div>
      </div>

      {/* Search Bar - Full width at top */}
      <div className="absolute top-4 left-14 right-4 z-20">
        <div className="relative">
          <div className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
            <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
          <input
            type="text"
            placeholder="Search by nickname or fingerprint..."
            className="w-full pl-9 pr-4 py-2 bg-black/40 backdrop-blur-md border border-green-500/20 rounded-lg text-white text-sm placeholder-gray-500 placeholder:text-xs"
            readOnly
          />
        </div>
      </div>

      {/* Collapsible Header Button / Panel */}
      <div className="absolute top-4 left-4 z-20">
        {!headerExpanded ? (
          /* Collapsed state - just menu icon */
          <button
            onClick={() => setHeaderExpanded(true)}
            className="w-10 h-10 flex items-center justify-center bg-black/40 backdrop-blur-md rounded-lg border border-green-500/20 text-green-400"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
        ) : (
          /* Expanded state - full header */
          <div className="bg-black/40 backdrop-blur-md rounded-lg p-3 border border-green-500/20 min-w-[180px]">
            {/* Close button */}
            <button
              onClick={() => setHeaderExpanded(false)}
              className="absolute -top-2 -right-2 w-6 h-6 flex items-center justify-center bg-black/80 rounded-full border border-green-500/30 text-gray-300"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>

            {/* Logo/Title */}
            <div className="flex items-center gap-2 mb-3 pb-2 border-b border-green-500/10">
              <svg className="w-6 h-6" viewBox="0 0 32 32" fill="none">
                <circle cx="16" cy="16" r="14" stroke="currentColor" strokeWidth="2" className="text-green-700" />
                <circle cx="16" cy="16" r="8" stroke="currentColor" strokeWidth="2" className="text-green-400" />
                <circle cx="16" cy="16" r="3" fill="currentColor" className="text-green-400" />
              </svg>
              <div>
                <h1 className="text-sm font-bold leading-tight">
                  <span className="text-green-400">Route</span> <span className="text-white">Flux Map</span>
                </h1>
                <p className="text-gray-500 text-[9px]">Visualizing the Tor Network</p>
              </div>
            </div>

            {/* Layer toggles */}
            <div className="space-y-2">
              <LayerToggle label="Relays" checked={true} />
              <LayerToggle label="Countries" checked={false} />
              <LayerToggle label="Traffic Flow" checked={true} />
            </div>
          </div>
        )}
      </div>

      {/* Description */}
      <div className="absolute bottom-4 left-4 right-4 bg-black/80 backdrop-blur rounded-lg p-3 text-xs text-gray-300">
        <strong className="text-green-400">Option 2:</strong> Header collapses to a menu icon.
        Tap to expand and see logo + layer toggles. Search bar stays at top.
        <div className="mt-2 text-gray-500">
          ✓ Maximum map visibility<br/>
          ✓ Clean, modern mobile pattern<br/>
          ✗ Layer toggles less discoverable
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// OPTION 3: Integrate Search Into Header Panel
// ============================================================================
// Search bar is embedded inside the header panel on mobile.
// One unified panel at top-left.

export function Option3_IntegratedSearch() {
  const [searchFocused, setSearchFocused] = useState(false);

  return (
    <div className={mockupContainer}>
      <div className={mockupLabel}>Option 3: Integrated Search</div>
      
      {/* Map background placeholder */}
      <div className="absolute inset-0 bg-gradient-to-b from-gray-800 to-gray-900">
        <div className="absolute inset-0 opacity-20">
          {Array.from({ length: 50 }).map((_, i) => (
            <div
              key={i}
              className="absolute w-1 h-1 bg-green-400 rounded-full"
              style={{
                left: `${Math.random() * 100}%`,
                top: `${Math.random() * 100}%`,
              }}
            />
          ))}
        </div>
      </div>

      {/* Unified Header Panel with Search */}
      <div className="absolute top-4 left-4 right-4 z-20">
        <div className="bg-black/40 backdrop-blur-md rounded-lg border border-green-500/20 overflow-hidden">
          {/* Top row: Logo + Search */}
          <div className="p-3 flex items-center gap-3">
            {/* Compact logo */}
            <svg className="w-8 h-8 flex-shrink-0" viewBox="0 0 32 32" fill="none">
              <circle cx="16" cy="16" r="14" stroke="currentColor" strokeWidth="2" className="text-green-700" />
              <circle cx="16" cy="16" r="8" stroke="currentColor" strokeWidth="2" className="text-green-400" />
              <circle cx="16" cy="16" r="3" fill="currentColor" className="text-green-400" />
            </svg>

            {/* Search input */}
            <div className="relative flex-1">
              <div className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none">
                <svg className="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
              <input
                type="text"
                placeholder="Search relays..."
                className="w-full pl-8 pr-3 py-1.5 bg-black/30 border border-green-500/20 rounded-md text-white text-xs placeholder-gray-500"
                onFocus={() => setSearchFocused(true)}
                onBlur={() => setSearchFocused(false)}
                readOnly
              />
            </div>
          </div>

          {/* Layer toggles row */}
          {!searchFocused && (
            <div className="px-3 pb-3 pt-0 flex items-center gap-4 border-t border-white/5">
              <CompactToggle label="Relays" checked={true} />
              <CompactToggle label="Countries" checked={false} />
              <CompactToggle label="Traffic" checked={true} />
            </div>
          )}
        </div>
      </div>

      {/* Description */}
      <div className="absolute bottom-4 left-4 right-4 bg-black/80 backdrop-blur rounded-lg p-3 text-xs text-gray-300">
        <strong className="text-green-400">Option 3:</strong> Search bar integrated into header panel.
        One unified panel at top with logo, search, and toggles.
        <div className="mt-2 text-gray-500">
          ✓ No overlap - single cohesive panel<br/>
          ✓ All controls in one place<br/>
          ✗ Panel is taller, takes more space
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// OPTION 4: Side-by-Side with Compact Header
// ============================================================================
// Header becomes a small icon/minimal logo. Search bar takes remaining space
// on the right side of the top row.

export function Option4_SideBySideCompact() {
  const [showToggles, setShowToggles] = useState(false);

  return (
    <div className={mockupContainer}>
      <div className={mockupLabel}>Option 4: Side-by-Side</div>
      
      {/* Map background placeholder */}
      <div className="absolute inset-0 bg-gradient-to-b from-gray-800 to-gray-900">
        <div className="absolute inset-0 opacity-20">
          {Array.from({ length: 50 }).map((_, i) => (
            <div
              key={i}
              className="absolute w-1 h-1 bg-green-400 rounded-full"
              style={{
                left: `${Math.random() * 100}%`,
                top: `${Math.random() * 100}%`,
              }}
            />
          ))}
        </div>
      </div>

      {/* Top Row: Compact Header + Search Side-by-Side */}
      <div className="absolute top-4 left-4 right-4 z-20 flex items-start gap-2">
        {/* Compact Header - Logo only with dropdown */}
        <div className="relative">
          <button
            onClick={() => setShowToggles(!showToggles)}
            className="flex items-center gap-1.5 bg-black/40 backdrop-blur-md rounded-lg px-2.5 py-2 border border-green-500/20"
          >
            <svg className="w-6 h-6" viewBox="0 0 32 32" fill="none">
              <circle cx="16" cy="16" r="14" stroke="currentColor" strokeWidth="2" className="text-green-700" />
              <circle cx="16" cy="16" r="8" stroke="currentColor" strokeWidth="2" className="text-green-400" />
              <circle cx="16" cy="16" r="3" fill="currentColor" className="text-green-400" />
            </svg>
            <svg 
              className={`w-3 h-3 text-gray-400 transition-transform ${showToggles ? 'rotate-180' : ''}`} 
              fill="none" 
              stroke="currentColor" 
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {/* Dropdown with toggles */}
          {showToggles && (
            <div className="absolute top-full left-0 mt-1 bg-black/90 backdrop-blur-md rounded-lg border border-green-500/20 p-3 min-w-[160px]">
              <div className="text-xs text-gray-400 mb-2 pb-1 border-b border-white/10">
                <span className="text-green-400">Route</span> <span className="text-white">Flux Map</span>
              </div>
              <div className="space-y-2">
                <LayerToggle label="Relays" checked={true} small />
                <LayerToggle label="Countries" checked={false} small />
                <LayerToggle label="Traffic Flow" checked={true} small />
              </div>
            </div>
          )}
        </div>

        {/* Search Bar - Takes remaining space */}
        <div className="flex-1 relative">
          <div className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
            <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
          <input
            type="text"
            placeholder="Search relays..."
            className="w-full pl-9 pr-4 py-2 bg-black/40 backdrop-blur-md border border-green-500/20 rounded-lg text-white text-sm placeholder-gray-500 placeholder:text-xs"
            readOnly
          />
        </div>
      </div>

      {/* Description */}
      <div className="absolute bottom-4 left-4 right-4 bg-black/80 backdrop-blur rounded-lg p-3 text-xs text-gray-300">
        <strong className="text-green-400">Option 4:</strong> Logo becomes compact button with dropdown.
        Search bar sits alongside. Both visible at top.
        <div className="mt-2 text-gray-500">
          ✓ Both always accessible at top<br/>
          ✓ Minimal vertical space used<br/>
          ✗ Toggles hidden in dropdown
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Shared Components
// ============================================================================

function LayerToggle({ label, checked, small = false }: { label: string; checked: boolean; small?: boolean }) {
  return (
    <label className="flex items-center gap-2 cursor-pointer group">
      <div className="relative">
        <div className={`${small ? 'w-8 h-4' : 'w-10 h-5'} rounded-full transition-colors ${checked ? 'bg-green-500/30' : 'bg-gray-700'}`} />
        <div 
          className={`absolute ${small ? 'top-0.5 left-0.5 w-3 h-3' : 'top-0.5 left-0.5 w-4 h-4'} rounded-full transition-all shadow-md ${
            checked ? (small ? 'translate-x-4' : 'translate-x-5') : 'translate-x-0'
          }`}
          style={{ backgroundColor: checked ? '#00ff88' : '#666' }}
        />
      </div>
      <span className={`text-gray-400 group-hover:text-white transition-colors ${small ? 'text-xs' : 'text-sm'}`}>
        {label}
      </span>
    </label>
  );
}

function CompactToggle({ label, checked }: { label: string; checked: boolean }) {
  return (
    <label className="flex items-center gap-1.5 cursor-pointer group py-2">
      <div className="relative">
        <div className={`w-7 h-3.5 rounded-full transition-colors ${checked ? 'bg-green-500/30' : 'bg-gray-700'}`} />
        <div 
          className="absolute top-0.5 left-0.5 w-2.5 h-2.5 rounded-full transition-all shadow-md"
          style={{ 
            backgroundColor: checked ? '#00ff88' : '#666',
            transform: checked ? 'translateX(14px)' : 'translateX(0)'
          }}
        />
      </div>
      <span className="text-gray-400 group-hover:text-white transition-colors text-[10px]">
        {label}
      </span>
    </label>
  );
}

// ============================================================================
// Demo Page Component - Shows all mockups side by side
// ============================================================================

export default function MobileLayoutMockups() {
  return (
    <div className="min-h-screen bg-gray-950 p-8">
      <h1 className="text-2xl font-bold text-white mb-2">Mobile Layout Mockups</h1>
      <p className="text-gray-400 mb-8">Solutions for search bar / layer toggles overlap on mobile</p>
      
      <div className="flex flex-wrap gap-8 justify-center">
        <Option2_CollapsibleHeader />
        <Option3_IntegratedSearch />
        <Option4_SideBySideCompact />
      </div>

      <div className="mt-12 max-w-3xl mx-auto">
        <h2 className="text-xl font-bold text-white mb-4">Comparison Summary</h2>
        <table className="w-full text-sm text-gray-300">
          <thead>
            <tr className="border-b border-gray-700">
              <th className="text-left py-2 px-3">Option</th>
              <th className="text-left py-2 px-3">Best For</th>
              <th className="text-left py-2 px-3">Trade-off</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-gray-800">
              <td className="py-2 px-3 text-green-400">Option 2: Collapsible</td>
              <td className="py-2 px-3">Maximum map visibility</td>
              <td className="py-2 px-3">Toggles hidden by default</td>
            </tr>
            <tr className="border-b border-gray-800">
              <td className="py-2 px-3 text-green-400">Option 3: Integrated</td>
              <td className="py-2 px-3">All controls always visible</td>
              <td className="py-2 px-3">Larger header panel</td>
            </tr>
            <tr className="border-b border-gray-800">
              <td className="py-2 px-3 text-green-400">Option 4: Side-by-Side</td>
              <td className="py-2 px-3">Balance of visibility &amp; space</td>
              <td className="py-2 px-3">Toggles in dropdown</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
