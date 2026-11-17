import type { MindNode, StylePreset, ThemeKind } from './types';

export interface PresetColors {
  background: string;
  text: string;
  border: string;
  accent: string | null;
}

export interface Palette {
  theme: ThemeKind;
  canvasBg: string;
  gridDot: string;
  nodeFill: string;
  nodeText: string;
  nodeMuted: string;
  nodeBorder: string;
  nodeShadow: string;
  edgeMuted: string;
  accent: string;
  accentContrast: string;
  selection: string;
  selectionSoft: string;
  relation: string;
  branches: string[];
  presets: Record<StylePreset, PresetColors>;
}

const LIGHT_PRESETS: Record<StylePreset, PresetColors> = {
  default: { background: '#ffffff', text: '#1c2534', border: '#dfe4ec', accent: null },
  important: { background: '#fff1f3', text: '#8e2436', border: '#f0b6c0', accent: '#df5a70' },
  question: { background: '#f7f2fe', text: '#663a95', border: '#ddc6f2', accent: '#a977d8' },
  definition: { background: '#eef6fd', text: '#1d5a8b', border: '#b8d8f0', accent: '#3d8bc9' },
  example: { background: '#edf9f5', text: '#176a57', border: '#aee0d1', accent: '#2fa88b' },
  warning: { background: '#fff7e9', text: '#8a5a12', border: '#eed19c', accent: '#d99026' },
  decision: { background: '#eef1fd', text: '#37499b', border: '#c5cdf1', accent: '#5a70d8' },
  task: { background: '#f2f8ed', text: '#42692e', border: '#d0e3bb', accent: '#6d9950' },
};

const DARK_PRESETS: Record<StylePreset, PresetColors> = {
  default: { background: '#1b2431', text: '#e9eef6', border: '#33404f', accent: null },
  important: { background: '#3a222d', text: '#ffb6bf', border: '#6b3544', accent: '#f0736f' },
  question: { background: '#302440', text: '#dcc0f5', border: '#5d4177', accent: '#b98bea' },
  definition: { background: '#1d3043', text: '#b6dcf7', border: '#315a7c', accent: '#61a9ea' },
  example: { background: '#183630', text: '#a8e6d3', border: '#2b6255', accent: '#43c6b7' },
  warning: { background: '#3a2c18', text: '#f2d194', border: '#6c5227', accent: '#e0a54b' },
  decision: { background: '#242c4d', text: '#c4cdfa', border: '#424e8f', accent: '#8b93ff' },
  task: { background: '#25351f', text: '#c8e4a9', border: '#466236', accent: '#8fc363' },
};

const LIGHT: Omit<Palette, 'theme'> = {
  canvasBg: '#f4f6fa',
  gridDot: '#d8dfe9',
  nodeFill: '#ffffff',
  nodeText: '#1b2434',
  nodeMuted: '#68748a',
  nodeBorder: '#e0e5ef',
  nodeShadow: 'rgba(24, 38, 66, 0.12)',
  edgeMuted: '#aeb8c8',
  accent: '#4f46e5',
  accentContrast: '#ffffff',
  selection: '#4f46e5',
  selectionSoft: '#eef0ff',
  relation: '#7b8798',
  branches: ['#4f46e5', '#0f8f83', '#d97706', '#c0457e', '#2b7fc4', '#7a5cc4', '#5a8f36', '#c25a45'],
  presets: LIGHT_PRESETS,
};

const DARK: Omit<Palette, 'theme'> = {
  canvasBg: '#0d1219',
  gridDot: '#26303e',
  nodeFill: '#1b2431',
  nodeText: '#e9eef6',
  nodeMuted: '#94a3b9',
  nodeBorder: '#33404f',
  nodeShadow: 'rgba(0, 0, 0, 0.45)',
  edgeMuted: '#5a6a80',
  accent: '#98a4ff',
  accentContrast: '#0c111b',
  selection: '#98a4ff',
  selectionSoft: '#242b4c',
  relation: '#9aa9bf',
  branches: ['#8b93ff', '#43c6b7', '#e7a94f', '#e77fb2', '#61a9ea', '#ab92ee', '#8fc363', '#e58d78'],
  presets: DARK_PRESETS,
};

/**
 * Palettes are cached by theme. Returning a fresh object literal here used to
 * break `memo()` on every node: the palette is a prop, so a new identity on each
 * derived rebuild re-rendered the whole map on every keystroke.
 */
const PALETTES: Record<ThemeKind, Palette> = {
  light: { theme: 'light', ...LIGHT },
  dark: { theme: 'dark', ...DARK },
};

export function getPalette(theme: ThemeKind): Palette {
  return theme === 'dark' ? PALETTES.dark : PALETTES.light;
}

/** Index of the top-level branch a node belongs to (0..7). Root is -1. */
export function branchIndexOf(node: MindNode, doc: { nodes: Record<string, MindNode>; rootId: string }): number {
  let current = node;
  let guard = 0;
  while (current.parentId && current.parentId !== doc.rootId && guard++ < 1000) {
    const parent = doc.nodes[current.parentId];
    if (!parent) break;
    current = parent;
  }
  if (current.parentId === doc.rootId) {
    const siblings = Object.values(doc.nodes)
      .filter((n) => n.parentId === doc.rootId)
      .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
    const idx = siblings.findIndex((n) => n.id === current.id);
    return idx < 0 ? 0 : idx;
  }
  return -1;
}

export function branchColor(index: number, palette: Palette): string {
  if (index < 0) return palette.accent;
  return palette.branches[index % palette.branches.length];
}

export interface ResolvedNodeColors {
  background: string;
  text: string;
  mutedText: string;
  border: string;
  accent: string;
  isCentral: boolean;
}

/** Resolve style preset + explicit overrides + branch color into concrete paint values. */
export function resolveNodeColors(
  node: MindNode,
  branchIdx: number,
  palette: Palette,
  isRoot: boolean,
): ResolvedNodeColors {
  const preset = palette.presets[node.style.preset] ?? palette.presets.default;
  const bColor = branchColor(branchIdx, palette);
  const isCentral = isRoot && node.style.preset === 'default';
  if (isCentral) {
    return {
      background: palette.accent,
      text: palette.accentContrast,
      mutedText: palette.accentContrast,
      border: palette.accent,
      accent: palette.accentContrast,
      isCentral: true,
    };
  }
  return {
    background: node.style.background ?? preset.background,
    text: node.style.textColor ?? preset.text,
    mutedText: node.style.textColor ?? palette.nodeMuted,
    border: node.style.borderColor ?? preset.border,
    accent: preset.accent ?? bColor,
    isCentral,
  };
}
