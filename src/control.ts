import { hasLineOfSight, steerPoint, type ArenaMap } from "./maps";
import { angleDelta, clamp, localToWorld } from "./math";

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
  vx?: number;
  vy?: number;
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
  arena: ArenaMap;
  /** Shots that can hurt this tank. */
  incoming: readonly ShotView[];
  dt: number;
}

export interface TankController {
  commands(ctx: TankControlContext): TankCommands;
}

/** How sharp a bot is. Higher rivals lead, react, dodge, and hold range more tightly. */
export interface BotTuning {
  /** Radians of aim wobble. */
  wobble: number;
  /** 0 aims at the foe. 1 aims where a 540px/s shot will meet their velocity. */
  lead: number;
  /** Seconds between updates of aim, throttle, and fire. */
  reaction: number;
  near: number;
  far: number;
  /** Dodge a shot that will arrive inside this distance. */
  dodge: number;
  /** Turret error still allowed when pulling the trigger. */
  aimSlack: number;
  /** 0 drives straight. 1 orbits in the preferred band. */
  strafe: number;
}

const SHOT_SPEED = 540;

/**
 * Same drive commands as the player. Tuning decides aim, lead, reaction,
 * dodge, and the range the hull tries to keep. Cover is pathed around, and
 * the gun stays quiet unless the foe is actually in sight.
 */
export function createBotController(tuning: BotTuning): TankController {
  let weave = 0;
  let react = 0;
  let strafeClock = 0;
  let strafeSign = 1;
  let held: TankCommands = { forward: 0, turn: 0, aimAngle: null, fire: false };
  return {
    commands(ctx: TankControlContext): TankCommands {
      weave += ctx.dt;
      strafeClock += ctx.dt;
      if (strafeClock > 1.7) {
        strafeClock = 0;
        strafeSign *= -1;
      }
      react -= ctx.dt;
      if (react > 0) return held;
      react = tuning.reaction;
      const foe = ctx.foe;
      if (!foe) {
        held = { forward: 0, turn: 0, aimAngle: null, fire: false };
        return held;
      }
      const dx = foe.x - ctx.self.x;
      const dy = foe.y - ctx.self.y;
      const dist = Math.hypot(dx, dy) || 1;
      const flight = (dist / SHOT_SPEED) * tuning.lead;
      const aim =
        Math.atan2(foe.x + (foe.vx ?? 0) * flight - ctx.self.x, -(foe.y + (foe.vy ?? 0) * flight - ctx.self.y)) +
        Math.sin(weave * 2.2) * tuning.wobble;
      const span = Math.max(ctx.arena.w, ctx.arena.h);
      const far = Math.min(tuning.far, span * 0.46);
      const near = Math.min(tuning.near, far * 0.55);
      let goalX = foe.x;
      let goalY = foe.y;
      if (dist < near) {
        goalX = ctx.self.x - (dx / dist) * 140;
        goalY = ctx.self.y - (dy / dist) * 140;
      } else if (dist <= far) {
        const sideX = -dy / dist;
        const sideY = dx / dist;
        const ring = (near + far) / 2;
        goalX = foe.x + sideX * strafeSign * ring;
        goalY = foe.y + sideY * strafeSign * ring;
      }
      for (const shot of ctx.incoming) {
        const sx = ctx.self.x - shot.x;
        const sy = ctx.self.y - shot.y;
        const sd = Math.hypot(sx, sy) || 1;
        const approach = (shot.vx * sx + shot.vy * sy) / sd;
        if (sd < tuning.dodge && approach > 40) {
          const side = Math.sign(sx * shot.vy - sy * shot.vx) || strafeSign;
          const right = localToWorld(1, 0, aim);
          goalX = ctx.self.x + right.x * side * 120;
          goalY = ctx.self.y + right.y * side * 120;
          break;
        }
      }
      const aimError = Math.abs(angleDelta(ctx.self.turret, aim));
      const los = hasLineOfSight(ctx.arena, ctx.self.x, ctx.self.y, foe.x, foe.y);
      const fire = aimError < tuning.aimSlack && los && dist > 64;
      const steer = steerPoint(ctx.arena, ctx.self.x, ctx.self.y, goalX, goalY);
      if (!steer) {
        held = { forward: 0, turn: 0.45, aimAngle: aim, fire };
        return held;
      }
      const sdx = steer.x - ctx.self.x;
      const sdy = steer.y - ctx.self.y;
      if (Math.hypot(sdx, sdy) < 14) {
        held = { forward: 0, turn: 0.35 * strafeSign, aimAngle: aim, fire };
        return held;
      }
      const face = Math.atan2(sdx, -sdy);
      const delta = angleDelta(ctx.self.angle, face);
      const turn = clamp(delta / 0.45, -1, 1);
      let forward = 1;
      if (Math.abs(delta) > 1.05) forward = 0.2;
      else if (Math.abs(delta) > 0.7) forward = 0.55;
      held = { forward, turn, aimAngle: aim, fire };
      return held;
    },
  };
}
