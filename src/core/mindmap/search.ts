import { contentSearchText } from './content';
import type { MindMapDocument, MindNode, NodeType } from './types';

export type SearchField = 'title' | 'description' | 'content' | 'tags' | 'type';

export interface SearchFilters {
  fields: SearchField[];
  types: NodeType[];
  tags: string[];
  exact: boolean;
  fuzzy: boolean;
}

export interface SearchHit {
  id: string;
  score: number;
  snippet: string;
  matchedIn: SearchField[];
}

export const DEFAULT_SEARCH_FILTERS: SearchFilters = {
  fields: ['title', 'description', 'content', 'tags', 'type'],
  types: [],
  tags: [],
  exact: false,
  fuzzy: true,
};

function normalize(value: string): string {
  return value.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
}

/** Cheap subsequence test — "gd" matches "gradient descent" without a fuzzy library. */
function isSubsequence(needle: string, haystack: string): boolean {
  if (needle.length < 2 || haystack.length > 400) return false;
  let index = 0;
  for (const char of haystack) {
    if (char === needle[index]) index++;
    if (index === needle.length) return true;
  }
  return false;
}

function editDistanceAtMostOne(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (a.length < b.length) j++;
    else { i++; j++; }
  }
  return true;
}

function snippetFor(node: MindNode, q: string): string {
  const sources = [node.description, node.content?.markdown ?? '', contentSearchText(node.content)].filter(Boolean);
  for (const source of sources) {
    const at = normalize(source).indexOf(q);
    if (at >= 0) {
      const start = Math.max(0, at - 28);
      return `${start > 0 ? '…' : ''}${source.slice(start, start + 90).replace(/\s+/g, ' ').trim()}…`;
    }
  }
  return node.description.slice(0, 90);
}

export function searchDocument(
  doc: MindMapDocument,
  query: string,
  filters: SearchFilters = DEFAULT_SEARCH_FILTERS,
): SearchHit[] {
  const q = normalize(query.trim());
  if (!q) return [];
  const hits: SearchHit[] = [];

  for (const node of Object.values(doc.nodes)) {
    if (filters.types.length && !filters.types.includes(node.type)) continue;
    const tags = node.content?.tags ?? [];
    if (filters.tags.length && !filters.tags.some((tag) => tags.includes(tag))) continue;

    const title = normalize(node.title);
    const description = normalize(node.description);
    const content = normalize(contentSearchText(node.content));
    const tagText = normalize(tags.map((tag) => `#${tag}`).join(' '));
    const typeText = normalize(node.type);
    const values: Record<SearchField, string> = {
      title,
      description,
      content,
      tags: tagText,
      type: typeText,
    };

    let score = 0;
    const matchedIn: SearchField[] = [];
    for (const field of filters.fields) {
      const value = values[field];
      if (!value) continue;
      let fieldScore = 0;
      if (value === q) fieldScore = 100;
      else if (!filters.exact) {
        if (field === 'title' && value.startsWith(q)) fieldScore = 80;
        else if (value.includes(q)) fieldScore = field === 'title' ? 60 : field === 'tags' ? 50 : 30;
        else if (filters.fuzzy && q.length >= 3) {
          if (value.split(/\s+/).some((word) => editDistanceAtMostOne(q, word))) fieldScore = 22;
          else if (isSubsequence(q, value)) fieldScore = 10;
        }
      }
      if (fieldScore > 0) {
        matchedIn.push(field);
        score += fieldScore * (field === 'title' ? 2 : 1);
      }
    }
    if (score > 0) hits.push({ id: node.id, score, snippet: snippetFor(node, q), matchedIn });
  }

  return hits.sort((a, b) =>
    b.score - a.score ||
    (doc.nodes[a.id]?.title ?? '').localeCompare(doc.nodes[b.id]?.title ?? ''),
  );
}
