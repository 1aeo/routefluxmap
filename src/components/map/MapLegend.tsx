/**
 * MapLegend - Relay type legend and source link
 * 
 * Positioned in bottom-right corner of the map.
 * Collapsible on mobile devices.
 */

import { useState } from 'react';
import type { DateIndex } from '../../lib/types';
import { config } from '../../lib/config';
import { MOBILE_CONTROLS_BOTTOM } from './MapControls';

export interface MapLegendProps {
  /** Whether on mobile device */
  isMobile: boolean;
  /** Date index for last updated info */
  dateIndex: DateIndex | null;
}

const RELAY_TYPES = [
  { key: 'exit' as const, label: 'Exit', desc: 'outbound traffic', extraClass: '' },
  { key: 'guard' as const, label: 'Guard', desc: 'entry point', extraClass: '' },
  { key: 'middle' as const, label: 'Middle', desc: 'intermediate', extraClass: '' },
  { key: 'hidden' as const, label: 'HSDir', desc: 'hidden services', extraClass: 'mt-1' },
];

export default function MapLegend({ isMobile, dateIndex }: MapLegendProps) {
  const [legendExpanded, setLegendExpanded] = useState(false);

  return (
    <div
      className={`absolute z-20 bg-black/40 backdrop-blur-md rounded-lg border border-tor-green/20 transition-all duration-200 ${
        isMobile ? 'right-3' : 'bottom-10 right-4'
      }`}
      style={
        isMobile
          ? {
              bottom: MOBILE_CONTROLS_BOTTOM,
              ...(legendExpanded ? { minWidth: '130px' } : { width: '40px', height: '40px' }),
            }
          : { minWidth: '130px' }
      }
    >
      {/* Mobile collapsed state - just an icon button */}
      {isMobile && !legendExpanded ? (
        <button
          onClick={() => setLegendExpanded(true)}
          className="w-full h-full flex items-center justify-center text-tor-green"
          aria-label="Show legend"
        >
          {/* Legend icon - stacked colored circles representing relay types */}
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="7" cy="7" r="3" />
            <circle cx="7" cy="17" r="3" opacity="0.6" />
            <rect x="12" y="5.5" width="8" height="3" rx="1" opacity="0.8" />
            <rect x="12" y="15.5" width="6" height="3" rx="1" opacity="0.5" />
          </svg>
        </button>
      ) : (
        <div className="px-3 pt-3 pb-1.5 relative">
          {/* Mobile: Close button - positioned prominently */}
          {isMobile && (
            <button
              onClick={() => setLegendExpanded(false)}
              className="absolute -top-2 -right-2 w-7 h-7 flex items-center justify-center bg-black/80 rounded-full border border-tor-green/30 text-gray-300 active:bg-tor-green/30"
              aria-label="Close legend"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}

          {/* Last updated */}
          {dateIndex && (
            <div className="text-gray-500 text-[10px] pb-2 mb-2 border-b border-white/10">
              Last updated:{' '}
              <span className="text-tor-green">
                {new Date(dateIndex.lastUpdated).toLocaleDateString()}
              </span>
            </div>
          )}

          {/* Relay Type Legend */}
          <div className="space-y-0.5">
            <div className="text-xs text-gray-400 mb-1">Relay Types</div>
            {RELAY_TYPES.map(({ key, label, desc, extraClass }) => (
              <div key={key} className={`flex items-center gap-1.5 text-[10px] ${extraClass}`}>
                <span
                  className="w-2 h-2 rounded-full"
                  style={{
                    backgroundColor: `rgb(${config.relayColors[key].slice(0, 3).join(',')})`,
                  }}
                />
                <span className="text-gray-400">{label}</span>
                {!isMobile && <span className="text-gray-600 text-[9px]">– {desc}</span>}
              </div>
            ))}
          </div>

          {/* Source Code link */}
          <a
            href="https://github.com/1aeo/routefluxmap"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 pt-1.5 border-t border-white/10 flex items-center justify-center gap-1 text-gray-500 hover:text-tor-green transition-colors text-[10px]"
          >
            Source Code
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
              />
            </svg>
          </a>
        </div>
      )}
    </div>
  );
}

