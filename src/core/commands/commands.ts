import { layoutDocument } from '../layout';
import type { MeasuredNode } from '../layout/measure';
import { normalizeContent } from '../mindmap/content';
import {
  addChild,
  addRelation,
  addSibling,
  deleteSubtree,
  duplicateSubtree,
  getDescendants,
  insertSubtree,
  removeEdge,
  reparentNode,
  setAllCollapsed,
  setEdgeLabel,
  setLayout,
  setTitle,
  toggleCollapse,
  updateNode,
  updateNodes,
  updateSettings,
  type NodePatch,
  type SubtreePayload,
} from '../mindmap/operations';
import type {
  LayoutKind,
  MapSettings,
  MindMapDocument,
  MindNode,
  NodeContent,
  Point,
} from '../mindmap/types';

export type AlignMode = 'left' | 'centerX' | 'right' | 'top' | 'centerY' | 'bottom';

/** Every document mutation goes through a command so history stays complete and auditable. */
export type Command =
  | { kind: 'addChild'; parentId: string; init?: Partial<MindNode> }
  | { kind: 'addSibling'; nodeId: string }
  | { kind: 'updateNode'; id: string; patch: NodePatch }
  | { kind: 'updateNodes'; patches: Record<string, NodePatch> }
  | { kind: 'updateContent'; id: string; content: NodeContent }
  | { kind: 'deleteNode'; id: string }
  | { kind: 'deleteNodes'; ids: string[] }
  | { kind: 'duplicateNode'; id: string }
  | { kind: 'toggleCollapse'; id: string }
  | { kind: 'setAllCollapsed'; collapsed: boolean }
  | { kind: 'reparent'; id: string; parentId: string }
  | { kind: 'moveNodes'; positions: Record<string, Point> }
  | { kind: 'addRelation'; source: string; target: string; label?: string }
  | { kind: 'removeEdge'; edgeId: string }
  | { kind: 'setEdgeLabel'; edgeId: string; label: string }
  | { kind: 'setTitle'; title: string }
  | { kind: 'setLayout'; layout: LayoutKind }
  | { kind: 'setPresentationOrder'; order: string[] }
  | { kind: 'updateSettings'; patch: Partial<MapSettings> }
  | { kind: 'applyLayout'; sizes: Record<string, MeasuredNode>; layout: LayoutKind; forceAll?: boolean }
  | { kind: 'resetToAutoLayout'; sizes: Record<string, MeasuredNode>; layout: LayoutKind }
  | { kind: 'alignNodes'; ids: string[]; align: AlignMode }
  | { kind: 'distributeNodes'; ids: string[]; axis: 'x' | 'y' }
  | { kind: 'groupNodes'; ids: string[]; title: string }
  | { kind: 'pasteSubtree'; parentId: string; payload: SubtreePayload; position?: Point }
  | { kind: 'replaceDocument'; doc: MindMapDocument };

export interface CommandResult {
  doc: MindMapDocument;
  createdId?: string;
  changed: boolean;
}

const STRUCTURAL: ReadonlySet<Command['kind']> = new Set([
  'addChild', 'addSibling', 'deleteNode', 'deleteNodes', 'duplicateNode', 'toggleCollapse',
  'setAllCollapsed', 'reparent', 'pasteSubtree', 'applyLayout', 'setLayout',
  'resetToAutoLayout', 'groupNodes', 'replaceDocument',
]);

export function isStructural(command: Command): boolean {
  return STRUCTURAL.has(command.kind);
}

function alignPositions(
  doc: MindMapDocument,
  ids: string[],
  align: AlignMode,
): Record<string, NodePatch> {
  const valid = ids.filter((id) => !!doc.nodes[id]);
  if (valid.length < 2) return {};
  const points = valid.map((id) => doc.nodes[id].position);
  const widthOf = (id: string) => doc.nodes[id].style.width ?? 180;
  const heightOf = () => 48;
  const target = (() => {
    switch (align) {
      case 'left': return Math.min(...valid.map((id) => doc.nodes[id].position.x - widthOf(id) / 2));
      case 'right': return Math.max(...valid.map((id) => doc.nodes[id].position.x + widthOf(id) / 2));
      case 'centerX': return points.reduce((sum, p) => sum + p.x, 0) / points.length;
      case 'top': return Math.min(...valid.map((id) => doc.nodes[id].position.y - heightOf() / 2));
      case 'bottom': return Math.max(...valid.map((id) => doc.nodes[id].position.y + heightOf() / 2));
      case 'centerY': return points.reduce((sum, p) => sum + p.y, 0) / points.length;
      default: return 0;
    }
  })();
  const patches: Record<string, NodePatch> = {};
  for (const id of valid) {
    const position = { ...doc.nodes[id].position };
    const w = widthOf(id);
    const h = heightOf();
    if (align === 'left') position.x = target + w / 2;
    else if (align === 'right') position.x = target - w / 2;
    else if (align === 'centerX') position.x = target;
    else if (align === 'top') position.y = target + h / 2;
    else if (align === 'bottom') position.y = target - h / 2;
    else position.y = target;
    patches[id] = { position, positionMode: 'manual' };
  }
  return patches;
}

