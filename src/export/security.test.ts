import { describe, expect, it } from 'vitest';
import { computeLayout } from '../core/layout';
import { MAP_STYLE } from '../core/mindmap/appearance';
import { getPalette } from '../core/mindmap/palette';
import { parseDocument } from '../core/mindmap/validation';
import { makeDoc, sizesOf } from '../test/fixtures';
import { frameIndices, GifExportCancelled, MAX_GIF_FRAMES } from './gif';
import { documentToJson } from './json';
import { renderExportScene, safeColor, type ExportSceneSpec } from './scene';

function sceneSpec(): ExportSceneSpec {
  const doc = makeDoc('Security');
  return {
    doc,
    ids: Object.keys(doc.nodes),
    positions: computeLayout(doc, sizesOf(doc), doc.settings.layout, { ignoreCollapsed: true }),
    sizes: sizesOf(doc),
    palette: getPalette('light'),
    mapStyle: MAP_STYLE,
    padding: 32,
    includeGrid: false,
  };
}

describe('SVG export hardening', () => {
  it('whitelists plain CSS colours only', () => {
    expect(safeColor('#aabbcc', '#ffffff')).toBe('#aabbcc');
    expect(safeColor('rgba(12, 34, 56, 0.5)', '#ffffff')).toBe('rgba(12, 34, 56, 0.5)');
    expect(safeColor('"><script>alert(1)</script>', '#ffffff')).toBe('#ffffff');
    expect(safeColor('url(javascript:alert(1))', '#ffffff')).toBe('#ffffff');
  });

  it('never emits injected markup from node colours', () => {
    const spec = sceneSpec();
    const child = Object.values(spec.doc.nodes).find((node) => node.id !== spec.doc.rootId)!;
    const payload = '"><script>alert(1)</script>';
    child.style.background = payload;
    child.style.textColor = payload;
    child.style.borderColor = payload;
    const markup = renderExportScene(spec).markup;
    expect(markup).not.toContain('<script');
    expect(markup).not.toContain('alert(1)');
    expect(markup).toContain('fill="#ffffff"');
  });

  it('escapes node titles and edge labels', () => {
    const spec = sceneSpec();
    spec.doc.title = '<img src=x onerror=alert(1)>';
    const markup = renderExportScene(spec).markup;
    expect(markup).not.toContain('<img');
    expect(markup).toContain('&lt;img');
  });
});

describe('import validation', () => {
  it('drops non-colour style values from imported documents', () => {
    const doc = makeDoc('Injected import');
    const child = Object.values(doc.nodes).find((node) => node.id !== doc.rootId)!;
    const raw = JSON.parse(documentToJson(doc)) as Record<string, unknown>;
    const nodes = raw.nodes as Record<string, { style: Record<string, unknown> }>;
    nodes[child.id].style.background = '"><script>alert(1)</script>';
    nodes[child.id].style.borderColor = 'url(javascript:alert(1))';
    nodes[child.id].style.textColor = '#123456';
    const parsed = parseDocument(raw);
    expect(parsed.nodes[child.id].style.background).toBeUndefined();
    expect(parsed.nodes[child.id].style.borderColor).toBeUndefined();
    expect(parsed.nodes[child.id].style.textColor).toBe('#123456');
  });

  it('does not let a __proto__ root id write to Object.prototype', () => {
    const raw = JSON.parse(documentToJson(makeDoc()));
    raw.rootId = '__proto__';
    const parsed = parseDocument(raw);
    expect(parsed.rootId).not.toBe('__proto__');
    expect(Object.getOwnPropertyDescriptor(Object.prototype, 'parentId')).toBeUndefined();
    expect(Object.getOwnPropertyDescriptor(Object.prototype, 'type')).toBeUndefined();
  });

  it('migrates a v1 document with missing settings', () => {
    const raw = JSON.parse(documentToJson(makeDoc('Legacy')));
    raw.version = 1;
    delete raw.settings;
    const parsed = parseDocument(raw);
    expect(parsed.version).toBe(2);
    expect(parsed.settings.presentationOrder).toEqual([]);
    expect(parsed.nodes[parsed.rootId].content).toBeDefined();
  });
});

describe('presentation GIF frame budget', () => {
  it('keeps short presentations intact', () => {
    expect(frameIndices(5)).toEqual([0, 1, 2, 3, 4]);
    expect(frameIndices(0)).toEqual([]);
  });

  it('evenly samples long presentations instead of allocating unbounded frames', () => {
    const indices = frameIndices(150);
    expect(indices).toHaveLength(MAX_GIF_FRAMES);
    expect(indices[0]).toBe(0);
    expect(indices[indices.length - 1]).toBe(149);
    expect(new Set(indices).size).toBe(MAX_GIF_FRAMES);
  });

  it('exposes a distinguishable cancellation error', () => {
    expect(new GifExportCancelled().name).toBe('GifExportCancelled');
  });
});
