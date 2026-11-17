import { describe, expect, it } from 'vitest';
import { findByTitle, makeDoc } from '../../test/fixtures';
import { MAP_STYLE, mapFontFamily, nodeBadges, effectiveFontSize, effectiveRadius } from './appearance';
import {
  EMPTY_CONTENT, contentBadges, contentSearchText, hasRichContent, isSafeImageSrc,
  MAX_IMAGE_SRC_LENGTH, normalizeContent,
} from './content';
import { migrateRawDocument, MigrationError, needsMigration, readDocumentVersion } from './migrations';
import {
  addChild,
  addRelation,
  createBlankDocument,
  deleteSubtree,
  duplicateSubtree,
  extractSubtree,
  getChildren,
  getStats,
  getVisibleNodes,
  insertSubtree,
  isVisible,
  placeNewChild,
} from './operations';
import { DEFAULT_SEARCH_FILTERS, searchDocument } from './search';
import { CURRENT_SCHEMA_VERSION } from './types';

describe('canonical document model', () => {
  it('creates a v2 blank document and keeps auto-arrange off by default', () => {
    const doc = createBlankDocument('Untitled');
    expect(doc.version).toBe(CURRENT_SCHEMA_VERSION);
    expect(Object.keys(doc.nodes)).toHaveLength(1);
    expect(doc.settings.autoArrange).toBe(false);
    expect(doc.settings.presentationOrder).toEqual([]);
    expect(doc.nodes[doc.rootId].content).toEqual(EMPTY_CONTENT);
    expect(getStats(doc)).toEqual({ nodes: 1, edges: 0, branches: 0, depth: 0 });
  });

  it('adds children without re-placing existing nodes', () => {
    const doc = makeDoc();
    const research = findByTitle(doc, 'Research');
    const before = { ...research.position };
    const result = addChild(doc, research.id, { title: 'Extra' });
    expect(result.id).toBeTruthy();
    expect(result.doc.nodes[research.id].position).toEqual(before);
    expect(getChildren(result.doc, research.id)).toHaveLength(3);
    expect(result.doc.nodes[result.id].metadata.order).toBe(2);
    const spot = placeNewChild(doc, research);
    expect(Number.isFinite(spot.x) && Number.isFinite(spot.y)).toBe(true);
  });

  it('deletes a whole subtree and any edges touching it', () => {
    let doc = makeDoc();
    const research = findByTitle(doc, 'Research');
    const launch = findByTitle(doc, 'Launch');
    doc = addRelation(doc, research.id, launch.id, 'depends on');
    doc = addRelation(doc, launch.id, doc.rootId, '');
    const next = deleteSubtree(doc, research.id);
    expect(Object.keys(next.nodes)).toHaveLength(Object.keys(doc.nodes).length - 3);
    expect(Object.values(next.edges)).toHaveLength(1);
    expect(next.nodes[research.id]).toBeUndefined();
  });

  it('duplicates a subtree with independent ids but identical shape', () => {
    const doc = makeDoc();
    const research = findByTitle(doc, 'Research');
    const result = duplicateSubtree(doc, research.id);
    expect(result.id).not.toBe(research.id);
    expect(result.doc.nodes[result.id].title).toBe('Research');
    expect(getChildren(result.doc, result.id)).toHaveLength(2);
    expect(Object.keys(result.doc.nodes)).toHaveLength(Object.keys(doc.nodes).length + 3);
  });

  it('round-trips a subtree through clipboard payload including rich content', () => {
    const doc = makeDoc();
    const research = findByTitle(doc, 'Research');
    research.content = normalizeContent({ tags: ['alpha', 'alpha'], markdown: 'Long note' });
    const payload = extractSubtree(doc, research.id);
    expect(payload?.root.content.tags).toEqual(['alpha']);
    const pasted = insertSubtree(doc, doc.rootId, payload!);
    expect(pasted.doc.nodes[pasted.id].content.markdown).toBe('Long note');
    expect(getChildren(pasted.doc, pasted.id)).toHaveLength(2);
  });

  it('keeps collapsed descendants in the document but out of the visible set', () => {
    const doc = makeDoc();
    const research = findByTitle(doc, 'Research');
    const sources = findByTitle(doc, 'Sources');
    doc.nodes[research.id].collapsed = true;
    expect(isVisible(doc, sources.id)).toBe(false);
    expect(getVisibleNodes(doc).some((node) => node.id === sources.id)).toBe(false);
    expect(doc.nodes[sources.id]).toBeDefined();
  });
});

describe('rich content normalisation', () => {
  it('filters unsafe URLs, deduplicates tags and clamps lengths', () => {
    const content = normalizeContent({
      tags: [' alpha ', '#beta', 'alpha', ''],
      markdown: 'x'.repeat(30_000),
      links: [
        { url: 'https://example.com', title: 'Safe' },
        { url: 'javascript:alert(1)', title: 'Unsafe' },
      ],
      images: [{ src: 'data:image/png;base64,AAAA', alt: 'Pixel' }],
      checklist: [{ text: 'Task', done: true }],
    });
    expect(content.tags).toEqual(['alpha', 'beta']);
    expect(content.markdown).toHaveLength(20_000);
    expect(content.links).toHaveLength(1);
    expect(content.links[0].title).toBe('Safe');
    expect(content.images).toHaveLength(1);
    expect(content.checklist[0].done).toBe(true);
    expect(hasRichContent(content)).toBe(true);
    expect(hasRichContent(EMPTY_CONTENT)).toBe(false);
    expect(contentSearchText(content)).toContain('#alpha');
    expect(contentBadges(content)).toContain('link');
  });

  it('produces compact canvas badges shared with measurement', () => {
    const badges = nodeBadges(normalizeContent({ tags: ['one', 'two'], code: [{ source: 'x' }], checklist: [{ done: true }] }));
    expect(badges.length).toBeLessThanOrEqual(4);
    expect(badges.some((badge) => badge.label.startsWith('#'))).toBe(true);
  });
});

