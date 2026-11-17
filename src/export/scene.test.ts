import { describe, expect, it } from 'vitest';
import { computeBounds, computeLayout } from '../core/layout';
import { findByTitle, makeDoc, sizesOf } from '../test/fixtures';
import { getPalette } from '../core/mindmap/palette';
import { MAP_STYLE } from '../core/mindmap/appearance';
import { measureAll } from '../core/layout/measure';
import { CURRENT_SCHEMA_VERSION } from '../core/mindmap/types';
import { parseDocumentFromText } from '../core/mindmap/validation';
import { documentToJson, exportJson } from './json';
import { renderExportScene, type ExportSceneSpec } from './scene';

function scene(): ExportSceneSpec {
  const doc = makeDoc('Export map');
  const research = findByTitle(doc, 'Research');
  doc.nodes[research.id].collapsed = true;
  return {
    doc,
    ids: Object.keys(doc.nodes),
    positions: computeLayout(doc, sizesOf(doc), doc.settings.layout, { ignoreCollapsed: true }),
    sizes: sizesOf(doc),
    palette: getPalette('light'),
    mapStyle: MAP_STYLE,
    padding: 64,
    includeGrid: true,
  };
}

describe('standalone export scene', () => {
  it('renders every node including collapsed descendants', () => {
    const spec = scene();
    const result = renderExportScene(spec);
    expect(result.width).toBeGreaterThan(0);
    expect(result.height).toBeGreaterThan(0);
    for (const id of spec.ids) expect(result.markup).toContain(`data-node-id="${id}"`);
    expect(result.markup).toContain('<svg');
    expect(result.markup).toContain('atlas-export-grid');
    expect(result.markup).not.toContain('data-export-ignore');
    expect(result.markup).toContain('<title>Export map</title>');
  });

  it('tiles the scene into smaller page clips', () => {
    const spec = scene();
    const full = renderExportScene(spec);
    const clipped = renderExportScene({ ...spec, clip: { x: 0, y: 0, width: full.width / 2, height: full.height / 2 } });
    expect(clipped.width).toBeLessThan(full.width);
    expect(clipped.height).toBeLessThan(full.height);
    expect(clipped.markup).toContain('<svg');
    expect(clipped.markup.match(/data-node-id=/g)?.length).toBeGreaterThan(0);
  });

  it('uses complete-map layout so hidden branches have real coordinates', () => {
    const spec = scene();
    const bounds = computeBounds(spec.positions, spec.sizes, spec.ids, 64);
    const sources = findByTitle(spec.doc, 'Sources');
    expect(spec.positions[sources.id].x).toBeGreaterThan(spec.positions[spec.doc.rootId].x);
    expect(bounds.width).toBeGreaterThan(200);
  });
});

describe('JSON export', () => {
  it('writes the current schema version and round-trips through validation', () => {
    const doc = makeDoc('Backup');
    const json = documentToJson(doc);
    expect(JSON.parse(json).version).toBe(CURRENT_SCHEMA_VERSION);
    const parsed = parseDocumentFromText(json);
    expect(parsed.title).toBe(doc.title);
    expect(Object.keys(parsed.nodes)).toHaveLength(Object.keys(doc.nodes).length);
    expect(typeof exportJson).toBe('function');
  });
});

describe('image export', () => {
  it('includes uploaded images and rejects unsafe image URLs', () => {
    const doc = makeDoc('Images');
    const id = doc.rootId;
    doc.nodes[id].content.images = [
      { id: 'a', src: 'data:image/png;base64,AAAA', alt: 'Pixel' },
      { id: 'b', src: 'data:image/jpeg;base64,BBBB', alt: 'Photo' },
      { id: 'c', src: 'javascript:alert(1)', alt: 'Bad' },
    ];
    const sizes = measureAll(Object.values(doc.nodes), false, doc.rootId);
    const spec: ExportSceneSpec = {
      doc, ids: Object.keys(doc.nodes),
      positions: computeLayout(doc, sizes, doc.settings.layout),
      sizes, palette: getPalette('light'), mapStyle: MAP_STYLE,
    };
    const markup = renderExportScene(spec).markup;
    expect(markup).toContain('<image href="data:image/png;base64,AAAA"');
    expect(markup).not.toContain('javascript:');
    expect(markup).toContain('+1 more');
  });

  it('resolves local blob references to embedded data URLs for standalone output', () => {
    const doc = makeDoc('Local images');
    doc.nodes[doc.rootId].content.images = [
      { id: 'local', src: 'atlas-blob:local', alt: 'Local' },
    ];
    const sizes = measureAll(Object.values(doc.nodes), false, doc.rootId);
    const spec: ExportSceneSpec = {
      doc, ids: Object.keys(doc.nodes),
      positions: computeLayout(doc, sizes, doc.settings.layout),
      sizes, palette: getPalette('light'), mapStyle: MAP_STYLE,
      imageSources: { local: 'data:image/png;base64,AAAA' },
    };
    const markup = renderExportScene(spec).markup;
    expect(markup).toContain('<image href="data:image/png;base64,AAAA"');
    expect(markup).not.toContain('atlas-blob:local');
  });
});

describe('scene options used by GIF frames', () => {
  it('scales pixels without changing the world viewBox', () => {
    const base = scene();
    const normal = renderExportScene(base);
    const scaled = renderExportScene({ ...base, pixelScale: 2 });
    expect(scaled.width).toBe(normal.width * 2);
    expect(scaled.markup).toContain(`viewBox="${computeBounds(base.positions, base.sizes, base.ids, 64).x.toFixed(2).replace(/\.00$/, '')}`);
  });

  it('can omit the background so frames can be layered', () => {
    const base = scene();
    const opaque = renderExportScene(base);
    const transparent = renderExportScene({ ...base, transparent: true });
    expect(opaque.markup).toContain('fill="#f4f6fa"');
    expect(transparent.markup).not.toContain('fill="#f4f6fa"');
  });

  it('reuses explicit bounds for a single-node overlay', () => {
    const base = scene();
    const full = renderExportScene(base);
    const overlay = renderExportScene({ ...base, ids: [base.doc.rootId], bounds: full.bounds, transparent: true });
    expect(overlay.width).toBe(full.width);
    expect(overlay.height).toBe(full.height);
    expect(overlay.markup).toContain(`data-node-id="${base.doc.rootId}"`);
    expect(overlay.markup.match(/data-node-id=/g)?.length).toBe(1);
  });

  it('applies per-node opacity for presentation dimming', () => {
    const base = scene();
    const dimmed = renderExportScene({ ...base, opacityOf: (id) => (id === base.doc.rootId ? 1 : 0.3) });
    expect(dimmed.markup).toContain('opacity="0.30"');
  });
});
