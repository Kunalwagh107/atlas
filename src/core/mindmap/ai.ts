import { normalizeContent } from './content';
import { createDocumentFromSpec, defaultNodeStyle, type NodeSpec, type SubtreePayload } from './operations';
import { parseDocument } from './validation';
import type { MindMapDocument } from './types';

/**
 * Trust boundary for AI-produced content. No provider is bundled: integrations
 * supply a `complete()` function, and everything it returns is validated against
 * the canonical document schema before it can reach the store. This is the only
 * supported path for AI-generated maps.
 */

export class AIValidationError extends Error {
  readonly issues: string[];
  constructor(message: string, issues: string[] = []) {
    super(message);
    this.name = 'AIValidationError';
    this.issues = issues;
  }
}

export interface AIProvider {
  /** Returns an arbitrary JSON value. Must never be trusted directly. */
  complete(prompt: string, schemaHint: string): Promise<unknown>;
}

export type AIResponse<T> =
  | { ok: true; value: T }
  | { ok: false; error: string; issues: string[] };

const MAX_NODES = 2_000;
const MAX_DEPTH = 12;
const TITLE_LIMIT = 300;
const TEXT_LIMIT = 4_000;

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function text(value: unknown, fallback = '', limit = TITLE_LIMIT): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, limit) : fallback;
}

function issuesTracker(): { list: string[]; add: (message: string) => void } {
  const list: string[] = [];
  return { list, add: (message: string) => { if (list.length < 25) list.push(message); } };
}

/** Convert a loose AI outline into a strictly validated NodeSpec tree. */
export function sanitizeOutline(raw: unknown): { spec: NodeSpec; issues: string[] } {
  const { list, add } = issuesTracker();
  let count = 0;

  const walk = (value: unknown, depth: number, fallbackTitle: string): NodeSpec => {
    count++;
    if (count > MAX_NODES) throw new AIValidationError('AI output contains too many nodes', list);
    if (depth > MAX_DEPTH) throw new AIValidationError('AI output is nested too deeply', list);
    if (!isObject(value) && typeof value !== 'string') {
      add(`Dropped an invalid node at depth ${depth}.`);
      return { title: fallbackTitle };
    }
    const object = typeof value === 'string' ? { title: value } : value;
    const title = text(object.title ?? object.label ?? object.text ?? object.name, fallbackTitle);
    if (!title) add(`A node at depth ${depth} had no title; a placeholder was used.`);
    const spec: NodeSpec = { title: title || fallbackTitle };
    const description = text(object.description ?? object.summary ?? object.notes, '', TEXT_LIMIT);
    if (description) spec.description = description;
    if (Array.isArray(object.tags)) {
      spec.tags = normalizeContent({ tags: object.tags }).tags;
    }
    const childrenRaw = object.children ?? object.nodes ?? object.items ?? object.topics;
    if (Array.isArray(childrenRaw) && childrenRaw.length) {
      spec.children = childrenRaw.slice(0, 200).map((child, index) => walk(child, depth + 1, `Idea ${index + 1}`));
    }
    return spec;
  };

  const source = isObject(raw)
    ? (raw.root ?? raw.central ?? raw.outline ?? raw.map ?? raw.nodes ?? raw)
    : raw;
  let root: NodeSpec;
  if (Array.isArray(source)) {
    if (!source.length) throw new AIValidationError('AI output contained no nodes.', list);
    if (source.length === 1 && isObject(source[0]) && Array.isArray(source[0].children)) {
      root = walk(source[0], 0, 'Central topic');
    } else {
      root = { title: 'Central topic', children: source.map((item, index) => walk(item, 1, `Idea ${index + 1}`)) };
    }
  } else {
    root = walk(source, 0, 'Central topic');
  }
  return { spec: root, issues: list };
}

