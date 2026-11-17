import { actions } from '../../state/actions';
import { controller } from '../../state/controller';
import { Icon } from '../common/Icon';
import { TemplateGrid } from './TemplateGrid';

export function EmptyState() {
  const choose = (id: string | 'blank') => {
    if (id === 'blank') controller.createBlank();
    else controller.createFromTemplate(id);
  };

  return (
    <div className="empty-state">
      <div className="empty-state__card">
        <div className="empty-state__hero">
          <div className="empty-state__mark">
            <Icon name="branch" size={28} strokeWidth={1.6} />
          </div>
          <span className="chip chip-accent"><Icon name="spark" size={12} /> Your thinking space</span>
          <h1>Create your first mind map</h1>
          <p>Start with a blank canvas or pick a starter template. Everything you create is saved in this browser — no account needed.</p>
          <div className="empty-state__actions">
            <button type="button" className="btn btn-primary btn-lg" onClick={() => choose('blank')}>
              <Icon name="plus" size={16} /> Create Blank Map
            </button>
            <button type="button" className="btn btn-lg" onClick={() => actions.openDialog('open')}>
              <Icon name="folder-open" size={16} /> Open existing
            </button>
            <button type="button" className="btn btn-lg" onClick={() => actions.openDialog('import')}>
              <Icon name="upload" size={16} /> Import JSON
            </button>
            <button type="button" className="btn btn-lg" onClick={() => actions.setUI({ showcaseOpen: true })}>
              <Icon name="book" size={16} /> Take the tour
            </button>
          </div>
        </div>

        <div className="empty-state__templates">
          <div className="empty-state__label"><span>Templates</span><span className="faint">A head start for any kind of thinking</span></div>
          <TemplateGrid onSelect={choose} compact />
        </div>

        <div className="empty-state__footer">
          <span><Icon name="keyboard" size={14} /> <kbd className="kbd">Tab</kbd> add child · <kbd className="kbd">Enter</kbd> add sibling · <kbd className="kbd">F</kbd> fit view</span>
          <button type="button" className="link-btn" onClick={() => actions.openDialog('shortcuts')}>See all shortcuts</button>
        </div>
      </div>
    </div>
  );
}
