/** Behavior group. Add a member here, then give it an icon and (if it needs new rules) a stat key. */
export type ModuleKind = "armor" | "tracks" | "power" | "fuel" | "engine" | "weapon";

/**
 * Numeric contributions of one placed block.
 * Every field is optional so a new module can set only what it changes.
 * `powerUse` is demand; `power` is supply. Weapons should set both damage and powerUse.
 */
export interface ModuleStats {
  hp?: number;
  speed?: number;
  turn?: number;
  fuel?: number;
  power?: number;
  powerUse?: number;
  damage?: number;
  fireRate?: number;
}

export interface ModuleDef {
  id: string;
  kind: ModuleKind;
  name: string;
  /** Always available in the garage. Shop modules set this false and list themselves in SHOP_ITEMS. */
  starter: boolean;
  color: string;
  /** Short stat line shown on the palette card. */
  blurb: string;
  stats: ModuleStats;
  /** Footprint along the hull. Row 0 of the footprint is the front. Defaults to 1×1. */
  rows?: number;
  cols?: number;
  /** Plate HP for this block. Armor uses this instead of the shared armor plate. */
  plate?: number;
  /** Seconds a shot from this weapon stays alive. Defaults to the small-cannon range. */
  shotLife?: number;
  /** Draws power and fixes other blocks while something on the tank is hurt. */
  repairs?: boolean;
  /** Launches one drone at a time while it has power. */
  drone?: boolean;
  /** Adds a rechargeable shield bubble. Extra copies stack. */
  generator?: boolean;
}

export type ShopItem =
  | { kind: "module"; moduleId: string; cost: number; name: string; tagline: string }
  | { kind: "hull"; hullId: string; cost: number; name: string; tagline: string };

export interface SaveData {
  version: 1;
  currency: number;
  /** Module and hull ids unlocked from the shop, not including starters. */
  unlocked: string[];
  /** Which owned hull is open in the garage and driven in battle. */
  hull: string;
  /** One layout per hull. Row 0 is the front. A cell is a module id, or `id@row,col` when several cells are one part. */
  layouts: Record<string, (string | null)[][]>;
  /** How many rivals have been beaten in order. 0 leaves only Rookie open. */
  botsBeaten: number;
}

export interface TankStats {
  /** Core HP. Armor is ablative plate HP, not part of this pool. */
  hp: number;
  /** How many armor blocks are still mounted. */
  plates: number;
  speed: number;
  turn: number;
  fuel: number;
  power: number;
  powerUse: number;
  /** Average damage of one projectile. */
  damage: number;
  /** Sum of every mounted weapon's damage (one salvo). */
  salvoDamage: number;
  /** Salvos per second after the power supply is applied. */
  fireRate: number;
  weaponCount: number;
  /** 0..1. Below 1, fire rate is reduced. 0 means cannons have no power. */
  powerFactor: number;
}
