import { uid } from '../../utils/common';
import { EMPTY_CONTENT, normalizeContent } from './content';
import {
  CURRENT_SCHEMA_VERSION,
  DEFAULT_SETTINGS,
  type LayoutKind,
  type MindEdge,
  type MindMapDocument,
  type MindNode,
  type NodeContent,
  type NodeStyle,
  type NodeType,
  type PositionMode,
  type StylePreset,
  type Point,
} from './types';

/** Patch accepted by node update commands — style overrides may be partial. */
export type NodePatch = Partial<Omit<MindNode, 'id' | 'createdAt' | 'style'>> & { style?: Partial<NodeStyle> };

export function defaultNodeStyle(preset: StylePreset = 'default'): NodeStyle {
  return {
    preset,
    borderWidth: 1,
    borderRadius: 10,
    fontSize: 14,
    fontWeight: 560,
  };
}

export function createNode(init: Partial<MindNode> & { parentId: string | null }): MindNode {
  const now = Date.now();
  return {
    id: init.id ?? uid('node'),
    parentId: init.parentId,
    title: init.title ?? 'New idea',
    description: init.description ?? '',
    position: init.position ?? { x: 0, y: 0 },
    positionMode: init.positionMode ?? 'auto',
    content: normalizeContent(init.content ?? EMPTY_CONTENT),
    style: { ...defaultNodeStyle(), ...(init.style ?? {}) },
    type: init.type ?? (init.parentId === null ? 'central' : 'subtopic'),
    collapsed: init.collapsed ?? false,
    createdAt: init.createdAt ?? now,
    updatedAt: init.updatedAt ?? now,
    metadata: init.metadata ?? {},
  };
}

export function createBlankDocument(title = 'Untitled map'): MindMapDocument {
  const now = Date.now();
  const root = createNode({ parentId: null, title: 'Central topic', type: 'central' });
  root.style.fontSize = 17;
  root.style.fontWeight = 680;
  root.style.borderRadius = 14;
  return {
    version: CURRENT_SCHEMA_VERSION,
    id: uid('map'),
    title,
    rootId: root.id,
    nodes: { [root.id]: root },
    edges: {},
    settings: { ...DEFAULT_SETTINGS },
    createdAt: now,
    updatedAt: now,
  };
}

export interface NodeSpec {
  title: string;
  type?: NodeType;
  preset?: StylePreset;
  description?: string;
  /** Tags from a foreign format, stored as rich content on the created node. */
  tags?: string[];
  children?: NodeSpec[];
}

export function createDocumentFromSpec(title: string, spec: NodeSpec, layout: LayoutKind = 'tree'): MindMapDocument {
  const doc = createBlankDocument(title);
  const root = doc.nodes[doc.rootId];
  root.title = spec.title;
  root.description = spec.description ?? '';
  root.type = 'central';
  if (spec.tags?.length) root.content.tags = normalizeContent({ tags: spec.tags }).tags;
  doc.settings.layout = layout;

  const visit = (parentId: string, childSpecs: NodeSpec[] = []) => {
    childSpecs.forEach((child, index) => {
      const node = createNode({
        parentId,
        title: child.title,
        description: child.description ?? '',
        type: child.type ?? (parentId === doc.rootId ? 'topic' : 'subtopic'),
        style: { ...defaultNodeStyle(child.preset ?? 'default') },
      });
      node.metadata.order = index;
      node.createdAt += index;
      if (child.tags?.length) node.content.tags = normalizeContent({ tags: child.tags }).tags;
      doc.nodes[node.id] = node;
      visit(node.id, child.children);
    });
  };
  visit(doc.rootId, spec.children);
  return doc;
}

/**
 * Children are indexed once per document snapshot. The previous implementation
 * scanned every node on each call, which made `getDescendants`, `setAllCollapsed`
 * and subtree copy O(n²) on large maps.
 */
const childIndexCache = new WeakMap<MindMapDocument, Map<string, MindNode[]>>();

function childIndex(doc: MindMapDocument): Map<string, MindNode[]> {
  const cached = childIndexCache.get(doc);
  if (cached) return cached;
  const index = new Map<string, MindNode[]>();
  for (const node of Object.values(doc.nodes)) {
    if (!node.parentId) continue;
    const list = index.get(node.parentId);
    if (list) list.push(node);
    else index.set(node.parentId, [node]);
  }
  childIndexCache.set(doc, index);
  return index;
}

