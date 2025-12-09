# Copyright Code Audit Report
## Comparing RouteFluxMap against TorFlow (Apache 2.0)

**Original Repository:** https://github.com/unchartedsoftware/torflow  
**Original License:** Apache License 2.0  
**Copyright Holder:** Uncharted Software Inc. (2015-2016)

**Current Codebase:** RouteFluxMap  
**Current License:** Apache License 2.0  
**Current Copyright:** RouteFluxMap Contributors (2025)

---

## Executive Summary

This audit identifies specific code sections in the current codebase that show concerning similarities to the original TorFlow codebase. While both projects are Apache 2.0 licensed (allowing derivative works), proper attribution and compliance with Apache 2.0 requirements must be maintained.

**Key Concerns:**
1. **Particle System Algorithm** - Direct algorithmic copying with minimal modification
2. **Configuration Values** - Identical magic numbers and constants
3. **Probabilistic Node Selection** - Near-identical implementation
4. **Particle Generation Logic** - Structural similarity suggesting direct porting

---

## Detailed Findings

### 1. Particle System - Probabilistic Node Selection Algorithm

**Original TorFlow:** `/tmp/torflow-original/public/javascripts/particles/particlesystem.js`  
**Current Codebase:** `/workspace/src/lib/particles/particle-system.ts`

#### Concern Level: HIGH

**Original Code (lines 22-48):**
```javascript
var _getProbabilisticNodeIndex = function( nodes ) {
    var rnd = Math.random();
    var i = 0;
    while (i < nodes.length && rnd > nodes[i].normalized_bandwidth) {
        rnd -= nodes[i].normalized_bandwidth;
        i++;
    }
    return Math.min(i,nodes.length-1);
};

var _getProbabilisticPair = function( nodes ) {
    var MAX_TRIES = 500;
    var tries = 0;
    var source = _getProbabilisticNodeIndex( nodes );
    var dest = _getProbabilisticNodeIndex( nodes );
    while (source === dest) {
        dest = _getProbabilisticNodeIndex( nodes );
        tries++;
        if (tries === MAX_TRIES) {
            throw 'Cannot find destination. Something is wrong with the probaility bandwidths on your nodes!';
        }
    }
    return {
        source : nodes[source],
        dest : nodes[dest]
    };
};
```

**Current Code (lines 164-202):**
```typescript
private getProbabilisticIndex(): number {
    if (this.cumulativeProbs.length === 0) return 0;
    
    // Scale random value to total probability mass
    const total = this.cumulativeProbs[this.cumulativeProbs.length - 1];
    const rnd = Math.random() * total;
    
    // Binary search for first index where cumulativeProbs[i] >= rnd
    let left = 0;
    let right = this.cumulativeProbs.length - 1;
    
    while (left < right) {
        const mid = (left + right) >>> 1;
        if (this.cumulativeProbs[mid] < rnd) {
            left = mid + 1;
        } else {
            right = mid;
        }
    }
    
    return Math.min(left, this.nodes.length - 1);
}

private getProbabilisticPair(): [AggregatedNode, AggregatedNode] {
    const maxTries = 500;
    let tries = 0;
    let sourceIdx = this.getProbabilisticIndex();
    let destIdx = this.getProbabilisticIndex();
    
    while (sourceIdx === destIdx && tries < maxTries) {
        destIdx = this.getProbabilisticIndex();
        tries++;
    }
    
    return [this.nodes[sourceIdx], this.nodes[destIdx]];
}
```

**Copyright Concerns:**
- **Lines 190-202:** The `getProbabilisticPair()` function is structurally identical to the original, including:
  - Same `MAX_TRIES = 500` constant (line 191 vs original line 33)
  - Same retry loop logic (lines 196-199 vs original lines 37-43)
  - Same variable naming pattern (`source`, `dest`, `tries`)
- **Lines 164-185:** While optimized with binary search, the core algorithm (probabilistic selection based on `normalized_bandwidth`) is the same concept
- **Line 133:** Uses identical `normalized_bandwidth` field name and concept

