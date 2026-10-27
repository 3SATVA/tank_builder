import { angleDelta, clamp } from "./math";

/**
 * Both the player and a rival (bot today, remote player later) drive a tank
 * through this shape. A serialized layout is just the module grid; these
 * commands are the per-tick input a network peer would send.
 */
export interface TankCommands {
  /** +1 forward along the hull, -1 backward. */
  forward: number;
  /** +1 turn clockwise, -1 turn counter-clockwise. */
  turn: number;
  /** World aim. 0 is up the screen, positive is clockwise. Null keeps the turret. */
  aimAngle: number | null;
  fire: boolean;
}

export interface CombatantView {
  x: number;
  y: number;
  angle: number;
  turret: number;
}

export interface ShotView {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface TankControlContext {
  self: CombatantView;
  foe: CombatantView | null;
  arena: { w: number; h: number };
  /** Shots that can hurt this tank. */
  incoming: readonly ShotView[];
  dt: number;
}

export interface TankController {
  commands(ctx: TankControlContext): TankCommands;
}

/**
 * Keeps range, turns the hull with the same forward/back + rotate rules as the
 * player, aims the turret at the foe, and sidesteps shots that are about to land.
 */
export function createRivalController(): TankController {
  let weave = 0;
  return {
    commands(ctx: TankControlContext): TankCommands {
      weave += ctx.dt;
      const foe = ctx.foe;
      if (!foe) return { forward: 0, turn: 0, aimAngle: null, fire: false };
      const dx = foe.x - ctx.self.x;
      const dy = foe.y - ctx.self.y;
      const dist = Math.hypot(dx, dy) || 1;
      const aim = Math.atan2(dx, -dy) + Math.sin(weave * 2.4) * 0.22;

      let face = aim;
      let forward = 0.85;
      if (dist < 260) {
        face = aim + Math.PI;
        forward = 1;
      } else if (dist < 460) {
        forward = 0.25;
        face = aim + Math.sin(weave * 1.6) * 0.85;
      }

      const margin = 180;
      if (ctx.self.x < margin) face = Math.PI / 2;
      else if (ctx.self.x > ctx.arena.w - margin) face = -Math.PI / 2;
      else if (ctx.self.y < margin) face = Math.PI;
      else if (ctx.self.y > ctx.arena.h - margin) face = 0;

      for (const shot of ctx.incoming) {
        const sx = ctx.self.x - shot.x;
        const sy = ctx.self.y - shot.y;
        const sd = Math.hypot(sx, sy) || 1;
        const approach = (shot.vx * sx + shot.vy * sy) / sd;
        if (sd < 170 && approach > 30) {
          forward = -0.55;
          face = aim + Math.PI / 2;
          break;
        }
      }

      const delta = angleDelta(ctx.self.angle, face);
      const turn = clamp(delta / 0.55, -1, 1);
      if (Math.abs(delta) > 0.5 && dist >= 260) forward *= 0.4;
      const aimError = Math.abs(angleDelta(ctx.self.turret, aim));
      const fire = aimError < 0.4 && dist < 760 && dist > 140;
      return { forward: clamp(forward, -1, 1), turn, aimAngle: aim, fire };
    },
  };
}