function compareSiblings(a: MindNode, b: MindNode): number {
  const ao = Number(a.metadata.order ?? a.createdAt);
  const bo = Number(b.metadata.order ?? b.createdAt);
  return ao - bo || a.createdAt - b.createdAt || a.id.localeCompare(b.id);
}

/** Children in their stable user-visible order. */
export function getChildren(doc: MindMapDocument, parentId: string): MindNode[] {
  const list = childIndex(doc).get(parentId);
  if (!list || list.length === 0) return [];
  // Copy before sorting so the cached index keeps its insertion order.
  return [...list].sort(compareSiblings);
}

export function nextSiblingOrder(doc: MindMapDocument, parentId: string): number {
  const siblings = getChildren(doc, parentId);
  let max = -1;
  for (const s of siblings) max = Math.max(max, Number(s.metadata.order ?? s.createdAt));
  return max + 1;
}

/** Every node whose ancestors are all expanded. Collapsed nodes remain in the document. */
export function isVisible(doc: MindMapDocument, nodeId: string): boolean {
  let node = doc.nodes[nodeId];
  if (!node) return false;
  let guard = 0;
  while (node.parentId && guard++ < 10_000) {
    const parent = doc.nodes[node.parentId];
    if (!parent) return true;
    if (parent.collapsed) return false;
    node = parent;
  }
  return true;
}

export function getVisibleNodes(doc: MindMapDocument): MindNode[] {
  return Object.values(doc.nodes).filter((n) => isVisible(doc, n.id));
}

export function getDescendants(doc: MindMapDocument, nodeId: string): MindNode[] {
  const out: MindNode[] = [];
  const stack = [...getChildren(doc, nodeId).map((n) => n.id)];
  const seen = new Set<string>();
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const node = doc.nodes[id];
    if (!node) continue;
    out.push(node);
    for (const child of getChildren(doc, id)) stack.push(child.id);
  }
  return out;
}

export function getHiddenDescendantCount(doc: MindMapDocument, nodeId: string): number {
  return getDescendants(doc, nodeId).length;
}

function touch(doc: MindMapDocument): MindMapDocument {
  return { ...doc, updatedAt: Date.now() };
}

/**
 * Intelligent placement for a new child: follow the active layout direction, use the
 * emptier side of a balanced map, then search for a collision-free slot nearby.
 * This is the only positioning that happens implicitly on a structural edit.
 */
export function placeNewChild(doc: MindMapDocument, parent: MindNode): Point {
  const children = getChildren(doc, parent.id);
  const layout = doc.settings.layout;
  const occupied = Object.values(doc.nodes);
  const collides = (x: number, y: number) => occupied.some(
    (node) => Math.abs(node.position.x - x) < 202 && Math.abs(node.position.y - y) < 64,
  );

  let x = parent.position.x;
  let y = parent.position.y;
  let stepX = 0;
  let stepY = 76;

  if (layout === 'vertical') {
    x = parent.position.x + (children.length % 3 - 1) * 200;
    y = parent.position.y + 140;
    stepX = 0;
    stepY = 76;
  } else if (layout === 'radial') {
    const angle = (children.length / Math.max(1, children.length + 1)) * Math.PI * 2 - Math.PI / 2;
    x = parent.position.x + Math.cos(angle) * 240;
    y = parent.position.y + Math.sin(angle) * 240;
    stepX = 0;
    stepY = 70;
  } else {
    let dir = 1;
    if (layout === 'tree') {
      const right = children.filter((child) => child.position.x >= parent.position.x).length;
      if (right > children.length - right) dir = -1;
    }
    const onSide = children.filter((child) => Math.sign(child.position.x - parent.position.x) === dir);
    x = parent.position.x + dir * 230;
    y = onSide.length ? Math.max(...onSide.map((child) => child.position.y)) + 76 : parent.position.y;
    stepY = 76;
  }
  for (let i = 0; i < 80 && collides(x, y); i++) {
    y += stepY;
    x += stepX;
  }
  return { x, y };
}

