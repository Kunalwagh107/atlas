import { describe, expect, it } from 'vitest';
import { makeDoc, makeLargeDoc } from '../test/fixtures';
import { parseDocument } from '../core/mindmap/validation';
import {
  isPortableMapText,
  parsePortableMap,
  PortableMapError,
  PORTABLE_VERSION,
  serializePortableMap,
} from './portable';

describe('portable map transfer', () => {
  it('round-trips nodes, relationships, metadata and embedded images', () => {
    const doc = makeDoc('Portable map');
    doc.nodes[doc.rootId].metadata = { source: 'test', nested: 'value' };
    doc.nodes[doc.rootId].content.images = [
      { id: 'img-1', src: 'data:image/png;base64,AAAA', alt: 'Local pixel' },
    ];
    const text = serializePortableMap(doc);
    expect(isPortableMapText(text)).toBe(true);
    expect(JSON.parse(text)).toMatchObject({ format: 'atlas-map', version: PORTABLE_VERSION });

    const parsed = parsePortableMap(text);
    expect(parsed.title).toBe('Portable map');
    expect(parsed.nodes[parsed.rootId].metadata).toEqual({ source: 'test', nested: 'value' });
    expect(parsed.nodes[parsed.rootId].content.images[0].src).toBe('data:image/png;base64,AAAA');
    expect(Object.keys(parsed.edges)).toEqual(Object.keys(doc.edges));
  });

  it('rejects tampered files and newer versions with clear diagnostics', () => {
    const doc = makeDoc('Tamper target');
    const file = JSON.parse(serializePortableMap(doc));
    file.doc.title = 'Changed';
    expect(() => parsePortableMap(JSON.stringify(file))).toThrow(PortableMapError);
    expect(() => parsePortableMap(JSON.stringify({ format: 'atlas-map', version: 99, doc }))).toThrow(/newer version/);
  });

  it('round-trips a large 5,000-node map', () => {
    const doc = makeLargeDoc(5000);
    const parsed = parsePortableMap(serializePortableMap(doc));
    expect(Object.keys(parsed.nodes)).toHaveLength(5000);
    expect(parsed.rootId).toBe(doc.rootId);
  });

  it('does not misclassify legacy plain-document JSON', () => {
    const legacy = JSON.stringify({ version: 2, title: 'Legacy', nodes: {} });
    expect(isPortableMapText(legacy)).toBe(false);
    expect(() => parsePortableMap(legacy)).toThrow(PortableMapError);
    expect(parseDocument(makeDoc('Still valid')).title).toBe('Still valid');
  });
});
