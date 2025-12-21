/**
 * MapHeader - Logo, title, and layer controls
 * 
 * Positioned in top-left corner of the map.
 */

import type { LayerVisibility } from '../../lib/types';
import LayerControls from '../ui/LayerControls';

export interface MapHeaderProps {
  /** Layer visibility state */
  visibility: LayerVisibility;
  /** Layer visibility change handler */
  onVisibilityChange: (visibility: LayerVisibility) => void;
}

export default function MapHeader({ visibility, onVisibilityChange }: MapHeaderProps) {
  return (
    <div className="absolute top-4 left-4 z-10">
      <div className="bg-black/40 backdrop-blur-md rounded-lg p-3 border border-tor-green/20">
        {/* Logo/Title */}
        <div className="flex items-center gap-2 mb-3 pb-2 border-b border-tor-green/10">
          <svg className="w-6 h-6" viewBox="0 0 32 32" fill="none">
            <circle cx="16" cy="16" r="14" stroke="currentColor" strokeWidth="2" className="text-tor-green-dark" />
            <circle cx="16" cy="16" r="8" stroke="currentColor" strokeWidth="2" className="text-tor-green" />
            <circle cx="16" cy="16" r="3" fill="currentColor" className="text-tor-green" />
          </svg>
          <div>
            <h1 className="text-lg font-bold leading-tight">
              <span className="text-tor-green">Route</span> <span className="text-white">Flux Map</span>
            </h1>
            <p className="text-gray-500 text-[10px]">Visualizing the Tor Network</p>
          </div>
        </div>

        {/* Layer toggles */}
        <LayerControls
          visibility={visibility}
          onVisibilityChange={onVisibilityChange}
          showParticles={true}
          compact={true}
        />
      </div>
    </div>
  );
}

