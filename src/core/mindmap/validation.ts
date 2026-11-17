import { uid } from '../../utils/common';
import { normalizeContent } from './content';
import { migrateRawDocument, MigrationError } from './migrations';
import { createBlankDocument, defaultNodeStyle } from './operations';
import {
  CURRENT_SCHEMA_VERSION,
  DEFAULT_SETTINGS,
  NODE_TYPES,
  STYLE_PRESETS,
  type LayoutKind,
  type MindEdge,
  type MindMapDocument,
  type MindNode,
  type NodeType,
  type PositionMode,
  type StylePreset,
} from './types';

const LAYOUT_VALUES = new Set<LayoutKind>(['tree', 'horizontal', 'vertical', 'radial']);
const TYPE_VALUES = new Set<string>(NODE_TYPES.map((t) => t.value));
const PRESET_VALUES = new Set<string>(STYLE_PRESETS.map((p) => p.value));

function str(value: unknown, fallback: string, max = 2000): string {
  return typeof value === 'string' && value.trim() ? value.slice(0, max) : fallback;
}
function num(value: unknown, fallback: number, min = -1e7, max = 1e7): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}
function bool(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
}
/**
 * Only plain CSS colours are accepted from an external document. This blocks
 * markup/url()/expression() payloads from reaching SVG attributes or React styles.
 */
const SAFE_COLOR = /^(?:#[0-9a-fA-F]{3,8}|rgba?\(\s*[\d.%,\s-]+\)|hsla?\(\s*[\d.%,\s-]+\)|transparent|none)$/;
function color(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim().slice(0, 40);
  return SAFE_COLOR.test(trimmed) ? trimmed : undefined;
}
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
function asArray(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.filter((v) => v && typeof v === 'object') as Record<string, unknown>[];
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).map(([key, v]) => {
      const item = record(v);
      return { ...item, id: item.id ?? key };
    });
  }
  return [];
}

export class ImportError extends Error {
  readonly details: string[];
  constructor(message: string, details: string[] = []) {
    super(message);
    this.name = 'ImportError';
    this.details = details;
  }
}

let lastDiagnostics: string[] = [];

/** Non-fatal repairs from the most recent parse, for the import diagnostic report. */
export function getLastImportDiagnostics(): string[] {
  return [...lastDiagnostics];
}

export function buildDiagnosticReport(filename: string, error?: unknown): string {
  const lines = [
    'Atlas import diagnostic',
    `File: ${filename}`,
    `Time: ${new Date().toISOString()}`,
    `Atlas schema: v${CURRENT_SCHEMA_VERSION}`,
    '',
  ];
  if (error instanceof Error) lines.push(`Error: ${error.message}`, '');
  if (error instanceof ImportError) {
    lines.push('Reasons:', ...error.details.map((detail) => `  - ${detail}`), '');
  }
  lines.push(
    lastDiagnostics.length ? 'Repairs applied:' : 'Repairs applied: none',
    ...lastDiagnostics.map((detail) => `  - ${detail}`),
  );
  return lines.join('\n');
}

/**
 * Defensively converts arbitrary JSON into a valid v2 document. Runs migrations first,
 * then validates and repairs: unknown fields dropped, orphans re-parented, cycles broken.
 */
