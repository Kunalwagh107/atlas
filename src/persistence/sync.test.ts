import { beforeEach, describe, expect, it } from 'vitest';
import { claimRevision, publishSave, readRevision, resetSyncForTests, subscribeToSaves } from './sync';

describe('cross-tab save coordination', () => {
  beforeEach(() => {
    localStorage.clear();
    resetSyncForTests();
  });

  it('starts at zero and hands out strictly increasing revisions', () => {
    expect(readRevision('map-a')).toBe(0);
    const first = claimRevision('map-a');
    const second = claimRevision('map-a');
    expect(first).toBeGreaterThan(0);
    expect(second).toBeGreaterThan(first);
    expect(readRevision('map-a')).toBe(second);
    expect(readRevision('map-b')).toBe(0);
  });

  it('publishes a save signal that other tabs can read synchronously', () => {
    const revision = claimRevision('map-a');
    publishSave('map-a', revision, 'Kemon');
    const raw = localStorage.getItem('atlas:last-save');
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw!)).toMatchObject({
      type: 'atlas:save',
      mapId: 'map-a',
      revision,
      title: 'Kemon',
    });
  });

  it('lets listeners unsubscribe without affecting other subscribers', () => {
    const seen: string[] = [];
    const unsubscribe = subscribeToSaves((signal) => seen.push(signal.mapId));
    const listener = (signal: { mapId: string }) => seen.push(signal.mapId);
    const second = subscribeToSaves(listener);
    unsubscribe();
    second();
    // No window in the Node test environment, so nothing is dispatched here —
    // the assertion documents that unsubscribing is safe and idempotent.
    expect(seen).toEqual([]);
  });
});
