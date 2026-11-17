import { uid } from '../../utils/common';
import type { NodeContent } from './types';

/**
 * Uploaded images are stored as data URLs so a map stays self-contained and works
 * offline. A phone photo compresses to well under this; the cap stops a hostile
 * document from allocating hundreds of megabytes in IndexedDB.
 */
export const MAX_IMAGE_SRC_LENGTH = 1_500_000;

/**
 * Images are local-only. A document may carry a portable data URL (JSON import,
 * backup, rendered export) or an opaque reference to a blob in this browser's
 * IndexedDB. External http(s)/relative URLs are never accepted or fetched.
 */
const SAFE_IMAGE_SRC = /^(?:data:image\/(?:png|jpe?g|gif|webp|avif);base64,[A-Za-z0-9+/=]+|atlas-blob:[A-Za-z0-9_-]{1,80})$/i;
const LOCAL_IMAGE_REF = /^atlas-blob:[A-Za-z0-9_-]{1,80}$/i;

export function isSafeImageSrc(src: string): boolean {
  return src.length <= MAX_IMAGE_SRC_LENGTH && SAFE_IMAGE_SRC.test(src);
}

export function isLocalImageRef(src: string): boolean {
  return LOCAL_IMAGE_REF.test(src);
}

export const EMPTY_CONTENT: NodeContent = {
  markdown: '',
  code: [],
  formulas: [],
  links: [],
  images: [],
  checklist: [],
  tags: [],
};

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
function text(value: unknown, max = 20_000): string {
  return typeof value === 'string' ? value.slice(0, max) : '';
}
function entryId(value: unknown): string {
  return typeof value === 'string' && value ? value.slice(0, 80) : uid('c');
}

/** Defensive normalisation — any stored or AI-produced content becomes a valid NodeContent. */
export function normalizeContent(raw: unknown): NodeContent {
  const value = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
  const tags = array(value.tags)
    .filter((tag): tag is string => typeof tag === 'string')
    .map((tag) => tag.trim().replace(/^#/, '').slice(0, 60))
    .filter(Boolean);
  return {
    markdown: text(value.markdown),
    code: array(value.code).slice(0, 50).map((item) => {
      const entry = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
      return { id: entryId(entry.id), language: text(entry.language, 40) || 'text', source: text(entry.source) };
    }),
    formulas: array(value.formulas).slice(0, 50).map((item) => {
      const entry = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
      return { id: entryId(entry.id), latex: text(entry.latex ?? entry.formula, 2000) };
    }),
    links: array(value.links).slice(0, 100).map((item) => {
      const entry = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
      const url = text(entry.url, 2000);
      return { id: entryId(entry.id), url, title: text(entry.title, 200) || url };
    }).filter((link) => /^(https?:|mailto:|\/|#)/i.test(link.url)),
    images: array(value.images).slice(0, 50).map((item) => {
      const entry = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
      // A real uploaded photo is a base64 data URL far longer than 4 000 chars;
      // the old 4 000-char clamp silently corrupted every local image. Oversized
      // sources are rejected outright — truncating one would keep a broken URL.
      const raw = typeof entry.src === 'string' ? entry.src.trim() : '';
      const src = raw.length <= MAX_IMAGE_SRC_LENGTH ? raw : '';
      return { id: entryId(entry.id), src, alt: text(entry.alt, 300) };
    }).filter((image) => isSafeImageSrc(image.src)),
    checklist: array(value.checklist).slice(0, 200).map((item) => {
      const entry = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
      return { id: entryId(entry.id), text: text(entry.text, 500), done: entry.done === true };
    }),
    tags: [...new Set(tags)].slice(0, 40),
  };
}

export function hasRichContent(content: NodeContent | undefined): boolean {
  if (!content) return false;
  return !!(
    content.markdown || content.code.length || content.formulas.length || content.links.length ||
    content.images.length || content.checklist.length || content.tags.length
  );
}

/** Flat text used by search and by AI context building. */
export function contentSearchText(content: NodeContent | undefined): string {
  if (!content) return '';
  return [
    content.markdown,
    ...content.code.map((item) => `${item.language} ${item.source}`),
    ...content.formulas.map((item) => item.latex),
    ...content.links.map((item) => `${item.title} ${item.url}`),
    ...content.images.map((item) => item.alt),
    ...content.checklist.map((item) => item.text),
    ...content.tags.map((tag) => `#${tag}`),
  ].join(' ');
}

export function contentBadges(content: NodeContent | undefined): string[] {
  if (!content) return [];
  const badges: string[] = [];
  if (content.markdown) badges.push('note');
  if (content.code.length) badges.push('code');
  if (content.formulas.length) badges.push('brackets');
  if (content.links.length) badges.push('link');
  if (content.images.length) badges.push('image');
  if (content.checklist.length) {
    const done = content.checklist.filter((item) => item.done).length;
    badges.push(done === content.checklist.length ? 'check' : 'list');
  }
  content.tags.slice(0, 2).forEach(() => badges.push('circle'));
  return badges.slice(0, 5);
}
