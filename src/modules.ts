import type { ModuleDef, ShopItem } from "./types";

/**
 * Catalog of every block the game knows about.
 * To add a module: append one object. The garage palette, stat sheet, saver,
 * and battle simulator all read this list — no other switch needs a new case
 * unless you introduce a brand new ModuleKind (then add an icon too).
 * Shop stock is separate and currently empty on purpose.
 */
export const MODULES: readonly ModuleDef[] = [
  {
    id: "armor",
    kind: "armor",
    name: "Armor",
    starter: true,
    color: "#6f93b5",
    blurb: "+40 hull",
    stats: { hp: 40 },
  },
  {
    id: "tracks",
    kind: "tracks",
    name: "Tracks",
    starter: true,
    color: "#4d596c",
    blurb: "+36 turning",
    stats: { turn: 36 },
  },
  {
    id: "power",
    kind: "power",
    name: "Power",
    starter: true,
    color: "#f0b429",
    blurb: "+2 power",
    stats: { power: 2 },
  },
  {
    id: "fuel",
    kind: "fuel",
    name: "Fuel",
    starter: true,
    color: "#e07a3d",
    blurb: "+40 fuel",
    stats: { fuel: 40 },
  },
  {
    id: "engine",
    kind: "engine",
    name: "Engine",
    starter: true,
    color: "#e15a4a",
    blurb: "+44 speed",
    stats: { speed: 44 },
  },
  {
    id: "cannon",
    kind: "weapon",
    name: "Cannon",
    starter: true,
    color: "#2ec4b6",
    blurb: "+16 dmg · uses 1",
    stats: { damage: 16, fireRate: 0.55, powerUse: 1 },
  },
];

/** No stock yet. Push ShopItem entries here when new modules go on sale. */
export const SHOP_ITEMS: readonly ShopItem[] = [];

const BY_ID = new Map(MODULES.map((mod) => [mod.id, mod]));

export function getModule(id: string): ModuleDef | undefined {
  return BY_ID.get(id);
}

export function modulesFor(unlocked: readonly string[]): ModuleDef[] {
  const owned = new Set(unlocked);
  return MODULES.filter((mod) => mod.starter || owned.has(mod.id));
}

/** Bare hull before any blocks. Kept here so the sheet and the sim share one baseline. */
export const BASE_HULL = {
  hp: 50,
  speed: 28,
  turn: 18,
  fuel: 36,
} as const;

/**
 * 5×3 starter hull. Row 0 is the front. The center cell is power, which sits
 * under the turret. Two cannons draw 2 power and the single power block supplies 2.
 */
export function createDefaultGrid(): (string | null)[][] {
  return [
    ["cannon", "armor", "armor", "armor", "cannon"],
    ["tracks", "engine", "power", "engine", "tracks"],
    ["tracks", "fuel", "armor", "fuel", "tracks"],
  ];
}
