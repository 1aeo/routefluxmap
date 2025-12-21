/**
 * RelayTooltip - Hover tooltip for relay markers
 * 
 * Pre-rendered (hidden) to eliminate React mount/unmount latency.
 * Position updates via ref for smooth 60fps tracking during mouse movement.
 */

import { forwardRef } from 'react';
import type { HoverInfo } from '../../lib/hooks';

export interface RelayTooltipProps {
  /** Current hover info (null when not hovering) */
  hoverInfo: HoverInfo | null;
  /** Whether popup is open (hides tooltip when true) */
  hasPopup: boolean;
}

const RelayTooltip = forwardRef<HTMLDivElement, RelayTooltipProps>(
  function RelayTooltip({ hoverInfo, hasPopup }, ref) {
    return (
      <div
        ref={ref}
        className="absolute pointer-events-none bg-black/40 backdrop-blur-md text-white text-sm px-3 py-2 rounded-lg shadow-lg border border-tor-green/30 z-10 transition-opacity duration-75"
        style={{
          left: 0,
          top: 0,
          opacity: hoverInfo && !hasPopup ? 1 : 0,
        }}
      >
        {hoverInfo && (
          <>
            <div className="font-medium text-tor-green">{hoverInfo.node.label}</div>
            <div className="text-gray-400 text-xs">
              {hoverInfo.node.relays.length} relay{hoverInfo.node.relays.length !== 1 ? 's' : ''}
            </div>
          </>
        )}
      </div>
    );
  }
);

export default RelayTooltip;

