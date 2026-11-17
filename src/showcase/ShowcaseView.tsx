import { useEffect, useRef } from 'react';
import { Icon } from '../components/common/Icon';
import { useAppStore } from '../state/store';
import { ShowcaseContent } from './ShowcasePage';
import './showcase-embedded.css';

export function ShowcaseView({ onClose }: { onClose: () => void }) {
  const backRef = useRef<HTMLButtonElement>(null);
  const theme = useAppStore((s) => s.ui.theme);

  useEffect(() => {
    backRef.current?.focus();
  }, []);

  return (
    <section className="showcase-view" aria-label="Atlas product tour">
      <div className="showcase-view__bar">
        <button ref={backRef} type="button" className="showcase-view__back" onClick={onClose}>
          <Icon name="chevron-left" size={15} /> Back to workspace
        </button>
        <span className="showcase-view__title">
          <Icon name="book" size={15} /> Product tour
        </span>
        <span className="showcase-view__hint">A quick look at what Atlas keeps local</span>
      </div>
      <div className="showcase-view__scroll">
        <div className="showcase showcase--embedded">
          <ShowcaseContent embedded onStart={onClose} theme={theme} />
        </div>
      </div>
    </section>
  );
}