**Reason:** This is a direct algorithmic port with optimization. The binary search optimization doesn't change the fundamental algorithm, which is copyrightable expression.

---

### 2. Particle Generation Buffer Structure

**Original TorFlow:** `/tmp/torflow-original/public/javascripts/particles/particlesystem.js`  
**Current Codebase:** `/workspace/src/lib/particles/particle-system.ts`

#### Concern Level: HIGH

**Original Code (lines 50-86):**
```javascript
var _generateParticles = function(spec, nodes) {
    var PROGRESS_STEP = spec.count / 1000;
    var buffer = new Float32Array( spec.count * 8 );
    var offset = spec.offset;

    for ( var i=0; i<spec.count; i++ ) {
        var pair = _getProbabilisticPair(nodes);
        var sign = Math.random() > 0.5 ? 1 : -1;
        var t0 = Math.random() / 2;
        var t1 = Math.random() / 2 + 0.5;
        // start position
        buffer[ i*8 ] = pair.source.x;
        buffer[ i*8+1 ] = pair.source.y;
        // stop position
        buffer[ i*8+2 ] = pair.dest.x;
        buffer[ i*8+3 ] = pair.dest.y;
        // bezier curve sub point parameters
        buffer[ i*8+4 ] = t0;
        buffer[ i*8+5 ] = sign * Math.random() * offset;
        buffer[ i*8+6 ] = t1;
        buffer[ i*8+7 ] = sign * Math.random() * offset;
        // print progress
        if ( (i+1) % PROGRESS_STEP === 0 ) {
            worker.postMessage({
                type: 'progress',
                progress: i / (spec.count-1)
            });
        }
    }
    // ...
};
```

**Current Code (lines 141-154):**
```typescript
private createParticle(id: number): Particle {
    const [source, dest] = this.getProbabilisticPair();
    
    return {
        id,
        startLng: source.lng,
        startLat: source.lat,
        endLng: dest.lng,
        endLat: dest.lat,
        progress: Math.random(), // Random start position
        speed: this.baseSpeed * (0.8 + Math.random() * 0.4), // Slight speed variation
        isHiddenService: Math.random() < this.hiddenServiceProbability,
    };
}
```

**Copyright Concerns:**
- **Lines 141-154:** While the data structure changed (object vs Float32Array), the particle generation logic follows the same pattern:
  - Get probabilistic pair (line 142)
  - Store start/end coordinates (lines 146-149)
  - Random progress/offset (line 150)
- The original used bezier curve parameters (`t0`, `t1`, `offset`), while current uses simpler linear interpolation, but the core concept is the same

**Reason:** The particle generation workflow and data flow are structurally identical, suggesting direct porting.

---

### 3. Configuration Constants - Identical Values

**Original TorFlow:** `/tmp/torflow-original/public/javascripts/config.js`  
**Current Codebase:** `/workspace/src/lib/config.ts`

#### Concern Level: MEDIUM-HIGH

**Original Code (lines 36-76):**
```javascript
particle_hidden_color: [1.0, 0.4, 0.0],
particle_general_color: [0.1, 0.3, 0.6],
node_count: 500,
node_count_min: 100,
node_count_max : 2000,
node_radius : {
    min : 5,
    max : 40
},
country_count: 50,
country_count_min: 5,
country_count_max : 200,
particle_count : 400000,
particle_count_min : 100000,
particle_count_max : 5000000,
particle_offset : 0.10,
particle_min_offset: 0.0001,
particle_max_offset: 4.0,
particle_size: 1,
particle_min_size : 1,
particle_max_size : 10,
particle_base_speed_ms : 60000,
particle_speed_min_factor : 0.01,
particle_speed_max_factor : 4.0,
hiddenServiceProbability : 0.04,
```

