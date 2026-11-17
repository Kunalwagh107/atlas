import type { MindMapDocument } from '../core/mindmap/types';
import { isLocalImageRef } from '../core/mindmap/content';
import { deleteImageBlob, imageBlobKey, listAllImageBlobs } from './imageBlobs';
import { mapRepository } from './indexeddb';
import { versionRepository } from './versions';

/**
 * Safe image-blob garbage collection.
 *
 * A blob is deleted only when no persisted map, no version snapshot and no
 * in-memory undo/redo entry references it. `protectedRefs` is supplied by the
 * controller from the current history stack, so an image that was just removed
 * but can still be restored by Undo is never collected.
 */

export interface ProtectedImageRef {
  mapId: string;
  imageId: string;
}

function addDocumentRefs(target: Set<string>, doc: MindMapDocument | null | undefined): void {
  if (!doc) return;
  for (const node of Object.values(doc.nodes)) {
    for (const image of node.content?.images ?? []) {
      if (isLocalImageRef(image.src)) target.add(imageBlobKey(doc.id, image.id));
    }
  }
}

export async function collectReferencedImageKeys(protectedRefs: ProtectedImageRef[] = []): Promise<Set<string>> {
  const referenced = new Set<string>();
  const maps = await mapRepository.list();
  for (const summary of maps) {
    addDocumentRefs(referenced, await mapRepository.get(summary.id));
    const versions = await versionRepository.list(summary.id);
    for (const version of versions) {
      addDocumentRefs(referenced, await versionRepository.get(version.id));
    }
  }
  for (const ref of protectedRefs) referenced.add(imageBlobKey(ref.mapId, ref.imageId));
  return referenced;
}

export interface ImageGcResult {
  deleted: number;
  kept: number;
}

export async function pruneOrphanImageBlobs(protectedRefs: ProtectedImageRef[] = []): Promise<ImageGcResult> {
  const referenced = await collectReferencedImageKeys(protectedRefs);
  const blobs = await listAllImageBlobs();
  let deleted = 0;
  for (const blob of blobs) {
    if (referenced.has(blob.key)) continue;
    await deleteImageBlob(blob.mapId, blob.imageId);
    deleted++;
  }
  return { deleted, kept: blobs.length - deleted };
}

let scheduled: ReturnType<typeof setTimeout> | null = null;

/** Debounced GC after saves; callers provide the current history references. */
export function scheduleImageGc(getRefs: () => ProtectedImageRef[], delayMs = 5_000): void {
  if (scheduled !== null) clearTimeout(scheduled);
  scheduled = setTimeout(() => {
    scheduled = null;
    void pruneOrphanImageBlobs(getRefs()).catch(() => undefined);
  }, delayMs);
}

export function cancelScheduledImageGc(): void {
  if (scheduled !== null) clearTimeout(scheduled);
  scheduled = null;
}
