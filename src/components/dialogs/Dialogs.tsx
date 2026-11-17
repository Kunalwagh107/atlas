import { useDialog } from '../../state/store';
import { AboutDialog, DeleteConfirmDialog, ImportDialog, NewMapDialog, RenameDialog, SaveAsDialog } from './SimpleDialogs';
import { ExportDialog } from './ExportDialog';
import { OpenDialog } from './OpenDialog';
import { SettingsDialog } from './SettingsDialog';
import { ShortcutsDialog } from './ShortcutsDialog';
import { HistoryDialog, ImportErrorDialog, PresentationDialog, UnsavedDialog } from './ExtraDialogs';
import { GifDialog } from './GifDialog';

export function Dialogs() {
  const dialog = useDialog();
  if (!dialog) return null;
  switch (dialog) {
    case 'new': return <NewMapDialog />;
    case 'open': return <OpenDialog />;
    case 'rename': return <RenameDialog />;
    case 'saveAs': return <SaveAsDialog />;
    case 'import': return <ImportDialog />;
    case 'export': return <ExportDialog />;
    case 'settings': return <SettingsDialog />;
    case 'shortcuts': return <ShortcutsDialog />;
    case 'deleteConfirm': return <DeleteConfirmDialog />;
    case 'about': return <AboutDialog />;
    case 'history': return <HistoryDialog />;
    case 'presentation': return <PresentationDialog />;
    case 'gif': return <GifDialog />;
    case 'unsaved': return <UnsavedDialog />;
    case 'importError': return <ImportErrorDialog />;
    default:
      return null;
  }
}
