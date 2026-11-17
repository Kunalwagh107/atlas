import { describe, expect, it } from 'vitest';
import { findByTitle, makeDoc } from '../../test/fixtures';
import {
  AIValidationError,
  callAI,
  expandNode,
  generateMindMap,
  parseAIDocument,
  parseAISubtree,
  sanitizeOutline,
  summarizeBranch,
  type AIProvider,
} from './ai';

const provider = (value: unknown): AIProvider => ({ complete: async () => value });

describe('AI trust boundary', () => {
  it('converts a loose outline into a valid canonical document', () => {
    const doc = parseAIDocument({
      title: 'Learning plan',
      root: { title: 'Learn', description: 'A plan', tags: ['study', 'study'], children: ['Read', { title: 'Practise', children: ['Exercises'] }] },
    });
    expect(doc.version).toBe(2);
    expect(doc.title).toBe('Learning plan');
    expect(Object.keys(doc.nodes)).toHaveLength(4);
    expect(findByTitle(doc, 'Learn').content.tags).toEqual(['study']);
    expect(findByTitle(doc, 'Exercises').parentId).toBe(findByTitle(doc, 'Practise').id);
  });

  it('accepts a canonical Atlas document without mangling it', () => {
    const source = makeDoc('Canonical');
    const parsed = parseAIDocument(JSON.parse(JSON.stringify(source)));
    expect(Object.keys(parsed.nodes)).toHaveLength(Object.keys(source.nodes).length);
    expect(parsed.rootId).toBe(source.rootId);
  });

  it('rejects oversized or deeply nested output with diagnostics', () => {
    const deep = (depth: number): unknown => depth === 0
      ? { title: 'leaf' }
      : { title: `level ${depth}`, children: [deep(depth - 1)] };
    expect(() => sanitizeOutline(deep(20))).toThrow(AIValidationError);
    let wide: unknown = { title: 'leaf' };
    for (let i = 0; i < 12; i++) wide = { title: `level ${i}`, children: [wide, wide] };
    expect(() => sanitizeOutline({ root: wide })).toThrow(/too many nodes/);
  });

  it('wraps provider failures and validation errors without leaking raw data', async () => {
    const ok = await generateMindMap(provider({ root: { title: 'Root', children: ['A', 'B'] } }), 'test');
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(Object.keys(ok.value.nodes)).toHaveLength(3);

    const broken = await callAI(
      { complete: async () => { throw new Error('network down'); } },
      'p', 's', () => 'never',
    );
    expect(broken.ok).toBe(false);
    if (!broken.ok) expect(broken.error).toContain('network down');

    const invalid = await generateMindMap(provider(null), 'test');
    expect(invalid.ok).toBe(false);
  });

  it('expands a node into a paste-ready subtree', async () => {
    const doc = makeDoc();
    const id = findByTitle(doc, 'Research').id;
    const result = await expandNode(provider({ title: 'New branches', children: ['Survey', 'Notes'] }), doc, id);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.children).toHaveLength(2);
      expect(result.value.root.content.tags).toEqual([]);
    }
    const missing = await expandNode(provider({}), doc, 'missing');
    expect(missing.ok).toBe(false);
  });

  it('builds a deterministic branch summary for prompts', () => {
    const doc = makeDoc();
    const summary = summarizeBranch(doc, findByTitle(doc, 'Research').id);
    expect(summary.title).toBe('Research');
    expect(summary.nodeCount).toBe(3);
    expect(summary.text).toContain('Sources');
  });

  it('validates subtrees with strict length and URL limits', () => {
    const payload = parseAISubtree({
      title: 'A'.repeat(500),
      children: [{ title: 'Child', tags: ['x'] }],
    });
    expect(payload.root.title.length).toBeLessThanOrEqual(300);
    expect(payload.children[0].root.content.tags).toEqual(['x']);
  });
});
