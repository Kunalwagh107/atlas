import { describe, expect, it } from 'vitest';
import {
  deleteImageBlobs,
  getImageBlob,
  localImageRef,
  saveImageBlob,
} from '../persistence/imageBlobs';
import { mapRepository } from '../persistence/indexeddb';
import { makeDoc } from '../test/fixtures';
import { actions } from './actions';
import { store } from './store';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';

function pngBlob(): Blob {
  const binary = atob(PNG.split(',')[1]);
  return new Blob([Uint8Array.from(binary, (char) => char.charCodeAt(0))], { type: 'image/png' });
}

describe('undo/redo with image content', () => {
  it('restores an image reference and keeps its blob available', async () => {
    const doc = makeDoc('Undo image map');
    doc.id = `undo_img_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    doc.nodes[doc.rootId].content.images = [{ id: 'undo-image', src: localImageRef('undo-image'), alt: 'Keep' }];
    await mapRepository.save(doc);
    await saveImageBlob(doc.id, 'undo-image', pngBlob());

    try {
      actions.load(doc);
      actions.patchContent(doc.rootId, { images: [] });
      expect(store.getState().history.present?.nodes[doc.rootId].content.images).toHaveLength(0);

      actions.undo();
      expect(store.getState().history.present?.nodes[doc.rootId].content.images[0].id).toBe('undo-image');
      expect(await getImageBlob(doc.id, 'undo-image')).not.toBeNull();

      actions.redo();
      expect(store.getState().history.present?.nodes[doc.rootId].content.images).toHaveLength(0);
    } finally {
      await deleteImageBlobs(doc.id);
      await mapRepository.remove(doc.id);
    }
  });
});
