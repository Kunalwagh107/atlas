export interface ShortcutItem {
  keys: string[];
  label: string;
}

export interface ShortcutGroup {
  title: string;
  icon: string;
  items: ShortcutItem[];
}

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: 'Nodes & editing',
    icon: 'plus',
    items: [
      { keys: ['Tab', 'on a node'], label: 'Add a child to the focused node' },
      { keys: ['Insert'], label: 'Add a child to the selection (canvas focus)' },
      { keys: ['Enter'], label: 'Add a sibling node' },
      { keys: ['F2'], label: 'Edit the selected node' },
      { keys: ['Double-click'], label: 'Edit a node / add a node on empty canvas' },
      { keys: ['Delete'], label: 'Delete the selected node and its branch' },
      { keys: ['C'], label: 'Collapse or expand the selected branch' },
      { keys: ['Ctrl', 'L'], label: 'Create a connection from the selected node' },
      { keys: ['↑', '↓', '←', '→'], label: 'Navigate between nodes' },
      { keys: ['Shift', 'Click'], label: 'Add a node to the selection' },
      { keys: ['Right-drag'], label: 'Marquee-select many nodes' },
      { keys: ['Drag corner'], label: 'Resize the selected node' },
      { keys: ['Marquee'], label: 'Left-drag lasso (toggle the lasso button)' },
      { keys: ['Enter', 'on a node'], label: 'Select a focused node (SVG nodes are tabbable)' },
      { keys: ['Shift', 'F'], label: 'Focus on the selected branch / exit focus' },
    ],
  },
  {
    title: 'History & clipboard',
    icon: 'undo',
    items: [
      { keys: ['Ctrl', 'Z'], label: 'Undo' },
      { keys: ['Ctrl', 'Shift', 'Z'], label: 'Redo' },
      { keys: ['Ctrl', 'C'], label: 'Copy the selected branch' },
      { keys: ['Ctrl', 'V'], label: 'Paste the branch as a child' },
      { keys: ['Ctrl', 'D'], label: 'Duplicate the selected branch' },
    ],
  },
  {
    title: 'View & navigation',
    icon: 'fit',
    items: [
      { keys: ['Wheel'], label: 'Zoom at the pointer' },
      { keys: ['+'], label: 'Zoom in' },
      { keys: ['−'], label: 'Zoom out' },
      { keys: ['F'], label: 'Fit map to screen' },
      { keys: ['Home'], label: 'Center on the central topic' },
      { keys: ['0'], label: 'Reset view (100% and centered)' },
      { keys: ['Space', 'Drag'], label: 'Pan with the space bar' },
      { keys: ['Drag canvas'], label: 'Pan by dragging empty canvas' },
      { keys: ['Right-click'], label: 'Open the context menu (no drag)' },
      { keys: ['P'], label: 'Open presentation mode' },
      { keys: ['→', '←', 'Space'], label: 'Next / previous presentation step' },
      { keys: ['Pinch'], label: 'Zoom on touch devices' },
    ],
  },
  {
    title: 'Files & search',
    icon: 'file',
    items: [
      { keys: ['Ctrl', 'N'], label: 'New map' },
      { keys: ['Ctrl', 'O'], label: 'Open a saved map' },
      { keys: ['Ctrl', 'S'], label: 'Save' },
      { keys: ['Ctrl', 'Shift', 'S'], label: 'Save as a copy' },
      { keys: ['Ctrl', 'E'], label: 'Export (opens options)' },
      { keys: ['Ctrl', 'F'], label: 'Search nodes' },
      { keys: ['?'], label: 'Show this shortcut list' },
      { keys: ['Esc'], label: 'Clear selection / close dialog / cancel link' },
    ],
  },
];
