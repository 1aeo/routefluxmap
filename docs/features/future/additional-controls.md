# Feature: Additional UI Controls & Enhancements

**Status:** Proposed  
**Priority:** Low-Medium  
**Complexity:** Low-Medium

## Overview

This document covers several smaller features not yet implemented in RouteFluxMap. These are grouped together as they are relatively simple additions that enhance the user experience.

---

## 1. Map Location URL Persistence

**Priority:** Medium  
**Complexity:** Low

### Description

Save the current map view (center coordinates and zoom level) in the URL hash so users can bookmark or share specific map views.

### URL Format

```
https://your-site/#date=2024-12-01&ML=-40.5,30.2,4
```

Where `ML=longitude,latitude,zoom`

### Implementation

```typescript
// Parse map location from URL
function parseMapLocation(): { lng: number; lat: number; zoom: number } | null {
  const hash = window.location.hash.slice(1);
  const match = hash.match(/ML=([^&]+)/);
  if (match) {
    const [lng, lat, zoom] = match[1].split(',').map(parseFloat);
    if (!isNaN(lng) && !isNaN(lat) && !isNaN(zoom)) {
      return { lng, lat, zoom };
    }
  }
  return null;
}

// Update URL on map move (debounced)
const handleViewStateChange = ({ viewState }) => {
  const { longitude, latitude, zoom } = viewState;
  const mlParam = `ML=${longitude.toFixed(2)},${latitude.toFixed(2)},${zoom.toFixed(1)}`;
  // Update URL hash
};
```

---

## 2. Node Count Slider

**Priority:** Low  
**Complexity:** Low

### Description

Control how many relay aggregation nodes are displayed (top N by bandwidth). Range: 100-2000 nodes.

### Implementation

1. Add `nodeCount` state to TorMap
2. Filter `relayData.nodes` by bandwidth (top N)
3. Add slider to Settings panel

```tsx
// In Settings panel
<div className="mb-3">
  <div className="flex justify-between text-[10px] text-gray-400 mb-1">
    <span>Node Count</span>
    <span>{nodeCount}</span>
  </div>
  <input
    type="range"
    min="100"
    max="2000"
    step="50"
    value={nodeCount}
    onChange={(e) => setNodeCount(parseInt(e.target.value))}
  />
</div>
```

---

## 3. Country Count Slider

**Priority:** Low  
**Complexity:** Low

### Description

Control how many countries are shown in the choropleth layer (top N by client connections).

### Implementation

Filter countries by connection count before rendering choropleth. Default: 50 countries.

---

## 4. Scale by Bandwidth Toggle (Nodes)

**Priority:** Low  
**Complexity:** Low

### Description

Toggle whether node marker size scales with bandwidth or uses uniform size.

### Implementation

```tsx
const [scaleNodesByBandwidth, setScaleNodesByBandwidth] = useState(true);

// In ScatterplotLayer
getRadius: scaleNodesByBandwidth 
  ? (d) => calculateRadius(d) 
  : () => config.nodeRadius.min
```

---

## 5. Particle Scaling Options

**Priority:** Low  
**Complexity:** Low

### Description

Two additional particle controls:

1. **Scale Size by Zoom** - Particles grow larger at higher zoom levels
2. **Scale Count by Bandwidth** - Particle count varies with current date's bandwidth

### Scale Count by Bandwidth

When enabled, particle count adjusts based on daily bandwidth:

```typescript
function getParticleCount(baseCount, currentBandwidth, minBandwidth, maxBandwidth) {
  const MIN_SCALE = 0.1;
  const scale = (currentBandwidth - minBandwidth) / (maxBandwidth - minBandwidth);
  return Math.floor(baseCount * Math.max(scale, MIN_SCALE));
}
```

---

## 6. Particle Size Slider

**Priority:** Low  
**Complexity:** Low

### Description

Adjust the base particle size (default 1px, range 1-10px).

### Current State

Already partially implemented in RouteFluxMap settings. Ensure full range is available.

---

## 7. Base Map Brightness Control

**Priority:** Very Low  
**Complexity:** Low

### Description

Adjust the brightness of the base map tiles.

### Implementation

MapLibre GL supports brightness via CSS filters:

```tsx
<Map
  mapStyle={config.mapStyle}
  style={{ filter: `brightness(${mapBrightness})` }}
/>
```

Range: 0.1 to 3.0, default 1.0

---

## 8. Social Sharing

