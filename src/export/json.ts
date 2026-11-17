import { CURRENT_SCHEMA_VERSION, type MindMapDocument } from '../core/mindmap/types';
import { downloadBlob, safeFilename } from '../utils/common';

export function documentToJson(doc: MindMapDocument): string {
  return JSON.stringify(
    {
      version: CURRENT_SCHEMA_VERSION,
      id: doc.id,
      title: doc.title,
      rootId: doc.rootId,
      nodes: doc.nodes,
      edges: doc.edges,
      settings: doc.settings,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
      exportedAt: Date.now(),
    },
    null,
    2,
  );
}

export function exportJson(doc: MindMapDocument): void {
  const blob = new Blob([documentToJson(doc)], { type: 'application/json;charset=utf-8' });
  downloadBlob(blob, `${safeFilename(doc.title)}.json`);
}
