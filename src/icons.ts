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

const BY_ID: Record<string, string> = {
  "heavy-armor":
    '<path d="M5 4h14v8c0 4-3 6.8-7 8.6C8 18.8 5 16 5 12V4z"/><path d="M8 8h.5M12 8h.5M16 8h.5M8 12h.5M12 12h.5M16 12h.5"/>',
  "repair-bay": '<path d="M12 4.5v15M4.5 12h15"/><circle cx="12" cy="12" r="3.2"/>',
  "medium-cannon": '<path d="M6 15h12v5.2H6z"/><path d="M9.2 15V2.8h5.6V15"/>',
  "heavy-cannon":
    '<path d="M6.2 16.2h11.6v5H6.2z"/><path d="M8 16.2V2.4h8V16.2"/><path d="M6.4 2.2h11.2v2.6H6.4z"/><path d="M8.6 7.2h6.8M8.6 11h6.8"/>',
  "robot-bay":
    '<rect x="3.5" y="3.5" width="17" height="17" rx="1"/><path d="M8 14.5h8v4.2H8z"/><path d="M10.6 14.5V8.2h2.8v6.3"/>',
  "shield-gen": '<circle cx="12" cy="12" r="8"/><path d="M12 7.2v9.6M8.4 12h7.2"/>',
  harpoon:
    '<path d="M12 2.2 8.2 7.2h2.2V14H13.6V7.2H15.8L12 2.2z"/><path d="M7 15.2h10v4.2H7z"/><path d="M9.2 15.2V11h5.6v4.2"/>',
  cutter:
    '<circle cx="12" cy="12" r="6.2"/><path d="M12 4.2v2.4M12 17.4v2.4M4.2 12h2.4M17.4 12h2.4M6.4 6.4l1.7 1.7M15.9 15.9l1.7 1.7M17.6 6.4l-1.7 1.7M8.1 15.9l-1.7 1.7"/><circle cx="12" cy="12" r="1.6"/>',
};

export function iconSvg(kind: ModuleKind, id?: string): string {
  const body = (id && BY_ID[id]) || PATHS[kind];
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;
}