describe('fixed map style and measurement helpers', () => {
  it('resolves fonts, sizes and radii consistently', () => {
    const doc = makeDoc();
    const node = doc.nodes[doc.rootId];
    expect(mapFontFamily()).toContain('Inter');
    expect(effectiveFontSize(node, true)).toBe(node.style.fontSize + 2);
    expect(effectiveFontSize(node, false)).toBe(node.style.fontSize);
    expect(effectiveRadius(node)).toBe(Math.round((node.style.borderRadius + MAP_STYLE.borderRadius) / 2));
  });
});

describe('image source safety', () => {
  it('accepts long bitmap data URLs and rejects script and oversized payloads', () => {
    const long = `data:image/png;base64,${'A'.repeat(20_000)}`;
    expect(isSafeImageSrc(long)).toBe(true);
    expect(normalizeContent({ images: [{ src: long }] }).images[0].src).toBe(long);
    expect(isSafeImageSrc('javascript:alert(1)')).toBe(false);
    expect(isSafeImageSrc('data:image/svg+xml;base64,PHN2Zz4=')).toBe(false);
    expect(isSafeImageSrc(`data:image/png;base64,${'A'.repeat(MAX_IMAGE_SRC_LENGTH + 10)}`)).toBe(false);
    // Oversized sources must be dropped, never truncated into a broken URL.
    expect(normalizeContent({ images: [{ src: `data:image/png;base64,${'A'.repeat(MAX_IMAGE_SRC_LENGTH + 10)}` }] }).images).toHaveLength(0);
  });

  it('drops remote image URLs so no map can request an external image', () => {
    expect(isSafeImageSrc('https://example.com/pixel.png')).toBe(false);
    expect(isSafeImageSrc('//example.com/pixel.png')).toBe(false);
    expect(isSafeImageSrc('/assets/pixel.png')).toBe(false);
    expect(isSafeImageSrc('atlas-blob:img-1')).toBe(true);
    expect(normalizeContent({
      images: [
        { src: 'https://example.com/pixel.png' },
        { src: 'atlas-blob:img-1' },
      ],
    }).images.map((image) => image.src)).toEqual(['atlas-blob:img-1']);
  });
});

describe('ranked search', () => {
  it('ranks exact title matches above substring matches', () => {
    const doc = makeDoc();
    const hits = searchDocument(doc, 'Research');
    expect(hits[0].id).toBe(findByTitle(doc, 'Research').id);
    expect(hits[0].score).toBeGreaterThan(0);
    expect(hits[0].matchedIn).toContain('title');
  });

  it('honours field filters and fuzzy matching', () => {
    const doc = makeDoc();
    const research = findByTitle(doc, 'Research');
    research.content = normalizeContent({ markdown: 'quantum annealing' });
    const all = searchDocument(doc, 'quantum');
    expect(all.some((hit) => hit.id === research.id)).toBe(true);
    const titlesOnly = searchDocument(doc, 'quantum', { ...DEFAULT_SEARCH_FILTERS, fields: ['title'] });
    expect(titlesOnly).toHaveLength(0);
    const noFuzzy = searchDocument(doc, 'Researc', { ...DEFAULT_SEARCH_FILTERS, fuzzy: false, exact: true });
    expect(noFuzzy).toHaveLength(0);
    const fuzzy = searchDocument(doc, 'Researc');
    expect(fuzzy.length).toBeGreaterThan(0);
  });
});

describe('schema migrations', () => {
  it('migrates a v1 document to v2 with legacy fields preserved', () => {
    const legacy = {
      version: 1,
      id: 'map-1',
      title: 'Legacy',
      rootId: 'root',
      nodes: [
        { id: 'root', parentId: null, title: 'Root', position: { x: 0, y: 0 }, metadata: { manualPosition: true }, tags: ['old'] },
        { id: 'child', parentId: 'root', title: 'Child', position: { x: 10, y: 0 }, markdown: '# notes' },
      ],
      edges: {},
      settings: { layout: 'tree' },
    };
    expect(readDocumentVersion(legacy)).toBe(1);
    expect(needsMigration(legacy)).toBe(true);
    const result = migrateRawDocument(legacy);
    expect(result.applied).toEqual([1]);
    expect(result.raw.version).toBe(2);
    const nodes = result.raw.nodes as Record<string, unknown>[];
    const root = nodes[0] as Record<string, unknown>;
    expect(root.positionMode).toBe('manual');
    expect((root.content as Record<string, unknown>).tags).toEqual(['old']);
    expect((result.raw.settings as Record<string, unknown>).autoArrange).toBe(false);
  });

  it('rejects documents newer than the app', () => {
    expect(() => migrateRawDocument({ version: 99, nodes: {} })).toThrow(MigrationError);
  });
});