**Priority:** Low  
**Complexity:** Low

### Description

Share button with links to Twitter, Facebook, LinkedIn, etc.

### Implementation

Modern approach without external libraries:

```tsx
function ShareButton() {
  const [showMenu, setShowMenu] = useState(false);
  const shareUrl = encodeURIComponent(window.location.href);
  const shareTitle = encodeURIComponent('Check out Tor Network visualization!');
  
  const platforms = [
    { name: 'Twitter', url: `https://twitter.com/intent/tweet?url=${shareUrl}&text=${shareTitle}` },
    { name: 'Facebook', url: `https://www.facebook.com/sharer/sharer.php?u=${shareUrl}` },
    { name: 'LinkedIn', url: `https://www.linkedin.com/sharing/share-offsite/?url=${shareUrl}` },
    { name: 'Reddit', url: `https://reddit.com/submit?url=${shareUrl}&title=${shareTitle}` },
  ];
  
  return (
    <div className="relative">
      <button onClick={() => setShowMenu(!showMenu)}>
        <ShareIcon />
      </button>
      {showMenu && (
        <div className="absolute ...">
          {platforms.map(p => (
            <a key={p.name} href={p.url} target="_blank" rel="noopener">
              {p.name}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
```

---

## 9. Legend Component

**Priority:** Low  
**Complexity:** Low

### Description

Color gradient legend showing what colors represent in the visualization.

### Implementation

```tsx
interface LegendProps {
  label: string;
  colorRamp: [string, string];  // [low, high]
  min?: string;
  max?: string;
}

function Legend({ label, colorRamp, min, max }: LegendProps) {
  return (
    <div className="text-xs">
      <div className="text-gray-400 mb-1">{label}</div>
      <div 
        className="h-2 rounded"
        style={{
          background: `linear-gradient(to right, ${colorRamp[0]}, ${colorRamp[1]})`
        }}
      />
      <div className="flex justify-between text-gray-500 mt-0.5">
        <span>{min || 'Low'}</span>
        <span>{max || 'High'}</span>
      </div>
    </div>
  );
}
```

---

## 10. Summary/Info Modal

**Priority:** Very Low  
**Complexity:** Very Low

### Description

Info button that shows project description and explanation.

### Current State

RouteFluxMap has an About page (`/about`). Consider adding:
- Info button → Summary modal (quick overview without leaving the map)
- About button → About page (detailed changelog)

---

## 11. Draggable Modal Dialogs (Desktop)

**Priority:** Very Low  
**Complexity:** Low

### Description

Allow users to drag modal dialogs (outlier chart, histogram, etc.) to reposition them.

### Implementation

Use a React drag library like `react-draggable`:

```tsx
import Draggable from 'react-draggable';

function DraggableModal({ children, ...props }) {
  const isMobile = useIsMobile();
  
  if (isMobile) {
    return <div {...props}>{children}</div>;
  }
  
  return (
    <Draggable handle=".modal-header">
      <div {...props}>{children}</div>
    </Draggable>
  );
}
```

---

## Implementation Priority Matrix

| Feature | Priority | Effort | Impact |
|---------|----------|--------|--------|
| Map Location URL | Medium | Low | High |
| Node Count Slider | Low | Low | Medium |
| Country Count Slider | Low | Low | Low |
| Scale by Bandwidth Toggle | Low | Low | Low |
| Particle Scaling Options | Low | Low | Medium |
| Particle Size Slider | Low | Very Low | Low |
| Base Map Brightness | Very Low | Low | Low |
| Social Sharing | Low | Low | Medium |
| Legend Component | Low | Low | Medium |
| Summary Modal | Very Low | Very Low | Low |
| Draggable Modals | Very Low | Low | Low |

---

## Recommended Implementation Order

1. **Map Location URL** - High value, low effort
2. **Legend Component** - Improves comprehension
3. **Social Sharing** - Helps discoverability
4. **Node/Country Count Sliders** - Power user feature
5. **Particle Scaling Options** - Nice to have
6. **Other** - As needed

---

## Files to Create/Modify

- `src/components/ui/Legend.tsx` - Color gradient legend
- `src/components/ui/ShareButton.tsx` - Social sharing
- `src/components/ui/InfoModal.tsx` - Summary modal
- `src/components/map/TorMap.tsx` - Add URL persistence, sliders
- `src/lib/utils/url.ts` - URL parsing/building utilities