export function parseDocument(input: unknown): MindMapDocument {
  let migrated: Record<string, unknown>;
  try {
    migrated = migrateRawDocument(input).raw;
  } catch (error) {
    if (error instanceof MigrationError) throw new ImportError(error.message, [error.message]);
    throw new ImportError('This map could not be migrated to the current schema.');
  }
  const raw = migrated;
  const diagnostics: string[] = [];
  lastDiagnostics = diagnostics;
  const fallback = createBlankDocument();
  const title = str(raw.title, 'Imported map', 200);
  const rawNodes = asArray(raw.nodes);
  const rawEdges = asArray(raw.edges);

  if (rawNodes.length > 20_000) throw new ImportError('This file contains too many nodes (limit: 20,000).');
  if (rawNodes.length === 0) throw new ImportError('No nodes were found in this file.', ['The "nodes" field is empty or missing.']);

  const settingsRaw = record(raw.settings);
  const layout = LAYOUT_VALUES.has(settingsRaw.layout as LayoutKind)
    ? (settingsRaw.layout as LayoutKind)
    : fallback.settings.layout;

  const nodes: Record<string, MindNode> = Object.create(null) as Record<string, MindNode>;
  const now = Date.now();
  const idMap = new Map<string, string>();

  for (const item of rawNodes) {
    const originalId = String(item.id ?? uid('node'));
    let id = originalId;
    if (nodes[id]) {
      id = uid('node');
      diagnostics.push(`Duplicate node id "${originalId}" was renamed to "${id}".`);
    }
    idMap.set(originalId, id);
    const styleRaw = record(item.style);
    const preset = PRESET_VALUES.has(String(styleRaw.preset)) ? (String(styleRaw.preset) as StylePreset) : 'default';
    const pos = record(item.position);
    const metadata: MindNode['metadata'] = {};
    for (const [key, value] of Object.entries(record(item.metadata))) {
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        metadata[key.slice(0, 60)] = value;
      }
    }
    const typeRaw = String(item.type ?? '');
    const positionMode: PositionMode = item.positionMode === 'manual' || metadata.manualPosition === true ? 'manual' : 'auto';
    nodes[id] = {
      id,
      parentId: item.parentId == null ? null : String(item.parentId),
      title: str(item.title ?? item.label ?? item.text, 'Untitled'),
      description: str(item.description ?? item.notes, '', 20_000),
      position: { x: num(pos.x, 0), y: num(pos.y, 0) },
      positionMode,
      content: normalizeContent(item.content ?? { tags: item.tags, markdown: item.markdown }),
      style: {
        ...defaultNodeStyle(preset),
        preset,
        background: color(styleRaw.background),
        textColor: color(styleRaw.textColor),
        borderColor: color(styleRaw.borderColor),
        borderWidth: num(styleRaw.borderWidth, 1, 0, 8),
        borderRadius: num(styleRaw.borderRadius, 10, 0, 40),
        fontSize: num(styleRaw.fontSize, 14, 9, 40),
        fontWeight: num(styleRaw.fontWeight, 560, 300, 900),
        icon: typeof styleRaw.icon === 'string' ? styleRaw.icon.slice(0, 40) : undefined,
        width: typeof styleRaw.width === 'number' ? num(styleRaw.width, 180, 80, 1200) : undefined,
        height: typeof styleRaw.height === 'number' ? num(styleRaw.height, 48, 30, 1200) : undefined,
      },
      type: (TYPE_VALUES.has(typeRaw) ? typeRaw : 'subtopic') as NodeType,
      collapsed: bool(item.collapsed),
      createdAt: num(item.createdAt, now, 0),
      updatedAt: num(item.updatedAt, now, 0),
      metadata,
    };
  }

  for (const node of Object.values(nodes)) {
    if (node.parentId === null) continue;
    const mapped = idMap.get(node.parentId) ?? node.parentId;
    if (mapped !== node.parentId) node.parentId = mapped;
    if (!nodes[node.parentId]) {
      diagnostics.push(`Invalid parent reference at node "${node.id}": parent "${node.parentId}" was not found; re-parented to the root.`);
      node.parentId = null;
    }
  }

  const declaredRoot = typeof raw.rootId === 'string' ? idMap.get(raw.rootId) ?? raw.rootId : null;
  let rootId = declaredRoot && nodes[declaredRoot] ? declaredRoot : null;
  if (!rootId) {
    rootId = Object.values(nodes).find((n) => n.parentId === null)?.id ?? Object.keys(nodes)[0];
    if (declaredRoot && !nodes[declaredRoot]) diagnostics.push(`Declared root "${declaredRoot}" is missing; used "${rootId}" instead.`);
  }
  nodes[rootId].parentId = null;
  nodes[rootId].type = 'central';

  const visited = new Set<string>();
  const fixCycles = (id: string) => {
    if (visited.has(id)) return;
    visited.add(id);
    let current = nodes[id];
    const chain = new Set<string>([id]);
    let guard = 0;
    while (current.parentId && guard++ < 20_000) {
      const parent = nodes[current.parentId];
      if (!parent || chain.has(parent.id)) {
        diagnostics.push(`Parent cycle detected at node "${id}"; its branch was attached to the root.`);
        current.parentId = rootId;
        break;
      }
      chain.add(parent.id);
      current = parent;
    }
  };
  for (const id of Object.keys(nodes)) fixCycles(id);

  for (const node of Object.values(nodes)) {
    if (node.id !== rootId && node.parentId === null) {
      diagnostics.push(`Disconnected node "${node.id}" was attached to the root.`);
      node.parentId = rootId;
    }
  }

  const edges: Record<string, MindEdge> = Object.create(null) as Record<string, MindEdge>;
  for (const item of rawEdges) {
    const source = idMap.get(String(item.source ?? '')) ?? String(item.source ?? '');
    const target = idMap.get(String(item.target ?? '')) ?? String(item.target ?? '');
    if (!nodes[source] || !nodes[target] || source === target) {
      diagnostics.push(`Dropped invalid edge from "${source}" to "${target}".`);
      continue;
    }
    const id = String(item.id ?? uid('edge'));
    if (edges[id]) {
      diagnostics.push(`Duplicate edge id "${id}" was skipped.`);
      continue;
    }
    edges[id] = {
      id,
      source,
      target,
      kind: item.kind === 'hierarchy' ? 'hierarchy' : 'relation',
      label: str(item.label, '', 200),
      createdAt: num(item.createdAt, now, 0),
    };
  }

  const stub: MindMapDocument = {
    version: CURRENT_SCHEMA_VERSION,
    id: typeof raw.id === 'string' ? raw.id : uid('map'),
    title,
    rootId,
    nodes,
    edges,
    settings: {
      ...DEFAULT_SETTINGS,
      layout,
      autoArrange: bool(settingsRaw.autoArrange, false),
      presentationOrder: Array.isArray(settingsRaw.presentationOrder)
        ? settingsRaw.presentationOrder.filter((id): id is string => typeof id === 'string' && !!nodes[id])
        : [],
      showDescriptions: bool(settingsRaw.showDescriptions, true),
      showGrid: bool(settingsRaw.showGrid, true),
      showMinimap: bool(settingsRaw.showMinimap, true),
      animated: bool(settingsRaw.animated, true),
      branchColorSeed: num(settingsRaw.branchColorSeed, 0, 0, 7),
    },
    createdAt: num(raw.createdAt, now, 0),
    updatedAt: num(raw.updatedAt, now, 0),
  };
  // Single pass instead of one full scan per parent (the old loop was O(n²)
  // and dominated import time on maps with thousands of nodes).
  const childrenByParent: Record<string, MindNode[]> = {};
  for (const node of Object.values(nodes)) {
    if (node.parentId) (childrenByParent[node.parentId] ??= []).push(node);
  }
  for (const siblings of Object.values(childrenByParent)) {
    siblings.sort((a, b) =>
      Number(a.metadata.order ?? a.createdAt) - Number(b.metadata.order ?? b.createdAt) ||
      a.createdAt - b.createdAt || a.id.localeCompare(b.id),
    );
    siblings.forEach((child, index) => {
      if (typeof child.metadata.order !== 'number') child.metadata.order = index;
    });
  }
  return stub;
}

export function parseDocumentFromText(text: string): MindMapDocument {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new ImportError('This file is not valid JSON.', [error instanceof Error ? error.message : 'JSON parse error']);
  }
  return parseDocument(data);
}
