import { SHORTCUT_GROUPS } from '../../state/shortcuts';
import { actions } from '../../state/actions';
import { Icon } from '../common/Icon';
import { Modal } from './Modal';

export function ShortcutsDialog() {
  return (
    <Modal title="Keyboard shortcuts" subtitle="Work without leaving the keyboard" icon="keyboard" width={680} onClose={() => actions.closeDialog()}>
      <div className="shortcuts-grid">
        {SHORTCUT_GROUPS.map((group) => (
          <section key={group.title} className="shortcuts-group">
            <h3><Icon name={group.icon} size={15} /> {group.title}</h3>
            <ul>
              {group.items.map((item, index) => (
                <li key={`${item.label}-${index}`}>
                  <span>{item.label}</span>
                  <span className="shortcuts-keys">
                    {item.keys.map((key) => <kbd key={key} className="kbd">{key}</kbd>)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      <p className="dialog-note"><Icon name="info" size={13} /> On macOS, use ⌘ in place of Ctrl. Shortcuts are ignored while typing in a field.</p>
    </Modal>
  );
}
