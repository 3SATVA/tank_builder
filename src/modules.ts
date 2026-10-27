import type { ModuleDef, ShopItem } from "./types";

/**
 * Catalog of every block the game knows about.
 * To add a module: append one object. The garage palette, stat sheet, saver,
 * and battle simulator all read this list — no other switch needs a new case
 * unless you introduce a brand new ModuleKind (then add an icon too).
 * Shop stock is SHOP_ITEMS.
 */
export const MODULES: readonly ModuleDef[] = [
  {
    id: "armor",
    kind: "armor",
    name: "Armor",
    starter: true,
    color: "#6f93b5",
    blurb: "48 plate",
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
  {
    id: "medium-cannon",
    kind: "weapon",
    name: "Medium Cannon",
    starter: false,
    color: "#148f86",
    blurb: "28 dmg · uses 4",
    stats: { damage: 28, fireRate: 0.3, powerUse: 4 },
    rows: 2,
    cols: 1,
    plate: 48,
    shotLife: 2.05,
  },
  {
    id: "repair-bay",
    kind: "power",
    name: "Repair Bay",
    starter: false,
    color: "#7dcf6a",
    blurb: "fixes blocks · uses 2",
    stats: { powerUse: 2 },
    repairs: true,
  },
  {
    id: "heavy-armor",
    kind: "armor",
    name: "Heavy Armor",
    starter: false,
    color: "#3e4c5c",
    blurb: "96 plate · −30 speed",
    stats: { speed: -30, turn: -12 },
    plate: 96,
  },
];

/**
 * A few wins (50 scrap each) buy the first block. The hull costs a bit more.
 * Heavy armor is the cheapest so it is the first thing a new pilot can afford.
 */
export const SHOP_ITEMS: readonly ShopItem[] = [
  {
    kind: "module",
    moduleId: "heavy-armor",
    cost: 150,
    name: "Heavy Armor",
    tagline: "Soaks 96 damage, about twice a normal plate. Each one cuts top speed and trims turning.",
  },
  {
    kind: "module",
    moduleId: "repair-bay",
    cost: 200,
    name: "Repair Bay",
    tagline: "Every few seconds, restores the most hurt block or rebuilds a destroyed one. Never the core. Draws 2 power while it is fixing.",
  },
  {
    kind: "module",
    moduleId: "medium-cannon",
    cost: 250,
    name: "Medium Cannon",
    tagline: "Occupies this bay and the one behind it. Thicker barrel, 28 damage, longer range, slower fire. Draws 4 power. Both cells must sit on the hull, or both inside the turret.",
  },
  {
    kind: "hull",
    hullId: "rear",
    cost: 300,
    name: "Rear Turret Tank",
    tagline: "Same 5×7 hull with the 3×3 turret set toward the back, leaving more hull in front of the guns. Keeps its own layout.",
  },
];

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

export const GRID_COLS = 5;
export const GRID_ROWS = 7;
export const TURRET_SIZE = 3;
export const ARMOR_PLATE = 48;
export const MODULE_PLATE = 32;

export interface HullDef {
  id: string;
  name: string;
  /** Shown under the hull switcher. */
  blurb: string;
  starter: boolean;
  /** Top-left cell of this hull's 3×3 turret on a 5×7 grid. */
  turret: { r: number; c: number };
}

export const HULLS: readonly HullDef[] = [
  {
    id: "standard",
    name: "Standard",
    blurb: "Turret in the middle.",
    starter: true,
    turret: { r: 2, c: 1 },
  },
  {
    id: "rear",
    name: "Rear turret",
    blurb: "Turret toward the back. More hull in front.",
    starter: false,
    turret: { r: 4, c: 1 },
  },
];

const HULL_BY_ID = new Map(HULLS.map((hull) => [hull.id, hull]));

export function getHull(id: string): HullDef | undefined {
  return HULL_BY_ID.get(id);
}

export function hullsFor(unlocked: readonly string[]): HullDef[] {
  const owned = new Set(unlocked);
  return HULLS.filter((hull) => hull.starter || owned.has(hull.id));
}

/** Top-left cell of this hull's 3×3 turret. */
export function turretOrigin(hull = "standard"): { c: number; r: number } {
  return getHull(hull)?.turret ?? HULLS[0].turret;
}

export function isTurretCell(row: number, col: number, cols = GRID_COLS, rows = GRID_ROWS, hull = "standard"): boolean {
  if (cols !== GRID_COLS || rows !== GRID_ROWS) {
    const origin = {
      c: Math.floor((cols - TURRET_SIZE) / 2),
      r: Math.floor((rows - TURRET_SIZE) / 2),
    };
    return col >= origin.c && col < origin.c + TURRET_SIZE && row >= origin.r && row < origin.r + TURRET_SIZE;
  }
  const origin = turretOrigin(hull);
  return col >= origin.c && col < origin.c + TURRET_SIZE && row >= origin.r && row < origin.r + TURRET_SIZE;
}

/** Center of the 3×3. A block here soaks first; an empty center takes core damage. */
export function isCoreCell(row: number, col: number, cols = GRID_COLS, rows = GRID_ROWS, hull = "standard"): boolean {
  const origin = cols === GRID_COLS && rows === GRID_ROWS
    ? turretOrigin(hull)
    : { c: Math.floor((cols - TURRET_SIZE) / 2), r: Math.floor((rows - TURRET_SIZE) / 2) };
  return row === origin.r + 1 && col === origin.c + 1;
}

export function moduleIdOf(value: string | null): string | null {
  if (!value) return null;
  const id = value.split("@")[0] ?? "";
  return getModule(id) ? id : null;
}

/** Anchor cells count once. A plain module id is its own anchor. */
export function isAnchorCell(value: string | null, row: number, col: number): boolean {
  if (!value || !moduleIdOf(value)) return false;
  const anchor = value.split("@")[1];
  if (!anchor) return true;
  return anchor === `${row},${col}`;
}

/** How much damage a block soaks before it pops off. */
export function blockPlate(moduleId: string): number {
  const mod = getModule(moduleIdOf(moduleId) ?? "");
  if (!mod) return 0;
  if (mod.plate) return mod.plate;
  return mod.kind === "armor" ? ARMOR_PLATE : MODULE_PLATE;
}

export function cloneGrid(grid: ReadonlyArray<ReadonlyArray<string | null>>): (string | null)[][] {
  return grid.map((row) => row.slice());
}

/**
 * 5 wide × 7 long. Row 0 is the front, so the long axis is the direction the hull drives and hull guns fire.
 * Standard turret is rows 2–4. Rear turret is rows 4–6, so more of the hull sits in front.
 * Two cannons sit on the front of the hull; two sit on the turret. Two power cells feed the four cannons.
 */
export function createDefaultGrid(hull = "standard"): (string | null)[][] {
  if (hull === "rear") {
    return [
      ["armor", "cannon", "armor", "cannon", "armor"],
      ["tracks", "engine", null, "engine", "tracks"],
      [null, "armor", null, "armor", null],
      [null, "fuel", null, "fuel", null],
      [null, "cannon", "armor", "cannon", null],
      ["fuel", null, "power", null, "fuel"],
      ["tracks", "armor", "power", "armor", "tracks"],
    ];
  }
  return [
    ["armor", "cannon", "armor", "cannon", "armor"],
    ["tracks", "engine", null, "engine", "tracks"],
    [null, "cannon", "armor", "cannon", null],
    ["fuel", null, "power", null, "fuel"],
    [null, "fuel", "power", "fuel", null],
    [null, "armor", null, "armor", null],
    ["armor", "tracks", null, "tracks", "armor"],
  ];
}

export interface RivalLoadout {
  hull: string;
  grid: (string | null)[][];
}

/** Mostly the starter hull. Sometimes a heavy plate, a repair bay, a single medium cannon, or the rear turret. */
export function createRivalLoadout(): RivalLoadout {
  const roll = Math.random();
  if (roll < 0.12) {
    const grid = createDefaultGrid("standard");
    grid[0][1] = "armor";
    grid[0][3] = "armor";
    grid[2][1] = "medium-cannon@2,1";
    grid[3][1] = "medium-cannon@2,1";
    grid[2][3] = null;
    return { hull: "standard", grid };
  }
  if (roll < 0.28) {
    const grid = createDefaultGrid("standard");
    grid[0][2] = "heavy-armor";
    return { hull: "standard", grid };
  }
  if (roll < 0.42) {
    const grid = createDefaultGrid("standard");
    grid[1][2] = "repair-bay";
    return { hull: "standard", grid };
  }
  if (roll < 0.55) return { hull: "rear", grid: createDefaultGrid("rear") };
  return { hull: "standard", grid: createDefaultGrid("standard") };
}