export function applyCommand(doc: MindMapDocument, command: Command): CommandResult {
  let next = doc;
  let createdId: string | undefined;

  switch (command.kind) {
    case 'addChild': {
      const result = addChild(doc, command.parentId, command.init ?? {});
      next = result.doc;
      createdId = result.id || undefined;
      break;
    }
    case 'addSibling': {
      const result = addSibling(doc, command.nodeId);
      next = result.doc;
      createdId = result.id || undefined;
      break;
    }
    case 'updateNode':
      next = updateNode(doc, command.id, command.patch);
      break;
    case 'updateNodes':
      next = updateNodes(doc, command.patches);
      break;
    case 'updateContent':
      next = updateNode(doc, command.id, { content: normalizeContent(command.content) });
      break;
    case 'deleteNode':
      next = deleteSubtree(doc, command.id);
      break;
    case 'deleteNodes': {
      const remaining = new Set(command.ids);
      // Full descendant walk, not a depth-capped loop: deep trees must never leave orphans.
      for (const id of command.ids) {
        if (id === doc.rootId || !doc.nodes[id]) continue;
        for (const descendant of getDescendants(doc, id)) remaining.add(descendant.id);
      }
      const nodes = Object.fromEntries(Object.entries(doc.nodes).filter(([id]) => !remaining.has(id) || id === doc.rootId));
      const edges = Object.fromEntries(
        Object.entries(doc.edges).filter(([, edge]) => nodes[edge.source] && nodes[edge.target]),
      );
      next = { ...doc, nodes, edges, updatedAt: Date.now() };
      break;
    }
    case 'duplicateNode': {
      const result = duplicateSubtree(doc, command.id);
      next = result.doc;
      createdId = result.id || undefined;
      break;
    }
    case 'toggleCollapse':
      next = toggleCollapse(doc, command.id);
      break;
    case 'setAllCollapsed':
      next = setAllCollapsed(doc, command.collapsed);
      break;
    case 'reparent':
      next = reparentNode(doc, command.id, command.parentId);
      break;
    case 'moveNodes': {
      const patches: Record<string, NodePatch> = {};
      for (const [id, position] of Object.entries(command.positions)) {
        patches[id] = { position, positionMode: 'manual' };
      }
      next = updateNodes(doc, patches, false);
      break;
    }
    case 'addRelation':
      next = addRelation(doc, command.source, command.target, command.label ?? '');
      break;
    case 'removeEdge':
      next = removeEdge(doc, command.edgeId);
      break;
    case 'setEdgeLabel':
      next = setEdgeLabel(doc, command.edgeId, command.label);
      break;
    case 'setTitle':
      next = setTitle(doc, command.title);
      break;
    case 'setLayout':
      next = setLayout(doc, command.layout);
      break;
    case 'setPresentationOrder':
      next = updateSettings(doc, { presentationOrder: command.order });
      break;
    case 'updateSettings':
      next = updateSettings(doc, command.patch);
      break;
    case 'applyLayout':
      next = layoutDocument(doc, command.sizes, command.layout, { forceAll: command.forceAll });
      break;
    case 'resetToAutoLayout': {
      const patches: Record<string, NodePatch> = {};
      for (const id of Object.keys(doc.nodes)) patches[id] = { positionMode: 'auto' };
      const cleared = updateNodes(doc, patches, false);
      next = layoutDocument(cleared, command.sizes, command.layout, { forceAll: true });
      break;
    }
    case 'alignNodes': {
      const patches = alignPositions(doc, command.ids, command.align);
      next = Object.keys(patches).length ? updateNodes(doc, patches) : doc;
      break;
    }
    case 'distributeNodes': {
      const ids = command.ids.filter((id) => !!doc.nodes[id]);
      if (ids.length >= 3) {
        const axis = command.axis;
        const sorted = [...ids].sort((a, b) => doc.nodes[a].position[axis] - doc.nodes[b].position[axis]);
        const first = doc.nodes[sorted[0]].position[axis];
        const last = doc.nodes[sorted[sorted.length - 1]].position[axis];
        const step = (last - first) / (sorted.length - 1);
        const patches: Record<string, NodePatch> = {};
        sorted.forEach((id, index) => {
          patches[id] = {
            position: { ...doc.nodes[id].position, [axis]: first + step * index },
            positionMode: 'manual',
          };
        });
        next = updateNodes(doc, patches);
      }
      break;
    }
    case 'groupNodes': {
      const ids = command.ids.filter((id) => id !== doc.rootId && !!doc.nodes[id]);
      if (ids.length < 2) break;
      const parents = new Set(ids.map((id) => doc.nodes[id].parentId).filter((id): id is string => !!id));
      const parentId = parents.size === 1 ? [...parents][0] : doc.rootId;
      const centroid = ids.reduce(
        (sum, id) => ({ x: sum.x + doc.nodes[id].position.x / ids.length, y: sum.y + doc.nodes[id].position.y / ids.length }),
        { x: 0, y: 0 },
      );
      const created = addChild(doc, parentId, { title: command.title, position: centroid, positionMode: 'manual' });
      next = created.doc;
      createdId = created.id;
      for (const id of ids) next = reparentNode(next, id, created.id);
      break;
    }
    case 'pasteSubtree': {
      const result = insertSubtree(doc, command.parentId, command.payload, command.position);
      next = result.doc;
      createdId = result.id || undefined;
      break;
    }
    case 'replaceDocument':
      next = command.doc;
      break;
  }

  return { doc: next, createdId, changed: next !== doc };
}
