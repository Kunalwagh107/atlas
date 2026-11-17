import { beforeEach, describe, expect, it } from 'vitest';
import { addChild } from '../core/mindmap/operations';
import { findByTitle, makeDoc } from '../test/fixtures';
import { buildDerived, resetDerivedCache } from './derivedData';

function retitle(doc: ReturnType<typeof makeDoc>, id: string, title: string) {
  return { ...doc, nodes: { ...doc.nodes, [id]: { ...doc.nodes[id], title } } };
}

describe('incremental derived data', () => {
  beforeEach(() => resetDerivedCache());

  it('reuses structure, positions and unchanged measurements when a title changes', () => {
    const doc = makeDoc();
    const research = findByTitle(doc, 'Research');
    const build = findByTitle(doc, 'Build');
    const first = buildDerived(doc, 'light', null);

    const second = buildDerived(retitle(doc, research.id, 'Research (edited)'), 'light', null);

    expect(second.positions).toBe(first.positions);
    expect(second.visibleIds).toBe(first.visibleIds);
    expect(second.stats).toBe(first.stats);
    expect(second.depth).toBe(first.depth);
    // The edited node was re-measured; every other measurement is reused by identity.
    expect(second.sizes[research.id]).not.toBe(first.sizes[research.id]);
    expect(second.sizes[build.id]).toBe(first.sizes[build.id]);
    // Outline rows read titles from byParent, so they must be refreshed.
    const parentId = doc.nodes[research.id].parentId!;
    expect(second.byParent[parentId].find((node) => node.id === research.id)?.title).toBe('Research (edited)');
  });

  it('rebuilds the structural slice when nodes are added', () => {
    const doc = makeDoc();
    const research = findByTitle(doc, 'Research');
    const first = buildDerived(doc, 'light', null);
    const added = addChild(doc, research.id, { title: 'Fresh' });
    const second = buildDerived(added.doc, 'light', null);

    expect(second.visibleIds).not.toBe(first.visibleIds);
    expect(second.visibleIds).toContain(added.id);
    expect(second.stats.nodes).toBe(first.stats.nodes + 1);
    expect(second.byParent[research.id].some((node) => node.id === added.id)).toBe(true);
  });

  it('rebuilds positions when a node moves and keeps bounds in sync', () => {
    const doc = makeDoc();
    const research = findByTitle(doc, 'Research');
    const first = buildDerived(doc, 'light', null);
    const moved = {
      ...doc,
      nodes: { ...doc.nodes, [research.id]: { ...doc.nodes[research.id], position: { x: 5000, y: 5000 } } },
    };
    const second = buildDerived(moved, 'light', null);
    expect(second.positions).not.toBe(first.positions);
    expect(second.positions[research.id]).toEqual({ x: 5000, y: 5000 });
    expect(second.bounds.width).toBeGreaterThan(first.bounds.width);
  });

  it('switches palette and focus without stale data', () => {
    const doc = makeDoc();
    const research = findByTitle(doc, 'Research');
    const light = buildDerived(doc, 'light', null);
    const dark = buildDerived(doc, 'dark', null);
    expect(dark.palette).not.toBe(light.palette);
    expect(dark.stats.nodes).toBe(light.stats.nodes);

    const focused = buildDerived(doc, 'dark', research.id);
    expect(focused.focusSet?.has(research.id)).toBe(true);
    expect(focused.focusSet?.has(doc.rootId)).toBe(true);
  });
});
