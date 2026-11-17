import { useEffect, useRef, useState } from 'react';
import {
  exportPresentationGif,
  GifExportCancelled,
  GIF_SPEED_CHOICES,
  GIF_WIDTH_CHOICES,
  MAX_GIF_FRAMES,
  type GifQuality,
} from '../../export/gif';
import { hydrateDocumentImages } from '../../persistence/imageBlobs';
import { actions } from '../../state/actions';
import { useDerived } from '../../state/derived';
import { depthFirstOrder, useAppStore } from '../../state/store';
import { Icon } from '../common/Icon';
import { Modal } from './Modal';

const QUALITIES: { value: GifQuality; label: string }[] = [
  { value: 'fast', label: 'Fast' },
  { value: 'balanced', label: 'Balanced' },
  { value: 'best', label: 'Best' },
];

/** Presentation → frames → GIF. Everything runs locally; nothing is uploaded. */
export function GifDialog() {
  const derived = useDerived();
  const doc = derived.doc;
  const presentationOrder = useAppStore((s) => s.ui.presentation.order);
  const [width, setWidth] = useState<number>(800);
  const [quality, setQuality] = useState<GifQuality>('balanced');
  const [delay, setDelay] = useState<number>(1000);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const explicit = doc ? doc.settings.presentationOrder.filter((id) => !!doc.nodes[id]) : [];
  const order = doc
    ? (presentationOrder.length ? presentationOrder : explicit.length ? explicit : depthFirstOrder(doc))
    : [];
  const frames = Math.min(order.length, MAX_GIF_FRAMES);
  const sampled = order.length > MAX_GIF_FRAMES;

  const close = () => {
    if (abortRef.current) {
      abortRef.current.abort();
      // The in-dialog message is unmounted with the dialog, so confirm here.
      actions.toast('GIF export cancelled — no file was downloaded', 'info');
    }
    actions.closeDialog();
  };

  const start = async () => {
    if (!doc || !order.length || running) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    setProgress(0);
    setMessage('');
    setError('');
    try {
      const { sources: imageSources } = await hydrateDocumentImages(doc);
      const result = await exportPresentationGif(
        {
          doc,
          order,
          positions: derived.positions,
          sizes: derived.sizes,
          visibleIds: derived.visibleIds,
          palette: derived.palette,
          branchIndices: derived.branchIndices,
          imageSources,
        },
        {
          width,
          quality,
          frameDelayMs: delay,
          signal: controller.signal,
          onProgress: (done, total) => setProgress(total ? done / total : 0),
        },
      );
      actions.toast(`GIF exported — ${result.frames} frames, ${Math.round(result.bytes / 1024)} KB`, 'success');
      setMessage(
        `Saved ${result.frames} frames at ${result.width}×${result.height}` +
        (result.sampled ? ' (evenly sampled from a longer presentation)' : '') + '.',
      );
    } catch (caught) {
      if (caught instanceof GifExportCancelled || controller.signal.aborted) {
        setMessage('Export cancelled — no file was downloaded.');
      } else {
        const text = caught instanceof Error ? caught.message : 'GIF export failed';
        setError(text);
        actions.toast(`GIF export failed — ${text}`, 'error');
      }
    } finally {
      setRunning(false);
      // Only clear our own controller: a second run must not lose its abort handle.
      if (abortRef.current === controller) abortRef.current = null;
    }
  };

  return (
    <Modal
      title="Export presentation as GIF"
      subtitle="One frame per presentation step, generated in this browser"
      icon="presentation"
      width={520}
      onClose={close}
      footer={
        <>
          <button type="button" className="btn btn-sm" onClick={close}>{running ? 'Cancel' : 'Close'}</button>
          <div className="spacer" />
          {running && (
            <button type="button" className="btn btn-sm is-danger" onClick={() => abortRef.current?.abort()}>
              Stop export
            </button>
          )}
          <button type="button" className="btn btn-primary" disabled={!doc || !frames || running} onClick={() => void start()}>
            <Icon name="download" size={14} /> {running ? 'Exporting…' : 'Export GIF'}
          </button>
        </>
      }
    >
      <p className="panel-note">
        {frames ? `${frames} frame${frames === 1 ? '' : 's'}` : 'No steps'} will be encoded
        {sampled ? ` — long presentations are evenly sampled to stay under ${MAX_GIF_FRAMES} frames` : ''}.
        Frames are painted one at a time, so the interface stays responsive and the export can be cancelled.
      </p>

      <div className="setting-row">
        <div><strong>Resolution</strong><span>Output width; height follows the map's aspect ratio</span></div>
        <div className="segmented">
          {GIF_WIDTH_CHOICES.map((value) => (
            <button key={value} type="button" disabled={running} aria-pressed={width === value} className={width === value ? 'is-active' : ''} onClick={() => setWidth(value)}>{value}px</button>
          ))}
        </div>
      </div>
      <div className="setting-row">
        <div><strong>Quality</strong><span>Number of colours kept per frame</span></div>
        <div className="segmented">
          {QUALITIES.map((item) => (
            <button key={item.value} type="button" disabled={running} aria-pressed={quality === item.value} className={quality === item.value ? 'is-active' : ''} onClick={() => setQuality(item.value)}>{item.label}</button>
          ))}
        </div>
      </div>
      <div className="setting-row">
        <div><strong>Frame duration</strong><span>How long each step stays on screen</span></div>
        <div className="segmented">
          {GIF_SPEED_CHOICES.map((value) => (
            <button key={value} type="button" disabled={running} aria-pressed={delay === value} className={delay === value ? 'is-active' : ''} onClick={() => setDelay(value)}>{(value / 1000).toFixed(value < 1000 ? 2 : 1)}s</button>
          ))}
        </div>
      </div>

      {running && (
        <div className="gif-export__progress" role="status" aria-live="polite">
          <div className="presentation-progress"><span style={{ width: `${Math.round(progress * 100)}%` }} /></div>
          <span>{Math.round(progress * 10) * 10}% · {frames} frames</span>
        </div>
      )}
      {message && <p className="dialog-note"><Icon name="check" size={13} /> {message}</p>}
      {error && <p className="dialog-note dialog-note--error"><Icon name="alert" size={13} /> {error}</p>}
      <p className="dialog-note"><Icon name="info" size={13} /> Encoding uses gifenc (MIT) on your device. No map data leaves the browser.</p>
    </Modal>
  );
}
