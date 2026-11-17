import { useMemo, useRef, useState } from 'react';
import { isLocalImageRef, normalizeContent } from '../../core/mindmap/content';
import type { MindNode, NodeContent } from '../../core/mindmap/types';
import {
  ImageStorageError,
  localImageRef,
  releaseImageObjectUrls,
  saveImageBlob,
} from '../../persistence/imageBlobs';
import { actions } from '../../state/actions';
import { useAppStore } from '../../state/store';
import { uid } from '../../utils/common';
import { Icon } from '../common/Icon';
import { useImageSources } from '../common/useImageSources';
import { useTabList } from '../common/useTabList';

const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;
const MAX_IMAGE_SIDE = 1200;
const MAX_STORED_IMAGE_BYTES = 900 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif']);

const SECTION_IDS = ['markdown', 'tags', 'checklist', 'links', 'code', 'formulas', 'images'] as const;
type Section = (typeof SECTION_IDS)[number];

const TABS: { id: Section; label: string; icon: string }[] = [
  { id: 'markdown', label: 'Note', icon: 'note' },
  { id: 'tags', label: 'Tags', icon: 'tag' },
  { id: 'checklist', label: 'Tasks', icon: 'check' },
  { id: 'links', label: 'Links', icon: 'link' },
  { id: 'code', label: 'Code', icon: 'code' },
  { id: 'formulas', label: 'Formula', icon: 'brackets' },
  { id: 'images', label: 'Image', icon: 'image' },
];

async function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/**
 * Downscale an uploaded file and return a compact local Blob. Opaque images
 * become JPEG; images with transparency use WebP (or PNG when WebP is not
 * available) so cut-outs do not get a black/white background.
 */
async function imageFileToBlob(file: File): Promise<Blob> {
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
    throw new Error('Choose a PNG, JPEG, WebP, GIF or AVIF image file.');
  }
  if (!file.size) throw new Error('That image file is empty.');
  if (file.size > MAX_UPLOAD_BYTES) throw new Error('That image is larger than 12 MB.');

  let source: ImageBitmap | HTMLImageElement;
  let objectUrl: string | null = null;
  if (typeof createImageBitmap === 'function') {
    try {
      source = await createImageBitmap(file);
    } catch {
      throw new Error('This image could not be decoded.');
    }
  } else {
    objectUrl = URL.createObjectURL(file);
    source = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('This image could not be decoded.'));
      image.src = objectUrl!;
    });
  }
  const isBitmap = typeof ImageBitmap !== 'undefined' && source instanceof ImageBitmap;
  try {
    const sourceWidth = isBitmap ? (source as ImageBitmap).width : (source as HTMLImageElement).naturalWidth;
    const sourceHeight = isBitmap ? (source as ImageBitmap).height : (source as HTMLImageElement).naturalHeight;
    if (!sourceWidth || !sourceHeight) throw new Error('This image has no pixels.');
    const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(sourceWidth, sourceHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(sourceWidth * scale));
    canvas.height = Math.max(1, Math.round(sourceHeight * scale));
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('This browser cannot process images.');
    ctx.drawImage(source as CanvasImageSource, 0, 0, canvas.width, canvas.height);

    let hasAlpha = false;
    try {
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      for (let index = 3; index < pixels.length; index += 4) {
        if (pixels[index] < 255) { hasAlpha = true; break; }
      }
    } catch {
      // A canvas that cannot be read is treated as opaque; the file type check
      // above already keeps SVG and non-bitmap inputs out.
    }

    let output = canvas;
    let blob: Blob | null = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      if (hasAlpha) {
        blob = await canvasToBlob(output, 'image/webp', 0.9);
        if (!blob || blob.type !== 'image/webp') blob = await canvasToBlob(output, 'image/png');
      } else {
        let quality = 0.86;
        blob = await canvasToBlob(output, 'image/jpeg', quality);
        while (blob && blob.size > MAX_STORED_IMAGE_BYTES && quality > 0.38) {
          quality -= 0.12;
          blob = await canvasToBlob(output, 'image/jpeg', quality);
        }
      }
      if (blob && blob.size <= MAX_STORED_IMAGE_BYTES) return blob;
      // Transparent PNGs can still be large: shrink the pixels, then retry.
      const next = document.createElement('canvas');
      next.width = Math.max(1, Math.round(output.width * 0.8));
      next.height = Math.max(1, Math.round(output.height * 0.8));
      const nextCtx = next.getContext('2d');
      if (!nextCtx) break;
      nextCtx.drawImage(output, 0, 0, next.width, next.height);
      output = next;
    }
    if (!blob) throw new Error('This browser could not encode the image.');
    throw new Error('That image is too large to store. Try a smaller file.');
  } finally {
    if (isBitmap) (source as ImageBitmap).close();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}

