import { Component, type ErrorInfo, type ReactNode } from 'react';
import { documentToJson } from '../../export/json';
import { store } from '../../state/store';
import { downloadBlob, safeFilename } from '../../utils/common';
import { Icon } from './Icon';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
  info: string;
}

/**
 * Last line of defence against a render-time crash. The document still lives in the
 * external store, so the user can download a full-fidelity backup before reloading.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: '' };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Atlas render error', error, info.componentStack);
    this.setState({ info: info.componentStack ?? '' });
  }

  private backup = (): void => {
    const doc = store.getState().history.present;
    if (!doc) return;
    downloadBlob(
      new Blob([documentToJson(doc)], { type: 'application/json;charset=utf-8' }),
      `${safeFilename(doc.title)}-recovery.json`,
    );
  };

  render(): ReactNode {
    const { error, info } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="crash-screen" role="alert">
        <div className="crash-screen__card">
          <span className="crash-screen__icon"><Icon name="alert" size={26} /></span>
          <h1>Atlas hit an unexpected error</h1>
          <p>
            Your map is still in browser memory. Download a JSON backup first, then reload.
            Nothing has been deleted.
          </p>
          <pre className="crash-screen__detail">{error.message}{info ? `\n${info.split('\n').slice(0, 4).join('\n')}` : ''}</pre>
          <div className="btn-row">
            <button type="button" className="btn btn-primary" onClick={this.backup}>
              <Icon name="download" size={14} /> Download backup
            </button>
            <button type="button" className="btn" onClick={() => window.location.reload()}>
              <Icon name="refresh" size={14} /> Reload Atlas
            </button>
            <button type="button" className="btn btn-sm" onClick={() => this.setState({ error: null, info: '' })}>
              Try to continue
            </button>
          </div>
        </div>
      </div>
    );
  }
}
