import { createDocumentFromSpec, type NodeSpec } from './operations';
import { parseDocument } from './validation';
import type { MindMapDocument } from './types';

/**
 * Plain-text interchange codecs. Every importer funnels through the canonical
 * document model (and therefore the same validator/migrator as JSON imports), so
 * a malformed Markdown/OPML/CSV/FreeMind file can never corrupt the canvas.
 */

export type ForeignFormat = 'json' | 'markdown' | 'opml' | 'csv' | 'freemind';
export const FOREIGN_FORMATS: ForeignFormat[] = ['json', 'markdown', 'opml', 'csv', 'freemind'];

interface OutlineItem {
  level: number;
  title: string;
  description: string;
  tags: string[];
}

const MAX_ITEMS = 10_000;

export function detectFormat(text: string, filename = ''): ForeignFormat | null {
  const trimmed = text.trim();
  const ext = filename.toLowerCase().split('.').pop() ?? '';
  if (/^\s*[{[]/.test(trimmed)) return 'json';
  if (ext === 'mm' || /<map\s+version=|<node\s+text=/i.test(trimmed)) return 'freemind';
  if (ext === 'opml' || /<opml[\s>]/i.test(trimmed)) return 'opml';
  if (ext === 'csv' || /^(path|level|depth|title)\s*,/i.test(trimmed.split('\n')[0] ?? '')) return 'csv';
  if (ext === 'md' || ext === 'markdown' || /^\s*#{1,6}\s|^\s*[-*+]\s/m.test(trimmed)) return 'markdown';
  return null;
}

function specFromOutline(items: OutlineItem[], title: string): NodeSpec {
  const root: NodeSpec = { title: items[0]?.title || title || 'Imported map', children: [] };
  // Stack holds the most recent node at each depth.
  const stack: { level: number; node: NodeSpec }[] = [{ level: 0, node: root }];
  for (const [index, item] of items.entries()) {
    if (index === 0 && item.level <= 1) continue; // first heading is the central topic
    const node: NodeSpec = { title: item.title, tags: item.tags };
    if (item.description) node.description = item.description;
    const level = Math.max(1, Math.min(12, item.level));
    while (stack.length > 1 && stack[stack.length - 1].level >= level) stack.pop();
    const parent = stack[stack.length - 1].node;
    (parent.children ??= []).push(node);
    stack.push({ level, node });
  }
  return root;
}

function documentFromItems(items: OutlineItem[], title: string): MindMapDocument {
  if (!items.length) throw new Error('No outline entries were found in this file.');
  if (items.length > MAX_ITEMS) throw new Error(`Too many entries (limit: ${MAX_ITEMS}).`);
  const spec = specFromOutline(items, title);
  const doc = createDocumentFromSpec(title || spec.title, spec);
  // Tag metadata is informational; store it on the created nodes by title order.
  return parseDocument(doc);
}

/* ---------------- Markdown ---------------- */

function parseMarkdown(text: string): OutlineItem[] {
  const items: OutlineItem[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\t/g, '  ');
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      items.push({ level: heading[1].length, title: heading[2].trim().slice(0, 300), description: '', tags: [] });
      continue;
    }
    const bullet = /^(\s*)[-*+]\s+(?:\[[ xX]\]\s+)?(.+)$/.exec(line);
    if (bullet) {
      const indent = Math.floor(bullet[1].length / 2);
      const body = bullet[2].trim();
      const tags = [...body.matchAll(/(?:^|\s)#([\w-]+)/g)].map((match) => match[1]);
      const title = body.replace(/(?:^|\s)#[\w-]+/g, '').trim() || body;
      items.push({ level: indent + 2, title: title.slice(0, 300), description: '', tags });
      continue;
    }
    if (items.length && line.trim() && !line.trim().startsWith('---')) {
      // Indented prose underneath a bullet becomes that node's description.
      const last = items[items.length - 1];
      last.description = `${last.description} ${line.trim()}`.trim().slice(0, 2000);
    }
  }
  return items;
}

export function serializeMarkdown(doc: MindMapDocument): string {
  const lines: string[] = [`# ${doc.title}`];
  const childrenOf = (parentId: string): { id: string; depth: number }[] => {
    const out: { id: string; depth: number }[] = [];
    const walk = (id: string, depth: number) => {
      for (const node of Object.values(doc.nodes)) {
        if (node.parentId !== id) continue;
        out.push({ id: node.id, depth });
        walk(node.id, depth + 1);
      }
    };
    walk(parentId, 1);
    return out;
  };
  const byParent = new Map<string, string[]>();
  for (const node of Object.values(doc.nodes)) {
    if (!node.parentId) continue;
    const list = byParent.get(node.parentId) ?? [];
    list.push(node.id);
    byParent.set(node.parentId, list);
  }
  const rows = childrenOf(doc.rootId);
  for (const { id, depth } of rows) {
    const node = doc.nodes[id];
    if (!node) continue;
    const hasChildren = (byParent.get(id)?.length ?? 0) > 0;
    const prefix = hasChildren ? `${'  '.repeat(depth - 1)}- ` : `${'  '.repeat(depth)}- `;
    const tags = (node.content?.tags ?? []).map((tag) => ` #${tag}`).join('');
    lines.push(`${prefix}${node.title}${tags}`);
    if (node.description) lines.push(`${'  '.repeat(depth + 1)}${node.description.replace(/\s+/g, ' ')}`);
  }
  return `${lines.join('\n')}\n`;
}

/* ---------------- XML outlines (OPML / FreeMind) ---------------- */

function xmlAttr(tag: string, name: string): string {
  const match = new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, 'i').exec(tag);
  return match ? decodeEntities(match[1]) : '';
}

function decodeEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, '&');
}

function encodeEntities(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

interface XmlNode {
  title: string;
  note: string;
  depth: number;
}

/** Small tolerant stack parser — no DOMParser, so it works in workers and tests. */
function parseXmlOutline(text: string, tagName: 'outline' | 'node'): XmlNode[] {
  const out: XmlNode[] = [];
  const tagPattern = new RegExp(`<(${tagName})\\b([^>]*?)(/?)>|</${tagName}>`, 'gi');
  let depth = 0;
  let match: RegExpExecArray | null;
  while ((match = tagPattern.exec(text)) !== null && out.length < MAX_ITEMS) {
    const closing = match[0].startsWith('</');
    if (closing) {
      depth = Math.max(0, depth - 1);
      continue;
    }
    const attrs = match[2] ?? '';
    const title = xmlAttr(attrs, tagName === 'outline' ? 'text' : 'TEXT') ||
      xmlAttr(attrs, 'title') || xmlAttr(attrs, 'label') || 'Untitled';
    out.push({ title, note: xmlAttr(attrs, '_note') || xmlAttr(attrs, 'note'), depth });
    if (!match[3]) depth++;
  }
  return out;
}

function parseOpml(text: string): OutlineItem[] {
  return parseXmlOutline(text, 'outline').map((item) => ({
    level: item.depth + 1,
    title: item.title.slice(0, 300),
    description: item.note.slice(0, 2000),
    tags: [],
  }));
}

function parseFreeMind(text: string): OutlineItem[] {
  const nodes = parseXmlOutline(text, 'node');
  if (!nodes.length) throw new Error('No <node> elements were found in this FreeMind file.');
  return nodes.map((item) => ({
    level: item.depth + 1,
    title: item.title.slice(0, 300),
    description: item.note.slice(0, 2000),
    tags: [],
  }));
}

/* ---------------- CSV ---------------- */

function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ',' || char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (char !== ',') {
        if (row.some((cell) => cell.trim())) rows.push(row);
        row = [];
      }
    } else field += char;
  }
  row.push(field);
  if (row.some((cell) => cell.trim())) rows.push(row);
  return rows;
}

