import { STYLE_PRESETS, type MindNode } from './types';

/**
 * Raw 24×24 path data for the node glyphs, shared with the standalone SVG/PDF
 * exporter (which cannot use the React `Icon` component). Keep in sync with the
 * matching entries in `components/common/Icon.tsx`.
 */
export const ICON_SVG_PATHS: Record<string, string> = {
  spark: '<path d="m12 2 1.9 6.1L20 10l-6.1 1.9L12 18l-1.9-6.1L4 10l6.1-1.9z"/><path d="m19 17 .7 2.3L22 20l-2.3.7L19 23l-.7-2.3L16 20l2.3-.7z"/>',
  branch: '<circle cx="6" cy="5" r="2"/><circle cx="18" cy="6" r="2"/><circle cx="18" cy="18" r="2"/><path d="M6 7v10a3 3 0 0 0 3 3h7M8 12h8"/>',
  circle: '<circle cx="12" cy="12" r="8"/>',
  note: '<path d="M4 4h16v12l-4 4H4z"/><path d="M20 16h-4v4M8 9h8M8 13h5"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.4 2.3c-.9.4-1.4 1-1.4 2"/><path d="M12 17h.01"/>',
  bulb: '<path d="M9 18h6M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7V18h8v-3.3A7 7 0 0 0 12 2z"/>',
  check: '<path d="m4 12 5 5L20 6"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7 7l1-1"/>',
  star: '<path d="m12 2 3 6.5 7 .9-5.2 4.8 1.4 6.8L12 17.7 5.8 21l1.4-6.8L2 9.4l7-.9z"/>',
  book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/>',
  diamond: '<path d="m12 2 9 10-9 10-9-10z"/>',
  layers: '<path d="m12 2 9 5-9 5-9-5z"/><path d="m3 12 9 5 9-5M3 17l9 5 9-5"/>',
  alert: '<path d="M10.3 3.5 2 18a2 2 0 0 0 1.7 3h16.6a2 2 0 0 0 1.7-3L13.7 3.5a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
  code: '<path d="m8 8-4 4 4 4M16 8l4 4-4 4M14 4l-4 16"/>',
  brackets: '<path d="M8 4H6a2 2 0 0 0-2 2v4a2 2 0 0 1-2 2 2 2 0 0 1 2 2v4a2 2 0 0 0 2 2h2M16 4h2a2 2 0 0 1 2 2v4a2 2 0 0 0 2 2 2 2 0 0 0-2 2v4a2 2 0 0 1-2 2h-2"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>',
  tag: '<path d="M20 12 12 20 3 11V4h7z"/><circle cx="7.5" cy="8.5" r="1.2"/>',
};

const TYPE_ICONS: Record<string, string> = {
  central: 'spark',
  topic: 'branch',
  subtopic: 'circle',
  note: 'note',
  question: 'help',
  example: 'bulb',
  task: 'check',
  reference: 'link',
};

/** Shared by the renderer and the text measurer so node widths always match what is drawn. */
export function iconForNode(node: MindNode, isRoot: boolean): string {
  if (node.style.icon) return node.style.icon;
  if (isRoot) return 'spark';
  if (node.style.preset !== 'default') {
    return STYLE_PRESETS.find((preset) => preset.value === node.style.preset)?.icon ?? 'circle';
  }
  if (['note', 'question', 'example', 'task', 'reference'].includes(node.type)) return TYPE_ICONS[node.type];
  return '';
}
