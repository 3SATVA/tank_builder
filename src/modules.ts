import { PAL } from "./palette";
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
    color: PAL.blue,
    blurb: "48 plate",
    stats: {},
  },
  {
    id: "tracks",
    kind: "tracks",
    name: "Tracks",
    starter: true,
    color: PAL.steel,
    blurb: "+22 turning",
    stats: { turn: 22 },
  },
  {
    id: "power",
    kind: "power",
    name: "Power",
    starter: true,
    color: PAL.gold,
    blurb: "+3 power",
    stats: { power: 3 },
  },
  {
    id: "fuel",
    kind: "fuel",
    name: "Fuel",
    starter: true,
    color: PAL.orange,
    blurb: "+36 fuel",
    stats: { fuel: 36 },
  },
  {
    id: "engine",
    kind: "engine",
    name: "Engine",
    starter: true,
    color: PAL.red,
    blurb: "+30 speed",
    stats: { speed: 30 },
  },
  {
    id: "cannon",
    kind: "weapon",
    name: "Cannon",
    starter: true,
    color: PAL.teal,
    blurb: "16 dmg · 0.62/s · 1 power",
    stats: { damage: 16, fireRate: 0.62, powerUse: 1 },
    shotLife: 1.15,
  },
  {
    id: "medium-cannon",
    kind: "weapon",
    name: "Medium Cannon",
    starter: false,
    color: PAL.tealDark,
    blurb: "42 dmg · 2 cells · 3 power",
    stats: { damage: 42, fireRate: 0.5, powerUse: 3 },
    rows: 2,
    cols: 1,
    plate: 48,
    shotLife: 2.2,
  },
  {
    id: "repair-bay",
    kind: "power",
    name: "Repair Bay",
    starter: false,
    color: PAL.green,
    blurb: "fixes blocks · uses 2",
    stats: { powerUse: 2 },
    repairs: true,
  },
  {
    id: "harpoon",
    kind: "weapon",
    name: "Harpoon",
    starter: false,
    color: PAL.tan,
    blurb: "22 dmg · pulls · uses 3",
    stats: { damage: 22, fireRate: 0.4, powerUse: 3 },
    rows: 2,
    cols: 1,
    plate: 40,
    shotLife: 1.5,
    hook: true,
  },
  {
    id: "cutter",
    kind: "weapon",
    name: "Cutter",
    starter: false,
    color: PAL.steel,
    blurb: "saws on contact · uses 2",
    stats: { powerUse: 2 },
    plate: 36,
    cutter: true,
  },
  {
    id: "heavy-armor",
    kind: "armor",
    name: "Heavy Armor",
    starter: false,
    color: PAL.blueDark,
    blurb: "100 plate · −16 speed",
    stats: { speed: -16, turn: -6 },
    plate: 100,
  },
  {
    id: "heavy-cannon",
    kind: "weapon",
    name: "Heavy Cannon",
    starter: false,
    color: PAL.sand,
    blurb: "64 dmg · 3 cells · 5 power",
    stats: { damage: 64, fireRate: 0.48, powerUse: 5 },
    rows: 3,
    cols: 1,
    plate: 64,
    shotLife: 3.5,
  },
  {
    id: "robot-bay",
    kind: "power",
    name: "Robot Bay",
    starter: false,
    color: PAL.gray,
    blurb: "launches a drone · uses 5",
    stats: { powerUse: 5 },
    rows: 2,
    cols: 2,
    plate: 48,
    drone: true,
  },
  {
    id: "shield-gen",
    kind: "power",
    name: "Shield Generator",
    starter: false,
    color: PAL.blue,
    blurb: "bubble · diminishing · uses 4",
    stats: { powerUse: 4 },
    rows: 2,
    cols: 2,
    plate: 48,
    generator: true,
  },
  {
    id: "boss-armor",
    kind: "armor",
    name: "Boss Armor",
    starter: false,
    boss: true,
    color: "#1a0c10",
    blurb: "boss plate",
    stats: { speed: -12, turn: -4 },
    plate: 120,
  },
  {
    id: "reactor",
    kind: "power",
    name: "Reactor",
    starter: false,
    boss: true,
    color: "#ff2438",
    blurb: "boss power",
    stats: { power: 12 },
    plate: 80,
  },
  {
    id: "mega-cannon",
    kind: "weapon",
    name: "Mega Cannon",
    starter: false,
    boss: true,
    color: "#8a1020",
    blurb: "boss gun",
    stats: { damage: 160, fireRate: 0.45, powerUse: 9 },
    rows: 3,
    cols: 1,
    plate: 72,
    shotLife: 4.6,
  },
  {
    id: "boss-grapple",
    kind: "weapon",
    name: "Boss Grapple",
    starter: false,
    boss: true,
    color: "#c81830",
    blurb: "boss harpoon",
    stats: { damage: 140, fireRate: 1, powerUse: 4 },
    rows: 2,
    cols: 1,
    plate: 96,
    shotLife: 2.4,
    hook: true,
  },
  {
    id: "super-shield",
    kind: "power",
    name: "Super Shield",
    starter: false,
    boss: true,
    color: "#3a1020",
    blurb: "boss bubble",
    stats: { powerUse: 6 },
    rows: 2,
    cols: 2,
    plate: 70,
    generator: true,
    shieldHp: 140,
  },
];

