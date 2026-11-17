import { describe, expect, it } from 'vitest';
import { makeDoc } from '../test/fixtures';
import { deleteImageBlobs, getImageBlob, localImageRef, saveImageBlob } from './imageBlobs';
import { pruneOrphanImageBlobs } from './imageGc';
import { mapRepository } from './indexeddb';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';

function blob(): Blob {
  const binary = atob(PNG.split(',')[1]);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new Blob([bytes], { type: 'image/png' });
}

describe('image blob garbage collection', () => {
  it('keeps referenced blobs and removes only unreferenced ones', async () => {
    const doc = makeDoc('GC map');
    doc.id = `gc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    doc.nodes[doc.rootId].content.images = [{ id: 'referenced', src: localImageRef('referenced'), alt: 'Keep' }];
    await mapRepository.save(doc);
    await saveImageBlob(doc.id, 'referenced', blob());
    await saveImageBlob(doc.id, 'orphan', blob());

    const result = await pruneOrphanImageBlobs();
    expect(result.deleted).toBe(1);
    expect(await getImageBlob(doc.id, 'referenced')).not.toBeNull();
    expect(await getImageBlob(doc.id, 'orphan')).toBeNull();
    await deleteImageBlobs(doc.id);
    await mapRepository.remove(doc.id);
  });

  it('protects blobs reachable only through undo/redo history', async () => {
    const doc = makeDoc('Undo map');
    doc.id = `gc_undo_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    await mapRepository.save(doc);
    await saveImageBlob(doc.id, 'undo-only', blob());

    expect((await pruneOrphanImageBlobs([{ mapId: doc.id, imageId: 'undo-only' }])).deleted).toBe(0);
    expect(await getImageBlob(doc.id, 'undo-only')).not.toBeNull();

    expect((await pruneOrphanImageBlobs()).deleted).toBe(1);
    expect(await getImageBlob(doc.id, 'undo-only')).toBeNull();
    await mapRepository.remove(doc.id);
  });
});
