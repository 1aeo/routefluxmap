# Copyright Concerns - Quick Reference
## Specific Line Numbers and Issues

## HIGH PRIORITY CONCERNS

### 1. `/workspace/src/lib/particles/particle-system.ts`

**Lines 190-202: `getProbabilisticPair()` method**
- **Issue:** Near-identical to original TorFlow `_getProbabilisticPair()` function
- **Original:** `/tmp/torflow-original/public/javascripts/particles/particlesystem.js:32-48`
- **Concern:** Same algorithm, same `MAX_TRIES = 500` constant, same retry loop logic
- **Reason:** Direct algorithmic port with minimal modification

**Lines 164-185: `getProbabilisticIndex()` method**
- **Issue:** Algorithmic port of original `_getProbabilisticNodeIndex()` with binary search optimization
- **Original:** `/tmp/torflow-original/public/javascripts/particles/particlesystem.js:22-30`
- **Concern:** Core algorithm (probabilistic selection based on `normalized_bandwidth`) is identical
- **Reason:** Optimization doesn't change the fundamental copyrightable algorithm

**Lines 141-154: `createParticle()` method**
- **Issue:** Same particle generation pattern as original
- **Original:** `/tmp/torflow-original/public/javascripts/particles/particlesystem.js:50-86`
- **Concern:** Uses `getProbabilisticPair()` and stores start/end coordinates in same pattern
- **Reason:** Structural similarity suggests direct porting

**Line 133: `normalized_bandwidth` usage**
- **Issue:** Uses identical field name and concept
- **Original:** `/tmp/torflow-original/public/javascripts/particles/particlesystem.js:25`
- **Concern:** Field name and probabilistic weighting concept are identical
- **Reason:** Same data structure and algorithm concept

### 2. `/workspace/src/lib/config.ts`

**Line 70: `hiddenServiceProbability: 0.04`**
- **Issue:** Identical magic number value
- **Original:** `/tmp/torflow-original/public/javascripts/config.js:76`
- **Concern:** Exact same probability value (0.04 = 4%)
- **Reason:** Unusual specific value suggests direct copying

**Lines 22-26: Node count configuration**
- **Issue:** Identical values (500, 100, 2000)
- **Original:** `/tmp/torflow-original/public/javascripts/config.js:39-41`
- **Concern:** Exact same default, min, and max values
- **Reason:** Specific combination suggests copying

**Lines 29-32: Node radius configuration**
- **Issue:** Identical values (5, 40)
- **Original:** `/tmp/torflow-original/public/javascripts/config.js:44-47`
- **Concern:** Exact same min and max pixel values
- **Reason:** Specific values suggest copying

**Lines 35-39: Country count configuration**
- **Issue:** Identical values (50, 5, 200)
- **Original:** `/tmp/torflow-original/public/javascripts/config.js:49-51`
- **Concern:** Exact same default, min, and max values
- **Reason:** Specific combination suggests copying

**Lines 42-46: Particle count configuration**
- **Issue:** Identical values (400000, 100000, 5000000)
- **Original:** `/tmp/torflow-original/public/javascripts/config.js:55-57`
- **Concern:** Exact same default, min, and max values
- **Reason:** Large specific numbers suggest copying

**Lines 49-53: Particle offset configuration**
- **Issue:** Identical values (0.10, 0.0001, 4.0)
- **Original:** `/tmp/torflow-original/public/javascripts/config.js:59-61`
- **Concern:** Exact same default, min, and max values, especially unusual 0.10 default
- **Reason:** Specific decimal values suggest copying

**Lines 56-60: Particle size configuration**
- **Issue:** Identical values (1, 1, 10)
- **Original:** `/tmp/torflow-original/public/javascripts/config.js:63-65`
- **Concern:** Exact same default, min, and max values
- **Reason:** Specific combination suggests copying

