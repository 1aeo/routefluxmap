/**
 * useLayerVisibility - Layer toggle state management
 * 
 * Manages visibility toggles for map layers:
 * - Relays (node markers)
 * - Countries (choropleth)
 * - Labels (map labels)
 * - Particles (traffic animation)
 */

import { useState, useCallback } from 'react';
import type { LayerVisibility } from '../types';

/** Default layer visibility */
const DEFAULT_VISIBILITY: LayerVisibility = {
  relays: true,
  countries: false,
  labels: true,
  particles: true,
};

export interface UseLayerVisibilityResult {
  /** Current layer visibility state */
  visibility: LayerVisibility;
  /** Update layer visibility */
  setVisibility: (visibility: LayerVisibility) => void;
  /** Handle visibility change with side effects */
  handleVisibilityChange: (newVisibility: LayerVisibility) => void;
  /** Toggle a specific layer */
  toggleLayer: (layer: keyof LayerVisibility) => void;
}

export interface UseLayerVisibilityOptions {
  /** Callback when relay layer is hidden (to clear hover/selection) */
  onRelaysHidden?: () => void;
  /** Callback when country layer is hidden (to clear hover) */
  onCountriesHidden?: () => void;
  /** Callback when particles are disabled (to reset filters) */
  onParticlesDisabled?: () => void;
}

/**
 * Manage layer visibility state
 */
export function useLayerVisibility(
  options: UseLayerVisibilityOptions = {}
): UseLayerVisibilityResult {
  const [visibility, setVisibility] = useState<LayerVisibility>(DEFAULT_VISIBILITY);

  const { onRelaysHidden, onCountriesHidden, onParticlesDisabled } = options;

  /**
   * Handle visibility change with side effect callbacks
   */
  const handleVisibilityChange = useCallback(
    (newVisibility: LayerVisibility) => {
      setVisibility(newVisibility);

      // Clear relay hover/popup if relays are hidden
      if (!newVisibility.relays && onRelaysHidden) {
        onRelaysHidden();
      }

      // Clear country hover if countries are hidden
      if (!newVisibility.countries && onCountriesHidden) {
        onCountriesHidden();
      }

      // Reset relay filter when particles are disabled
      if (!newVisibility.particles && onParticlesDisabled) {
        onParticlesDisabled();
      }
    },
    [onRelaysHidden, onCountriesHidden, onParticlesDisabled]
  );

  /**
   * Toggle a single layer
   */
  const toggleLayer = useCallback(
    (layer: keyof LayerVisibility) => {
      handleVisibilityChange({
        ...visibility,
        [layer]: !visibility[layer],
      });
    },
    [visibility, handleVisibilityChange]
  );

  return {
    visibility,
    setVisibility,
    handleVisibilityChange,
    toggleLayer,
  };
}

