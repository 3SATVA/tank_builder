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
  /** A powered gun is bolted to the hull, so the hull itself has to aim. */
  hullGuns?: boolean;
  /** A powered gun sits on a turret and tracks the aim point on its own. */
  turretGuns?: boolean;
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
 * The turret tracks every frame. The hull picks a spot and stays with it for a few seconds,
 * and while it holds it turns to face the target. Hull guns need that facing to be the shot.
 * Steering eases in, and it will not flick the turn or the throttle back and forth.
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
  let faced = false;
  let aimSmooth = 0;
  let aimReady = false;
  let rangeBand: "close" | "fight" | "far" = "far";
  let backUntil = 0;
  let coolUntil = 0;
  let drive = 0;
  let driveUntil = 0;
  let turnSign = 0;
  let turnUntil = 0;

  const approach = (
    sx: number,
    sy: number,
    fx: number,
    fy: number,
    reach: number,
    arena: ArenaMap,
  ): { x: number; y: number } => {
    const base = Math.atan2(sx - fx, -(sy - fy));
    const margin = 90;
    for (const offset of [0, 0.7, -0.7, 1.3, -1.3, 2]) {
      const ang = base + offset * side;
      const x = clamp(fx + Math.sin(ang) * reach, margin, arena.w - margin);
      const y = clamp(fy - Math.cos(ang) * reach, margin, arena.h - margin);
      if (hasLineOfSight(arena, x, y, fx, fy)) return { x, y };
    }
    const span = Math.max(1, Math.hypot(sx - fx, sy - fy));
    const nx = (sx - fx) / span;
    const ny = (sy - fy) / span;
    const flank = tuning.strafe * 90 * side;
    return {
      x: clamp(fx + nx * reach - ny * flank, margin, arena.w - margin),
      y: clamp(fy + ny * reach + nx * flank, margin, arena.h - margin),
    };
  };

  return {
    commands(ctx: TankControlContext): TankCommands {
      weave += ctx.dt;
      const foe = ctx.foe;
      if (!foe) {
        turnCmd = 0;
        forwardCmd = 0;
        aimReady = false;
        faced = false;
        return { forward: 0, turn: 0, aimAngle: null, fire: false };
      }
      const hullGuns = Boolean(ctx.hullGuns);
      const turretGuns = Boolean(ctx.turretGuns);
      const hullPrimary = hullGuns && !turretGuns;
      const dx = foe.x - ctx.self.x;
      const dy = foe.y - ctx.self.y;
      const dist = Math.hypot(dx, dy) || 1;
      const flight = (dist / SHOT_SPEED) * tuning.lead;
      const aim =
        Math.atan2(foe.x + (foe.vx ?? 0) * flight - ctx.self.x, -(foe.y + (foe.vy ?? 0) * flight - ctx.self.y)) +
        Math.sin(weave * 1.1) * tuning.wobble;
      const hullFlight = (dist / SHOT_SPEED) * Math.min(1, 0.28 + tuning.lead * 0.5);
      const hullAim = Math.atan2(
        foe.x + (foe.vx ?? 0) * hullFlight - ctx.self.x,
        -(foe.y + (foe.vy ?? 0) * hullFlight - ctx.self.y),
      );
      if (!aimReady) {
        aimSmooth = hullAim;
        aimReady = true;
      } else {
        aimSmooth += angleDelta(aimSmooth, hullAim) * Math.min(1, ctx.dt * 3.2);
      }
      const bearing = Math.atan2(dx, -dy);
      const span = Math.max(ctx.arena.w, ctx.arena.h);
      const far = Math.min(tuning.far, span * 0.46);
      const near = Math.min(tuning.near, far * 0.72);
      const los = hasLineOfSight(ctx.arena, ctx.self.x, ctx.self.y, foe.x, foe.y);
      if (rangeBand === "fight") {
        if (dist < near * 0.72) rangeBand = "close";
        else if (dist > far * 1.08) rangeBand = "far";
      } else if (rangeBand === "close") {
        if (dist > near * 1.02) rangeBand = "fight";
      } else if (dist < far * 0.9) rangeBand = "fight";
      const tooClose = rangeBand === "close";
      const tooFar = rangeBand === "far";
      const canShoot = los && rangeBand === "fight";
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

      const begin = (next: "hold" | "go", x: number, y: number, seconds: number, flip: boolean): void => {
        mode = next;
        goalX = x;
        goalY = y;
        commit = seconds;
        reacted = false;
        if (flip) side *= -1;
        notice = 0;
        if (next === "go") faced = false;
      };
      const dodge = (): void => {
        if (reacted) return;
        reacted = true;
        if (hullPrimary) {
          if (weave < coolUntil) return;
          backUntil = weave + 1.4;
          coolUntil = weave + 3.6;
          mode = "hold";
          commit = 2.2;
          notice = 0;
          return;
        }
        mode = "go";
        faced = false;
        goalX = ctx.self.x + dodgeSign * 180;
        goalY = ctx.self.y - (dy / dist) * 50;
        commit = 2.8;
        notice = 0;
        side *= -1;
      };

      if (canShoot && !heavy && mode !== "hold") begin("hold", ctx.self.x, ctx.self.y, 3.6, false);

      if (mode === "hold") {
        if (seen && heavy) dodge();
        else if (seen && tooClose && !hullPrimary) begin("go", ctx.self.x - (dx / dist) * 200, ctx.self.y - (dy / dist) * 200, 2.8, true);
        else if (seen && (tooFar || !los)) {
          const spot = approach(ctx.self.x, ctx.self.y, foe.x, foe.y, (near + far) / 2, ctx.arena);
          begin("go", spot.x, spot.y, COMMIT, true);
        }
      } else {
        commit -= ctx.dt;
        const arrived = Math.hypot(goalX - ctx.self.x, goalY - ctx.self.y) < 46;
        if (seen && heavy) dodge();
        else if (commit <= 0 || arrived) {
          if (canShoot && !heavy) begin("hold", ctx.self.x, ctx.self.y, 3.6, false);
          else if (tooClose && !hullPrimary) begin("go", ctx.self.x - (dx / dist) * 200, ctx.self.y - (dy / dist) * 200, 2.8, true);
          else if (tooClose) begin("hold", ctx.self.x, ctx.self.y, 2.2, false);
          else {
            const spot = approach(ctx.self.x, ctx.self.y, foe.x, foe.y, (near + far) / 2, ctx.arena);
            begin("go", spot.x, spot.y, COMMIT, true);
          }
        }
      }

      let targetTurn = 0;
      let targetForward = 0;
      const face = (desired: number, tight: boolean): void => {
        const delta = angleDelta(ctx.self.angle, desired);
        const abs = Math.abs(delta);
        const stop = tight ? 0.05 : 0.12;
        const resume = tight ? 0.11 : 0.26;
        if (faced) {
          if (abs > resume) faced = false;
        } else if (abs < stop) faced = true;
        if (faced) targetTurn = 0;
        else targetTurn = clamp(delta / (tight ? 1.25 : 2.1), -(tight ? 0.72 : 0.42), tight ? 0.72 : 0.42);
      };

      if (mode === "hold") {
        face(hullGuns ? aimSmooth : bearing, hullGuns);
        if (weave < backUntil || (hullPrimary && tooClose)) targetForward = -0.5;
      } else {
        const steer = steerPoint(ctx.arena, ctx.self.x, ctx.self.y, goalX, goalY);
        const step = steer && Math.hypot(steer.x - ctx.self.x, steer.y - ctx.self.y) > 28 ? steer : null;
        const sdx = (step ? step.x : goalX) - ctx.self.x;
        const sdy = (step ? step.y : goalY) - ctx.self.y;
        if (Math.hypot(sdx, sdy) > 28) {
          const delta = angleDelta(ctx.self.angle, Math.atan2(sdx, -sdy));
          const abs = Math.abs(delta);
          targetTurn = abs < 0.1 ? 0 : clamp(delta / 1.9, -0.55, 0.55);
          if (abs < 0.42) targetForward = 0.72;
          else if (abs < 1.05) targetForward = 0.22;
        } else {
          face(hullGuns ? aimSmooth : bearing, hullGuns);
          if (tooFar) targetForward = 0.55;
        }
      }

      if (targetTurn !== 0 && turnSign !== 0 && Math.sign(targetTurn) !== turnSign && weave < turnUntil) targetTurn = 0;
      else if (Math.abs(targetTurn) > 0.06 && Math.sign(targetTurn) !== turnSign) {
        turnSign = Math.sign(targetTurn);
        turnUntil = weave + 0.4;
      } else if (Math.abs(targetTurn) < 0.02) turnSign = 0;

      const wantSign = Math.sign(targetForward);
      if (drive !== 0 && wantSign !== 0 && wantSign !== drive && weave < driveUntil) targetForward = drive * 0.45;
      else if (Math.abs(targetForward) > 0.08 && wantSign !== drive) {
        drive = wantSign;
        driveUntil = weave + 0.55;
      } else if (Math.abs(targetForward) < 0.02) drive = 0;

      const slew = 1.5 * ctx.dt;
      turnCmd += clamp(targetTurn - turnCmd, -slew, slew);
      forwardCmd += clamp(targetForward - forwardCmd, -slew, slew);
      if (Math.abs(targetTurn) < 0.02 && Math.abs(turnCmd) < 0.045) turnCmd = 0;
      if (Math.abs(targetForward) < 0.02 && Math.abs(forwardCmd) < 0.045) forwardCmd = 0;

      const hullError = Math.abs(angleDelta(ctx.self.angle, aimSmooth));
      const turretError = Math.abs(angleDelta(ctx.self.turret, aim));
      const hullOk = hullError < Math.max(tuning.aimSlack, 0.14);
      const turretOk = turretError < tuning.aimSlack;
      const aligned = hullGuns && turretGuns ? hullOk && turretOk : hullGuns ? hullOk : turretOk;
      const fire = aligned && los && dist > 70 && dist < far * 1.25 && !tooFar;
      return { forward: forwardCmd, turn: turnCmd, aimAngle: aim, fire };
    },
  };
}
