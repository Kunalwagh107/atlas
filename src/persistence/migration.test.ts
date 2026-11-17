import { beforeEach, describe, expect, it } from 'vitest';
import { makeDoc } from '../test/fixtures';
import {
  IMAGE_BLOB_STORE,
  mapRepository,
  openAtlasDatabase,
  REVISION_STORE,
  resetAtlasDatabaseForTests,
} from './indexeddb';
import { documentFingerprint, versionRepository } from './versions';

const DB_NAME = 'atlas-mindmaps';

function openV2(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 2);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('maps')) {
        const maps = db.createObjectStore('maps', { keyPath: 'id' });
        maps.createIndex('updatedAt', 'updatedAt');
      }
      if (!db.objectStoreNames.contains('versions')) {
        const versions = db.createObjectStore('versions', { keyPath: 'id' });
        versions.createIndex('mapId', 'mapId');
        versions.createIndex('createdAt', 'createdAt');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function deleteDatabase(): Promise<void> {
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
  resetAtlasDatabaseForTests();
}

async function seedV2(db: IDBDatabase) {
  const doc = makeDoc('Migrated map');
  doc.id = `migration_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  doc.nodes[doc.rootId].content.images = [{ id: 'legacy-image', src: 'atlas-blob:legacy-image', alt: 'Legacy' }];
  const versionId = `${doc.id}_v1`;
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(['maps', 'versions'], 'readwrite');
    tx.objectStore('maps').put({
      id: doc.id,
      title: doc.title,
      nodeCount: Object.keys(doc.nodes).length,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
      doc,
    });
    tx.objectStore('versions').put({
      id: versionId,
      mapId: doc.id,
      label: 'Before upgrade',
      kind: 'named',
      createdAt: Date.now(),
      nodeCount: Object.keys(doc.nodes).length,
      fingerprint: documentFingerprint(doc),
      doc,
    });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
  return { doc, versionId };
}

describe('IndexedDB v2 → v3 migration', () => {
  beforeEach(async () => {
    await deleteDatabase();
  });

  it('preserves maps, nodes, settings and version snapshots while adding v3 stores', async () => {
    const old = await openV2();
    const seeded = await seedV2(old);
    old.close();

    const db = await openAtlasDatabase();
    expect(db).not.toBeNull();
    expect(db!.objectStoreNames.contains(REVISION_STORE)).toBe(true);
    expect(db!.objectStoreNames.contains(IMAGE_BLOB_STORE)).toBe(true);

    const restored = await mapRepository.get(seeded.doc.id);
    expect(restored?.title).toBe('Migrated map');
    expect(restored?.nodes[restored.rootId].title).toBe(seeded.doc.nodes[seeded.doc.rootId].title);
    expect(restored?.nodes[restored.rootId].content.images[0].src).toBe('atlas-blob:legacy-image');
    expect(restored?.settings).toEqual(seeded.doc.settings);

    const version = await versionRepository.get(seeded.versionId);
    expect(version?.title).toBe('Migrated map');
    expect(version?.nodes[version.rootId].content.images[0].src).toBe('atlas-blob:legacy-image');
    expect(version?.settings).toEqual(seeded.doc.settings);
  });

  it('keeps v2 data intact when an upgrade is blocked, then succeeds on retry', async () => {
    const blocker = await openV2();
    const seeded = await seedV2(blocker);

    const blocked = await openAtlasDatabase();
    expect(blocked).toBeNull();

    // The old connection still reads its data; the failed upgrade destroyed nothing.
    const stillThere = await new Promise<boolean>((resolve, reject) => {
      const tx = blocker.transaction('maps', 'readonly');
      const request = tx.objectStore('maps').get(seeded.doc.id);
      request.onsuccess = () => resolve(!!request.result);
      request.onerror = () => reject(request.error);
    });
    expect(stillThere).toBe(true);

    blocker.close();
    resetAtlasDatabaseForTests();
    const retried = await openAtlasDatabase();
    expect(retried).not.toBeNull();
    expect((await mapRepository.get(seeded.doc.id))?.title).toBe('Migrated map');
    expect((await versionRepository.get(seeded.versionId))?.title).toBe('Migrated map');
  });
});
