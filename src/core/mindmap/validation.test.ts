import { describe, expect, it } from 'vitest';
import { findByTitle, makeDoc } from '../../test/fixtures';
import { CURRENT_SCHEMA_VERSION } from './types';
import {
  ImportError,
  buildDiagnosticReport,
  getLastImportDiagnostics,
  parseDocument,
  parseDocumentFromText,
} from './validation';

function rawDoc() {
  return JSON.parse(JSON.stringify(makeDoc())) as Record<string, unknown>;
}

describe('import validation and repair', () => {
  it('accepts a canonical document and normalises every node', () => {
    const parsed = parseDocument(rawDoc());
    expect(parsed.version).toBe(CURRENT_SCHEMA_VERSION);
    expect(Object.keys(parsed.nodes)).toHaveLength(Object.keys(rawDoc().nodes as object).length);
    expect(getLastImportDiagnostics()).toEqual([]);
    for (const node of Object.values(parsed.nodes)) {
      expect(node.content).toBeDefined();
      expect(['auto', 'manual']).toContain(node.positionMode);
    }
  });

  it('renames duplicate ids, fixes bad parents and drops invalid edges', () => {
    const raw = rawDoc();
    const nodes = Object.values(raw.nodes as Record<string, Record<string, unknown>>);
    const first = nodes[0];
    const second = nodes[1];
    second.id = first.id; // duplicate
    second.parentId = 'missing-parent';
    raw.edges = {
      e1: { id: 'e1', source: 'nope', target: first.id, kind: 'relation' },
      e2: { id: 'e2', source: first.id, target: first.id, kind: 'relation' },
    };
    const parsed = parseDocument(raw);
    expect(new Set(Object.keys(parsed.nodes)).size).toBe(nodes.length);
    expect(Object.keys(parsed.edges)).toHaveLength(0);
    const diagnostics = getLastImportDiagnostics();
    expect(diagnostics.some((line) => line.includes('Duplicate node id'))).toBe(true);
    expect(diagnostics.some((line) => line.includes('Dropped invalid edge'))).toBe(true);
    for (const node of Object.values(parsed.nodes)) {
      if (node.id !== parsed.rootId) expect(node.parentId).toBeTruthy();
    }
  });

  it('breaks parent cycles instead of hanging', () => {
    const raw = rawDoc();
    const nodes = raw.nodes as Record<string, Record<string, unknown>>;
    const rootId = raw.rootId as string;
    const ids = Object.keys(nodes);
    nodes[ids[1]].parentId = ids[2];
    nodes[ids[2]].parentId = ids[1];
    const parsed = parseDocument(raw);
    expect(parsed.rootId).toBe(rootId);
    expect(Object.keys(parsed.nodes)).toHaveLength(ids.length);
  });

  it('rejects newer schemas, empty node sets and invalid JSON with useful details', () => {
    expect(() => parseDocument({ version: CURRENT_SCHEMA_VERSION + 1, nodes: {} })).toThrow(ImportError);
    expect(() => parseDocument({ nodes: [] })).toThrow(/No nodes/);
    expect(() => parseDocumentFromText('{not json')).toThrow(ImportError);
    try {
      parseDocumentFromText('{"version":99,"nodes":{}}');
    } catch (error) {
      expect(error).toBeInstanceOf(ImportError);
      expect((error as ImportError).details.length).toBeGreaterThan(0);
    }
  });

  it('produces a copyable diagnostic report', () => {
    parseDocument(rawDoc());
    const report = buildDiagnosticReport('broken.json', new ImportError('Bad file', ['reason one']));
    expect(report).toContain(`Atlas schema: v${CURRENT_SCHEMA_VERSION}`);
    expect(report).toContain('reason one');
    expect(report).toContain('broken.json');
  });

  it('round-trips through JSON with search-visible content intact', () => {
    const doc = makeDoc();
    const node = findByTitle(doc, 'Research');
    node.content.tags = ['roundtrip'];
    const parsed = parseDocumentFromText(JSON.stringify(doc));
    expect(findByTitle(parsed, 'Research').content.tags).toEqual(['roundtrip']);
  });

  it('preserves explicit node size and uploaded images', () => {
    const doc = makeDoc();
    const node = findByTitle(doc, 'Research');
    node.style.width = 320;
    node.style.height = 180;
    const dataUrl = `data:image/png;base64,${'A'.repeat(20_000)}`;
    node.content.images = [{ id: 'photo', src: dataUrl, alt: 'Photo' }];
    const parsed = parseDocumentFromText(JSON.stringify(doc));
    expect(parsed.nodes[node.id].style.width).toBe(320);
    expect(parsed.nodes[node.id].style.height).toBe(180);
    expect(parsed.nodes[node.id].content.images[0].src).toBe(dataUrl);
  });
});
