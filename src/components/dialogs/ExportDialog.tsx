import { useState } from 'react';
import {
  exportMap,
  type ExportArea,
  type ExportFormat,
  type ExportScope,
  type PdfMode,
  type PdfPageSize,
} from '../../export';
import { actions } from '../../state/actions';
import { useDerived } from '../../state/derived';
import { Icon } from '../common/Icon';
import { Modal } from './Modal';

const FORMATS: { value: ExportFormat; icon: string; label: string; hint: string }[] = [
  { value: 'json', icon: 'brackets', label: 'JSON', hint: 'Portable Atlas map — nodes, styles, links, images and metadata. Re-importable.' },
  { value: 'svg', icon: 'code', label: 'SVG', hint: 'Crisp vector graphic that stays editable in design tools.' },
  { value: 'png', icon: 'image', label: 'PNG', hint: 'High-resolution raster image, ready to embed in docs.' },
  { value: 'pdf', icon: 'file', label: 'PDF', hint: 'Printable page, single fit or tiled multi-page.' },
  { value: 'markdown', icon: 'note', label: 'Markdown', hint: 'Headings and nested bullets for docs and wikis.' },
  { value: 'opml', icon: 'list', label: 'OPML', hint: 'Outline interchange for mind-map and outliner apps.' },
  { value: 'csv', icon: 'grid', label: 'CSV', hint: 'One row per node with its full path, type and tags.' },
  { value: 'freemind', icon: 'map', label: 'FreeMind', hint: '.mm XML readable by FreeMind and Freeplane.' },
];

