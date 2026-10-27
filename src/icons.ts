import type { ModuleKind } from "./types";

const PATHS: Record<ModuleKind, string> = {
  armor: '<path d="M6 4.5h12v7.2c0 3.6-2.5 6.4-6 8.3-3.5-1.9-6-4.7-6-8.3V4.5z"/>',
  tracks: '<path d="M4 7.5h16M4 12h16M4 16.5h16"/>',
  power: '<path d="M13 3.5 6.5 13H12l-1 7.5L18 11h-5.5L13 3.5z"/>',
  fuel: '<path d="M12 3.5s5 5.2 5 8.6a5 5 0 0 1-10 0c0-3.4 5-8.6 5-8.6z"/>',
  engine: '<circle cx="12" cy="12" r="3.2"/><path d="M12 4.5v2.2M12 17.3v2.2M4.5 12h2.2M17.3 12h2.2M6.8 6.8l1.6 1.6M15.6 15.6l1.6 1.6M17.2 6.8l-1.6 1.6M8.4 15.6l-1.6 1.6"/>',
  weapon: '<path d="M5 14.5V9.5h8l6-3v11l-6-3H5z"/>',
};

export function iconSvg(kind: ModuleKind): string {
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${PATHS[kind]}</svg>`;
}
