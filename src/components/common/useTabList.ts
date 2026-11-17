import { useCallback, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react';

/**
 * Shared ARIA tab behaviour: roving tabindex (only the active tab is a tab stop),
 * Left/Right (and Up/Down) plus Home/End navigation, and the id wiring that ties
 * each tab to its panel. Panels stay mounted and are hidden with `hidden`, which
 * keeps their scroll position and drafts alive while switching.
 */
export interface TabListOptions<T extends string> {
  ids: readonly T[];
  active: T;
  onChange: (id: T) => void;
  /** Prefix for the generated tab/panel ids (must be unique per tab list). */
  base: string;
}

export function useTabList<T extends string>({ ids, active, onChange, base }: TabListOptions<T>) {
  const refs = useRef(new Map<T, HTMLButtonElement | null>());

  const register = useCallback((id: T) => (element: HTMLButtonElement | null) => {
    refs.current.set(id, element);
  }, []);

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>) => {
      const index = Math.max(0, ids.indexOf(active));
      let next: T | null = null;
      switch (event.key) {
        case 'ArrowRight':
        case 'ArrowDown':
          next = ids[(index + 1) % ids.length];
          break;
        case 'ArrowLeft':
        case 'ArrowUp':
          next = ids[(index - 1 + ids.length) % ids.length];
          break;
        case 'Home':
          next = ids[0];
          break;
        case 'End':
          next = ids[ids.length - 1];
          break;
        default:
          return;
      }
      event.preventDefault();
      onChange(next);
      // The new tab becomes the tab stop; focus follows selection.
      requestAnimationFrame(() => refs.current.get(next!)?.focus());
    },
    [active, ids, onChange],
  );

  const tabProps = (id: T) => ({
    id: `${base}-tab-${id}`,
    role: 'tab' as const,
    'aria-selected': active === id,
    'aria-controls': `${base}-panel-${id}`,
    tabIndex: active === id ? 0 : -1,
    ref: register(id),
    onKeyDown,
  });

  const panelProps = (id: T) => ({
    id: `${base}-panel-${id}`,
    role: 'tabpanel' as const,
    'aria-labelledby': `${base}-tab-${id}`,
    tabIndex: 0,
    hidden: active !== id,
  });

  return { tabProps, panelProps, onKeyDown };
}
