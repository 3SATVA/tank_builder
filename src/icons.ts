import type { ModuleKind } from "./types";

const PATHS: Record<ModuleKind, string> = {
  armor: '<path d="M6 4.5h12v7.2c0 3.6-2.5 6.4-6 8.3-3.5-1.9-6-4.7-6-8.3V4.5z"/>',
  tracks: '<path d="M4 7.5h16M4 12h16M4 16.5h16"/>',
  power: '<path d="M13 3.5 6.5 13H12l-1 7.5L18 11h-5.5L13 3.5z"/>',
  fuel: '<path d="M12 3.5s5 5.2 5 8.6a5 5 0 0 1-10 0c0-3.4 5-8.6 5-8.6z"/>',
  engine:
    '<path d="M5 11h14v7H5z"/><path d="M7 11V6.2h2.4V11M10.8 11V5h2.4v6M14.6 11V6.8h2.4V11"/><path d="M8 18v3.2M16 18v3.2"/>',
  weapon: '<path d="M7.5 13.5h9v6h-9z"/><path d="M10.2 13.5V4.2h3.6v9.3"/>',
};

export function iconSvg(kind: ModuleKind): string {
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${PATHS[kind]}</svg>`;
}
