import { useEffect, useRef, useState } from 'react';
import { LAYOUTS, type LayoutKind } from '../../core/mindmap/types';
import { mapRepository } from '../../persistence/indexeddb';
import { actions } from '../../state/actions';
import { controller } from '../../state/controller';
import { useDerived } from '../../state/derived';
import { useAppStore } from '../../state/store';
import { useStorageUsage } from '../common/useStorageUsage';
import { formatBytes, storageWarning } from '../../persistence/storageUsage';
import { Icon } from '../common/Icon';
import { Modal } from './Modal';

export function SettingsDialog() {
  const theme = useAppStore((s) => s.ui.theme);
  const autoSave = useAppStore((s) => s.ui.autoSave);
  const hints = useAppStore((s) => s.ui.showShortcutHints);
  const derived = useDerived();
  const [mapCount, setMapCount] = useState(0);
  const [versionCount, setVersionCount] = useState(0);
  const [confirmClear, setConfirmClear] = useState(false);
  const usage = useStorageUsage();
  const warning = storageWarning(usage);
  const restoreRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void mapRepository.list().then((list) => setMapCount(list.length));
    if (derived.doc) void controller.listVersions(derived.doc.id).then((list) => setVersionCount(list.length));
  }, [derived.doc]);

  return (
    <Modal title="Settings" subtitle="Preferences are stored on this device" icon="settings" width={500} onClose={() => actions.closeDialog()}>
      <div className="settings-group">
        <div className="settings-group__title">Appearance</div>
        <div className="setting-row">
          <div><strong>Theme</strong><span>Choose the canvas and interface palette</span></div>
          <div className="segmented">
            <button type="button" aria-pressed={theme === 'light'} className={theme === 'light' ? 'is-active' : ''} onClick={() => actions.setTheme('light')}><Icon name="sun" size={14} /> Light</button>
            <button type="button" aria-pressed={theme === 'dark'} className={theme === 'dark' ? 'is-active' : ''} onClick={() => actions.setTheme('dark')}><Icon name="moon" size={14} /> Dark</button>
          </div>
        </div>
        <div className="setting-row">
          <div><strong>Interface hints</strong><span>Show shortcut hints in tooltips and empty states</span></div>
          <label className="switch"><input type="checkbox" aria-label="Show interface hints" checked={hints} onChange={(event) => actions.setUI({ showShortcutHints: event.target.checked })} /><span className="switch-track" /></label>
        </div>
        {derived.doc && (
          <div className="setting-row">
            <div><strong>Animations</strong><span>Smooth zoom, fit and node transitions</span></div>
            <label className="switch"><input type="checkbox" aria-label="Enable animations" checked={derived.doc.settings.animated} onChange={(event) => actions.updateSettings({ animated: event.target.checked })} /><span className="switch-track" /></label>
          </div>
        )}
      </div>

      <div className="settings-group">
        <div className="settings-group__title">Saving</div>
        <div className="setting-row">
          <div><strong>Auto-save</strong><span>Write changes to browser storage shortly after each edit</span></div>
          <label className="switch"><input type="checkbox" aria-label="Enable auto-save" checked={autoSave} onChange={(event) => actions.setUI({ autoSave: event.target.checked })} /><span className="switch-track" /></label>
        </div>
        <div className="setting-row">
          <div><strong>Save now</strong><span>Force a save of the current map</span></div>
          <button type="button" className="btn btn-sm" disabled={!derived.doc} onClick={() => void controller.save()}><Icon name="save" size={13} /> Save</button>
        </div>
      </div>

      {derived.doc && (
        <div className="settings-group">
          <div className="settings-group__title">Default layout for this map</div>
          <div className="field">
            <select className="select" value={derived.doc.settings.layout} onChange={(event) => actions.changeLayout(event.target.value as LayoutKind)}>
              {LAYOUTS.map((layout) => <option key={layout.value} value={layout.value}>{layout.label} — {layout.description}</option>)}
            </select>
          </div>
        </div>
      )}

      <div className="settings-group">
        <div className="settings-group__title">Version history</div>
        <div className="setting-row">
          <div><strong>{versionCount} snapshot{versionCount === 1 ? '' : 's'} for this map</strong><span>40 automatic + 60 named snapshots are retained</span></div>
          <button type="button" className="btn btn-sm" disabled={!derived.doc || !versionCount} onClick={() => actions.openDialog('history')}>
            <Icon name="history" size={13} /> Manage
          </button>
        </div>
      </div>

      <div className="settings-group">
        <div className="settings-group__title">Backup &amp; move to another device</div>
        <div className="setting-row">
          <div><strong>Back up all maps</strong><span>Download every saved map as one JSON file</span></div>
          <button type="button" className="btn btn-sm" onClick={() => void controller.backupAll()}>
            <Icon name="download" size={13} /> Download backup
          </button>
        </div>
        <div className="setting-row">
          <div><strong>Restore a backup</strong><span>Imports the maps as copies — nothing is overwritten</span></div>
          <input
            ref={restoreRef}
            type="file"
            accept="application/json,.json"
            className="sr-only"
            aria-label="Restore backup file"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void controller.restoreBackup(file);
              event.target.value = '';
            }}
          />
          <button type="button" className="btn btn-sm" onClick={() => restoreRef.current?.click()}>
            <Icon name="upload" size={13} /> Restore…
          </button>
        </div>
      </div>

      <div className="settings-group">
        <div className="settings-group__title">Local storage</div>
        <div className="setting-row">
          <div>
            <strong>Browser storage</strong>
            <span>
              {usage
                ? `${formatBytes(usage.usage)} used of ${formatBytes(usage.quota)} (${Math.round(usage.ratio * 100)}%)`
                : 'Usage estimate is unavailable in this browser'}
            </span>
            {warning && <span className="field-error" role="status">{warning}</span>}
          </div>
          <button type="button" className="btn btn-sm" onClick={() => void controller.cleanUnusedImages()}>
            <Icon name="trash" size={13} /> Clean unused images
          </button>
        </div>
        <div className="setting-row">
          <div><strong>{mapCount} saved {mapCount === 1 ? 'map' : 'maps'}</strong><span>Stored in IndexedDB, scoped to this browser</span></div>
          <button
            type="button"
            className={`btn btn-sm ${confirmClear ? 'btn-danger' : ''}`}
            onClick={async () => {
              if (!confirmClear) { setConfirmClear(true); return; }
              await mapRepository.clear();
              actions.closeDoc();
              actions.toast('All local maps were removed', 'success');
            }}
          >
            <Icon name="trash" size={13} /> {confirmClear ? 'Confirm: delete all' : 'Clear all maps'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