/**
 * Editor for the rich, UI-agnostic `NodeContent` model. Every change goes through
 * `actions.patchContent` → `updateContent` command → history, so all of it is
 * undoable and included in exports.
 */
export function ContentEditor({ node }: { node: MindNode }) {
  const [tagDraft, setTagDraft] = useState('');
  const [checkDraft, setCheckDraft] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [linkTitle, setLinkTitle] = useState('');
  const [codeLang, setCodeLang] = useState('text');
  const [codeSource, setCodeSource] = useState('');
  const [formula, setFormula] = useState('');
  const [imageAlt, setImageAlt] = useState('');
  const [imageBusy, setImageBusy] = useState(false);
  const [imageError, setImageError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [section, setSection] = useState<Section>('markdown');
  const mapId = useAppStore((s) => s.history.present?.id ?? null);
  const { tabProps, panelProps } = useTabList<Section>({
    ids: SECTION_IDS,
    active: section,
    onChange: setSection,
    base: 'content',
  });

  const content = node.content ?? normalizeContent(undefined);
  const patch = (value: Partial<NodeContent>) => actions.patchContent(node.id, value);
  const images = useMemo(() => content.images, [content.images]);
  const imageUrls = useImageSources(mapId, images);

  const onImageFiles = async (files: FileList | File[] | null) => {
    if (!files?.length) return;
    if (!mapId) {
      setImageError('Open a map before adding images.');
      return;
    }
    setImageBusy(true);
    setImageError('');
    try {
      // Save blobs first and patch once. A failed write never leaves a dangling
      // reference in the document, so no upload is silently lost.
      const additions: NodeContent['images'] = [];
      for (const file of Array.from(files).slice(0, 5)) {
        const blob = await imageFileToBlob(file);
        const id = uid('img');
        try {
          await saveImageBlob(mapId, id, blob);
        } catch (error) {
          if (error instanceof DOMException && error.name === 'QuotaExceededError') {
            throw new ImageStorageError('Browser storage is full — export a backup and remove unused images before uploading more.');
          }
          throw error;
        }
        additions.push({ id, src: localImageRef(id), alt: imageAlt.trim() || file.name.replace(/\.[^.]+$/, '') });
      }
      if (additions.length) {
        patch({ images: [...content.images, ...additions] });
        setImageAlt('');
        actions.toast(
          additions.length === 1 ? 'Image added to node' : `${additions.length} images added to node`,
          'success',
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'This image could not be added.';
      setImageError(message);
      actions.toast(message, 'error');
    } finally {
      setImageBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const addTag = () => {
    const tags = tagDraft.split(/[,;\s]+/).map((tag) => tag.trim().replace(/^#/, '')).filter(Boolean);
    if (!tags.length) return;
    patch({ tags: normalizeContent({ tags: [...content.tags, ...tags] }).tags });
    setTagDraft('');
  };

  return (
    <div className="content-editor">
      <div className="content-editor__tabs" role="tablist" aria-label="Node content type" aria-orientation="horizontal">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            {...tabProps(tab.id)}
            className={section === tab.id ? 'is-active' : ''}
            title={tab.label}
            onClick={() => setSection(tab.id)}
          >
            <Icon name={tab.icon} size={13} />
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      <div {...panelProps('markdown')} className="field">
        <label className="field-label" htmlFor="content-markdown">Markdown note</label>
        <textarea
          id="content-markdown"
          className="textarea mono"
          rows={5}
          placeholder="**Important** detail, a source, or a longer explanation…"
          value={content.markdown}
          onChange={(event) => patch({ markdown: event.target.value })}
        />
        <span className="panel-note">Rendered as a badge on the node and stored verbatim in JSON exports.</span>
      </div>

      <div {...panelProps('tags')} className="field">
        <span className="field-label">Tags</span>
        <div className="tag-chips">
          {content.tags.map((tag) => (
            <span key={tag} className="tag-chip">
              #{tag}
              <button type="button" aria-label={`Remove ${tag}`} onClick={() => patch({ tags: content.tags.filter((t) => t !== tag) })}>
                <Icon name="x" size={10} />
              </button>
            </span>
          ))}
          {!content.tags.length && <span className="faint">No tags yet</span>}
        </div>
        <div className="inline-form">
          <input
            className="input input-sm"
            placeholder="Add tags, comma separated"
            value={tagDraft}
            onChange={(event) => setTagDraft(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addTag(); } }}
          />
          <button type="button" className="btn btn-sm" onClick={addTag}><Icon name="plus" size={12} /> Add</button>
        </div>
      </div>

      <div {...panelProps('checklist')} className="field">
        <span className="field-label">Checklist</span>
        <ul className="content-list">
          {content.checklist.map((item) => (
            <li key={item.id}>
              <input
                type="checkbox"
                checked={item.done}
                aria-label={`Mark ${item.text} done`}
                onChange={() => patch({ checklist: content.checklist.map((c) => c.id === item.id ? { ...c, done: !c.done } : c) })}
              />
              <input
                className="input input-sm"
                value={item.text}
                aria-label="Checklist item text"
                onChange={(event) => patch({ checklist: content.checklist.map((c) => c.id === item.id ? { ...c, text: event.target.value } : c) })}
              />
              <button type="button" className="icon-btn is-danger" aria-label="Remove item" onClick={() => patch({ checklist: content.checklist.filter((c) => c.id !== item.id) })}>
                <Icon name="x" size={12} />
              </button>
            </li>
          ))}
        </ul>
        <div className="inline-form">
          <input
            className="input input-sm"
            placeholder="New task"
            value={checkDraft}
            onChange={(event) => setCheckDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && checkDraft.trim()) {
                event.preventDefault();
                patch({ checklist: [...content.checklist, { id: uid('task'), text: checkDraft.trim(), done: false }] });
                setCheckDraft('');
              }
            }}
          />
          <button
            type="button"
            className="btn btn-sm"
            disabled={!checkDraft.trim()}
            onClick={() => {
              patch({ checklist: [...content.checklist, { id: uid('task'), text: checkDraft.trim(), done: false }] });
              setCheckDraft('');
            }}
          >
            <Icon name="plus" size={12} /> Add
          </button>
        </div>
      </div>

      <div {...panelProps('links')} className="field">
        <span className="field-label">Links</span>
        <ul className="content-list">
          {content.links.map((link) => (
            <li key={link.id}>
              <a href={link.url} target="_blank" rel="noreferrer" title={link.url}><Icon name="external-link" size={12} /> {link.title}</a>
              <button type="button" className="icon-btn is-danger" aria-label="Remove link" onClick={() => patch({ links: content.links.filter((l) => l.id !== link.id) })}>
                <Icon name="x" size={12} />
              </button>
            </li>
          ))}
        </ul>
        <div className="inline-form inline-form--stack">
          <input className="input input-sm" placeholder="https://example.com" value={linkUrl} onChange={(event) => setLinkUrl(event.target.value)} />
          <input className="input input-sm" placeholder="Title (optional)" value={linkTitle} onChange={(event) => setLinkTitle(event.target.value)} />
          <button
            type="button"
            className="btn btn-sm"
            disabled={!/^(https?:|mailto:|\/|#)/i.test(linkUrl)}
            onClick={() => {
              patch({ links: [...content.links, { id: uid('link'), url: linkUrl, title: linkTitle || linkUrl }] });
              setLinkUrl(''); setLinkTitle('');
            }}
          >
            <Icon name="plus" size={12} /> Add link
          </button>
        </div>
      </div>

      <div {...panelProps('code')} className="field">
        <span className="field-label">Code blocks</span>
        <ul className="content-list">
          {content.code.map((block) => (
            <li key={block.id} className="content-list__code">
              <span className="chip">{block.language}</span>
              <code>{block.source.slice(0, 80) || '(empty)'}</code>
              <button type="button" className="icon-btn is-danger" aria-label="Remove code block" onClick={() => patch({ code: content.code.filter((c) => c.id !== block.id) })}>
                <Icon name="x" size={12} />
              </button>
            </li>
          ))}
        </ul>
        <div className="inline-form inline-form--stack">
          <input className="input input-sm" placeholder="Language" value={codeLang} onChange={(event) => setCodeLang(event.target.value)} />
          <textarea className="textarea mono" rows={3} placeholder="Source…" value={codeSource} onChange={(event) => setCodeSource(event.target.value)} />
          <button
            type="button"
            className="btn btn-sm"
            disabled={!codeSource.trim()}
            onClick={() => {
              patch({ code: [...content.code, { id: uid('code'), language: codeLang || 'text', source: codeSource }] });
              setCodeSource('');
            }}
          >
            <Icon name="plus" size={12} /> Add code block
          </button>
        </div>
      </div>

      <div {...panelProps('formulas')} className="field">
        <span className="field-label">LaTeX formulas</span>
        <ul className="content-list">
          {content.formulas.map((item) => (
            <li key={item.id}>
              <code>{item.latex}</code>
              <button type="button" className="icon-btn is-danger" aria-label="Remove formula" onClick={() => patch({ formulas: content.formulas.filter((f) => f.id !== item.id) })}>
                <Icon name="x" size={12} />
              </button>
            </li>
          ))}
        </ul>
        <div className="inline-form">
          <input
            className="input input-sm mono"
            placeholder="E = mc^2"
            value={formula}
            onChange={(event) => setFormula(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && formula.trim()) {
                patch({ formulas: [...content.formulas, { id: uid('formula'), latex: formula.trim() }] });
                setFormula('');
              }
            }}
          />
          <button
            type="button"
            className="btn btn-sm"
            disabled={!formula.trim()}
            onClick={() => {
              patch({ formulas: [...content.formulas, { id: uid('formula'), latex: formula.trim() }] });
              setFormula('');
            }}
          >
            <Icon name="plus" size={12} /> Add
          </button>
        </div>
      </div>

      <div {...panelProps('images')} className="field">
        <span className="field-label">Images</span>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
          multiple
          className="sr-only"
          aria-label="Upload images"
          onChange={(event) => void onImageFiles(event.target.files)}
        />
        <div
          className="image-dropzone"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void onImageFiles(event.dataTransfer.files);
          }}
        >
          <button
            type="button"
            className="btn btn-sm btn-block image-upload-btn"
            disabled={imageBusy}
            onClick={() => fileInputRef.current?.click()}
          >
            <Icon name="upload" size={13} /> {imageBusy ? 'Processing image…' : 'Upload images from this device'}
          </button>
          <span className="panel-note">Or drop image files here. Files stay on this device.</span>
        </div>
        <span className="panel-note">Images are downscaled, stored as local blobs in this browser, and included in JSON backups and rendered exports. No image is fetched from the internet.</span>
        <div className="inline-form inline-form--stack">
          <input className="input input-sm" placeholder="Alt text for the next upload (optional)" value={imageAlt} onChange={(event) => setImageAlt(event.target.value)} />
        </div>
        {imageError && <p className="field-error" role="alert"><Icon name="alert" size={12} /> {imageError}</p>}
        <ul className="content-list content-list--images">
          {content.images.map((image) => {
            const source = isLocalImageRef(image.src) ? imageUrls[image.id] : image.src;
            return (
              <li key={image.id}>
                {source ? <img src={source} alt={image.alt} className="content-thumb" /> : <span className="content-thumb content-thumb--empty" aria-hidden="true" />}
                <span title={image.alt}>{image.alt || 'Image'}</span>
                <button
                  type="button"
                  className="icon-btn is-danger"
                  aria-label={`Remove ${image.alt || 'image'}`}
                  onClick={() => {
                    if (isLocalImageRef(image.src) && mapId) releaseImageObjectUrls(mapId, image.id);
                    patch({ images: content.images.filter((i) => i.id !== image.id) });
                  }}
                >
                  <Icon name="x" size={12} />
                </button>
              </li>
            );
          })}
        </ul>
        {!content.images.length && <span className="faint">No images yet</span>}
      </div>
    </div>
  );
}
