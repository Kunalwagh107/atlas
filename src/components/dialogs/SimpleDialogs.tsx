import { useEffect, useState } from 'react';
import { mapRepository } from '../../persistence/indexeddb';
import { actions } from '../../state/actions';
import { controller } from '../../state/controller';
import { useDerived } from '../../state/derived';
import { useAppStore } from '../../state/store';
import { Icon } from '../common/Icon';
import { Modal } from './Modal';
import { TemplateGrid } from './TemplateGrid';

export function NewMapDialog() {
  const choose = (id: string | 'blank') => {
    if (id === 'blank') controller.createBlank();
    else controller.createFromTemplate(id);
    actions.closeDialog();
  };
  return (
    <Modal title="Create a new mind map" subtitle="Start blank or pick a structured starting point" icon="file-plus" width={680} onClose={() => actions.closeDialog()}>
      <TemplateGrid onSelect={choose} compact />
      <p className="dialog-note"><Icon name="info" size={13} /> Your current map is saved automatically. Creating a new one will not delete it.</p>
    </Modal>
  );
}

export function RenameDialog() {
  const derived = useDerived();
  const [title, setTitle] = useState(derived.doc?.title ?? '');
  const submit = () => {
    if (title.trim()) actions.setTitle(title);
    void controller.save();
    actions.closeDialog();
    actions.toast('Map renamed', 'success');
  };
  return (
    <Modal
      title="Rename map"
      subtitle="Give this map a clear, searchable name"
      icon="edit"
      width={420}
      onClose={() => actions.closeDialog()}
      footer={<><div className="spacer" /><button type="button" className="btn" onClick={() => actions.closeDialog()}>Cancel</button><button type="button" className="btn btn-primary" onClick={submit}>Save name</button></>}
    >
      <div className="field">
        <label className="field-label" htmlFor="rename-input">Map title</label>
        <input id="rename-input" className="input" autoFocus value={title} onChange={(event) => setTitle(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') submit(); }} />
      </div>
    </Modal>
  );
}

export function SaveAsDialog() {
  const derived = useDerived();
  const [title, setTitle] = useState(`${derived.doc?.title ?? 'Untitled map'} (copy)`);
  return (
    <Modal
      title="Save as"
      subtitle="Creates an independent copy in your browser storage"
      icon="save"
      width={420}
      onClose={() => actions.closeDialog()}
      footer={<><div className="spacer" /><button type="button" className="btn" onClick={() => actions.closeDialog()}>Cancel</button><button type="button" className="btn btn-primary" onClick={() => void controller.saveAs(title)}>Save copy</button></>}
    >
      <div className="field">
        <label className="field-label" htmlFor="saveas-input">New map name</label>
        <input id="saveas-input" className="input" autoFocus value={title} onChange={(event) => setTitle(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void controller.saveAs(title); }} />
      </div>
    </Modal>
  );
}

export function ImportDialog() {
  const [text, setText] = useState('');
  const [aiText, setAiText] = useState('');
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = async (file: File) => {
    setBusy(true);
    await controller.importFile(file);
    setBusy(false);
  };

  return (
    <Modal
      title="Import a mind map"
      subtitle="JSON, Markdown, OPML, CSV or FreeMind .mm — validated before opening"
      icon="upload"
      width={520}
      onClose={() => actions.closeDialog()}
      footer={<><div className="spacer" /><button type="button" className="btn" onClick={() => actions.closeDialog()}>Cancel</button><button type="button" className="btn btn-primary" disabled={!text.trim() || busy} onClick={async () => { setBusy(true); await controller.importText(text); setBusy(false); }}>Import JSON</button></>}
    >
      <div
        className={`dropzone ${dragging ? 'is-dragging' : ''}`}
        onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setDragging(false);
          const file = event.dataTransfer.files[0];
          if (file) void load(file);
        }}
      >
        <Icon name="upload" size={24} />
        <strong>Drop a map file here</strong>
        <span>or choose a file from your computer</span>
        <label className="btn btn-sm">
          Choose file
          <input type="file" accept=".json,.txt,.md,.markdown,.opml,.csv,.mm,.xml,application/json,text/markdown,text/csv" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void load(file); }} />
        </label>
      </div>
      <div className="field">
        <label className="field-label" htmlFor="import-json">Or paste JSON</label>
        <textarea id="import-json" className="textarea mono" rows={5} placeholder='{ "version": 2, "nodes": [], "edges": [] }' value={text} onChange={(event) => setText(event.target.value)} />
      </div>
      <details className="ai-import">
        <summary><Icon name="spark" size={13} /> Paste an AI-generated outline</summary>
        <p className="panel-note">
          Accepts a loose outline such as <code>{'{ "title": "…", "root": { "title": "…", "children": […] } }'}</code>.
          Every value is validated, length-limited and normalised against the Atlas schema before opening —
          no untrusted structure can reach the canvas.
        </p>
        <textarea
          className="textarea mono"
          rows={5}
          aria-label="AI-generated outline JSON"
          placeholder='{ "title": "Project plan", "root": { "title": "Plan", "children": ["Research", "Build"] } }'
          value={aiText}
          onChange={(event) => setAiText(event.target.value)}
        />
        <button type="button" className="btn btn-sm btn-primary" disabled={!aiText.trim() || busy} onClick={async () => { setBusy(true); await controller.importAIOutline(aiText); setBusy(false); }}>
          <Icon name="check" size={13} /> Validate &amp; open
        </button>
      </details>
      <p className="dialog-note"><Icon name="info" size={13} /> Imported maps are validated and repaired automatically. The original file is never modified.</p>
    </Modal>
  );
}

