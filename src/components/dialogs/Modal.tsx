import { useEffect, useRef, type ReactNode } from 'react';
import { Icon } from '../common/Icon';

export interface ModalProps {
  title: string;
  subtitle?: string;
  icon?: string;
  width?: number;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Modal({ title, subtitle, icon, width = 480, onClose, children, footer }: ModalProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  // Keep the latest close handler without re-running the focus effect on every render.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const items = () => Array.from(cardRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])
      .filter((element) => element.getClientRects().length > 0);

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        closeRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = items();
      if (!focusable.length) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const inside = cardRef.current?.contains(document.activeElement) ?? false;
      // aria-modal="true" is only honest if Tab cannot escape the dialog.
      if (event.shiftKey && (!inside || document.activeElement === first)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (!inside || document.activeElement === last)) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKey, true);
    // Focus the first control without stealing focus from an actively typing input.
    const first = items()[0];
    if (first && (document.activeElement === document.body || !cardRef.current?.contains(document.activeElement))) {
      first.focus();
    }
    return () => {
      document.removeEventListener('keydown', onKey, true);
      previous?.focus?.();
    };
  }, []);

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={cardRef}
        className="modal"
        style={{ width }}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="modal__head">
          {icon && <span className="modal__icon"><Icon name={icon} size={18} /></span>}
          <div className="modal__headings">
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button type="button" className="icon-btn" aria-label="Close dialog" onClick={onClose}>
            <Icon name="x" size={17} />
          </button>
        </div>
        <div className="modal__body">{children}</div>
        {footer && <div className="modal__footer">{footer}</div>}
      </div>
    </div>
  );
}
