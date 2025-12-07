# Feature: Additional TorFlow Controls & UI Enhancements

**Status:** Proposed  
**Priority:** Low-Medium  
**Complexity:** Low-Medium  
**Reference:** TorFlow `public/javascripts/main.js`, various UI components

## Overview

This document covers several smaller TorFlow features not yet implemented in RouteFluxMap. These are grouped together as they are relatively simple additions that enhance the user experience.

---

## 1. Map Location URL Persistence

**Priority:** Medium  
**Complexity:** Low

### Description
Save the current map view (center coordinates and zoom level) in the URL hash so users can bookmark or share specific map views.

### TorFlow Implementation
```javascript
// main.js
var _buildMapLocQueryParam = function() {
  var center = _map.getCenter();
  return center.lng + ',' + center.lat + ',' + _map.getZoom();
};

var _updateMapLocUrl = function() {
  var hash = window.location.hash;
  var mapLocIndex = hash.indexOf('ML=');
  // ... update hash with ?ML=lng,lat,zoom
};

_map.on('moveend', _updateMapLocUrl);
_map.on('zoomend', _updateMapLocUrl);
```

### URL Format
```
https://routefluxmap.1aeo.com/#date=2024-12-01&ML=-40.5,30.2,4
```

### RouteFluxMap Implementation

```typescript
// In TorMap.tsx

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

// Update URL on map move
const handleViewStateChange = useCallback(({ viewState }) => {
  setViewState(viewState);
  
  // Update URL hash (debounced)
  const { longitude, latitude, zoom } = viewState;
  const hash = window.location.hash;
  const mlParam = `ML=${longitude.toFixed(2)},${latitude.toFixed(2)},${zoom.toFixed(1)}`;
  // ... update hash
}, []);
```

---

## 2. Node Count Slider

**Priority:** Low  
**Complexity:** Low

### Description
Control how many relay aggregation nodes are displayed (top N by bandwidth). TorFlow allows 100-2000 nodes.

### TorFlow Implementation
```javascript
// main.js - _addMarkerControls
var nodeCountSlider = new Slider({
  label: 'Node Count (top n)',
  min: layer.getNodeCountMin(),      // 100
  max: layer.getNodeCountMax(),      // 2000
  step: (max - min) / 100,
  initialValue: layer.getNodeCount(), // 500
  slideStop: function(event) {
    if (event.value !== layer.getNodeCount()) {
      layer.setNodeCount(event.value);
      _updateNodes();
    }
  }
});
```

### RouteFluxMap Implementation

Currently, RouteFluxMap shows all aggregated nodes. To add this:

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

### TorFlow Implementation
```javascript
// main.js - _addCountryControls
var countryCountSlider = new Slider({
  label: 'Country Count (top n)',
  min: 5,
  max: 200,
  initialValue: 50,
  slideStop: function(event) {
    layer.setCountryCount(event.value);
    _updateCountries();
  }
});
```

### RouteFluxMap Implementation

Filter countries by connection count before rendering choropleth.

---

## 4. Scale by Bandwidth Toggle (Nodes)

**Priority:** Low  
**Complexity:** Low

### Description
Toggle whether node marker size scales with bandwidth or uses uniform size.

### TorFlow Implementation
```javascript
var scaleByBandwidthToggle = new ToggleBox({
  label: 'Scale by Bandwidth',
  initialValue: true,
  enabled: function() { layer.scaleByBandwidth(true); },
  disabled: function() { layer.scaleByBandwidth(false); }
});
```

### RouteFluxMap Implementation

Currently always scales. Add toggle to disable:

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
TorFlow offers multiple particle scaling options:

1. **Scale Size by Zoom** - Particles grow larger at higher zoom levels
2. **Scale Count by Bandwidth** - Particle count varies with current date's bandwidth

### TorFlow Implementation
```javascript
// Scale Size by Zoom
var scaleByZoomToggle = new ToggleBox({
  label: 'Scale Size by Zoom',
  initialValue: false,
  enabled: function() { layer.scaleSizeByZoom(true); },
  disabled: function() { layer.scaleSizeByZoom(false); }
});

// Scale Count by Bandwidth
var scaleByBandwidthToggle = new ToggleBox({
  label: 'Scale Count by Bandwidth',
  initialValue: true,
  enabled: function() { layer.scaleCountByBandwidth(true); },
  disabled: function() { layer.scaleCountByBandwidth(false); }
});
```

When scale by bandwidth is enabled:
```javascript
getParticleCount: function() {
  var MIN_SCALE = 0.1;
  if (this.scaleCountByBandwidth()) {
    var scale = (this._currentBandwidth - this._minBandwidth) / 
                (this._maxBandwidth - this._minBandwidth);
    return this.getUnscaledParticleCount() * Math.max(scale, MIN_SCALE);
  }
  return this.getUnscaledParticleCount();
}
```

---

## 6. Particle Size Slider

**Priority:** Low  
**Complexity:** Low

### Description
Adjust the base particle size (default 1px, range 1-10px).

### Implementation
Already partially implemented in RouteFluxMap settings. Ensure full range is available.

---

## 7. Base Map Brightness Control

**Priority:** Very Low  
**Complexity:** Low

### Description
Adjust the brightness of the base map tiles.

### TorFlow Implementation
```javascript
var brightnessSlider = new Slider({
  label: 'Brightness',
  min: 0.01,
  max: 3,
  step: 0.01,
  initialValue: 1.0,
  change: function(event) {
    layer.setBrightness(event.value.newValue);
  }
});
```

### RouteFluxMap Implementation

MapLibre GL supports map brightness via layer paint properties or CSS filters:

```tsx
<Map
  mapStyle={config.mapStyle}
  style={{ filter: `brightness(${mapBrightness})` }}
/>
```

---

## 8. Social Sharing

**Priority:** Low  
**Complexity:** Low

### Description
Share button with links to Twitter, Facebook, LinkedIn, etc.

### TorFlow Implementation
```javascript
$shareContainer.find('.share-content').jsSocials({
  showCount: false,
  shares: ['twitter', 'facebook', 'googleplus', 'linkedin', 'pinterest']
});
```

### RouteFluxMap Implementation

Modern approach without jsSocials library:

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

### TorFlow Implementation
```javascript
function _createRamp(increments, ramp) {
  var $ramp = $('<div class="legend-ramp-container"></div>');
  var colorRamp = d3.scale.linear()
    .range(ramp)
    .domain([0, 1]);
  
  for (var i = 0; i < increments; i++) {
    $ramp.append('<div class="legend-increment" style="' +
      'background-color:' + colorRamp(i/increments) + ';' +
      'width:' + ((1/increments)*100) + '%;"></div>');
  }
  return $ramp;
}
```

### RouteFluxMap Implementation

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

RouteFluxMap has an About page (`/about`). TorFlow has both:
- Info button → Summary modal (quick overview)
- About button → About page (detailed changelog)

### Implementation

Add an info button that shows a condensed version of the about content in a modal, without leaving the map.

---

## 11. Draggable Modal Dialogs (Desktop)

**Priority:** Very Low  
**Complexity:** Low

### Description
Allow users to drag modal dialogs (outlier chart, histogram, etc.) to reposition them.

### TorFlow Implementation
Uses Draggabilly library:
```javascript
if (!IS_MOBILE) {
  $outlierContainer.draggabilly();
  $histogramContainer.draggabilly();
}
```

### RouteFluxMap Implementation

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