export function ExportDialog() {
  const derived = useDerived();
  const [format, setFormat] = useState<ExportFormat>('png');
  const [scale, setScale] = useState(2);
  const [padding, setPadding] = useState(64);
  const [includeGrid, setIncludeGrid] = useState(false);
  const [scope, setScope] = useState<ExportScope>('visible');
  const [area, setArea] = useState<ExportArea>('whole');
  const [pdfMode, setPdfMode] = useState<PdfMode>('fit');
  const [pageSize, setPageSize] = useState<PdfPageSize>('a4');
  const [busy, setBusy] = useState(false);

  const isRaster = format === 'png' || format === 'pdf';
  const isGraphic = isRaster || format === 'svg';
  const totalNodes = derived.doc ? Object.keys(derived.doc.nodes).length : 0;
  const hidden = totalNodes - derived.visibleIds.length;

  const run = async () => {
    setBusy(true);
    try {
      await exportMap(format, derived, { scale, padding, includeGrid, scope, area, pdfMode, pageSize });
      actions.toast(`${format.toUpperCase()} exported`, 'success');
      actions.closeDialog();
    } catch (error) {
      actions.toast(error instanceof Error ? error.message : 'Export failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Export mind map"
      subtitle={`“${derived.doc?.title ?? 'Map'}” · ${derived.visibleIds.length} visible / ${totalNodes} total nodes`}
      icon="download"
      width={580}
      onClose={() => actions.closeDialog()}
      footer={<><div className="spacer" /><button type="button" className="btn" onClick={() => actions.openDialog('gif')}><Icon name="image" size={14} /> Animated GIF…</button><button type="button" className="btn" onClick={() => actions.closeDialog()}>Cancel</button><button type="button" className="btn btn-primary" disabled={busy} onClick={() => void run()}><Icon name="download" size={14} /> {busy ? 'Exporting…' : `Export ${format.toUpperCase()}`}</button></>}
    >
      <div className="export-formats">
        {FORMATS.map((item) => (
          <button key={item.value} type="button" aria-pressed={format === item.value}
            className={`export-format ${format === item.value ? 'is-active' : ''}`} onClick={() => setFormat(item.value)}>
            <span className="export-format__icon"><Icon name={item.icon} size={18} /></span>
            <span className="export-format__text"><strong>{item.label}</strong><small>{item.hint}</small></span>
            {format === item.value && <Icon name="check" size={15} />}
          </button>
        ))}
      </div>

      {isGraphic && (
        <div className="settings-group">
          <div className="settings-group__title">Content &amp; area</div>
          <div className="setting-row">
            <div><strong>Include</strong><span>{hidden} node{hidden === 1 ? '' : 's'} currently hidden by collapsed branches</span></div>
            <div className="segmented">
              <button type="button" aria-pressed={scope === 'visible'} className={scope === 'visible' ? 'is-active' : ''} onClick={() => setScope('visible')}>Visible only</button>
              <button type="button" aria-pressed={scope === 'complete'} className={scope === 'complete' ? 'is-active' : ''} onClick={() => { setScope('complete'); setArea('whole'); }}>Complete map</button>
            </div>
          </div>
          <div className="setting-row">
            <div><strong>Area</strong><span>Whole map or exactly what is on screen</span></div>
            <div className="segmented">
              <button type="button" aria-pressed={area === 'whole'} className={area === 'whole' ? 'is-active' : ''} onClick={() => setArea('whole')}>Whole map</button>
              <button type="button" aria-pressed={area === 'view'} className={area === 'view' ? 'is-active' : ''} disabled={scope === 'complete'} onClick={() => setArea('view')}>Current view</button>
            </div>
          </div>
          {format === 'pdf' && (
            <div className="setting-row">
              <div><strong>PDF layout</strong><span>Fit to one page or tile across several</span></div>
              <div className="segmented">
                <button type="button" aria-pressed={pdfMode === 'fit'} className={pdfMode === 'fit' ? 'is-active' : ''} onClick={() => setPdfMode('fit')}>Single page</button>
                <button type="button" aria-pressed={pdfMode === 'multipage'} className={pdfMode === 'multipage' ? 'is-active' : ''} onClick={() => setPdfMode('multipage')}>Multi-page</button>
              </div>
            </div>
          )}
          {format === 'pdf' && (
            <div className="setting-row">
              <div><strong>Page size</strong><span>Landscape orientation</span></div>
              <div className="segmented">
                <button type="button" aria-pressed={pageSize === 'a4'} className={pageSize === 'a4' ? 'is-active' : ''} onClick={() => setPageSize('a4')}>A4</button>
                <button type="button" aria-pressed={pageSize === 'letter'} className={pageSize === 'letter' ? 'is-active' : ''} onClick={() => setPageSize('letter')}>Letter</button>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="settings-group">
        <div className="settings-group__title">Options</div>
        <div className="setting-row">
          <div><strong>Padding</strong><span>Space around the outermost nodes</span></div>
          <div className="segmented">
            {[32, 64, 120].map((value) => <button key={value} type="button" disabled={!isGraphic || area === 'view'} aria-pressed={padding === value} className={padding === value ? 'is-active' : ''} onClick={() => setPadding(value)}>{value}px</button>)}
          </div>
        </div>
        <div className="setting-row">
          <div><strong>Render scale</strong><span>Resolution for PNG and PDF</span></div>
          <div className="segmented">
            {[1, 2, 3].map((value) => <button key={value} type="button" disabled={!isRaster} aria-pressed={scale === value} className={scale === value ? 'is-active' : ''} onClick={() => setScale(value)}>{value}×</button>)}
          </div>
        </div>
        <div className="setting-row">
          <div><strong>Include dot grid</strong><span>Adds the canvas texture to the export</span></div>
          <label className="switch"><input type="checkbox" aria-label="Include dot grid in export" checked={includeGrid} disabled={!isGraphic} onChange={(event) => setIncludeGrid(event.target.checked)} /><span className="switch-track" /></label>
        </div>
      </div>
      <p className="dialog-note"><Icon name="info" size={13} /> JSON preserves images and rich content; SVG/PNG/PDF include the node image thumbnail; Markdown, OPML, CSV and FreeMind are outlines without images. Animated GIF is built from the presentation steps.</p>
    </Modal>
  );
}
