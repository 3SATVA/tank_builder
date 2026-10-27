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
    blurb: "32 plate",
    stats: {},
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

/** Bare core before any blocks. Armor does not add to this; it soaks hits on its own cell. */
export const BASE_HULL = {
  hp: 70,
  speed: 28,
  turn: 18,
  fuel: 36,
} as const;

export const GRID_COLS = 7;
export const GRID_ROWS = 5;
export const TURRET_SIZE = 3;
export const ARMOR_PLATE = 32;
export const MODULE_PLATE = 16;

/** Top-left cell of the centered 3×3 turret. */
export function turretOrigin(cols = GRID_COLS, rows = GRID_ROWS): { c: number; r: number } {
  return {
    c: Math.floor((cols - TURRET_SIZE) / 2),
    r: Math.floor((rows - TURRET_SIZE) / 2),
  };
}

export function isTurretCell(row: number, col: number, cols = GRID_COLS, rows = GRID_ROWS): boolean {
  const origin = turretOrigin(cols, rows);
  return col >= origin.c && col < origin.c + TURRET_SIZE && row >= origin.r && row < origin.r + TURRET_SIZE;
}

/** How much damage a block soaks before it pops off. Armor soaks more than anything else. */
export function blockPlate(moduleId: string): number {
  const mod = getModule(moduleId);
  if (!mod) return 0;
  return mod.kind === "armor" ? ARMOR_PLATE : MODULE_PLATE;
}

export function cloneGrid(grid: ReadonlyArray<ReadonlyArray<string | null>>): (string | null)[][] {
  return grid.map((row) => row.slice());
}

/**
 * 7×5 box. Row 0 is the front. The centered 3×3 (rows 1–3, cols 2–4) is the turret.
 * Two cannons sit on the hull and fire with the hull; two sit on the turret and aim.
 * Two power cells exactly feed the four cannons.
 */
export function createDefaultGrid(): (string | null)[][] {
  return [
    [null, "armor", "cannon", "armor", "cannon", "armor", null],
    ["tracks", "engine", "cannon", null, "cannon", "engine", "tracks"],
    [null, "fuel", "armor", "power", "armor", "fuel", null],
    [null, "fuel", null, "power", null, "fuel", null],
    ["armor", "tracks", null, "armor", null, "tracks", "armor"],
  ];
}

/** Same module rules as the player. A future online rival is just another grid. */
export function createRivalGrid(): (string | null)[][] {
  return createDefaultGrid();
}
