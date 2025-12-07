# Testing Guide

## Running Tests

```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Watch mode (re-run on changes)
npm test -- --watch
```

## Test Structure

```
tests/
├── lib/
│   ├── config.test.ts    # Configuration helpers
│   ├── geo.test.ts       # Geographic utilities
│   └── format.test.ts    # Formatting utilities
└── components/           # (future) React component tests
```

## Writing Tests

Tests use [Vitest](https://vitest.dev/) with jsdom for browser environment simulation.

```typescript
import { describe, it, expect } from 'vitest';
import { someFunction } from '../../src/lib/utils';

describe('someFunction', () => {
  it('does something expected', () => {
    const result = someFunction('input');
    expect(result).toBe('expected output');
  });
});
```

---

## Visual Testing Checklist

Run `npm run dev` and manually verify:

### Map Display

- [ ] Map renders with dark CARTO basemap
- [ ] Relay markers appear as colored circles
- [ ] Marker sizing scales with bandwidth/relay count
- [ ] Color coding: Exit (orange), Guard (green), Middle (cyan)

### Interactivity

- [ ] Hover tooltip shows relay count at location
- [ ] Click popup shows individual relays with nicknames
- [ ] Metrics links open correct URL (configured metrics URL/relay/{fp})
- [ ] Fingerprint links work (40-char hex format)

### Date Navigation

- [ ] Date slider navigates between available dates
- [ ] Play button auto-advances through dates
- [ ] Keyboard arrows navigate dates
- [ ] URL hash updates with current date
- [ ] Direct URL with date hash loads correct data

### Visualization Layers

- [ ] Particle animation shows flowing dots between relays
- [ ] Line paths connect relays with traffic indication
- [ ] Layer toggles hide/show relays, countries, particles
- [ ] Settings panel adjusts particle density/speed/opacity
- [ ] Country choropleth shows client density (when enabled)

### Controls

- [ ] Zoom controls work correctly
- [ ] Pan/drag works smoothly
- [ ] Touch gestures work on mobile

---

## Data Validation Checklist

### Relay Data

- [ ] Relay count matches Onionoo (~8,000-10,000 relays)
- [ ] Fingerprints are valid 40-char hex strings
- [ ] Coordinates place relays in correct geographic locations
- [ ] Bandwidth values are reasonable (not 0 or negative)
- [ ] No duplicate fingerprints within a date

### Country Data

- [ ] Country codes are valid 2-letter ISO codes
- [ ] User counts are positive integers
- [ ] Total matches sum of individual countries (approximately)

### Index

- [ ] Dates are sorted chronologically
- [ ] Bandwidths array length matches dates array
- [ ] min/max dates exist in the dates array

---

## Mobile Testing

### Devices to Test

- [ ] iPhone (Safari)
- [ ] Android (Chrome)
- [ ] iPad (Safari)
- [ ] Android tablet (Chrome)

### Checks

- [ ] Touch navigation works for pan/zoom
- [ ] Popups position correctly on small screens
- [ ] Layer controls are accessible
- [ ] Date slider is usable on touch devices
- [ ] No horizontal scroll on mobile viewport

---

## Performance Testing

### Metrics to Check

| Metric | Target |
|--------|--------|
| Initial load | < 3 seconds on 4G |
| Date switching | < 1 second |
| Particle animation | 30+ FPS |
| Memory usage | Stable over time |

### Tools

- Chrome DevTools Performance tab
- Lighthouse audit
- Network throttling (4G preset)

---

## CI/CD

Tests run automatically on:
- Pull requests to main branch
- Pushes to main branch

See `.github/workflows/test.yml` for configuration.

