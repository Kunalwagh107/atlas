import { afterEach, describe, expect, it, vi } from 'vitest';
import { isLocalImageRef, isSafeImageSrc, normalizeContent } from '../core/mindmap/content';
import { makeDoc } from '../test/fixtures';
import {
  copyImageBlobs,
  dataUrlToBlob,
  deleteImageBlobs,
  getImageBlob,
  getImageObjectUrl,
  hydrateDocumentImages,
  imageIdFromRef,
  ImageStorageError,
  listImageBlobs,
  localImageRef,
  prepareDocumentForStorage,
  releaseImageObjectUrls,
  saveImageBlob,
} from './imageBlobs';
import { resetAtlasDatabaseForTests } from './indexeddb';

afterEach(() => {
  vi.unstubAllGlobals();
  resetAtlasDatabaseForTests();
});

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';

function imageDoc(label: string, src = PNG) {
  const doc = makeDoc(label);
  doc.id = `img_${label}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  doc.nodes[doc.rootId].content.images = [{ id: 'img-1', src, alt: 'Pixel' }];
  return doc;
}

describe('local-only image sources', () => {
  it('accepts local refs and data URLs but never external image URLs', () => {
    expect(isSafeImageSrc(localImageRef('img-1'))).toBe(true);
    expect(isLocalImageRef(localImageRef('img-1'))).toBe(true);
    expect(imageIdFromRef(localImageRef('img-1'))).toBe('img-1');
    expect(isSafeImageSrc('https://example.com/pixel.png')).toBe(false);
    expect(isSafeImageSrc('/pixel.png')).toBe(false);
    expect(normalizeContent({ images: [{ src: 'https://example.com/pixel.png' }] }).images).toHaveLength(0);
    expect(normalizeContent({ images: [{ src: localImageRef('img-1') }] }).images).toHaveLength(1);
  });

  it('stores bytes per map, copies them and deletes them', async () => {
    const source = imageDoc('store');
    const targetId = `${source.id}_copy`;
    const blob = dataUrlToBlob(PNG)?.blob;
    if (!blob) throw new Error('fixture did not decode');
    await saveImageBlob(source.id, 'img-1', blob);
    expect((await getImageBlob(source.id, 'img-1'))?.size).toBe(blob.size);
    await copyImageBlobs(source.id, targetId);
    expect(await listImageBlobs(targetId)).toHaveLength(1);
    await deleteImageBlobs(source.id);
    expect(await getImageBlob(source.id, 'img-1')).toBeNull();
    expect(await getImageBlob(targetId, 'img-1')).not.toBeNull();
    await deleteImageBlobs(targetId);
  });

  it('moves data URLs into blob storage and hydrates them for export', async () => {
    const doc = imageDoc('hydrate');
    try {
      const stored = await prepareDocumentForStorage(doc);
      expect(stored.nodes[doc.rootId].content.images[0].src).toBe(localImageRef('img-1'));
      // The original document object is not mutated; the command still owns it.
      expect(doc.nodes[doc.rootId].content.images[0].src).toBe(PNG);

      const hydrated = await hydrateDocumentImages(stored);
      expect(hydrated.sources['img-1']).toContain('data:image/png;base64,');
      expect(hydrated.doc.nodes[doc.rootId].content.images[0].src).toBe(hydrated.sources['img-1']);
      expect(await getImageBlob(stored.id, 'img-1')).not.toBeNull();
    } finally {
      await deleteImageBlobs(doc.id);
    }
  });

  it('stores and lists a large image collection', async () => {
    const doc = imageDoc('many');
    const blob = dataUrlToBlob(PNG)?.blob;
    if (!blob) throw new Error('fixture did not decode');
    try {
      for (let index = 0; index < 40; index++) await saveImageBlob(doc.id, `img-${index}`, blob);
      expect(await listImageBlobs(doc.id)).toHaveLength(40);
    } finally {
      await deleteImageBlobs(doc.id);
    }
  });

  it('reports a missing blob instead of emitting a broken reference', async () => {
    const doc = imageDoc('missing', localImageRef('gone'));
    await expect(hydrateDocumentImages(doc)).rejects.toBeInstanceOf(ImageStorageError);
  });
});

describe('image object URL lifecycle', () => {
  it('creates one URL per blob and revokes it on release', async () => {
    const doc = imageDoc('urls');
    const blob = dataUrlToBlob(PNG)?.blob;
    if (!blob) throw new Error('fixture did not decode');
    const create = vi.fn(() => 'blob:atlas-test');
    const revoke = vi.fn();
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    Object.defineProperty(URL, 'createObjectURL', { value: create, configurable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: revoke, configurable: true });
    try {
      await saveImageBlob(doc.id, 'img-1', blob);
      expect(await getImageObjectUrl(doc.id, 'img-1')).toBe('blob:atlas-test');
      expect(await getImageObjectUrl(doc.id, 'img-1')).toBe('blob:atlas-test');
      expect(create).toHaveBeenCalledTimes(1);
      releaseImageObjectUrls(doc.id, 'img-1');
      expect(revoke).toHaveBeenCalledWith('blob:atlas-test');
    } finally {
      Object.defineProperty(URL, 'createObjectURL', { value: originalCreate, configurable: true });
      Object.defineProperty(URL, 'revokeObjectURL', { value: originalRevoke, configurable: true });
      await deleteImageBlobs(doc.id);
    }
  });
});

describe('image storage failure handling', () => {
  it('reports a clear error instead of silently dropping an upload when storage is unavailable', async () => {
    resetAtlasDatabaseForTests();
    vi.stubGlobal('indexedDB', undefined);
    const blob = dataUrlToBlob(PNG)?.blob;
    if (!blob) throw new Error('fixture did not decode');
    await expect(saveImageBlob('missing-db', 'img-1', blob)).rejects.toBeInstanceOf(ImageStorageError);
  });
});