/**
 * Scrap price for the newest shop batch: Heavy Cannon, Robot Bay, Gun Deck,
 * and Shield Generator. Change this one number to reprice all four.
 */
export const NEW_SHOP_COST = 50;

/**
 * A few wins (50 scrap each) buy the first block. The hull costs a bit more.
 * Heavy armor is the cheapest so it is the first thing a new pilot can afford.
 */
export const SHOP_ITEMS: readonly ShopItem[] = [
  {
    kind: "module",
    moduleId: "harpoon",
    cost: NEW_SHOP_COST,
    name: "Harpoon",
    tagline: "Two cells in a line. Fires a short-range spear along the mount, hull or turret. A hit does moderate damage and reels the enemy in. Slow reload. Draws 3 power.",
  },
  {
    kind: "module",
    moduleId: "cutter",
    cost: NEW_SHOP_COST,
    name: "Cutter",
    tagline: "A spinning blade. Enemy blocks and drones that touch it take damage the whole time they stay in contact. Draws 1 power.",
  },
  {
    kind: "module",
    moduleId: "heavy-cannon",
    cost: NEW_SHOP_COST,
    name: "Heavy Cannon",
    tagline: "Three cells in a line, like a longer Medium Cannon. Bigger shell, longer range, slower fire, and a high power draw. All three cells sit on the hull, or all three sit in the turret.",
  },
  {
    kind: "module",
    moduleId: "robot-bay",
    cost: NEW_SHOP_COST,
    name: "Robot Bay",
    tagline: "A 2×2 bay. In battle it launches one small drone that drives itself, steers around cover, and shoots the enemy. The rival can destroy it. Draws 6 power. Unpowered bays do not launch.",
  },
  {
    kind: "hull",
    hullId: "gun-deck",
    cost: NEW_SHOP_COST,
    name: "Gun Deck",
    tagline: "No turret. Six blocks wide and seven long, with more bays than the standard hull. Every gun is bolted to the hull and the aim stick still fires. Starts empty.",
  },
  {
    kind: "module",
    moduleId: "shield-gen",
    cost: NEW_SHOP_COST,
    name: "Shield Generator",
    tagline: "A 2×2 generator. A bubble around the tank soaks hits before modules do, then recharges after a delay. Each extra generator adds shield and recharges faster. Draws 3 power.",
  },
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
    tagline: "Every few seconds, restores the most hurt block or rebuilds a destroyed one. Draws 2 power whenever it is mounted.",
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
  return MODULES.filter((mod) => !mod.boss && (mod.starter || owned.has(mod.id)));
}

/** Bare hull before any blocks. Armor soaks hits on its own cell and does not add a separate pool. */
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
  cols: number;
  rows: number;
  /** Short label on the shop card. */
  mark: string;
  /** Top-left cell of the 3×3 turret. Null when every gun is mounted on the hull. */
  turret: { r: number; c: number } | null;
  /** More 3×3 turrets that aim with the main one. */
  extraTurrets?: { r: number; c: number }[];
  /** Campaign only. Hidden from the shop and the garage, and rejected by PvP. */
  boss?: boolean;
}

export const HULLS: readonly HullDef[] = [
  {
    id: "standard",
    name: "Standard",
    blurb: "Turret in the middle.",
    starter: true,
    cols: GRID_COLS,
    rows: GRID_ROWS,
    mark: "Std",
    turret: { r: 2, c: 1 },
  },
  {
    id: "rear",
    name: "Rear turret",
    blurb: "Turret toward the back. More hull in front.",
    starter: false,
    cols: GRID_COLS,
    rows: GRID_ROWS,
    mark: "Rear",
    turret: { r: 4, c: 1 },
  },
  {
    id: "gun-deck",
    name: "Gun deck",
    blurb: "No turret. 6 wide, 7 long. Guns fire with the hull.",
    starter: false,
    cols: 6,
    rows: 7,
    mark: "Deck",
    turret: null,
  },
  {
    id: "citadel",
    name: "Citadel",
    blurb: "Boss hull. Two turrets.",
    starter: false,
    boss: true,
    cols: 7,
    rows: 9,
    mark: "Boss",
    turret: { r: 1, c: 2 },
    extraTurrets: [{ r: 5, c: 2 }],
  },
];

const HULL_BY_ID = new Map(HULLS.map((hull) => [hull.id, hull]));

export function getHull(id: string): HullDef | undefined {
  return HULL_BY_ID.get(id);
}