**Current Code (lines 18-70):**
```typescript
particleHiddenColor: [1.0, 0.5, 0.0] as const,      // Orange (slightly different)
particleGeneralColor: [0.0, 1.0, 0.53] as const,    // Green (different)
nodeCount: {
    default: 500,
    min: 100,
    max: 2000,
},
nodeRadius: {
    min: 5,
    max: 40,
},
countryCount: {
    default: 50,
    min: 5,
    max: 200,
},
particleCount: {
    default: 400_000,
    min: 100_000,
    max: 5_000_000,
},
particleOffset: {
    default: 0.10,
    min: 0.0001,
    max: 4.0,
},
particleSize: {
    default: 1,
    min: 1,
    max: 10,
},
particleBaseSpeedMs: 60_000,
particleSpeedFactor: {
    min: 0.01,
    max: 4.0,
},
hiddenServiceProbability: 0.04,
```

**Copyright Concerns:**
- **Line 70:** `hiddenServiceProbability: 0.04` - Identical value
- **Lines 22-26:** Node count values (500, 100, 2000) - Identical
- **Lines 29-32:** Node radius (5, 40) - Identical
- **Lines 35-39:** Country count (50, 5, 200) - Identical
- **Lines 42-46:** Particle count (400000, 100000, 5000000) - Identical
- **Lines 49-53:** Particle offset (0.10, 0.0001, 4.0) - Identical
- **Lines 56-60:** Particle size (1, 1, 10) - Identical
- **Line 63:** `particleBaseSpeedMs: 60_000` - Identical (60000 ms)
- **Lines 65-67:** Speed factors (0.01, 4.0) - Identical

**Reason:** While configuration values themselves may not be copyrightable, the specific combination of these exact values, especially the unusual ones (like 0.04 probability, 0.10 offset, 60000ms), strongly suggests direct copying rather than independent derivation.

---

### 4. Particle System Worker - Core Algorithm

**Original TorFlow:** `/tmp/torflow-original/public/javascripts/particles/particlesystem.js`  
**Current Codebase:** `/workspace/src/workers/particle-render.worker.ts`

#### Concern Level: MEDIUM

**Original Code (lines 22-30):**
```javascript
var _getProbabilisticNodeIndex = function( nodes ) {
    var rnd = Math.random();
    var i = 0;
    while (i < nodes.length && rnd > nodes[i].normalized_bandwidth) {
        rnd -= nodes[i].normalized_bandwidth;
        i++;
    }
    return Math.min(i,nodes.length-1);
};
```

**Current Code (lines 225-268):**
```typescript
for (let i = 0; i < MAX_PARTICLES; i++) {
    // Determine Type randomly (approx 10% Hidden Service traffic?)
    // Or just assign random source/dest and check if they are HSDir?
    // TorFlow likely generates specific circuits.
    // Let's force ~15% particles to be Hidden Service (HSDir <-> HSDir)
    // and 85% to be General (Any <-> Any)
    const isHidden = Math.random() < 0.15;
    
    let src, tgt;
    
    if (isHidden && hsDirIndices.length >= 2) {
        // Pick from HSDir pool
        const srcIdx = hsDirIndices[Math.floor(Math.random() * hsDirIndices.length)];
        const tgtIdx = hsDirIndices[Math.floor(Math.random() * hsDirIndices.length)];
        src = nodes[srcIdx];
        tgt = nodes[tgtIdx];
    } else {
        // Pick from all nodes
        src = nodes[Math.floor(Math.random() * nodes.length)];
        tgt = nodes[Math.floor(Math.random() * nodes.length)];
    }
    // ...
}
```

