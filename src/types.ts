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
}

export interface ShopItem {
  moduleId: string;
  cost: number;
  tagline: string;
}

export interface SaveData {
  version: 1;
  currency: number;
  /** Module ids unlocked from the shop, not including starters. */
  unlocked: string[];
  /** Row 0 is the front of the hull. Cells hold a module id or null. */
  grid: (string | null)[][];
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
