/**
 * MapHeader - Logo, title, and layer controls
 * 
 * Positioned in top-left corner of the map.
 * On mobile, integrates the search bar into the header panel.
 */

import type { LayerVisibility } from '../../lib/types';
import type { SearchItem } from '../../lib/utils/relay-search';
import LayerControls from '../ui/LayerControls';
import RelaySearch from '../ui/RelaySearch';

export interface MapHeaderProps {
  /** Layer visibility state */
  visibility: LayerVisibility;
  /** Layer visibility change handler */
  onVisibilityChange: (visibility: LayerVisibility) => void;
  /** Whether on mobile device */
  isMobile?: boolean;
  /** Search index for relay search (mobile only) */
  searchIndex?: SearchItem[];
  /** Callback when a relay is selected from search (mobile only) */
  onSelectRelay?: (nodeIndex: number, relayIndex: number, fingerprint: string) => void;
  /** Whether search is disabled (mobile only) */
  searchDisabled?: boolean;
}

const Logo = ({ className }: { className?: string }) => (
  <svg className={className ?? 'w-6 h-6'} viewBox="0 0 32 32" fill="none">
    <circle cx="16" cy="16" r="14" stroke="currentColor" strokeWidth="2" className="text-tor-green-dark" />
    <circle cx="16" cy="16" r="8" stroke="currentColor" strokeWidth="2" className="text-tor-green" />
    <circle cx="16" cy="16" r="3" fill="currentColor" className="text-tor-green" />
  </svg>
);

export default function MapHeader({ 
  visibility, 
  onVisibilityChange,
  isMobile = false,
  searchIndex = [],
  onSelectRelay,
  searchDisabled = false,
}: MapHeaderProps) {
  return (
    <div className={`absolute top-4 z-10 ${isMobile ? 'left-4 right-4' : 'left-4'}`}>
      <div className="bg-black/40 backdrop-blur-md rounded-lg p-3 border border-tor-green/20">
        {/* Header row: Logo (+ Search on mobile) */}
        <div className={`flex items-center mb-3 pb-2 border-b border-tor-green/10 ${isMobile ? 'gap-3' : 'gap-2'}`}>
          <Logo className={isMobile ? 'w-8 h-8 flex-shrink-0' : 'w-6 h-6'} />
          {isMobile ? (
            <div className="flex-1">
              <RelaySearch
                searchIndex={searchIndex}
                onSelectRelay={onSelectRelay ?? (() => {})}
                disabled={searchDisabled}
              />
            </div>
          ) : (
            <div>
              <h1 className="text-lg font-bold leading-tight">
                <span className="text-tor-green">Route</span> <span className="text-white">Flux Map</span>
              </h1>
              <p className="text-gray-500 text-[10px]">Visualizing the Tor Network</p>
            </div>
          )}
        </div>

        {/* Layer toggles */}
        <LayerControls
          visibility={visibility}
          onVisibilityChange={onVisibilityChange}
          showParticles={true}
          compact={true}
          horizontal={isMobile}
        />
      </div>
    </div>
  );
}

