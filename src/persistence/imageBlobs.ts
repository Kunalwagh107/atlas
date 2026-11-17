import type { MindMapDocument, MindNode } from '../core/mindmap/types';
import { isLocalImageRef } from '../core/mindmap/content';
import { IMAGE_BLOB_STORE, openAtlasDatabase, queueStorageWrite } from './indexeddb';

/**
 * Local image blobs.
 *
 * The document keeps only a small `atlas-blob:<imageId>` reference; the bytes
 * live in the same IndexedDB database as the map, in a per-map store. Exports
 * and backups turn the reference back into a data URL in memory, so no file is
 * ever fetched from the network and no base64 lives in the persisted document.
 */

export interface ImageBlobRecord {
  key: string;
  mapId: string;
  imageId: string;
  blob: Blob;
  mime: string;
  createdAt: number;
}

export class ImageStorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImageStorageError';
  }
}

export const LOCAL_IMAGE_PREFIX = 'atlas-blob:';

export function imageBlobKey(mapId: string, imageId: string): string {
  return `${mapId}::${imageId}`;
}

export function localImageRef(imageId: string): string {
  return `${LOCAL_IMAGE_PREFIX}${imageId}`;
}

export function imageIdFromRef(ref: string): string | null {
  return isLocalImageRef(ref) ? ref.slice(LOCAL_IMAGE_PREFIX.length) : null;
}

function openBlobStore(): Promise<IDBDatabase | null> {
  return openAtlasDatabase();
}

export async function saveImageBlob(mapId: string, imageId: string, blob: Blob): Promise<void> {
  const db = await openBlobStore();
  if (!db || typeof indexedDB === 'undefined') {
    throw new ImageStorageError('Browser image storage is unavailable — the image was not added.');
  }
  const record: ImageBlobRecord = {
    key: imageBlobKey(mapId, imageId),
    mapId,
    imageId,
    blob,
    mime: blob.type || 'image/jpeg',
    createdAt: Date.now(),
  };
  await queueStorageWrite(() => new Promise<void>((resolve, reject) => {
    let failure: unknown = null;
    const tx = db.transaction(IMAGE_BLOB_STORE, 'readwrite');
    tx.objectStore(IMAGE_BLOB_STORE).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => { failure ??= tx.error; };
    tx.onabort = () => reject(failure ?? tx.error ?? new Error('Saving the image was aborted'));
  }));
}

export async function getImageBlob(mapId: string, imageId: string): Promise<Blob | null> {
  const db = await openBlobStore();
  if (!db) return null;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IMAGE_BLOB_STORE, 'readonly');
    const request = tx.objectStore(IMAGE_BLOB_STORE).get(imageBlobKey(mapId, imageId));
    request.onsuccess = () => resolve((request.result as ImageBlobRecord | undefined)?.blob ?? null);
    request.onerror = () => reject(request.error);
    tx.onabort = () => reject(tx.error ?? new Error('Reading the image was aborted'));
  });
}

export async function listAllImageBlobs(): Promise<ImageBlobRecord[]> {
  const db = await openBlobStore();
  if (!db) return [];
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IMAGE_BLOB_STORE, 'readonly');
    const request = tx.objectStore(IMAGE_BLOB_STORE).getAll();
    request.onsuccess = () => resolve((request.result ?? []) as ImageBlobRecord[]);
    request.onerror = () => reject(request.error);
    tx.onabort = () => reject(tx.error ?? new Error('Listing images was aborted'));
  });
}

export async function deleteImageBlob(mapId: string, imageId: string): Promise<void> {
  const db = await openBlobStore();
  if (!db) return;
  await queueStorageWrite(() => new Promise<void>((resolve, reject) => {
    let failure: unknown = null;
    const tx = db.transaction(IMAGE_BLOB_STORE, 'readwrite');
    tx.objectStore(IMAGE_BLOB_STORE).delete(imageBlobKey(mapId, imageId));
    tx.oncomplete = () => resolve();
    tx.onerror = () => { failure ??= tx.error; };
    tx.onabort = () => reject(failure ?? tx.error ?? new Error('Deleting the image was aborted'));
  }));
}

export async function listImageBlobs(mapId: string): Promise<ImageBlobRecord[]> {
  const db = await openBlobStore();
  if (!db) return [];
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IMAGE_BLOB_STORE, 'readonly');
    const request = tx.objectStore(IMAGE_BLOB_STORE).index('mapId').getAll(mapId);
    request.onsuccess = () => resolve((request.result ?? []) as ImageBlobRecord[]);
    request.onerror = () => reject(request.error);
    tx.onabort = () => reject(tx.error ?? new Error('Listing images was aborted'));
  });
}

