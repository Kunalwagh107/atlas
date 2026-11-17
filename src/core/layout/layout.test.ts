import { describe, expect, it } from 'vitest';
import { findByTitle, makeDoc, sizesOf } from '../../test/fixtures';
import { mapSpacing } from '../mindmap/appearance';
import { getPalette } from '../mindmap/palette';
import { computeBounds, computeLayout, layoutDocument } from './index';
import { measureAll } from './measure';

describe('layout engine', () => {
  it('computes padded bounds for the requested node set', () => {
    const doc = makeDoc();
    const sizes = sizesOf(doc);
    const positions: Record<string, { x: number; y: number }> = {
      [doc.rootId]: { x: 0, y: 0 },
    };
    const bounds = computeBounds(positions, sizes, [doc.rootId], 50);
    const size = sizes[doc.rootId];
    expect(bounds.width).toBeCloseTo(size.width + 100, 0);
    expect(bounds.height).toBeCloseTo(size.height + 100, 0);
    expect(bounds.x).toBeCloseTo(-size.width / 2 - 50, 0);
  });

  it('lays out the complete map when ignoreCollapsed is set', () => {
    const doc = makeDoc();
    const research = findByTitle(doc, 'Research');
    doc.nodes[research.id].collapsed = true;
    const sizes = sizesOf(doc);
    const normal = computeLayout(doc, sizes, 'horizontal');
    const complete = computeLayout(doc, sizes, 'horizontal', { ignoreCollapsed: true });
    const sources = findByTitle(doc, 'Sources');
    const prototype = findByTitle(doc, 'Prototype');
    expect(complete[sources.id]).toBeDefined();
    // Expanded layout gives every descendant its own column.
    expect(complete[sources.id].x).toBeGreaterThan(complete[research.id].x);
    expect(complete[prototype.id].x).toBeGreaterThan(complete[doc.rootId].x);
    expect(complete[sources.id]).not.toEqual(normal[sources.id]);
  });

  it('never moves manually positioned nodes unless explicitly forced', () => {
    const doc = makeDoc();
    const research = findByTitle(doc, 'Research');
    doc.nodes[research.id].position = { x: 1234, y: -432 };
    doc.nodes[research.id].positionMode = 'manual';
    const sizes = sizesOf(doc);
    const gentle = layoutDocument(doc, sizes, 'horizontal');
    expect(gentle.nodes[research.id].position).toEqual({ x: 1234, y: -432 });
    const forced = layoutDocument(doc, sizes, 'horizontal', { forceAll: true });
    expect(forced.nodes[research.id].position).not.toEqual({ x: 1234, y: -432 });
    expect(forced.nodes[research.id].positionMode).toBe('auto');
  });

  it('uses one fixed visual style regardless of app theme', () => {
    expect(mapSpacing('horizontal')).toEqual({ gapPrimary: 70, gapSecondary: 18 });
    const doc = makeDoc();
    const sizes = measureAll(Object.values(doc.nodes), true, doc.rootId);
    expect(sizes[doc.rootId].fontFamily).toContain('Inter');
    expect(getPalette('dark').canvasBg).toBe('#0d1219');
  });
});

describe('explicit node sizing', () => {
  it('honours explicit width/height without clipping text', () => {
    const doc = makeDoc();
    const research = findByTitle(doc, 'Research');
    const natural = measureAll(Object.values(doc.nodes), true, doc.rootId)[research.id];
    research.style.width = 300;
    research.style.height = 40; // smaller than natural — must be ignored
    const small = measureAll(Object.values(doc.nodes), true, doc.rootId)[research.id];
    research.style.height = 220;
    const large = measureAll(Object.values(doc.nodes), true, doc.rootId)[research.id];
    expect(small.width).toBe(300);
    expect(small.height).toBeGreaterThanOrEqual(natural.height);
    expect(large.height).toBe(220);
  });

  it('reserves a thumbnail strip for attached images', () => {
    const doc = makeDoc();
    const research = findByTitle(doc, 'Research');
    const before = measureAll(Object.values(doc.nodes), true, doc.rootId)[research.id];
    research.content.images = [{ id: 'img', src: 'data:image/png;base64,AAAA', alt: 'Pixel' }];
    const after = measureAll(Object.values(doc.nodes), true, doc.rootId)[research.id];
    expect(after.image).toBe('data:image/png;base64,AAAA');
    expect(after.height).toBeGreaterThan(before.height + 40);
  });
});