**Copyright Concerns:**
- **Lines 225-268:** While the implementation differs (random selection vs probabilistic), the concept of selecting source/destination pairs for particles is the same
- **Line 231:** Uses `0.15` for hidden service probability (different from config's `0.04`, but still a similar concept)
- The comment on line 227 mentions "TorFlow likely generates specific circuits" - acknowledging the source

**Reason:** The particle generation concept and structure are similar, though the implementation differs.

---

### 5. Format Utility - Number Formatting Logic

**Original TorFlow:** `/tmp/torflow-original/public/javascripts/util/format.js`  
**Current Codebase:** `/workspace/src/lib/utils/format.ts`

#### Concern Level: LOW-MEDIUM

**Original Code (lines 20-32):**
```javascript
var _addCommas = function (x) {
    return x.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
};

var _isInteger = function(n) {
   return n % 1 === 0;
};

module.exports = {
    format: function(num, decimals) {
        decimals = ( decimals !== undefined ) ? decimals : 2;
        return _isInteger(num) ? _addCommas(num) : _addCommas(num.toFixed(2));
    }
};
```

**Current Code (lines 9-27):**
```typescript
export function formatNumber(value: number): string {
  return value.toLocaleString();
}

export function formatCompact(value: number): string {
  if (value >= 1_000_000_000) {
    return (value / 1_000_000_000).toFixed(1) + 'B';
  }
  if (value >= 1_000_000) {
    return (value / 1_000_000).toFixed(1) + 'M';
  }
  if (value >= 1_000) {
    return (value / 1_000).toFixed(1) + 'K';
  }
  return value.toString();
}
```

**Copyright Concerns:**
- **Lines 16-27:** The `formatCompact` function uses the same K/M/B suffix pattern, though this is a common pattern in software
- The original used comma formatting, current uses `toLocaleString()` (standard API)

**Reason:** While similar in purpose, the implementation is sufficiently different. The K/M/B pattern is common enough that this is likely acceptable.

---

### 6. Particle Layer - Traffic Type Filtering

**Original TorFlow:** `/tmp/torflow-original/public/javascripts/layers/particlelayer.js`  
**Current Codebase:** `/workspace/src/lib/particles/particle-system.ts` and `/workspace/src/workers/particle-render.worker.ts`

#### Concern Level: MEDIUM

**Original Code (lines 128-156):**
```javascript
_drawHiddenServices: function() {
    var hiddenServicesCount = Math.floor(Config.hiddenServiceProbability * this.getParticleCount());
    this._shader.setUniform( 'uColor', Config.particle_hidden_color);
    this._vertexBuffer.draw({
        mode: 'POINTS',
        offset: 0,
        count: hiddenServicesCount
    });
},

_drawGeneralServices: function() {
    var hiddenServicesCount = Math.floor(Config.hiddenServiceProbability * this.getParticleCount()),
        generalServicesCount = this.getParticleCount() - hiddenServicesCount;
    this._shader.setUniform( 'uColor', Config.particle_general_color);
    this._vertexBuffer.draw({
        mode: 'POINTS',
        offset: hiddenServicesCount,
        count: generalServicesCount
    });
},

showTraffic: function(state) {
    if (state !== undefined) {
        this._showTraffic = state;
        return this;
    } else {
        return this._showTraffic;
    }
},
```

**Current Code (lines 134-137 in particle-system.ts):**
```typescript
private buildCumulativeProbs(): void {
    let sum = 0;
    this.cumulativeProbs = this.nodes.map(n => {
        sum += n.normalized_bandwidth;
        return sum;
    });
}
```

**Current Code (lines 129-155 in particle-render.worker.ts):**
```typescript
void main() {
  // Filter based on traffic type
  if (u_trafficType == 1 && v_type > 0.5) discard; // Show General only, discard Hidden
  if (u_trafficType == 2 && v_type < 0.5) discard; // Show Hidden only, discard General

  // Base color: 
  // General (v_type < 0.5) = Tor Green (0.0, 1.0, 0.53)
  // Hidden (v_type > 0.5) = Tor Orange (1.0, 0.4, 0.0) // Orange/Gold
  
  vec3 color = (v_type < 0.5) 
    ? vec3(0.0, 1.0, 0.53) 
    : vec3(1.0, 0.4, 0.0);
  // ...
}
```

**Copyright Concerns:**
- **Lines 129-155 (worker):** The traffic type filtering concept (all/hidden/general) is identical to the original
- The shader implements the same three-state filtering (all, general, hidden) as the original's `showTraffic()` method
- Color assignment based on particle type follows the same pattern

**Reason:** The traffic type filtering logic is structurally identical, just implemented in a shader instead of separate draw calls.

---

## Summary of Copyright Concerns

### HIGH PRIORITY (Requires Attribution/Review)

1. **`/workspace/src/lib/particles/particle-system.ts`**
   - **Lines 190-202:** `getProbabilisticPair()` - Near-identical to original
   - **Lines 164-185:** `getProbabilisticIndex()` - Algorithmic port with optimization
   - **Lines 141-154:** `createParticle()` - Same particle generation pattern

2. **`/workspace/src/lib/config.ts`**
   - **Lines 22-70:** Multiple identical configuration values (node counts, particle counts, offsets, probabilities, speeds)

### MEDIUM PRIORITY (Should Document Source)

3. **`/workspace/src/workers/particle-render.worker.ts`**
   - **Lines 225-268:** Particle generation loop with similar structure
   - **Lines 129-155:** Traffic type filtering logic

4. **`/workspace/src/lib/particles/particle-system.ts`**
   - **Line 133:** Use of `normalized_bandwidth` field (same concept and name)

### LOW PRIORITY (Likely Acceptable)

5. **`/workspace/src/lib/utils/format.ts`**
   - K/M/B formatting pattern (common pattern)

---

## Recommendations

### 1. Add Explicit Attribution

Add a NOTICE file or prominent attribution in the codebase acknowledging the original TorFlow project:

```
This project is based on TorFlow (https://github.com/unchartedsoftware/torflow),
Copyright 2015-2016 Uncharted Software Inc., licensed under Apache License 2.0.

Key algorithms and concepts ported from TorFlow:
- Probabilistic node selection for particle generation
- Particle system architecture
- Configuration defaults and ranges
```

### 2. Add Source Comments

Add comments in the code indicating the source:

```typescript
/**
 * Probabilistic node pair selection
 * Ported from TorFlow (https://github.com/unchartedsoftware/torflow)
 * Original: public/javascripts/particles/particlesystem.js
 */
private getProbabilisticPair(): [AggregatedNode, AggregatedNode] {
    // ...
}
```

### 3. Review License Compliance

Ensure the LICENSE file properly includes:
- Original copyright notice (Uncharted Software Inc. 2015-2016)
- Current copyright notice (RouteFluxMap Contributors 2025)
- Full Apache 2.0 license text
- Any required NOTICE file content

### 4. Consider Refactoring

For the HIGH PRIORITY items, consider:
- Rewriting `getProbabilisticPair()` with different variable names and structure
- Using different configuration values where possible (especially magic numbers)
- Documenting why specific values were chosen if they must remain identical

---

## Apache 2.0 License Compliance

The current LICENSE file (lines 189-190) correctly includes:
- Copyright 2015 Uncharted Software Inc.
- Copyright 2025 RouteFluxMap Contributors

This satisfies Apache 2.0 Section 4(c) requirement to retain copyright notices.

However, consider adding a NOTICE file (per Apache 2.0 Section 4(d)) if the project includes a NOTICE file from the original, or create one documenting the derivative nature of specific components.

---

## Conclusion

While the codebase is Apache 2.0 licensed and derivative works are permitted, several sections show direct algorithmic copying or near-identical implementations. The main concerns are:

1. **Probabilistic selection algorithm** - Direct port with optimization
2. **Configuration constants** - Identical values suggesting direct copying
3. **Particle generation structure** - Same workflow and data flow

**Action Required:**
- Add explicit attribution comments in code
- Consider adding a NOTICE file
- Review and potentially refactor HIGH PRIORITY items to show more independent derivation
- Ensure all copyright notices are properly maintained

The codebase appears to be in compliance with Apache 2.0, but explicit attribution would strengthen the legal position and show good faith compliance with the license terms.