export function DeleteConfirmDialog() {
  const pendingId = useAppStore((s) => s.ui.pendingDeleteMapId);
  const [title, setTitle] = useState('this map');
  useEffect(() => {
    if (!pendingId) return;
    void mapRepository.list().then((list) => {
      setTitle(list.find((item) => item.id === pendingId)?.title ?? 'this map');
    });
  }, [pendingId]);

  return (
    <Modal
      title="Delete this map?"
      icon="trash"
      width={420}
      onClose={() => actions.openDialog('open')}
      footer={<><div className="spacer" /><button type="button" className="btn" onClick={() => actions.openDialog('open')}>Cancel</button><button type="button" className="btn btn-danger" onClick={() => { if (pendingId) void controller.remove(pendingId).then(() => actions.openDialog('open')); }}>Delete permanently</button></>}
    >
      <div className="danger-note">
        <Icon name="alert" size={20} />
        <div>
          <strong>“{title}” will be removed from this browser.</strong>
          <p>This cannot be undone. Export a JSON backup first if you want to keep a copy.</p>
        </div>
      </div>
    </Modal>
  );
}

export function AboutDialog() {
  return (
    <Modal title="About Atlas" subtitle="A focused workspace for visual thinking" icon="info" width={470} onClose={() => actions.closeDialog()}>
      <div className="about">
        <div className="about__brand"><span className="brand__mark"><Icon name="branch" size={22} /></span><div><strong>Atlas</strong><span>Mind map workspace · version 1.0</span></div></div>
        <p>Atlas is a local-first mind-mapping application. Your maps live in your browser's IndexedDB — nothing is sent to a server. You can export full-fidelity JSON at any time.</p>
        <ul>
          <li><Icon name="layout" size={14} /> Four automatic layouts: mind map, horizontal, vertical and radial</li>
          <li><Icon name="link" size={14} /> Hierarchy plus free-form cross-connections</li>
          <li><Icon name="download" size={14} /> JSON, SVG, PNG and PDF export</li>
          <li><Icon name="keyboard" size={14} /> Full keyboard workflow with application-level undo/redo</li>
        </ul>
        <button type="button" className="btn btn-sm" onClick={() => actions.openDialog('shortcuts')}><Icon name="keyboard" size={14} /> View keyboard shortcuts</button>
      </div>
    </Modal>
  );
}
