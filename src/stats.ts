import { BASE_HULL, getModule, isAnchorCell, moduleIdOf } from "./modules";
import type { ModuleDef, TankStats } from "./types";

export interface PowerPlan {
  /** Sum of power cells. */
  supply: number;
  /** Sum of every module's draw, powered or not. */
  demand: number;
  /** Anchor keys (`row,col`) that received power. Zero-draw parts are not listed; they always run. */
  powered: Set<string>;
}

function drawPriority(mod: ModuleDef): number {
  if (mod.kind === "weapon") return 0;
  if (mod.generator) return 1;
  if (mod.repairs) return 2;
  if (mod.drone) return 3;
  return 4;
}

/** Weapons, then shields, then repair, then robot bays. Ties keep front-to-back, left-to-right order. */
export function powerPlan(grid: ReadonlyArray<ReadonlyArray<string | null>>): PowerPlan {
  let supply = 0;
  const loads: { key: string; cost: number; priority: number; index: number }[] = [];
  let index = 0;
  for (let r = 0; r < grid.length; r += 1) {
    for (let c = 0; c < (grid[r]?.length ?? 0); c += 1) {
      const token = grid[r][c];
      if (!isAnchorCell(token, r, c)) continue;
      const mod = getModule(moduleIdOf(token) ?? "");
      if (!mod) continue;
      supply += mod.stats.power ?? 0;
      const cost = mod.stats.powerUse ?? 0;
      if (cost <= 0) continue;
      loads.push({ key: `${r},${c}`, cost, priority: drawPriority(mod), index });
      index += 1;
    }
  }
  loads.sort((a, b) => a.priority - b.priority || a.index - b.index);
  const powered = new Set<string>();
  let left = supply;
  let demand = 0;
  for (const load of loads) {
    demand += load.cost;
    if (left < load.cost) continue;
    left -= load.cost;
    powered.add(load.key);
  }
  return { supply, demand, powered };
}

export function anchorKey(token: string | null, row: number, col: number): string {
  const anchor = token?.split("@")[1];
  return anchor && /^\d+,\d+$/.test(anchor) ? anchor : `${row},${col}`;
}

/** A part with no draw always runs. A part with a draw runs only when the budget paid for it. */
export function cellPowered(plan: PowerPlan, token: string | null, row: number, col: number): boolean {
  const mod = getModule(moduleIdOf(token) ?? "");
  if (!mod || (mod.stats.powerUse ?? 0) <= 0) return true;
  return plan.powered.has(anchorKey(token, row, col));
}

export interface Mobility {
  tracks: boolean;
  engine: boolean;
  fuel: boolean;
  mobile: boolean;
}

/**
 * Needs at least one working track, one working engine, and a fuel module that still has fuel.
 * Omit `fuelRemaining` in the garage (a full tank). An unpowered engine or track does not count.
 */
export function mobility(grid: ReadonlyArray<ReadonlyArray<string | null>>, fuelRemaining?: number): Mobility {
  const plan = powerPlan(grid);
  let tracks = false;
  let engine = false;
  let fuelMods = false;
  for (let r = 0; r < grid.length; r += 1) {
    for (let c = 0; c < (grid[r]?.length ?? 0); c += 1) {
      const token = grid[r][c];
      if (!isAnchorCell(token, r, c)) continue;
      const mod = getModule(moduleIdOf(token) ?? "");
      if (!mod) continue;
      const running = cellPowered(plan, token, r, c);
      if (mod.kind === "tracks" && running) tracks = true;
      if (mod.kind === "engine" && running) engine = true;
      if (mod.kind === "fuel") fuelMods = true;
    }
  }
  const fuel = fuelMods && (fuelRemaining === undefined || fuelRemaining > 0);
  return { tracks, engine, fuel, mobile: tracks && engine && fuel };
}

export function mobilityWarning(grid: ReadonlyArray<ReadonlyArray<string | null>>): string | null {
  const move = mobility(grid);
  if (move.mobile) return null;
  const missing: string[] = [];
  if (!move.tracks) missing.push("tracks");
  if (!move.engine) missing.push("an engine");
  if (!move.fuel) missing.push("fuel");
  return `Immobile without ${missing.join(" and ")}. You can still fight.`;
}

export function computeStats(grid: ReadonlyArray<ReadonlyArray<string | null>>): TankStats {
  const plan = powerPlan(grid);
  let hp = BASE_HULL.hp;
  let speed: number = BASE_HULL.speed;
  let turn: number = BASE_HULL.turn;
  let fuel = BASE_HULL.fuel;
  let damageSum = 0;
  let fireRate = 0;
  let weaponCount = 0;
  let shooters = 0;
  let plates = 0;

  for (let r = 0; r < grid.length; r += 1) {
    for (let c = 0; c < grid[r].length; c += 1) {
      const token = grid[r][c];
      if (!isAnchorCell(token, r, c)) continue;
      const mod = getModule(moduleIdOf(token) ?? "");
      if (!mod) continue;
      const running = cellPowered(plan, token, r, c);
      hp += mod.stats.hp ?? 0;
      if (running) {
        speed += mod.stats.speed ?? 0;
        turn += mod.stats.turn ?? 0;
      }
      fuel += mod.stats.fuel ?? 0;
      if (mod.kind === "armor") plates += 1;
      if (mod.kind === "weapon") {
        weaponCount += 1;
        if (running && !mod.cutter && !mod.mine && !mod.missile && !mod.ability) {
          shooters += 1;
          damageSum += mod.stats.damage ?? 0;
          fireRate += mod.stats.fireRate ?? 0;
        }
      }
    }
  }
  // 200 is a bare hull plus about three engines. More engines stop adding speed.
  speed = Math.min(200, Math.max(12, speed));
  turn = Math.max(10, turn);

  const averageRate = shooters > 0 ? fireRate / shooters : 0;
  const over = plan.demand > plan.supply;

  return {
    hp,
    plates,
    speed,
    turn,
    fuel,
    power: plan.supply,
    powerUse: plan.demand,
    damage: shooters > 0 ? damageSum / shooters : 0,
    salvoDamage: damageSum,
    fireRate: averageRate,
    weaponCount,
    powerFactor: over ? plan.supply / Math.max(plan.demand, 1) : 1,
  };
}

/** Pixels per second at full forward stick, before the reverse penalty. Empty fuel does not crawl. */
export function maxDriveSpeed(stats: TankStats, fuelRemaining: number): number {
  if (fuelRemaining <= 0) return 0;
  return stats.speed * 2.55;
}

/** Radians per second at full left/right stick. */
export function maxTurnRate(stats: TankStats): number {
  return stats.turn * 0.011;
}

/** Fuel units drained per second at the given throttle (0..1). Bigger tanks burn slower. */
export function fuelDrainPerSecond(stats: TankStats, throttle: number): number {
  const efficiency = 70 / Math.max(36, stats.fuel);
  return 7.5 * efficiency * throttle;
}

export interface MountedWeapon {
  damage: number;
}

/** One entry per weapon cell, left-to-right then front-to-back, so the salvo fan is stable. */
export function mountedWeapons(grid: ReadonlyArray<ReadonlyArray<string | null>>): MountedWeapon[] {
  const weapons: MountedWeapon[] = [];
  for (const row of grid) {
    for (const id of row) {
      if (!id) continue;
      const mod = getModule(id);
      if (!mod || mod.kind !== "weapon") continue;
      weapons.push({ damage: mod.stats.damage ?? 0 });
    }
  }
  return weapons;
}