/** Validate *any* AI output into a canonical document. Accepts a canonical doc too. */
export function parseAIDocument(raw: unknown, title = 'AI generated map'): MindMapDocument {
  if (isObject(raw) && isObject(raw.nodes) && typeof raw.rootId === 'string') {
    try {
      return parseDocument(raw);
    } catch (error) {
      throw new AIValidationError('AI output is not a valid Atlas document.', [error instanceof Error ? error.message : 'Validation failed']);
    }
  }
  const { spec } = sanitizeOutline(raw);
  const documentTitle = isObject(raw) ? text(raw.title, title, 200) : title;
  const doc = createDocumentFromSpec(documentTitle || title, spec);
  // Final schema pass: migrations, id repair, cycle removal, content normalisation.
  return parseDocument(doc);
}

/** Validate an AI "expand this node" answer into a paste-ready subtree. */
export function parseAISubtree(raw: unknown): SubtreePayload {
  const { spec } = sanitizeOutline(raw);
  const convert = (node: NodeSpec): SubtreePayload => ({
    root: {
      title: node.title,
      description: node.description ?? '',
      type: 'subtopic',
      style: defaultNodeStyle(node.preset ?? 'default'),
      collapsed: false,
      content: normalizeContent({ tags: node.tags ?? [] }),
      positionMode: 'auto',
    },
    children: (node.children ?? []).map(convert),
    relations: [],
  });
  return convert(spec);
}

/** Always-on guard around a provider call: no unvalidated value escapes. */
export async function callAI<T>(
  provider: AIProvider,
  prompt: string,
  schemaHint: string,
  validate: (raw: unknown) => T,
): Promise<AIResponse<T>> {
  try {
    const raw = await provider.complete(prompt, schemaHint);
    if (raw === null || raw === undefined) {
      return { ok: false, error: 'The AI provider returned no content.', issues: [] };
    }
    return { ok: true, value: validate(raw) };
  } catch (error) {
    if (error instanceof AIValidationError) {
      return { ok: false, error: error.message, issues: error.issues };
    }
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'The AI provider failed.',
      issues: [],
    };
  }
}

const OUTLINE_SCHEMA = JSON.stringify({
  title: 'string',
  root: { title: 'string', description: 'string?', tags: 'string[]?', children: 'same shape[]' },
});

export function generateMindMap(provider: AIProvider, prompt: string): Promise<AIResponse<MindMapDocument>> {
  return callAI(
    provider,
    `Create a mind map about: ${prompt}\nReturn JSON only, no prose.`,
    OUTLINE_SCHEMA,
    (raw) => parseAIDocument(raw, prompt.slice(0, 80) || 'AI generated map'),
  );
}

export function expandNode(
  provider: AIProvider,
  doc: MindMapDocument,
  nodeId: string,
): Promise<AIResponse<SubtreePayload>> {
  const node = doc.nodes[nodeId];
  if (!node) return Promise.resolve({ ok: false, error: 'Node not found.', issues: [] });
  return callAI(
    provider,
    `Expand this mind-map node with 3-6 concrete sub-ideas. Node: "${node.title}". Notes: "${node.description}". Return JSON only.`,
    OUTLINE_SCHEMA,
    parseAISubtree,
  );
}

/** Pure, provider-free context builder for summarisation prompts and AI calls. */
export function summarizeBranch(doc: MindMapDocument, nodeId: string): {
  title: string;
  nodeCount: number;
  depth: number;
  text: string;
} {
  const root = doc.nodes[nodeId];
  if (!root) return { title: '', nodeCount: 0, depth: 0, text: '' };
  const byParent: Record<string, string[]> = {};
  for (const node of Object.values(doc.nodes)) {
    if (node.parentId) (byParent[node.parentId] ??= []).push(node.id);
  }
  const lines: string[] = [];
  let maxDepth = 0;
  let count = 0;
  const walk = (id: string, depth: number) => {
    const node = doc.nodes[id];
    if (!node) return;
    count++;
    maxDepth = Math.max(maxDepth, depth);
    lines.push(`${'  '.repeat(depth)}- ${node.title}${node.description ? `: ${node.description}` : ''}`);
    for (const child of byParent[id] ?? []) walk(child, depth + 1);
  };
  walk(nodeId, 0);
  return { title: root.title, nodeCount: count, depth: maxDepth, text: lines.join('\n') };
}
