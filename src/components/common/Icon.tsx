import type { ReactNode, SVGProps } from 'react';

/** A compact, consistent 24px stroke icon set (no external icon dependency). */
const PATHS: Record<string, ReactNode> = {
  plus: <><path d="M12 5v14M5 12h14" /></>,
  minus: <path d="M5 12h14" />,
  x: <><path d="M18 6 6 18M6 6l12 12" /></>,
  'file-plus': <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6M12 18v-6M9 15h6" /></>,
  'folder-open': <><path d="M6 3h5l2 2h5a2 2 0 0 1 2 2v2" /><path d="M4 9h16l-2 10H4z" /><path d="M4 9V5a2 2 0 0 1 2-2" /></>,
  save: <><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /><path d="M17 21v-8H7v8M7 3v5h8" /></>,
  undo: <><path d="M3 7v6h6" /><path d="M3.5 13a9 9 0 1 0 2.2-6.4L3 9" /></>,
  redo: <><path d="M21 7v6h-6" /><path d="M20.5 13a9 9 0 1 1-2.2-6.4L21 9" /></>,
  'zoom-in': <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5M10.5 7.5v6M7.5 10.5h6" /></>,
  'zoom-out': <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5M7.5 10.5h6" /></>,
  fit: <><path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M3 16v3a2 2 0 0 0 2 2h3" /><rect x="8" y="8" width="8" height="8" rx="1.5" /></>,
  center: <><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /><circle cx="12" cy="12" r="8" strokeDasharray="2 3" /></>,
  search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
  moon: <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" />,
  download: <><path d="M12 3v12M7 10l5 5 5-5" /><path d="M4 17v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" /></>,
  upload: <><path d="M12 16V4M7 9l5-5 5 5" /><path d="M4 17v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></>,
  trash: <><path d="M3 6h18M8 6V4h8v2M19 6l-1 15H6L5 6" /><path d="M10 11v6M14 11v6" /></>,
  edit: <><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></>,
  copy: <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></>,
  duplicate: <><rect x="3" y="3" width="12" height="12" rx="2" /><path d="M9 15v4a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-4" /></>,
  link: <><path d="M10 13a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7-7l-1 1" /><path d="M14 11a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7 7l1-1" /></>,
  collapse: <><path d="m9 8-4 4 4 4M15 8l4 4-4 4" /><path d="M12 4v16" strokeDasharray="2 3" /></>,
  expand: <><path d="m13 8 4 4-4 4M11 8l-4 4 4 4" /><path d="M12 4v16" strokeDasharray="2 3" /></>,
  layout: <><rect x="3" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="16" width="7" height="5" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /><path d="M6.5 8v8M17.5 8v8" /></>,
  radial: <><circle cx="12" cy="12" r="3" /><circle cx="12" cy="3" r="2" /><circle cx="21" cy="12" r="2" /><circle cx="12" cy="21" r="2" /><circle cx="3" cy="12" r="2" /><path d="M12 5v4M19 12h-4M12 15v4M9 12H5" /></>,
  horizontal: <><rect x="2" y="9" width="6" height="6" rx="1.5" /><rect x="16" y="3" width="6" height="5" rx="1.5" /><rect x="16" y="16" width="6" height="5" rx="1.5" /><path d="M8 12h4v-6.5h4M12 12v6.5h4" /></>,
  vertical: <><rect x="9" y="2" width="6" height="6" rx="1.5" /><rect x="2" y="16" width="6" height="5" rx="1.5" /><rect x="16" y="16" width="6" height="5" rx="1.5" /><path d="M12 8v4H5.5v4M12 12h6.5v4" /></>,
  grid: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
  list: <><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></>,
  tree: <><rect x="2" y="9" width="6" height="6" rx="1.5" /><rect x="16" y="3" width="6" height="5" rx="1.5" /><rect x="16" y="16" width="6" height="5" rx="1.5" /><path d="M8 12h4V5.5h4M12 12v6.5h4" /></>,
  'panel-left': <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M9 3v18" /></>,
  'panel-right': <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M15 3v18" /></>,
  check: <path d="m4 12 5 5L20 6" />,
  'chevron-right': <path d="m9 6 6 6-6 6" />,
  'chevron-left': <path d="m15 6-6 6 6 6" />,
  'chevron-down': <path d="m6 9 6 6 6-6" />,
  'chevron-up': <path d="m6 15 6-6 6 6" />,
  'arrow-up': <path d="M12 20V4m-6 6 6-6 6 6" />,
  'arrow-down': <path d="M12 4v16m-6-6 6 6 6-6" />,
  spark: <><path d="m12 2 1.9 6.1L20 10l-6.1 1.9L12 18l-1.9-6.1L4 10l6.1-1.9z" /><path d="m19 17 .7 2.3L22 20l-2.3.7L19 23l-.7-2.3L16 20l2.3-.7z" /></>,
  book: <><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></>,
  bulb: <><path d="M9 18h6M10 22h4" /><path d="M12 2a7 7 0 0 0-4 12.7V18h8v-3.3A7 7 0 0 0 12 2z" /></>,
  target: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1.5" /></>,
  diamond: <path d="m12 2 9 10-9 10-9-10z" />,
  layers: <><path d="m12 2 9 5-9 5-9-5z" /><path d="m3 12 9 5 9-5M3 17l9 5 9-5" /></>,
  note: <><path d="M4 4h16v12l-4 4H4z" /><path d="M20 16h-4v4M8 9h8M8 13h5" /></>,
  star: <path d="m12 2 3 6.5 7 .9-5.2 4.8 1.4 6.8L12 17.7 5.8 21l1.4-6.8L2 9.4l7-.9z" />,
  circle: <circle cx="12" cy="12" r="8" />,
  help: <><circle cx="12" cy="12" r="9" /><path d="M9.5 9a2.5 2.5 0 1 1 3.4 2.3c-.9.4-1.4 1-1.4 2" /><path d="M12 17h.01" /></>,
  alert: <><path d="M10.3 3.5 2 18a2 2 0 0 0 1.7 3h16.6a2 2 0 0 0 1.7-3L13.7 3.5a2 2 0 0 0-3.4 0z" /><path d="M12 9v4M12 17h.01" /></>,
  branch: <><circle cx="6" cy="5" r="2" /><circle cx="18" cy="6" r="2" /><circle cx="18" cy="18" r="2" /><path d="M6 7v10a3 3 0 0 0 3 3h7M8 12h8" /></>,
  keyboard: <><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 13h.01M10 13h.01M14 13h.01M18 13h.01M8 16h8" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>,
  eye: <><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>,
  'eye-off': <><path d="M3 3l18 18M10.6 10.6a3 3 0 0 0 2.8 2.8" /><path d="M9.9 5.2A10.9 10.9 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-2.2 3.1M6.6 6.6A17 17 0 0 0 2 12s3.6 7 10 7a10.8 10.8 0 0 0 4-.7" /></>,
  palette: <><path d="M12 3a9 9 0 1 0 0 18h1.5a2 2 0 0 0 1.5-3.3 2 2 0 0 1 1.5-3.2H19a2 2 0 0 0 2-2 9 9 0 0 0-9-9z" /><path d="M7.5 11h.01M10 7.5h.01M14.5 7.5h.01M17 11h.01" /></>,
  refresh: <><path d="M21 12a9 9 0 1 1-2.6-6.4" /><path d="M21 3v6h-6" /></>,
  focus: <><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" /><path d="M12 1v3M12 20v3M1 12h3M20 12h3" /></>,
  image: <><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="m21 15-5-5L5 21" /></>,
  code: <><path d="m8 8-4 4 4 4M16 8l4 4-4 4M14 4l-4 16" /></>,
  file: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6M8 13h8M8 17h5" /></>,
  printer: <><path d="M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" /><path d="M6 14h12v7H6z" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  more: <><circle cx="5" cy="12" r="1.4" /><circle cx="12" cy="12" r="1.4" /><circle cx="19" cy="12" r="1.4" /></>,
  drag: <><circle cx="9" cy="6" r="1.2" /><circle cx="15" cy="6" r="1.2" /><circle cx="9" cy="12" r="1.2" /><circle cx="15" cy="12" r="1.2" /><circle cx="9" cy="18" r="1.2" /><circle cx="15" cy="18" r="1.2" /></>,
  map: <><path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3z" /><path d="M9 3v15M15 6v15" /></>,
  'external-link': <><path d="M14 3h7v7M21 3l-9 9" /><path d="M19 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5" /></>,
  'mouse-pointer': <path d="m4 3 7 17 2.5-6.5L20 11z" />,
  command: <><path d="M9 6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3z" /></>,
  brackets: <><path d="M8 4H6a2 2 0 0 0-2 2v4a2 2 0 0 1-2 2 2 2 0 0 1 2 2v4a2 2 0 0 0 2 2h2M16 4h2a2 2 0 0 1 2 2v4a2 2 0 0 0 2 2 2 2 0 0 0-2 2v4a2 2 0 0 1-2 2h-2" /></>,
  tag: <><path d="M20 12 12 20 3 11V4h7z" /><circle cx="7.5" cy="8.5" r="1.2" /></>,
  pin: <><path d="M12 17v5" /><path d="M9 3h6l-1 6 3 3v2H7v-2l3-3z" /></>,
  play: <path d="m7 4 13 8-13 8z" />,
  pause: <><path d="M8 4v16M16 4v16" /></>,
  'skip-back': <><path d="M18 5 7 12l11 7z" /><path d="M5 5v14" /></>,
  'skip-forward': <><path d="m6 5 11 7-11 7z" /><path d="M19 5v14" /></>,
  history: <><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /><path d="M12 7v5l4 2" /></>,
  filter: <><path d="M3 5h18l-7 8v6l-4 2v-8z" /></>,
  lasso: <><path d="M4 12a8 6 0 1 0 16 0 8 6 0 1 0-16 0" strokeDasharray="3 3" /><path d="M12 18v3" /></>,
  'align-left': <><path d="M4 3v18M8 7h12M8 12h8M8 17h12" /></>,
  'align-center': <><path d="M12 3v18M6 7h12M8 12h8M5 17h14" /></>,
  'align-right': <><path d="M20 3v18M4 7h12M8 12h8M4 17h12" /></>,
  'align-top': <><path d="M3 4h18M7 8v12M12 8v8M17 8v12" /></>,
  'align-middle': <><path d="M3 12h18M7 5v14M12 8v8M17 5v14" /></>,
  'align-bottom': <><path d="M3 20h18M7 4v12M12 8v8M17 4v12" /></>,
  distribute: <><path d="M3 4v16M21 4v16" /><rect x="8" y="8" width="3" height="8" rx="1" /><rect x="14" y="8" width="3" height="8" rx="1" /></>,
  group: <><rect x="3" y="3" width="8" height="8" rx="1.5" /><rect x="13" y="13" width="8" height="8" rx="1.5" /><path d="M11 7h5a2 2 0 0 1 2 2v4" /></>,
  presentation: <><rect x="2" y="4" width="20" height="13" rx="2" /><path d="M12 17v4M8 21h8M10 9l5 3-5 3z" /></>,
};

export type IconName = keyof typeof PATHS | string;

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName;
  size?: number;
  strokeWidth?: number;
}

export function Icon({ name, size = 16, strokeWidth = 1.8, ...rest }: IconProps) {
  const content = PATHS[name] ?? PATHS.circle;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {content}
    </svg>
  );
}
