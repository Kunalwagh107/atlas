import { describe, expect, it } from 'vitest';
import { makeDoc } from '../../test/fixtures';
import {
  detectFormat,
  parseForeignDocument,
  serializeCsv,
  serializeDocument,
  serializeFreeMind,
  serializeMarkdown,
  serializeOpml,
} from './codecs';

const titles = (doc: ReturnType<typeof makeDoc>) => Object.values(doc.nodes).map((node) => node.title);

describe('format detection', () => {
  it('detects JSON, Markdown, OPML, CSV and FreeMind by content and extension', () => {
    expect(detectFormat('{"version":2,"nodes":{}}')).toBe('json');
    expect(detectFormat('# Title\n- Child')).toBe('markdown');
    expect(detectFormat('a,b\n1,2', 'outline.CSV')).toBe('csv');
    expect(detectFormat('<opml version="2.0"><body/></opml>')).toBe('opml');
    expect(detectFormat('<map version="freeplane 1.9.0"></map>', 'map.mm')).toBe('freemind');
    expect(detectFormat('random prose')).toBeNull();
  });
});

describe('plain-text codecs', () => {
  it('round-trips a Markdown outline', () => {
    const markdown = '# Project plan\n\n- Research #important\n  Gather evidence\n  - Sources\n- Build\n- Launch\n';
    const doc = parseForeignDocument(markdown, 'markdown', 'Project plan');
    const labels = titles(doc);
    expect(labels).toContain('Research');
    expect(labels).toContain('Sources');
    expect(labels).toContain('Launch');
    expect(Object.values(doc.nodes).some((node) => node.content.tags.includes('important'))).toBe(true);
    const output = serializeMarkdown(doc);
    expect(output).toContain('# Project plan');
    expect(output).toContain('Research');
    expect(parseForeignDocument(output, 'markdown').nodes).toBeDefined();
  });

  it('round-trips OPML and FreeMind without losing the hierarchy', () => {
    const original = makeDoc('Formats');
    for (const format of ['opml', 'freemind'] as const) {
      const text = serializeDocument(original, format);
      const parsed = parseForeignDocument(text, format, 'Formats');
      expect(titles(parsed)).toContain('Research');
      expect(titles(parsed)).toContain('Sources');
      expect(Object.keys(parsed.nodes).length).toBe(Object.keys(original.nodes).length);
    }
    expect(serializeOpml(original)).toContain('<opml');
    expect(serializeFreeMind(original)).toContain('<map');
  });

  it('round-trips CSV paths, types and tags', () => {
    const original = makeDoc('CSV map');
    const research = Object.values(original.nodes).find((node) => node.title === 'Research')!;
    research.content.tags = ['priority'];
    const csv = serializeCsv(original);
    expect(csv.split('\n')[0]).toContain('path,title,description,type,tags');
    const parsed = parseForeignDocument(csv, 'csv', 'CSV map');
    expect(titles(parsed)).toContain('Research');
    expect(titles(parsed)).toContain('Prototype');
    expect(Object.values(parsed.nodes).some((node) => node.content.tags.includes('priority'))).toBe(true);
  });

  it('rejects empty or oversized outlines instead of producing broken maps', () => {
    expect(() => parseForeignDocument('', 'markdown')).toThrow(/No outline entries/);
    expect(() => parseForeignDocument('# Only\n', 'opml')).toThrow();
    expect(() => parseForeignDocument('{"version": 999, "nodes": {}}', 'json')).toThrow();
  });
});
