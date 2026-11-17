import { describe, expect, it } from 'vitest';
import { findByTitle, makeDoc, sizesOf } from '../../test/fixtures';
import { normalizeContent } from '../mindmap/content';
import { applyCommand, isStructural } from './commands';

describe('command layer', () => {
  it('normalises rich content on every updateContent command', () => {
    const doc = makeDoc();
    const id = findByTitle(doc, 'Build').id;
    const result = applyCommand(doc, {
      kind: 'updateContent',
      id,
      content: {
        markdown: 'note', code: [], formulas: [], links: [{ id: 'x', url: 'javascript:bad()', title: '' }],
        images: [], checklist: [], tags: ['a', 'a'],
      },
    });
    expect(result.changed).toBe(true);
    expect(result.doc.nodes[id].content.tags).toEqual(['a']);
    expect(result.doc.nodes[id].content.links).toHaveLength(0);
    expect(result.doc.nodes[id].content.markdown).toBe('note');
  });

  it('aligns and distributes selected nodes and stamps them manual', () => {
    let doc = makeDoc();
    const a = findByTitle(doc, 'Research').id;
    const b = findByTitle(doc, 'Build').id;
    const c = findByTitle(doc, 'Launch').id;
    doc.nodes[a].position = { x: 10, y: 100 };
    doc.nodes[b].position = { x: 90, y: 140 };
    doc.nodes[c].position = { x: 200, y: 180 };
    const aligned = applyCommand(doc, { kind: 'alignNodes', ids: [a, b, c], align: 'centerY' }).doc;
    expect(aligned.nodes[a].position.y).toBe(aligned.nodes[b].position.y);
    expect(aligned.nodes[a].positionMode).toBe('manual');
    const distributed = applyCommand(aligned, { kind: 'distributeNodes', ids: [a, b, c], axis: 'x' }).doc;
    const xs = [a, b, c].map((id) => distributed.nodes[id].position.x);
    expect(xs[1] - xs[0]).toBeCloseTo(xs[2] - xs[1], 5);
  });

  it('bulk-deletes whole subtrees while protecting the root', () => {
    const doc = makeDoc();
    const research = findByTitle(doc, 'Research').id;
    const build = findByTitle(doc, 'Build').id;
    const result = applyCommand(doc, { kind: 'deleteNodes', ids: [research, build, doc.rootId] });
    expect(result.doc.nodes[doc.rootId]).toBeDefined();
    expect(result.doc.nodes[research]).toBeUndefined();
    expect(result.doc.nodes[build]).toBeUndefined();
    expect(Object.values(result.doc.nodes).some((node) => node.title === 'Sources')).toBe(false);
  });

  it('groups nodes under a new parent', () => {
    const doc = makeDoc();
    const a = findByTitle(doc, 'Research').id;
    const b = findByTitle(doc, 'Build').id;
    const result = applyCommand(doc, { kind: 'groupNodes', ids: [a, b], title: 'Phase 1' });
    expect(result.createdId).toBeTruthy();
    expect(result.doc.nodes[result.createdId!].title).toBe('Phase 1');
    expect(result.doc.nodes[a].parentId).toBe(result.createdId);
    expect(result.doc.nodes[b].parentId).toBe(result.createdId);
  });

  it('updates document settings through commands', () => {
    const doc = makeDoc();
    const ordered = applyCommand(doc, { kind: 'setPresentationOrder', order: [doc.rootId] }).doc;
    expect(ordered.settings.presentationOrder).toEqual([doc.rootId]);
  });

  it('resets manual positions only on an explicit command', () => {
    const doc = makeDoc();
    const id = findByTitle(doc, 'Launch').id;
    doc.nodes[id].position = { x: 999, y: 999 };
    doc.nodes[id].positionMode = 'manual';
    const result = applyCommand(doc, {
      kind: 'resetToAutoLayout', sizes: sizesOf(doc), layout: 'horizontal',
    });
    expect(result.doc.nodes[id].positionMode).toBe('auto');
    expect(result.doc.nodes[id].position).not.toEqual({ x: 999, y: 999 });
  });

  it('classifies structural commands for auto-arrange', () => {
    expect(isStructural({ kind: 'addChild', parentId: 'x' })).toBe(true);
    expect(isStructural({ kind: 'setTitle', title: 'x' })).toBe(false);
    expect(isStructural({ kind: 'updateContent', id: 'x', content: normalizeContent(undefined) })).toBe(false);
  });
});