**Line 63: `particleBaseSpeedMs: 60_000`**
- **Issue:** Identical value (60000 milliseconds)
- **Original:** `/tmp/torflow-original/public/javascripts/config.js:70`
- **Concern:** Exact same base speed value
- **Reason:** Specific millisecond value suggests copying

**Lines 65-67: Particle speed factors**
- **Issue:** Identical values (0.01, 4.0)
- **Original:** `/tmp/torflow-original/public/javascripts/config.js:71-72`
- **Concern:** Exact same min and max factor values
- **Reason:** Specific decimal values suggest copying

## MEDIUM PRIORITY CONCERNS

### 3. `/workspace/src/workers/particle-render.worker.ts`

**Lines 225-268: Particle generation loop**
- **Issue:** Similar structure to original particle generation
- **Original:** `/tmp/torflow-original/public/javascripts/particles/particlesystem.js:50-86`
- **Concern:** Same concept of selecting source/destination pairs, though implementation differs
- **Reason:** Core concept and workflow are similar

**Lines 129-155: Traffic type filtering in shader**
- **Issue:** Implements same three-state filtering (all/hidden/general)
- **Original:** `/tmp/torflow-original/public/javascripts/layers/particlelayer.js:128-156`
- **Concern:** Same filtering logic, just implemented in shader vs separate draw calls
- **Reason:** Algorithmic concept is identical

**Line 231: Hidden service probability (0.15)**
- **Issue:** Uses similar probability concept (though different value)
- **Original:** `/tmp/torflow-original/public/javascripts/config.js:76` (0.04)
- **Concern:** Same concept of probabilistic hidden service assignment
- **Reason:** Similar algorithmic approach

### 4. `/workspace/src/lib/particles/particle-system.ts`

**Line 31: `hiddenServiceProbability = 0.04`**
- **Issue:** Default value matches config
- **Original:** `/tmp/torflow-original/public/javascripts/config.js:76`
- **Concern:** Same default probability value
- **Reason:** Propagates the same magic number

**Lines 57, 94: `hiddenServiceProbability` assignment**
- **Issue:** Uses same default value (0.04)
- **Original:** `/tmp/torflow-original/public/javascripts/config.js:76`
- **Concern:** Same default fallback value
- **Reason:** Same magic number throughout codebase

## LOW PRIORITY (Likely Acceptable)

### 5. `/workspace/src/lib/utils/format.ts`

**Lines 16-27: `formatCompact()` function**
- **Issue:** Uses K/M/B suffix pattern
- **Original:** `/tmp/torflow-original/public/javascripts/util/format.js:20-32` (different implementation)
- **Concern:** Similar purpose but different implementation
- **Reason:** Common pattern, implementation differs sufficiently

---

## Summary by File

### `/workspace/src/lib/particles/particle-system.ts`
- **Lines 31, 57, 94:** `hiddenServiceProbability` default values
- **Line 133:** `normalized_bandwidth` usage
- **Lines 141-154:** `createParticle()` method
- **Lines 164-185:** `getProbabilisticIndex()` method  
- **Lines 190-202:** `getProbabilisticPair()` method

### `/workspace/src/lib/config.ts`
- **Lines 22-26:** Node count values
- **Lines 29-32:** Node radius values
- **Lines 35-39:** Country count values
- **Lines 42-46:** Particle count values
- **Lines 49-53:** Particle offset values
- **Lines 56-60:** Particle size values
- **Line 63:** Particle base speed
- **Lines 65-67:** Particle speed factors
- **Line 70:** Hidden service probability

### `/workspace/src/workers/particle-render.worker.ts`
- **Lines 129-155:** Traffic type filtering
- **Line 231:** Hidden service probability usage
- **Lines 225-268:** Particle generation loop

---

## Recommended Actions

1. **Add source attribution comments** to all HIGH PRIORITY sections
2. **Consider refactoring** `getProbabilisticPair()` with different structure/variable names
3. **Document configuration values** - explain why specific values were chosen
4. **Add NOTICE file** acknowledging TorFlow as source
5. **Review LICENSE file** - ensure all copyright notices are present
