import { measureAll } from '../core/layout/measure';
import { createDocumentFromSpec } from '../core/mindmap/operations';
import type { MindMapDocument } from '../core/mindmap/types';

export function makeDoc(title = 'Test map'): MindMapDocument {
  return createDocumentFromSpec(title, {
    title: 'Central topic',
    children: [
      { title: 'Research', description: 'Gather evidence', children: [
        { title: 'Sources' },
        { title: 'Interviews' },
      ] },
      { title: 'Build', children: [{ title: 'Prototype' }] },
      { title: 'Launch' },
    ],
  });
}

export function findByTitle(doc: MindMapDocument, title: string) {
  const node = Object.values(doc.nodes).find((candidate) => candidate.title === title);
  if (!node) throw new Error(`Fixture node "${title}" is missing`);
  return node;
}

export function sizesOf(doc: MindMapDocument) {
  return measureAll(Object.values(doc.nodes), doc.settings.showDescriptions, doc.rootId);
}

/** Deterministic tree used by the benchmark harness. */
export function makeLargeDoc(count: number): MindMapDocument {
  const doc = createDocumentFromSpec('Benchmark', { title: 'Root' });
  const root = doc.nodes[doc.rootId];
  const queue: string[] = [root.id];
  let index = 0;
  let total = 1; // avoid O(n²) Object.keys() inside the generation loop
  const now = Date.now();
  while (total < count && queue.length) {
    const parentId = queue.shift()!;
    for (let i = 0; i < 3 && total < count; i++) {
      const id = `bench_${index++}`;
      total++;
      doc.nodes[id] = {
        id,
        parentId,
        title: `Node ${index} with a reasonably descriptive label`,
        description: index % 4 === 0 ? 'A short supporting detail for measurement' : '',
        position: { x: 0, y: 0 },
        positionMode: 'auto',
        content: { markdown: '', code: [], formulas: [], links: [], images: [], checklist: [], tags: index % 7 === 0 ? ['bench'] : [] },
        style: { preset: 'default', borderWidth: 1, borderRadius: 10, fontSize: 14, fontWeight: 560 },
        type: parentId === root.id ? 'topic' : 'subtopic',
        collapsed: false,
        createdAt: now + index,
        updatedAt: now + index,
        metadata: { order: index },
      };
      queue.push(id);
    }
  }
  return doc;
}