function parseCsv(text: string): OutlineItem[] {
  const rows = parseCsvRows(text);
  if (!rows.length) throw new Error('This CSV file is empty.');
  const header = rows[0].map((cell) => cell.trim().toLowerCase());
  const hasHeader = header.includes('title') || header.includes('path') || header.includes('level');
  const body = hasHeader ? rows.slice(1) : rows;
  const levelIdx = header.indexOf('level');
  const depthIdx = header.indexOf('depth');
  const titleIdx = header.indexOf('title');
  const pathIdx = header.indexOf('path');
  const descIdx = header.indexOf('description');
  const tagIdx = header.indexOf('tags');
  const items: OutlineItem[] = [];
  for (const row of body) {
    if (pathIdx >= 0) {
      const segments = (row[pathIdx] ?? '').split(/[\\/|>]/).map((s) => s.trim()).filter(Boolean);
      if (!segments.length) continue;
      segments.forEach((segment, index) => {
        if (index === segments.length - 1) {
          items.push({
            level: index + 1,
            title: segment.slice(0, 300),
            description: (row[descIdx] ?? '').slice(0, 2000),
            tags: (row[tagIdx] ?? '').split(/[;|]/).map((s) => s.trim()).filter(Boolean),
          });
        } else if (!items.some((item) => item.level === index + 1 && item.title === segment)) {
          items.push({ level: index + 1, title: segment.slice(0, 300), description: '', tags: [] });
        }
      });
      continue;
    }
    const level = Number(row[levelIdx >= 0 ? levelIdx : depthIdx >= 0 ? depthIdx : 0]) || 1;
    const title = (row[titleIdx >= 0 ? titleIdx : hasHeader ? 1 : 0] ?? '').trim();
    if (!title) continue;
    items.push({
      level: Math.max(1, Math.min(12, level)),
      title: title.slice(0, 300),
      description: (descIdx >= 0 ? row[descIdx] ?? '' : '').slice(0, 2000),
      tags: (tagIdx >= 0 ? row[tagIdx] ?? '' : '').split(/[;|]/).map((s) => s.trim()).filter(Boolean),
    });
  }
  return items;
}

