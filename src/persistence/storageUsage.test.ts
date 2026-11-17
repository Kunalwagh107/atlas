import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatBytes, getStorageUsage, storageWarning } from './storageUsage';

afterEach(() => vi.unstubAllGlobals());

describe('storage usage', () => {
  it('formats byte counts for the settings UI', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(12 * 1024 * 1024)).toBe('12 MB');
  });

  it('reports a warning above the safety thresholds', () => {
    expect(storageWarning(null)).toBeNull();
    expect(storageWarning({ usage: 1, quota: 10, ratio: 0.1 })).toBeNull();
    expect(storageWarning({ usage: 8, quota: 10, ratio: 0.8 })).toMatch(/filling up/);
    expect(storageWarning({ usage: 9.5, quota: 10, ratio: 0.95 })).toMatch(/almost full/);
  });

  it('reads navigator.storage.estimate when available', async () => {
    vi.stubGlobal('navigator', {
      storage: { estimate: async () => ({ usage: 5 * 1024 * 1024, quota: 10 * 1024 * 1024 }) },
    });
    const usage = await getStorageUsage();
    expect(usage?.ratio).toBeCloseTo(0.5);
    expect(usage?.quota).toBe(10 * 1024 * 1024);
  });
});