export function addChild(
  doc: MindMapDocument,
  parentId: string,
  init: Partial<MindNode> = {},
): { doc: MindMapDocument; id: string } {
  const parent = doc.nodes[parentId];
  if (!parent) return { doc, id: '' };
  const node = createNode({
    ...init,
    parentId,
    type: init.type ?? (parentId === doc.rootId ? 'topic' : 'subtopic'),
    position: init.position ?? placeNewChild(doc, parent),
    positionMode: init.positionMode ?? 'auto',
  });
  node.metadata.order = nextSiblingOrder(doc, parentId);
  return {
    doc: touch({ ...doc, nodes: { ...doc.nodes, [node.id]: node } }),
    id: node.id,
  };
}

export function addSibling(doc: MindMapDocument, nodeId: string): { doc: MindMapDocument; id: string } {
  const node = doc.nodes[nodeId];
  if (!node) return { doc, id: '' };
  if (!node.parentId) return addChild(doc, nodeId); // central topic cannot have a sibling
  return addChild(doc, node.parentId);
}

export function updateNode(
  doc: MindMapDocument,
  nodeId: string,
  patch: NodePatch,
): MindMapDocument {
  const node = doc.nodes[nodeId];
  if (!node) return doc;
  const merged: MindNode = {
    ...node,
    ...patch,
    style: patch.style ? { ...node.style, ...patch.style } : node.style,
    metadata: patch.metadata ? { ...node.metadata, ...patch.metadata } : node.metadata,
    updatedAt: Date.now(),
  };
  return touch({ ...doc, nodes: { ...doc.nodes, [nodeId]: merged } });
}

export function updateNodes(
  doc: MindMapDocument,
  patches: Record<string, NodePatch>,
  markUpdated = true,
): MindMapDocument {
  const nodes = { ...doc.nodes };
  for (const [id, patch] of Object.entries(patches)) {
    const node = nodes[id];
    if (!node) continue;
    nodes[id] = {
      ...node,
      ...patch,
      style: patch.style ? { ...node.style, ...patch.style } : node.style,
      updatedAt: markUpdated ? Date.now() : node.updatedAt,
    };
  }
  return markUpdated ? touch({ ...doc, nodes }) : { ...doc, nodes };
}

/** Removes a node and its whole subtree, plus any edges that reference removed nodes. */
export function deleteSubtree(doc: MindMapDocument, nodeId: string): MindMapDocument {
  const node = doc.nodes[nodeId];
  if (!node) return doc;
  if (nodeId === doc.rootId) return doc;
  const removed = new Set([nodeId, ...getDescendants(doc, nodeId).map((n) => n.id)]);
  const nodes: Record<string, MindNode> = {};
  for (const [id, n] of Object.entries(doc.nodes)) if (!removed.has(id)) nodes[id] = n;
  const edges: Record<string, MindEdge> = {};
  for (const [id, e] of Object.entries(doc.edges)) {
    if (!removed.has(e.source) && !removed.has(e.target)) edges[id] = e;
  }
  return touch({ ...doc, nodes, edges });
}

export function duplicateSubtree(
  doc: MindMapDocument,
  nodeId: string,
  targetParentId?: string,
): { doc: MindMapDocument; id: string } {
  const source = doc.nodes[nodeId];
  if (!source || nodeId === doc.rootId) return { doc, id: '' };
  const parentId = targetParentId ?? source.parentId;
  if (!parentId || !doc.nodes[parentId]) return { doc, id: '' };
  const subtree = extractSubtree(doc, nodeId);
  if (!subtree) return { doc, id: '' };
  return insertSubtree(doc, parentId, subtree, {
    x: source.position.x + 36,
    y: source.position.y + 72,
  });
}

export interface SubtreePayload {
  root: {
    title: string;
    description: string;
    type: NodeType;
    style: NodeStyle;
    collapsed: boolean;
    content: NodeContent;
    positionMode: PositionMode;
  };
  children: SubtreePayload[];
  relations: { targetTitle: string; label: string }[];
}

export function extractSubtree(doc: MindMapDocument, nodeId: string): SubtreePayload | null {
  const node = doc.nodes[nodeId];
  if (!node) return null;
  return {
    root: {
      title: node.title,
      description: node.description,
      type: node.type,
      style: { ...node.style },
      collapsed: node.collapsed,
      content: normalizeContent(node.content),
      positionMode: node.positionMode,
    },
    children: getChildren(doc, nodeId).map((c) => extractSubtree(doc, c.id)!).filter(Boolean),
    relations: [],
  };
}