function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

export function serializeCsv(doc: MindMapDocument): string {
  const rootTitle = doc.nodes[doc.rootId]?.title ?? doc.title;
  const lines = [
    'path,title,description,type,tags',
    [rootTitle, rootTitle, '', 'central', ''].map(csvCell).join(','),
  ];
  const walk = (id: string, path: string[]) => {
    for (const node of Object.values(doc.nodes)) {
      if (node.parentId !== id) continue;
      const next = [...path, node.title];
      lines.push([
        next.join('/'), node.title, node.description, node.type,
        (node.content?.tags ?? []).join(';'),
      ].map(csvCell).join(','));
      walk(node.id, next);
    }
  };
  walk(doc.rootId, [rootTitle]);
  return `${lines.join('\n')}\n`;
}

export function serializeOpml(doc: MindMapDocument): string {
  const lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<opml version="2.0">', '  <head><title>Atlas export</title></head>', '  <body>'];
  const walk = (id: string, indent: number) => {
    for (const node of Object.values(doc.nodes)) {
      if (node.parentId !== id) continue;
      const kids = Object.values(doc.nodes).some((candidate) => candidate.parentId === node.id);
      const attrs = `text="${encodeEntities(node.title)}"` + (node.description ? ` _note="${encodeEntities(node.description)}"` : '');
      if (kids) {
        lines.push(`${' '.repeat(indent)}<outline ${attrs}>`);
        walk(node.id, indent + 2);
        lines.push(`${' '.repeat(indent)}</outline>`);
      } else lines.push(`${' '.repeat(indent)}<outline ${attrs} />`);
    }
  };
  lines.push(`    <outline text="${encodeEntities(doc.nodes[doc.rootId]?.title ?? doc.title)}">`);
  walk(doc.rootId, 6);
  lines.push('    </outline>', '  </body>', '</opml>');
  return `${lines.join('\n')}\n`;
}

export function serializeFreeMind(doc: MindMapDocument): string {
  const lines = ['<map version="freeplane 1.9.0">'];
  const walk = (id: string, indent: number) => {
    for (const node of Object.values(doc.nodes)) {
      if (node.parentId !== id) continue;
      const kids = Object.values(doc.nodes).some((candidate) => candidate.parentId === node.id);
      const attrs = `TEXT="${encodeEntities(node.title)}"`;
      if (kids) {
        lines.push(`${' '.repeat(indent)}<node ${attrs}>`);
        walk(node.id, indent + 2);
        lines.push(`${' '.repeat(indent)}</node>`);
      } else lines.push(`${' '.repeat(indent)}<node ${attrs} />`);
    }
  };
  lines.push(`  <node TEXT="${encodeEntities(doc.nodes[doc.rootId]?.title ?? doc.title)}">`);
  walk(doc.rootId, 4);
  lines.push('  </node>', '</map>');
  return `${lines.join('\n')}\n`;
}

/** Convert a supported foreign format into a validated canonical document. */
export function parseForeignDocument(text: string, format: ForeignFormat, title = 'Imported map'): MindMapDocument {
  switch (format) {
    case 'json': return parseDocument(JSON.parse(text) as unknown);
    case 'markdown': return documentFromItems(parseMarkdown(text), title);
    case 'opml': return documentFromItems(parseOpml(text), title);
    case 'csv': return documentFromItems(parseCsv(text), title);
    case 'freemind': return documentFromItems(parseFreeMind(text), title);
    default: throw new Error('Unsupported import format');
  }
}

export function serializeDocument(doc: MindMapDocument, format: ForeignFormat): string {
  switch (format) {
    case 'json': return JSON.stringify(doc, null, 2);
    case 'markdown': return serializeMarkdown(doc);
    case 'opml': return serializeOpml(doc);
    case 'csv': return serializeCsv(doc);
    case 'freemind': return serializeFreeMind(doc);
    default: throw new Error('Unsupported export format');
  }
}

export const FILE_EXTENSIONS: Record<ForeignFormat, string> = {
  json: 'json',
  markdown: 'md',
  opml: 'opml',
  csv: 'csv',
  freemind: 'mm',
};
