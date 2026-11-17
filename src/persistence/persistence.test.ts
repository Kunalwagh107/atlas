import { describe, expect, it } from 'vitest';
import { makeDoc } from '../test/fixtures';
import { mapRepository, openAtlasDatabase, readLocalSettings, RevisionConflictError, writeLocalSettings } from './indexeddb';
import { readRevision } from './sync';
import { documentFingerprint, versionRepository } from './versions';

function uniqueDoc(label: string) {
  const doc = makeDoc(label);
  doc.id = `test_${label}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  return doc;
}

describe('map repository', () => {
  it('saves, lists, reads, duplicates and removes a document', async () => {
    const doc = uniqueDoc('roundtrip');
    const summary = await mapRepository.save(doc);
    expect(summary.nodeCount).toBe(Object.keys(doc.nodes).length);
    const stored = await mapRepository.get(doc.id);
    expect(stored?.title).toBe(doc.title);
    expect(stored?.nodes[doc.rootId].content).toBeDefined();
    expect((await mapRepository.list()).some((item) => item.id === doc.id)).toBe(true);
    await mapRepository.remove(doc.id);
    expect(await mapRepository.get(doc.id)).toBeNull();
  });

  it('validates and migrates a legacy/corrupt record on read', async () => {
    const doc = uniqueDoc('legacy');
    const db = await openAtlasDatabase();
    if (!db) throw new Error('fake IndexedDB is not available');
    const legacy = {
      id: doc.id,
      title: 'Legacy record',
      nodeCount: Object.keys(doc.nodes).length,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
      doc: { ...doc, version: 1, settings: undefined },
    };
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('maps', 'readwrite');
      tx.objectStore('maps').put(legacy);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    const restored = await mapRepository.get(doc.id);
    expect(restored?.version).toBe(2);
    expect(restored?.settings.presentationOrder).toEqual([]);
    expect(restored?.nodes[doc.rootId].content).toBeDefined();
    await mapRepository.remove(doc.id);
  });

  it('persists local settings with defaults', () => {
    const settings = readLocalSettings();
    expect(settings.autoSave).toBe(true);
    writeLocalSettings({ ...settings, theme: 'dark' });
    expect(readLocalSettings().theme).toBe('dark');
  });
});

describe('persistent version history', () => {
  it('creates named snapshots that survive a fresh repository read', async () => {
    const doc = uniqueDoc('versions');
    const snapshot = await versionRepository.save(doc, { kind: 'named', label: 'Milestone' });
    expect(snapshot?.label).toBe('Milestone');
    const list = await versionRepository.list(doc.id);
    expect(list).toHaveLength(1);
    expect(list[0].nodeCount).toBe(Object.keys(doc.nodes).length);
    const restored = await versionRepository.get(snapshot!.id);
    expect(restored?.id).toBe(doc.id);
    expect(Object.keys(restored!.nodes)).toHaveLength(Object.keys(doc.nodes).length);
  });

  it('deduplicates and throttles automatic snapshots', async () => {
    const doc = uniqueDoc('auto');
    const first = await versionRepository.save(doc, { kind: 'auto' });
    expect(first).not.toBeNull();
    expect(await versionRepository.save(doc, { kind: 'auto' })).toBeNull();
    doc.nodes[doc.rootId].title = 'Changed';
    expect(await versionRepository.save(doc, { kind: 'auto' })).toBeNull(); // inside the 45s window
    expect(await versionRepository.save(doc, { kind: 'auto', force: true })).not.toBeNull();
    expect(await versionRepository.list(doc.id)).toHaveLength(2);
  });

  it('prunes old automatic snapshots but keeps named ones', async () => {
    const doc = uniqueDoc('prune');
    for (let i = 0; i < 4; i++) {
      doc.nodes[doc.rootId].title = `Title ${i}`;
      await versionRepository.save(doc, { kind: 'auto', force: true, policy: { maxAuto: 2 } });
    }
    await versionRepository.save(doc, { kind: 'named', label: 'Keep me', policy: { maxAuto: 2 } });
    const list = await versionRepository.list(doc.id);
    expect(list.filter((item) => item.kind === 'auto')).toHaveLength(2);
    expect(list.some((item) => item.label === 'Keep me')).toBe(true);
  });

  it('renames, removes and clears snapshots', async () => {
    const doc = uniqueDoc('crud');
    const one = await versionRepository.save(doc, { kind: 'named', label: 'One' });
    const two = await versionRepository.save(doc, { kind: 'named', label: 'Two', force: true });
    await versionRepository.rename(one!.id, 'Renamed');
    expect((await versionRepository.list(doc.id)).find((item) => item.id === one!.id)?.label).toBe('Renamed');
    await versionRepository.remove(two!.id);
    expect(await versionRepository.list(doc.id)).toHaveLength(1);
    await versionRepository.clear(doc.id);
    expect(await versionRepository.list(doc.id)).toHaveLength(0);
  });

  it('fingerprints content but ignores volatile timestamps', () => {
    const doc = makeDoc('fingerprint');
    const before = documentFingerprint(doc);
    doc.updatedAt += 1000;
    expect(documentFingerprint(doc)).toBe(before);
    doc.nodes[doc.rootId].title = 'Different';
    expect(documentFingerprint(doc)).not.toBe(before);
  });
});

describe('atomic saves', () => {
  it('rejects a stale revision and leaves the newer document intact', async () => {
    const doc = uniqueDoc('atomic');
    const first = await mapRepository.saveAtomic(doc, 0);
    const second = await mapRepository.saveAtomic({ ...doc, title: 'Newer' }, first.revision);
    expect(second.revision).toBeGreaterThan(first.revision);

    await expect(
      mapRepository.saveAtomic({ ...doc, title: 'Stale overwrite' }, first.revision),
    ).rejects.toBeInstanceOf(RevisionConflictError);

    expect((await mapRepository.get(doc.id))?.title).toBe('Newer');
    expect(readRevision(doc.id)).toBe(second.revision);
    await mapRepository.remove(doc.id);
  });

  it('accepts a retry with the latest observed revision', async () => {
    const doc = uniqueDoc('atomic-retry');
    const first = await mapRepository.saveAtomic(doc, 0);
    const retry = await mapRepository.saveAtomic(
      { ...doc, title: 'Resolved' },
      readRevision(doc.id),
    );
    expect(retry.revision).toBeGreaterThan(first.revision);
    expect((await mapRepository.get(doc.id))?.title).toBe('Resolved');
    await mapRepository.remove(doc.id);
  });
});
