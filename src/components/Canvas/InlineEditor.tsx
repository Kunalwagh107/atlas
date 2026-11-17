import { useEffect, useRef, useState } from 'react';
import type { MeasuredNode } from '../../core/layout/measure';
import type { MindNode, Point } from '../../core/mindmap/types';
import type { Viewport } from '../../state/types';
import { worldToScreen } from './viewport';

export interface InlineEditorProps {
  node: MindNode;
  position?: Point;
  size: MeasuredNode;
  viewport: Viewport;
  /** Matches the map's typography so the editor does not visually jump on mount. */
  fontFamily?: string;
  onCommit: (title: string) => void;
  onCancel: () => void;
}

export function InlineEditor({ node, position, size, viewport, fontFamily, onCommit, onCancel }: InlineEditorProps) {
  const [value, setValue] = useState(node.title);
  const ref = useRef<HTMLTextAreaElement>(null);
  const committed = useRef(false);
  /** False only while the editor is genuinely gone (not StrictMode's test unmount). */
  const live = useRef(true);
  const valueRef = useRef(value);
  valueRef.current = value;
  const commitRef = useRef(onCommit);
  commitRef.current = onCommit;
  const originalRef = useRef(node.title);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.focus();
    element.select();
  }, []);

  const commit = () => {
    if (committed.current) return;
    committed.current = true;
    const clean = valueRef.current.replace(/\s*\n\s*/g, ' ').trim();
    if (clean) commitRef.current(clean);
    else commitRef.current(originalRef.current);
  };

  /**
   * Unmounting does not reliably fire `blur` (clicking empty canvas removes the
   * textarea while it holds focus), so commit on teardown as well — otherwise the
   * typed text is silently discarded.
   *
   * The commit is deferred by a microtask because React's StrictMode runs
   * mount → cleanup → mount in development; committing synchronously in cleanup
   * would mark the editor as already committed before the user types.
   */
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      queueMicrotask(() => {
        if (live.current || committed.current) return;
        committed.current = true;
        const clean = valueRef.current.replace(/\s*\n\s*/g, ' ').trim();
        if (clean && clean !== originalRef.current) commitRef.current(clean);
      });
    };
  }, []);

  const center = worldToScreen(position ?? node.position, viewport);
  const left = center.x - (size.width / 2) * viewport.zoom;
  const top = center.y - (size.height / 2) * viewport.zoom;

  return (
    <textarea
      ref={ref}
      className="inline-editor"
      value={value}
      aria-label="Edit node title"
      spellCheck={false}
      style={{
        left,
        top,
        width: Math.max(120, size.width * viewport.zoom),
        minHeight: Math.max(38, size.height * viewport.zoom),
        fontSize: Math.max(12, Math.min(40, size.fontSize * viewport.zoom)),
        fontFamily,
        fontWeight: node.style.fontWeight,
        borderRadius: node.style.borderRadius * viewport.zoom,
      }}
      onChange={(event) => setValue(event.target.value)}
      onBlur={commit}
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Escape') {
          committed.current = true;
          onCancel();
        } else if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault();
          commit();
        }
      }}
    />
  );
}
