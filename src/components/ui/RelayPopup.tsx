/**
 * RelayPopup - Shows list of relays at a location with metrics links
 */

import { useEffect, useRef } from 'react';
import type { AggregatedNode } from '../../lib/types';
import { config, getRelayMetricsUrl } from '../../lib/config';
import { cleanFingerprint } from '../../lib/utils/relay-search';

interface RelayPopupProps {
  node: AggregatedNode;
  countryName?: string | null;
  totalBandwidth: number;
  x: number;
  y: number;
  onClose: () => void;
  highlightFingerprint?: string | null;
}

// Format bandwidth as percentage of network
function formatNetworkShare(nodeBandwidth: number, totalBandwidth: number): string {
  if (totalBandwidth <= 0) return '0%';
  const pct = (nodeBandwidth / totalBandwidth) * 100;
  if (pct >= 1) return `${pct.toFixed(1)}%`;
  if (pct >= 0.1) return `${pct.toFixed(2)}%`;
  return `${pct.toFixed(3)}%`;
}

// Pre-computed relay type info (avoid string building on every render)
const RELAY_TYPES = {
  exit: { name: 'Exit', color: `rgb(${config.relayColors.exit.slice(0, 3).join(',')})` },
  guard: { name: 'Guard', color: `rgb(${config.relayColors.guard.slice(0, 3).join(',')})` },
  middle: { name: 'Middle', color: `rgb(${config.relayColors.middle.slice(0, 3).join(',')})` },
} as const;

function getRelayType(flags: string) {
  if (flags.includes('E')) return RELAY_TYPES.exit;
  if (flags.includes('G')) return RELAY_TYPES.guard;
  return RELAY_TYPES.middle;
}

function isHSDir(flags: string): boolean {
  return flags.includes('H');
}

// SVG path constants
const CLOSE_PATH = "M6 18L18 6M6 6l12 12";
const EXTERNAL_LINK_PATH = "M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14";

export default function RelayPopup({ 
  node, 
  countryName, 
  totalBandwidth, 
  x, 
  y, 
  onClose,
  highlightFingerprint 
}: RelayPopupProps) {
  const left = Math.min(x + 15, window.innerWidth - 380);
  const top = Math.min(y + 15, window.innerHeight - 400);
  
  const highlightedRef = useRef<HTMLDivElement>(null);
  const highlightClean = highlightFingerprint ? cleanFingerprint(highlightFingerprint) : null;
  
  // Scroll highlighted relay into view
  useEffect(() => {
    if (highlightClean && highlightedRef.current) {
      const timer = setTimeout(() => {
        highlightedRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [highlightClean]);

  const relays = node.relays;
  const relayCount = relays.length;

  return (
    <div
      className="absolute z-30 bg-black/50 backdrop-blur-md border border-tor-green/30 rounded-lg shadow-xl animate-fade-in"
      style={{
        left: Math.max(10, left),
        top: Math.max(10, top),
        maxWidth: '360px',
        maxHeight: '380px',
      }}
    >
      {/* Header */}
      <div className="flex justify-between items-start p-4 border-b border-tor-green/20">
        <div>
          <h3 className="text-tor-green font-bold text-lg">
            {relayCount === 1 ? relays[0].nickname : `${relayCount} Relays`}
          </h3>
          <p className="text-gray-400 text-xs mt-1">
            {node.lat.toFixed(4)}, {node.lng.toFixed(4)}
            {countryName && <span className="text-gray-500"> — {countryName}</span>}
          </p>
          <p className="text-gray-500 text-xs">
            {formatNetworkShare(node.bandwidth, totalBandwidth)} of network
          </p>
        </div>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-white transition-colors p-1"
          aria-label="Close"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={CLOSE_PATH} />
          </svg>
        </button>
      </div>

      {/* Relay list */}
      <div className="overflow-y-auto p-2" style={{ maxHeight: '280px' }}>
        {relays.map((relay, index) => {
          const relayType = getRelayType(relay.flags);
          const hsDir = isHSDir(relay.flags);
          // Only compute clean fingerprint when we need to compare for highlighting
          const isHighlighted = highlightClean ? cleanFingerprint(relay.fingerprint) === highlightClean : false;
          
          return (
            <div
              key={relay.fingerprint || index}
              ref={isHighlighted ? highlightedRef : undefined}
              className={`p-3 rounded-lg transition-colors ${
                isHighlighted ? 'bg-tor-green/20 ring-1 ring-tor-green/50' : 'hover:bg-white/5'
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <span className="text-lg" style={{ color: relayType.color }}>●</span>
                <span className="font-medium text-white truncate flex-1">{relay.nickname}</span>
                <span 
                  className="text-xs font-medium px-1.5 py-0.5 rounded"
                  style={{ color: relayType.color, backgroundColor: `${relayType.color}20` }}
                >
                  {relayType.name}
                </span>
                {hsDir && (
                  <span className="text-[10px] text-purple-400 bg-purple-400/20 px-1 py-0.5 rounded">HSDir</span>
                )}
              </div>
              
              <div className="ml-6 space-y-1">
                <div className="text-xs text-gray-500 font-mono">{relay.ip}:{relay.port}</div>
                <a
                  href={getRelayMetricsUrl(relay.fingerprint)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-tor-green hover:text-tor-green-dim hover:underline transition-colors"
                  title="Opens relay details on metrics site. Note: Historical relays may no longer be active."
                >
                  View on Metrics
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={EXTERNAL_LINK_PATH} />
                  </svg>
                </a>
                <span className="text-[10px] text-gray-600 block mt-0.5">
                  Historical relays may not be active and available
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer */}
      {relayCount > 5 && (
        <div className="p-2 border-t border-tor-green/20 text-center">
          <span className="text-xs text-gray-500">Scroll for more relays</span>
        </div>
      )}
    </div>
  );
}