export function hullsFor(unlocked: readonly string[]): HullDef[] {
  const owned = new Set(unlocked);
  return HULLS.filter((hull) => !hull.boss && (hull.starter || owned.has(hull.id)));
}

export function isBossModule(id: string | null | undefined): boolean {
  return Boolean(id && getModule(id)?.boss);
}

export function isBossHull(id: string | null | undefined): boolean {
  return Boolean(id && getHull(id)?.boss);
}

/** Every 3×3 on this hull, main turret first. */
export function turretOrigins(hull = "standard"): { r: number; c: number }[] {
  const spec = getHull(hull);
  if (!spec?.turret) return [];
  return [spec.turret, ...(spec.extraTurrets ?? [])];
}

/** The 3×3 that contains this cell, if it sits on a turret. */
export function turretAt(row: number, col: number, hull = "standard"): { r: number; c: number } | null {
  return (
    turretOrigins(hull).find(
      (origin) => col >= origin.c && col < origin.c + TURRET_SIZE && row >= origin.r && row < origin.r + TURRET_SIZE,
    ) ?? null
  );
}

export function hullSize(hull = "standard"): { cols: number; rows: number } {
  const spec = getHull(hull);
  return { cols: spec?.cols ?? GRID_COLS, rows: spec?.rows ?? GRID_ROWS };
}

export function hasTurret(hull = "standard"): boolean {
  return Boolean(getHull(hull)?.turret);
}

/** Top-left cell of this hull's 3×3 turret, or null when the hull has no turret. */
export function turretOrigin(hull = "standard"): { c: number; r: number } | null {
  const spec = getHull(hull);
  if (!spec) return HULLS[0].turret;
  return spec.turret;
}

export function isTurretCell(row: number, col: number, _cols = GRID_COLS, _rows = GRID_ROWS, hull = "standard"): boolean {
  return turretAt(row, col, hull) !== null;
}

export type PartRole = "single" | "front" | "mid" | "rear" | "nw" | "ne" | "sw" | "se";

/** Which piece of a multi-cell part this bay is. Front is the muzzle end. */
export function partRole(token: string | null, row: number, col: number): PartRole {
  const mod = getModule(moduleIdOf(token) ?? "");
  if (!token || !mod) return "single";
  const anchor = token.split("@")[1];
  if (!anchor) return "single";
  const [ar, ac] = anchor.split(",").map((part) => Number(part));
  const dr = row - (ar ?? row);
  const dc = col - (ac ?? col);
  const rows = mod.rows ?? 1;
  const spanCols = mod.cols ?? 1;
  if (rows > 1 && spanCols === 1) {
    if (dr <= 0) return "front";
    if (dr >= rows - 1) return "rear";
    return "mid";
  }
  if (rows > 1 && spanCols > 1) {
    if (dr <= 0 && dc <= 0) return "nw";
    if (dr <= 0) return "ne";
    if (dc <= 0) return "sw";
    return "se";
  }
  return "single";
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

/** Empty bays for a hull. Bought hulls and their Reset button use this. */
export function emptyGrid(hull = "standard"): (string | null)[][] {
  const size = hullSize(hull);
  return Array.from({ length: size.rows }, () => Array.from({ length: size.cols }, () => null));
}

export function gridHasModules(grid: ReadonlyArray<ReadonlyArray<string | null>>): boolean {
  return grid.some((row) => row.some((cell) => moduleIdOf(cell)));
}

/** Why this layout cannot start a fight, or null when it has a weapon and a power block. */
export function outfitProblem(grid: ReadonlyArray<ReadonlyArray<string | null>>): string | null {
  let weapons = 0;
  let power = 0;
  for (let r = 0; r < grid.length; r += 1) {
    for (let c = 0; c < (grid[r]?.length ?? 0); c += 1) {
      const token = grid[r][c];
      if (!isAnchorCell(token, r, c)) continue;
      const mod = getModule(moduleIdOf(token) ?? "");
      if (!mod) continue;
      if (mod.kind === "weapon") weapons += 1;
      if (mod.kind === "power") power += 1;
    }
  }
  if (weapons > 0 && power > 0) return null;
  if (weapons === 0 && power === 0) return "Mount a weapon and a power block before you fight.";
  if (weapons === 0) return "Mount a weapon before you fight.";
  return "Mount a power block before you fight.";
}

/**
 * 5 wide × 7 long. Row 0 is the front, so the long axis is the direction the hull drives and hull guns fire.
 * The starter hull ships with a working loadout, including a weapon and a power block.
 * Every other hull starts blank. A tank falls when its last weapon or its last power block is gone.
 * Standard turret is rows 2–4. Rear turret is rows 4–6.
 */
export function createDefaultGrid(hull = "standard"): (string | null)[][] {
  const spec = getHull(hull);
  if (spec && !spec.starter) return emptyGrid(hull);
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

