/**
 * useRelaySelection - Relay marker interaction state
 * 
 * Manages:
 * - Click selection (popup)
 * - Hover state (tooltip)
 * - Focus state (from search)
 * - Popup position tracking
 */

import { useState, useCallback, useRef } from 'react';
import type { RefObject } from 'react';
import type { PickingInfo } from '@deck.gl/core';
import type { AggregatedNode } from '../types';

export interface HoverInfo {
  node: AggregatedNode;
  x: number;
  y: number;
}

export interface UseRelaySelectionResult {
  /** Currently selected node (popup open) */
  selectedNode: AggregatedNode | null;
  /** Country name for selected node */
  selectedCountryName: string | null;
  /** Popup screen position */
  popupPosition: { x: number; y: number } | null;
  /** Currently hovered node (tooltip) */
  hoverInfo: HoverInfo | null;
  /** Node focused from search */
  focusedNode: AggregatedNode | null;
  /** Fingerprint of focused relay (for highlighting) */
  focusedFingerprint: string | null;
  /** Ref for tooltip DOM element */
  tooltipRef: RefObject<HTMLDivElement>;
  /** Handle click on relay marker */
  handleClick: (info: PickingInfo, findCountry?: (lng: number, lat: number) => string | null) => boolean;
  /** Handle hover on relay marker */
  handleHover: (info: PickingInfo) => void;
  /** Handle click on map background */
  handleDeckClick: (info: PickingInfo) => void;
  /** Close popup and clear focus */
  closePopup: () => void;
  /** Set focus state (called by focusRelay) */
  setFocus: (node: AggregatedNode | null, fingerprint: string | null) => void;
  /** Set selected node with position */
  setSelection: (node: AggregatedNode | null, position: { x: number; y: number } | null, countryName?: string | null) => void;
  /** Clear all selection/hover/focus */
  clearAll: () => void;
}

/**
 * Manage relay selection and hover state
 */
export function useRelaySelection(): UseRelaySelectionResult {
  const [selectedNode, setSelectedNode] = useState<AggregatedNode | null>(null);
  const [selectedCountryName, setSelectedCountryName] = useState<string | null>(null);
  const [popupPosition, setPopupPosition] = useState<{ x: number; y: number } | null>(null);
  const [hoverInfo, setHoverInfo] = useState<HoverInfo | null>(null);
  const [focusedNode, setFocusedNode] = useState<AggregatedNode | null>(null);
  const [focusedFingerprint, setFocusedFingerprint] = useState<string | null>(null);
  
  // Ref for tooltip DOM element (for direct position updates)
  const tooltipRef = useRef<HTMLDivElement>(null);
  
  // Ref for focus timeout (to open popup after fly-to)
  const focusTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Handle click on relay marker
   */
  const handleClick = useCallback(
    (info: PickingInfo, findCountry?: (lng: number, lat: number) => string | null): boolean => {
      if (info.object) {
        const node = info.object as AggregatedNode;
        setSelectedNode(node);
        setPopupPosition({ x: info.x, y: info.y });

        // Find country name if function provided
        if (findCountry) {
          const countryName = findCountry(node.lng, node.lat);
          setSelectedCountryName(countryName);
        } else {
          setSelectedCountryName(null);
        }

        return true; // Stop propagation
      }
      return false;
    },
    []
  );

  /**
   * Handle hover on relay marker
   * Optimized to only re-render when the NODE changes, not just position
   */
  const handleHover = useCallback(
    (info: PickingInfo) => {
      if (info.object) {
        const node = info.object as AggregatedNode;
        
        // Only trigger re-render if the NODE changes
        setHoverInfo(prev => {
          if (prev && prev.node === node) {
            // Same node - update position via ref without re-render
            if (tooltipRef.current) {
              tooltipRef.current.style.left = `${info.x + 10}px`;
              tooltipRef.current.style.top = `${info.y + 10}px`;
            }
            return prev;
          }
          return { node, x: info.x, y: info.y };
        });
      } else {
        // Only clear if we were previously hovering
        setHoverInfo(prev => (prev ? null : prev));
      }
    },
    []
  );

  /**
   * Handle click on map background (close popup)
   */
  const handleDeckClick = useCallback(
    (info: PickingInfo) => {
      if (!info.object) {
        closePopup();
      }
    },
    []
  );

  /**
   * Close popup and clear focus state
   */
  const closePopup = useCallback(() => {
    setSelectedNode(null);
    setPopupPosition(null);
    setSelectedCountryName(null);
    setFocusedNode(null);
    setFocusedFingerprint(null);
    
    if (focusTimeoutRef.current) {
      clearTimeout(focusTimeoutRef.current);
      focusTimeoutRef.current = null;
    }
  }, []);

  /**
   * Set focus state (for search results)
   */
  const setFocus = useCallback((node: AggregatedNode | null, fingerprint: string | null) => {
    setFocusedNode(node);
    setFocusedFingerprint(fingerprint);
  }, []);

  /**
   * Set selection with position and optional country name
   */
  const setSelection = useCallback(
    (node: AggregatedNode | null, position: { x: number; y: number } | null, countryName?: string | null) => {
      setSelectedNode(node);
      setPopupPosition(position);
      if (countryName !== undefined) {
        setSelectedCountryName(countryName);
      }
    },
    []
  );

  /**
   * Clear all selection, hover, and focus state
   */
  const clearAll = useCallback(() => {
    setSelectedNode(null);
    setPopupPosition(null);
    setSelectedCountryName(null);
    setHoverInfo(null);
    setFocusedNode(null);
    setFocusedFingerprint(null);
    
    if (focusTimeoutRef.current) {
      clearTimeout(focusTimeoutRef.current);
      focusTimeoutRef.current = null;
    }
  }, []);

  return {
    selectedNode,
    selectedCountryName,
    popupPosition,
    hoverInfo,
    focusedNode,
    focusedFingerprint,
    tooltipRef,
    handleClick,
    handleHover,
    handleDeckClick,
    closePopup,
    setFocus,
    setSelection,
    clearAll,
  };
}

