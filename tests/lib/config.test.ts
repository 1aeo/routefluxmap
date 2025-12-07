import { describe, it, expect } from 'vitest';
import { getRelayMetricsUrl } from '../../src/lib/config';

describe('getRelayMetricsUrl', () => {
  it('generates correct URL for valid uppercase fingerprint', () => {
    const fp = '7EAAC4D0E1AC54E888C49F2F0C6BF5B2DDFB4C4A';
    const url = getRelayMetricsUrl(fp);
    expect(url).toBe('https://metrics.1aeo.com/relay/7EAAC4D0E1AC54E888C49F2F0C6BF5B2DDFB4C4A');
  });

  it('handles lowercase fingerprints by uppercasing', () => {
    const fp = '7eaac4d0e1ac54e888c49f2f0c6bf5b2ddfb4c4a';
    const url = getRelayMetricsUrl(fp);
    expect(url).toContain('7EAAC4D0E1AC54E888C49F2F0C6BF5B2DDFB4C4A');
  });

  it('removes $ prefix from fingerprints', () => {
    const fp = '$7EAAC4D0E1AC54E888C49F2F0C6BF5B2DDFB4C4A';
    const url = getRelayMetricsUrl(fp);
    expect(url).not.toContain('$');
    expect(url).toContain('7EAAC4D0E1AC54E888C49F2F0C6BF5B2DDFB4C4A');
  });

  it('removes colons from fingerprints', () => {
    const fp = '7E:AA:C4:D0:E1:AC:54:E8:88:C4:9F:2F:0C:6B:F5:B2:DD:FB:4C:4A';
    const url = getRelayMetricsUrl(fp);
    expect(url).not.toContain(':');
  });

  it('removes spaces from fingerprints', () => {
    const fp = '7E AA C4 D0 E1 AC 54 E8 88 C4 9F 2F 0C 6B F5 B2 DD FB 4C 4A';
    const url = getRelayMetricsUrl(fp);
    expect(url).not.toContain(' ');
  });
});