export async function deleteImageBlobs(mapId: string): Promise<void> {
  const db = await openBlobStore();
  if (!db) return;
  const records = await listImageBlobs(mapId);
  if (!records.length) return;
  await queueStorageWrite(() => new Promise<void>((resolve, reject) => {
    let failure: unknown = null;
    const tx = db.transaction(IMAGE_BLOB_STORE, 'readwrite');
    const store = tx.objectStore(IMAGE_BLOB_STORE);
    for (const record of records) store.delete(record.key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => { failure ??= tx.error; };
    tx.onabort = () => reject(failure ?? tx.error ?? new Error('Deleting images was aborted'));
  }));
}

export async function copyImageBlobs(fromMapId: string, toMapId: string): Promise<void> {
  if (fromMapId === toMapId) return;
  const records = await listImageBlobs(fromMapId);
  for (const record of records) {
    await saveImageBlob(toMapId, record.imageId, record.blob);
  }
}

export async function blobToDataUrl(blob: Blob): Promise<string> {
  let binary = '';
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return `data:${blob.type || 'image/jpeg'};base64,${btoa(binary)}`;
}

export function dataUrlToBlob(dataUrl: string): { blob: Blob; mime: string } | null {
  const match = /^data:(image\/(?:png|jpe?g|gif|webp|avif));base64,([A-Za-z0-9+/=]+)$/i.exec(dataUrl.trim());
  if (!match) return null;
  try {
    const binary = atob(match[2]);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    return { blob: new Blob([bytes], { type: match[1].toLowerCase() }), mime: match[1].toLowerCase() };
  } catch {
    return null;
  }
}

/**
 * Move any embedded data-URL images into the blob store and leave an opaque
 * reference in the document. Safe to call repeatedly: references pass through.
 * When IndexedDB is unavailable the data URL is kept (still local) so uploads
 * are not silently lost in the documented localStorage fallback.
 */
export async function prepareDocumentForStorage(doc: MindMapDocument): Promise<MindMapDocument> {
  const db = await openBlobStore();
  if (!db) return doc;
  let changed = false;
  const nodes: Record<string, MindNode> = { ...doc.nodes };
  for (const node of Object.values(doc.nodes)) {
    if (!node.content?.images?.length) continue;
    let images = node.content.images;
    for (let index = 0; index < images.length; index++) {
      const image = images[index];
      const decoded = dataUrlToBlob(image.src);
      if (!decoded) continue;
      await saveImageBlob(doc.id, image.id, decoded.blob);
      if (images === node.content.images) images = images.slice();
      images[index] = { ...image, src: localImageRef(image.id) };
      changed = true;
    }
    if (images !== node.content.images) {
      nodes[node.id] = { ...node, content: { ...node.content, images } };
    }
  }
  return changed ? { ...doc, nodes } : doc;
}

export interface HydratedImages {
  doc: MindMapDocument;
  /** imageId → local data URL, for SVG/PNG/PDF/GIF export. */
  sources: Record<string, string>;
}

/** Turn local references back into embedded data URLs for portable JSON. */
export async function hydrateDocumentImages(doc: MindMapDocument): Promise<HydratedImages> {
  const sources: Record<string, string> = {};
  let changed = false;
  const nodes: Record<string, MindNode> = { ...doc.nodes };
  for (const node of Object.values(doc.nodes)) {
    if (!node.content?.images?.length) continue;
    let images = node.content.images;
    for (let index = 0; index < images.length; index++) {
      const image = images[index];
      const imageId = imageIdFromRef(image.src);
      if (!imageId) continue;
      const blob = await getImageBlob(doc.id, imageId);
      if (!blob) throw new ImageStorageError('An image in this map is missing from browser storage. Open the map where it was added and export a JSON backup.');
      const dataUrl = await blobToDataUrl(blob);
      sources[imageId] = dataUrl;
      if (images === node.content.images) images = images.slice();
      images[index] = { ...image, src: dataUrl };
      changed = true;
    }
    if (images !== node.content.images) {
      nodes[node.id] = { ...node, content: { ...node.content, images } };
    }
  }
  return { doc: changed ? { ...doc, nodes } : doc, sources };
}

/* ---------- object URL lifecycle for live rendering ----------------------- */

const objectUrls = new Map<string, string>();
const urlListeners = new Set<() => void>();

function notifyUrls(): void {
  for (const listener of urlListeners) {
    try { listener(); } catch { /* a listener must never break image loading */ }
  }
}

export function subscribeToImageUrls(listener: () => void): () => void {
  urlListeners.add(listener);
  return () => urlListeners.delete(listener);
}

export function peekImageObjectUrls(mapId: string, imageIds: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const id of imageIds) {
    const url = objectUrls.get(imageBlobKey(mapId, id));
    if (url) out[id] = url;
  }
  return out;
}

/** Create (or reuse) a local object URL for one stored image. */
export async function getImageObjectUrl(mapId: string, imageId: string): Promise<string | null> {
  const key = imageBlobKey(mapId, imageId);
  const existing = objectUrls.get(key);
  if (existing) return existing;
  if (typeof URL.createObjectURL !== 'function') return null;
  const blob = await getImageBlob(mapId, imageId);
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  objectUrls.set(key, url);
  notifyUrls();
  return url;
}

/** Revoke one image URL, or every URL belonging to a map when no id is given. */
export function releaseImageObjectUrls(mapId?: string, imageId?: string): void {
  let removed = false;
  if (mapId && imageId) {
    const key = imageBlobKey(mapId, imageId);
    const url = objectUrls.get(key);
    if (url) { URL.revokeObjectURL(url); objectUrls.delete(key); removed = true; }
  } else {
    for (const [key, url] of objectUrls) {
      if (mapId && !key.startsWith(`${mapId}::`)) continue;
      URL.revokeObjectURL(url);
      objectUrls.delete(key);
      removed = true;
    }
  }
  if (removed) notifyUrls();
}

/** Test hook: forget the object URL cache without touching stored blobs. */
export function resetImageUrlCacheForTests(): void {
  releaseImageObjectUrls();
}
