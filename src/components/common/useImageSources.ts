import { useEffect, useMemo, useState } from 'react';
import { isLocalImageRef } from '../../core/mindmap/content';
import {
  getImageObjectUrl,
  peekImageObjectUrls,
  subscribeToImageUrls,
} from '../../persistence/imageBlobs';

interface ImageRef {
  id: string;
  src: string;
}

/** Resolve local blob references to object URLs for canvas/editor rendering. */
export function useImageSources(mapId: string | null, images: ImageRef[]): Record<string, string> {
  const ids = useMemo(
    () => images.filter((image) => isLocalImageRef(image.src)).map((image) => image.id),
    [images],
  );
  const key = ids.join('|');
  const [urls, setUrls] = useState<Record<string, string>>(() =>
    mapId ? peekImageObjectUrls(mapId, key ? key.split('|') : []) : {},
  );

  useEffect(() => {
    let alive = true;
    const list = key ? key.split('|') : [];
    if (!mapId || !list.length) {
      setUrls({});
      return () => { alive = false; };
    }
    setUrls(peekImageObjectUrls(mapId, list));
    void Promise.all(list.map(async (id) => [id, await getImageObjectUrl(mapId, id)] as const))
      .then((entries) => {
        if (!alive) return;
        const next: Record<string, string> = {};
        for (const [id, url] of entries) if (url) next[id] = url;
        setUrls(next);
      })
      .catch(() => { if (alive) setUrls({}); });
    return () => { alive = false; };
  }, [mapId, key]);

  useEffect(() => subscribeToImageUrls(() => {
    const list = key ? key.split('|') : [];
    setUrls(mapId ? peekImageObjectUrls(mapId, list) : {});
  }), [mapId, key]);

  return urls;
}
