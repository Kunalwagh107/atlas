/**
 * Canonical mind-map document model. There is exactly one document shape shared by
 * the canvas, outline, layout engine, persistence, export, templates, history and AI.
 * All geometry is in world coordinates; `position` is the node centre.
 */

export type Point = { x: number; y: number };
export type Size = { width: number; height: number };
export type Rect = Point & Size;

export const CURRENT_SCHEMA_VERSION = 2;

export type NodeType =
  | 'central'
  | 'topic'
  | 'subtopic'
  | 'note'
  | 'question'
  | 'example'
  | 'task'
  | 'reference';

export type StylePreset =
  | 'default'
  | 'important'
  | 'question'
  | 'definition'
  | 'example'
  | 'warning'
  | 'decision'
  | 'task';

export type LayoutKind = 'tree' | 'horizontal' | 'vertical' | 'radial';
/** Application-level appearance only (light/dark). Maps have a single fixed visual style. */
export type ThemeKind = 'light' | 'dark';
export type EdgeKind = 'hierarchy' | 'relation';
export type PositionMode = 'auto' | 'manual';

export interface NodeStyle {
  preset: StylePreset;
  /** Explicit overrides take precedence over the preset. Undefined = inherit preset. */
  background?: string;
  textColor?: string;
  borderColor?: string;
  borderWidth: number;
  borderRadius: number;
  fontSize: number;
  fontWeight: number;
  icon?: string;
  /** Explicit width/height overrides (corner-drag resizing). Undefined = auto. */
  width?: number;
  height?: number;
}

/** Rich, UI-agnostic node content. Every field is optional in storage and normalised on read. */
export interface NodeContent {
  markdown: string;
  code: { id: string; language: string; source: string }[];
  formulas: { id: string; latex: string }[];
  links: { id: string; url: string; title: string }[];
  images: { id: string; src: string; alt: string }[];
  checklist: { id: string; text: string; done: boolean }[];
  tags: string[];
}

export interface MindNode {
  id: string;
  parentId: string | null;
  title: string;
  description: string;
  position: Point;
  /** Manual nodes are never moved by automatic layout until the user explicitly resets them. */
  positionMode: PositionMode;
  content: NodeContent;
  style: NodeStyle;
  type: NodeType;
  collapsed: boolean;
  createdAt: number;
  updatedAt: number;
  metadata: Record<string, string | number | boolean>;
}

export interface MindEdge {
  id: string;
  source: string;
  target: string;
  kind: EdgeKind;
  label: string;
  createdAt: number;
}

export interface MapSettings {
  layout: LayoutKind;
  branchColorSeed: number;
  showDescriptions: boolean;
  showGrid: boolean;
  showMinimap: boolean;
  animated: boolean;
  /** Opt-in continuous arrangement. Turns itself off as soon as the user drags a node. */
  autoArrange: boolean;
  /** Explicit presentation order; empty means depth-first tree order. */
  presentationOrder: string[];
}

export interface MindMapDocument {
  version: number;
  id: string;
  title: string;
  rootId: string;
  nodes: Record<string, MindNode>;
  edges: Record<string, MindEdge>;
  settings: MapSettings;
  createdAt: number;
  updatedAt: number;
}

export interface MapSummary {
  id: string;
  title: string;
  nodeCount: number;
  createdAt: number;
  updatedAt: number;
}

/** A lightweight, backend-ready shape for map listings. */
export interface StoredMap {
  doc: MindMapDocument;
  summary: MapSummary;
}

export const NODE_TYPES: { value: NodeType; label: string; icon: string; hint: string }[] = [
  { value: 'central', label: 'Central topic', icon: 'spark', hint: 'The root idea' },
  { value: 'topic', label: 'Topic', icon: 'branch', hint: 'A main branch' },
  { value: 'subtopic', label: 'Subtopic', icon: 'layers', hint: 'A supporting idea' },
  { value: 'note', label: 'Note', icon: 'note', hint: 'Free-form detail' },
  { value: 'question', label: 'Question', icon: 'help', hint: 'Something to answer' },
  { value: 'example', label: 'Example', icon: 'bulb', hint: 'Concrete instance' },
  { value: 'task', label: 'Task', icon: 'check', hint: 'An action item' },
  { value: 'reference', label: 'Reference', icon: 'link', hint: 'External source' },
];

export interface PresetDefinition {
  value: StylePreset;
  label: string;
  icon: string;
  swatch: string;
}

export const STYLE_PRESETS: PresetDefinition[] = [
  { value: 'default', label: 'Default', icon: 'circle', swatch: '#8b93ff' },
  { value: 'important', label: 'Important', icon: 'star', swatch: '#e05a6d' },
  { value: 'question', label: 'Question', icon: 'help', swatch: '#b07ae0' },
  { value: 'definition', label: 'Definition', icon: 'book', swatch: '#3e8ed0' },
  { value: 'example', label: 'Example', icon: 'bulb', swatch: '#2fa88b' },
  { value: 'warning', label: 'Warning', icon: 'alert', swatch: '#d99026' },
  { value: 'decision', label: 'Decision', icon: 'diamond', swatch: '#5a70d8' },
  { value: 'task', label: 'Task', icon: 'check', swatch: '#6d9950' },
];

export const LAYOUTS: { value: LayoutKind; label: string; description: string }[] = [
  { value: 'tree', label: 'Mind map', description: 'Balanced branches on both sides of the central topic' },
  { value: 'horizontal', label: 'Horizontal tree', description: 'Left-to-right hierarchy, ideal for outlines' },
  { value: 'vertical', label: 'Vertical tree', description: 'Top-to-bottom hierarchy, ideal for org charts' },
  { value: 'radial', label: 'Radial', description: 'Branches radiate evenly around the central topic' },
];

/** Compact labels for the 2×2 layout picker (the full labels are too wide). */
export const LAYOUT_SHORT_LABELS: Record<LayoutKind, string> = {
  tree: 'Mind map',
  horizontal: 'Horizontal',
  vertical: 'Vertical',
  radial: 'Radial',
};

/** Display label for a layout kind — never render the raw enum value in the UI. */
export function layoutLabel(kind: LayoutKind): string {
  return LAYOUTS.find((item) => item.value === kind)?.label ?? LAYOUT_SHORT_LABELS[kind];
}

export const DEFAULT_SETTINGS: MapSettings = {
  layout: 'tree',
  branchColorSeed: 0,
  showDescriptions: true,
  showGrid: true,
  showMinimap: true,
  animated: true,
  autoArrange: false,
  presentationOrder: [],
};
