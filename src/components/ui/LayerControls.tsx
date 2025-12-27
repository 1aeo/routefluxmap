/**
 * LayerControls - Toggle visibility of map layers
 * Provides controls for relays, countries, particles, and labels
 */

import { useState } from 'react';
import type { LayerVisibility } from '../../lib/types';

interface LayerControlsProps {
  visibility: LayerVisibility;
  onVisibilityChange: (visibility: LayerVisibility) => void;
  showParticles?: boolean; // Only show particle toggle when implemented
  compact?: boolean; // Render without container (for embedding in other components)
  horizontal?: boolean; // Render toggles in a horizontal row (for mobile header)
}

interface ToggleProps {
  label: string;
  icon?: React.ReactNode;
  checked: boolean;
  onChange: () => void;
  color?: string;
  small?: boolean;
}

function Toggle({ label, icon, checked, onChange, color = '#00ff88', small = false }: ToggleProps) {
  const inputId = `toggle-${label.toLowerCase().replace(/\s+/g, '-')}`;
  return (
    <label htmlFor={inputId} className={`flex items-center cursor-pointer group ${small ? 'gap-1.5' : 'gap-2'}`}>
      <div className="relative">
        <input
          type="checkbox"
          id={inputId}
          name={inputId}
          checked={checked}
          onChange={onChange}
          className="sr-only"
        />
        <div className={`rounded-full transition-colors duration-200 ${checked ? 'bg-tor-green/30' : 'bg-gray-700'} ${small ? 'w-7 h-3.5' : 'w-10 h-5'}`} />
        <div 
          className={`absolute top-0.5 left-0.5 rounded-full transition-all duration-200 shadow-md ${
            small 
              ? `w-2.5 h-2.5 ${checked ? 'translate-x-3.5' : 'translate-x-0'}`
              : `w-4 h-4 ${checked ? 'translate-x-5' : 'translate-x-0'}`
          }`}
          style={{ backgroundColor: checked ? color : '#666' }}
        />
      </div>
      <span className={`text-gray-400 group-hover:text-white transition-colors ${small ? 'text-[11px]' : 'flex items-center gap-1.5'}`}>
        {!small && icon && <span className="opacity-70">{icon}</span>}
        <span className={small ? '' : 'text-sm'}>{label}</span>
      </span>
    </label>
  );
}

export default function LayerControls({
  visibility,
  onVisibilityChange,
  showParticles = false,
  compact = false,
  horizontal = false,
}: LayerControlsProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  
  const handleToggle = (layer: keyof LayerVisibility) => {
    onVisibilityChange({
      ...visibility,
      [layer]: !visibility[layer],
    });
  };
  
  // Compact mode: just toggles, no container
  if (compact) {
    return (
      <div className={horizontal ? 'flex items-center gap-4 flex-wrap' : 'space-y-2'}>
        <Toggle
          label="Relays"
          icon={!horizontal ? <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" /></svg> : undefined}
          checked={visibility.relays}
          onChange={() => handleToggle('relays')}
          small={horizontal}
        />
        <Toggle
          label="Countries"
          icon={!horizontal ? <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg> : undefined}
          checked={visibility.countries}
          onChange={() => handleToggle('countries')}
          small={horizontal}
        />
        {showParticles && (
          <Toggle
            label={horizontal ? 'Traffic' : 'Traffic Flow'}
            icon={!horizontal ? <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><circle cx="6" cy="6" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="18" cy="18" r="2" /><circle cx="18" cy="6" r="1.5" /><circle cx="6" cy="18" r="1.5" /></svg> : undefined}
            checked={visibility.particles}
            onChange={() => handleToggle('particles')}
            small={horizontal}
          />
        )}
      </div>
    );
  }
  
  // Full mode with container
  
  return (
    <div className="bg-black/40 backdrop-blur-md rounded-lg border border-tor-green/20 overflow-hidden">
      {/* Header - always visible */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-4 py-3 flex items-center justify-between text-white hover:bg-white/5 transition-colors"
      >
        <span className="text-sm font-medium flex items-center gap-2">
          <svg className="w-4 h-4 text-tor-green" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
          </svg>
          Layers
        </span>
        <svg 
          className={`w-4 h-4 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} 
          fill="none" 
          stroke="currentColor" 
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      
      {/* Expandable controls */}
      <div 
        className={`
          overflow-hidden transition-all duration-200
          ${isExpanded ? 'max-h-60 opacity-100' : 'max-h-0 opacity-0'}
        `}
      >
        <div className="px-4 pb-4 space-y-3 border-t border-white/10 pt-3">
          <Toggle
            label="Relays"
            icon={<svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" /></svg>}
            checked={visibility.relays}
            onChange={() => handleToggle('relays')}
          />
          <Toggle
            label="Countries"
            icon={<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>}
            checked={visibility.countries}
            onChange={() => handleToggle('countries')}
          />
          <Toggle
            label="Labels"
            icon={<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" /></svg>}
            checked={visibility.labels}
            onChange={() => handleToggle('labels')}
            color="#ffffff"
          />
          {showParticles && (
            <Toggle
              label="Traffic Flow"
              icon={<svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><circle cx="6" cy="6" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="18" cy="18" r="2" /><circle cx="18" cy="6" r="1.5" /><circle cx="6" cy="18" r="1.5" /></svg>}
              checked={visibility.particles}
              onChange={() => handleToggle('particles')}
            />
          )}
        </div>
      </div>
      
      {/* Quick toggle indicators when collapsed */}
      {!isExpanded && (
        <div className="px-4 pb-3 flex gap-2">
          <div 
            className={`w-2 h-2 rounded-full ${visibility.relays ? 'bg-tor-green' : 'bg-gray-600'}`}
            title="Relays"
          />
          <div 
            className={`w-2 h-2 rounded-full ${visibility.countries ? 'bg-tor-green' : 'bg-gray-600'}`}
            title="Countries"
          />
          <div 
            className={`w-2 h-2 rounded-full ${visibility.labels ? 'bg-white' : 'bg-gray-600'}`}
            title="Labels"
          />
          {showParticles && (
            <div 
              className={`w-2 h-2 rounded-full ${visibility.particles ? 'bg-tor-green' : 'bg-gray-600'}`}
              title="Traffic Flow"
            />
          )}
        </div>
      )}
    </div>
  );
}

