import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { buildDerived, type DerivedMap } from './derivedData';
import { useAppStore } from './store';

export type { DerivedMap, DerivedStats } from './derivedData';

const DerivedContext = createContext<DerivedMap>(buildDerived(null, 'light', null));

/**
 * Provides the derived map to the canvas, sidebar and exporters. The heavy
 * lifting lives in `derivedData.ts`, which reuses structural data and unchanged
 * measurements between document revisions (see `buildDerived`).
 */
export function DerivedProvider({ children }: { children: ReactNode }) {
  const doc = useAppStore((s) => s.history.present);
  const theme = useAppStore((s) => s.ui.theme);
  const focusRootId = useAppStore((s) => s.ui.focusRootId);

  const value = useMemo(() => buildDerived(doc, theme, focusRootId), [doc, theme, focusRootId]);

  return <DerivedContext.Provider value={value}>{children}</DerivedContext.Provider>;
}

export function useDerived(): DerivedMap {
  return useContext(DerivedContext);
}