export function insertSubtree(
  doc: MindMapDocument,
  parentId: string,
  payload: SubtreePayload,
  position?: Point,
): { doc: MindMapDocument; id: string } {
  let next = doc;
  const created = addChild(next, parentId, {
    title: payload.root.title,
    description: payload.root.description,
    type: payload.root.type === 'central' ? 'topic' : payload.root.type,
    style: { ...payload.root.style },
    collapsed: payload.root.collapsed,
    content: payload.root.content,
    positionMode: position ? 'manual' : payload.root.positionMode,
    position,
  });
  next = created.doc;
  for (const child of payload.children) {
    next = insertSubtree(next, created.id, child).doc;
  }
  return { doc: next, id: created.id };
}

export function toggleCollapse(doc: MindMapDocument, nodeId: string): MindMapDocument {
  const node = doc.nodes[nodeId];
  if (!node || getChildren(doc, nodeId).length === 0) return doc;
  return updateNode(doc, nodeId, { collapsed: !node.collapsed });
}

export function setAllCollapsed(doc: MindMapDocument, collapsed: boolean): MindMapDocument {
  const patches: Record<string, Partial<MindNode>> = {};
  for (const node of Object.values(doc.nodes)) {
    if (node.id !== doc.rootId && getChildren(doc, node.id).length > 0) patches[node.id] = { collapsed };
  }
  return updateNodes(doc, patches);
}

export function reparentNode(
  doc: MindMapDocument,
  nodeId: string,
  newParentId: string,
): MindMapDocument {
  const node = doc.nodes[nodeId];
  if (!node || nodeId === doc.rootId || !doc.nodes[newParentId]) return doc;
  if (newParentId === nodeId) return doc;
  if (getDescendants(doc, nodeId).some((n) => n.id === newParentId)) return doc; // no cycles
  const patched = updateNode(doc, nodeId, { parentId: newParentId });
  return updateNode(patched, nodeId, { metadata: { order: nextSiblingOrder(patched, newParentId) } });
}

export function addRelation(
  doc: MindMapDocument,
  source: string,
  target: string,
  label = '',
): MindMapDocument {
  if (source === target || !doc.nodes[source] || !doc.nodes[target]) return doc;
  const exists = Object.values(doc.edges).some(
    (e) =>
      e.kind === 'relation' &&
      ((e.source === source && e.target === target) || (e.source === target && e.target === source)),
  );
  if (exists) return doc;
  const edge: MindEdge = { id: uid('edge'), source, target, kind: 'relation', label, createdAt: Date.now() };
  return touch({ ...doc, edges: { ...doc.edges, [edge.id]: edge } });
}

export function removeEdge(doc: MindMapDocument, edgeId: string): MindMapDocument {
  if (!doc.edges[edgeId]) return doc;
  const edges = { ...doc.edges };
  delete edges[edgeId];
  return touch({ ...doc, edges });
}

export function setEdgeLabel(doc: MindMapDocument, edgeId: string, label: string): MindMapDocument {
  const edge = doc.edges[edgeId];
  if (!edge) return doc;
  return touch({ ...doc, edges: { ...doc.edges, [edgeId]: { ...edge, label } } });
}

export function setTitle(doc: MindMapDocument, title: string): MindMapDocument {
  return touch({ ...doc, title: title.trim() || 'Untitled map' });
}

export function setLayout(doc: MindMapDocument, layout: LayoutKind): MindMapDocument {
  return touch({ ...doc, settings: { ...doc.settings, layout } });
}

export function updateSettings(doc: MindMapDocument, patch: Partial<MindMapDocument['settings']>): MindMapDocument {
  return touch({ ...doc, settings: { ...doc.settings, ...patch } });
}

/** One BFS instead of an ancestor walk per node (that was O(n · depth)). */
export function getStats(doc: MindMapDocument) {
  const depth: Record<string, number> = { [doc.rootId]: 0 };
  const queue = [doc.rootId];
  let maxDepth = 0;
  for (let head = 0; head < queue.length; head++) {
    const id = queue[head];
    for (const child of getChildren(doc, id)) {
      depth[child.id] = (depth[id] ?? 0) + 1;
      maxDepth = Math.max(maxDepth, depth[child.id]);
      queue.push(child.id);
    }
  }
  return {
    nodes: Object.keys(doc.nodes).length,
    edges: Object.values(doc.edges).filter((e) => e.kind === 'relation').length,
    branches: getChildren(doc, doc.rootId).length,
    depth: maxDepth,
  };
}
