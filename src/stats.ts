import { BASE_HULL, getModule } from "./modules";
import type { TankStats } from "./types";

export function computeStats(
  grid: ReadonlyArray<ReadonlyArray<string | null>>,
  options?: { repairActive?: boolean },
): TankStats {
  const repairActive = options?.repairActive !== false;
  let hp = BASE_HULL.hp;
  let speed: number = BASE_HULL.speed;
  let turn: number = BASE_HULL.turn;
  let fuel = BASE_HULL.fuel;
  let power = 0;
  let powerUse = 0;
  let damageSum = 0;
  let fireRate = 0;
  let weaponCount = 0;
  let plates = 0;

  for (let r = 0; r < grid.length; r += 1) {
    for (let c = 0; c < grid[r].length; c += 1) {
      const token = grid[r][c];
      if (!token) continue;
      const anchor = token.split("@")[1];
      if (anchor && anchor !== `${r},${c}`) continue;
      const mod = getModule(token.split("@")[0] ?? "");
      if (!mod) continue;
      hp += mod.stats.hp ?? 0;
      speed += mod.stats.speed ?? 0;
      turn += mod.stats.turn ?? 0;
      fuel += mod.stats.fuel ?? 0;
      power += mod.stats.power ?? 0;
      if (!mod.repairs || repairActive) powerUse += mod.stats.powerUse ?? 0;
      if (mod.kind === "armor") plates += 1;
      if (mod.kind === "weapon") {
        weaponCount += 1;
        damageSum += mod.stats.damage ?? 0;
        fireRate += mod.stats.fireRate ?? 0;
      }
    }
  }
  speed = Math.max(12, speed);
  turn = Math.max(10, turn);

  const powerFactor = powerUse <= 0 ? 1 : Math.min(1, power / powerUse);
  const averageRate = weaponCount > 0 ? fireRate / weaponCount : 0;
  const canFire = weaponCount > 0 && powerFactor > 0 && averageRate > 0;

  return {
    hp,
    plates,
    speed,
    turn,
    fuel,
    power,
    powerUse,
    damage: weaponCount > 0 ? damageSum / weaponCount : 0,
    salvoDamage: damageSum,
    fireRate: canFire ? averageRate * powerFactor : 0,
    weaponCount,
    powerFactor: weaponCount === 0 ? 1 : powerFactor,
  };
}

/** Pixels per second at full forward stick, before the reverse penalty. */
export function maxDriveSpeed(stats: TankStats, fuelRemaining: number): number {
  const cruise = stats.speed * 2.55;
  return fuelRemaining > 0 ? cruise : cruise * 0.25;
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
