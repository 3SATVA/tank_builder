import { hasLineOfSight, steerPoint, type ArenaMap } from "./maps";
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

/** How sharp a bot is. Movement stays deliberate; skill is aim, patience, and when to leave a spot. */
export interface BotTuning {
  /** Radians of aim wobble. */
  wobble: number;
  /** 0 aims at the foe. 1 aims where a 540px/s shot will meet their velocity. */
  lead: number;
  /** Seconds they wait before admitting a plan is wrong. */
  reaction: number;
  near: number;
  far: number;
  /** A shell inside this distance counts as incoming fire. */
  dodge: number;
  /** Turret error still allowed when pulling the trigger. */
  aimSlack: number;
  /** How far to the side the next approach point sits. */
  strafe: number;
}

const SHOT_SPEED = 540;

const COMMIT = 3.2;

/**
 * The turret tracks every frame. The hull picks a spot and stays with it for a few seconds.
 * It only leaves to get into range, to clear a blocked path, or to step off heavy fire.
 */
export function createBotController(tuning: BotTuning): TankController {
  let weave = 0;
  let notice = 0;
  let commit = 0;
  let mode: "hold" | "go" = "hold";
  let goalX = 0;
  let goalY = 0;
  let side = 1;
  let reacted = false;
  let turnCmd = 0;
  let forwardCmd = 0;

  const approach = (x: number, y: number, fx: number, fy: number, dist: number, reach: number): { x: number; y: number } => {
    const nx = (x - fx) / dist;
    const ny = (y - fy) / dist;
    const flank = tuning.strafe * 110 * side;
    return { x: fx + nx * reach - ny * flank, y: fy + ny * reach + nx * flank };
  };

  return {
    commands(ctx: TankControlContext): TankCommands {
      weave += ctx.dt;
      const foe = ctx.foe;
      if (!foe) {
        turnCmd = 0;
        forwardCmd = 0;
        return { forward: 0, turn: 0, aimAngle: null, fire: false };
      }
      const dx = foe.x - ctx.self.x;
      const dy = foe.y - ctx.self.y;
      const dist = Math.hypot(dx, dy) || 1;
      const flight = (dist / SHOT_SPEED) * tuning.lead;
      const aim =
        Math.atan2(foe.x + (foe.vx ?? 0) * flight - ctx.self.x, -(foe.y + (foe.vy ?? 0) * flight - ctx.self.y)) +
        Math.sin(weave * 1.1) * tuning.wobble;
      const span = Math.max(ctx.arena.w, ctx.arena.h);
      const far = Math.min(tuning.far, span * 0.46);
      const near = Math.min(tuning.near, far * 0.72);
      const los = hasLineOfSight(ctx.arena, ctx.self.x, ctx.self.y, foe.x, foe.y);
      const tooClose = dist < near * 0.82;
      const tooFar = dist > far;
      const canShoot = los && !tooClose && !tooFar;
      let threats = 0;
      let dodgeSign = side;
      for (const shot of ctx.incoming) {
        const sx = ctx.self.x - shot.x;
        const sy = ctx.self.y - shot.y;
        const sd = Math.hypot(sx, sy) || 1;
        const closing = (shot.vx * sx + shot.vy * sy) / sd;
        if (sd < tuning.dodge && closing > 70) {
          threats += sd < 90 ? 2 : 1;
          dodgeSign = Math.sign(sx * shot.vy - sy * shot.vx) || side;
        }
      }
      const heavy = threats >= 2;
      if (heavy || tooClose || tooFar || !los) notice += ctx.dt;
      else notice = 0;
      const seen = notice >= Math.max(0.15, tuning.reaction);

      const begin = (next: "hold" | "go", x: number, y: number, seconds: number): void => {
        mode = next;
        goalX = x;
        goalY = y;
        commit = seconds;
        reacted = false;
        side *= -1;
        notice = 0;
      };
      const dodge = (): void => {
        if (reacted) return;
        reacted = true;
        mode = "go";
        goalX = ctx.self.x + dodgeSign * 180;
        goalY = ctx.self.y - (dy / dist) * 50;
        commit = 2.8;
        notice = 0;
      };

      if (mode === "hold") {
        if (seen && heavy) dodge();
        else if (seen && tooClose) begin("go", ctx.self.x - (dx / dist) * 200, ctx.self.y - (dy / dist) * 200, 2.8);
        else if (seen && (tooFar || !los)) {
          const spot = approach(ctx.self.x, ctx.self.y, foe.x, foe.y, dist, (near + far) / 2);
          begin("go", spot.x, spot.y, COMMIT);
        }
      } else {
        commit -= ctx.dt;
        const arrived = Math.hypot(goalX - ctx.self.x, goalY - ctx.self.y) < 46;
        if (seen && heavy) dodge();
        else if (commit <= 0 || arrived) {
          if (canShoot && !heavy) begin("hold", ctx.self.x, ctx.self.y, 3.6);
          else if (tooClose) begin("go", ctx.self.x - (dx / dist) * 200, ctx.self.y - (dy / dist) * 200, 2.8);
          else {
            const spot = approach(ctx.self.x, ctx.self.y, foe.x, foe.y, dist, (near + far) / 2);
            begin("go", spot.x, spot.y, COMMIT);
          }
        }
      }

      const aimError = Math.abs(angleDelta(ctx.self.turret, aim));
      const fire = aimError < tuning.aimSlack && los && dist > 80 && dist < far * 1.2;
      let targetTurn = 0;
      let targetForward = 0;
      if (mode === "hold") {
        const bearing = Math.atan2(dx, -dy);
        const delta = angleDelta(ctx.self.angle, bearing);
        targetTurn = Math.abs(delta) < 0.2 ? 0 : clamp(delta / 2.4, -0.4, 0.4);
      } else {
        const steer = steerPoint(ctx.arena, ctx.self.x, ctx.self.y, goalX, goalY);
        if (steer) {
          const sdx = steer.x - ctx.self.x;
          const sdy = steer.y - ctx.self.y;
          if (Math.hypot(sdx, sdy) > 22) {
            const delta = angleDelta(ctx.self.angle, Math.atan2(sdx, -sdy));
            targetTurn = Math.abs(delta) < 0.16 ? 0 : clamp(delta / 1.8, -0.62, 0.62);
            if (Math.abs(delta) < 0.4) targetForward = 0.8;
            else if (Math.abs(delta) < 1.05) targetForward = 0.28;
          }
        } else {
          targetTurn = 0.28 * side;
        }
      }
      const slew = 2.2 * ctx.dt;
      turnCmd += clamp(targetTurn - turnCmd, -slew, slew);
      forwardCmd += clamp(targetForward - forwardCmd, -slew, slew);
      if (Math.abs(targetTurn) < 0.02) turnCmd = 0;
      if (targetForward < 0.02) forwardCmd = 0;
      return { forward: forwardCmd, turn: turnCmd, aimAngle: aim, fire };
    },
  };
}
