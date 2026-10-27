import { createBotController, type BotTuning, type ShotView, type TankCommands } from "./control";
import { el } from "./dom";
import { CELL, cellCenter, listGuns } from "./geometry";
import { applyRepair, damageInstance, nextRepair } from "./grid";
import { attachInput, type InputController } from "./input";
import { clamp, localToWorld, rotateToward, traceRoundRect, worldToLocal } from "./math";
import {
  blockPlate,
  cloneGrid,
  createDefaultGrid,
  getModule,
  isAnchorCell,
  isCoreCell,
  isTurretCell,
  moduleIdOf,
  turretOrigin,
  TURRET_SIZE,
} from "./modules";
import { sfxBoom, sfxHit, sfxShot } from "./sfx";
import { computeStats, fuelDrainPerSecond, maxDriveSpeed, maxTurnRate } from "./stats";
import type { ModuleKind } from "./types";

const ARENA_W = 2000;
const ARENA_H = 1400;
const TURRET_TURN = 4.6;

interface Pillar {
  x: number;
  y: number;
  w: number;
  h: number;
}

const PILLARS: readonly Pillar[] = [
  { x: 180, y: 600, w: 120, h: 180 },
  { x: 1700, y: 600, w: 120, h: 180 },
];

type Side = "player" | "rival";

interface Tank {
  id: Side;
  name: string;
  x: number;
  y: number;
  angle: number;
  turret: number;
  vx: number;
  vy: number;
  core: number;
  coreMax: number;
  fuel: number;
  cooldown: number;
  flash: number;
  muzzle: number;
  puff: number;
  hull: string;
  repairTimer: number;
  sparkLife: number;
  sparkCells: { r: number; c: number }[];
  grid: (string | null)[][];
  plate: number[][];
  blueprint: (string | null)[][];
  radius: number;
}

interface Shot {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  damage: number;
  life: number;
  owner: Side;
  color: string;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  color: string;
  size: number;
  puff?: boolean;
}

interface Floater {
  x: number;
  y: number;
  text: string;
  life: number;
}

export interface BattleOptions {
  grid: (string | null)[][];
  hull: string;
  rivalName: string;
  rivalHull: string;
  rivalGrid: (string | null)[][];
  rivalTuning: BotTuning;
  scrap: number;
  currency: number;
  onCurrency: (next: number) => void;
  onWin: () => void;
  onExit: () => void;
  onGarage: () => void;
  onRivals: () => void;
}

interface TankDebug {
  x: number;
  y: number;
  angle: number;
  turret: number;
  core: number;
  fuel: number;
  speed: number;
  shots: number;
  phase: "play" | "win" | "lose";
  guns: Array<"hull" | "turret">;
  modules: number;
  rivalCore: number;
  rivalModules: number;
  rivalTurret: number;
  rivalX: number;
  rivalY: number;
  lastVolley: Array<{ mount: "hull" | "turret"; angle: number }>;
}

declare global {
  interface Window {
    __TANK_DEBUG__?: () => TankDebug;
  }
}

/**
 * Angle 0 faces up the screen. Positive rotation is clockwise.
 * Move stick up/down drives along the hull. Left/right turns the hull.
 * The centered 3×3 rotates toward the aim stick. Every powered gun fires while aim is held:
 * turret guns along the aim, hull guns along the hull.
 */
export function mountBattle(root: HTMLElement, options: BattleOptions): () => void {
  const playerBlueprint = options.grid.length >= 3 ? options.grid : createDefaultGrid();
  const canvas = el("canvas");
  canvas.id = "battle-canvas";
  canvas.setAttribute("aria-label", "Duel arena");

  const hud = el("div", "hud");
  const exit = el("button", "btn btn-ghost hud-exit", "Menu");
  exit.type = "button";
  const readout = el("div", "hud-readout");
  const coreLabel = el("div", "meter-label");
  coreLabel.append(el("span", undefined, "Core"), el("span", "meter-value", ""));
  const coreMeter = el("div", "meter meter-hp");
  const coreFill = el("span");
  coreMeter.append(coreFill);
  const fuelLabel = el("div", "meter-label");
  fuelLabel.append(el("span", undefined, "Fuel"), el("span", "meter-value", ""));
  const fuelMeter = el("div", "meter meter-fuel");
  const fuelFill = el("span");
  fuelMeter.append(fuelFill);
  const rivalLabel = el("div", "meter-label");
  rivalLabel.append(el("span", undefined, options.rivalName), el("span", "meter-value", ""));
  const rivalMeter = el("div", "meter meter-rival");
  const rivalFill = el("span");
  rivalMeter.append(rivalFill);
  readout.append(coreLabel, coreMeter, fuelLabel, fuelMeter, rivalLabel, rivalMeter);
  const scrap = el("div", "scrap-pill hud-scrap");
  const scrapValue = el("span", undefined, "");
  scrap.append(el("span", "scrap-nut", "⬡"), scrapValue);
  hud.append(exit, readout, scrap);

  const help = el(
    "p",
    "battle-help",
    "Up/down drives, left/right turns. Aim stick spins the turret and fires every gun.",
  );
  const status = el("p", "battle-status");
  status.setAttribute("aria-live", "polite");

  const moveStick = joystick("move", "Move", "Move. Up and down drive. Left and right turn.");
  const aimStick = joystick("aim", "Aim", "Aim. Spins the turret and fires while held.");

  const endcard = el("div", "endcard");
  endcard.hidden = true;
  const endTitle = el("h2", undefined, "");
  const endCopy = el("p", "end-copy");
  const retry = el("button", "btn btn-primary", "Rematch");
  retry.type = "button";
  const garage = el("button", "btn", "Garage");
  garage.type = "button";
  const rivals = el("button", "btn", "Rivals");
  rivals.type = "button";
  const endActions = el("div", "end-actions");
  endActions.append(retry, rivals, garage);
  const endPanel = el("div", "end-panel");
  endPanel.append(endTitle, endCopy, endActions);
  endcard.append(endPanel);

  root.append(canvas, hud, help, status, moveStick.root, aimStick.root, endcard);

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");
  const context = ctx;
  const input = attachInput(moveStick.base, moveStick.knob, aimStick.base, aimStick.knob);
  const rivalAi = createBotController(options.rivalTuning);
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  let bank = options.currency;
  let paid = false;
  let phase: "play" | "win" | "lose" = "play";
  let shake = 0;
  let simTime = 0;
  let lastStatus = "";
  let raf = 0;
  let lastTime = 0;
  let stopped = false;
  let acc = 0;
  let player = spawnTank("player", "You", playerBlueprint, 1000, 1080, 0, options.hull);
  let rival = spawnTank("rival", options.rivalName, options.rivalGrid, 1040, 380, Math.PI, options.rivalHull);
  let shots: Shot[] = [];
  let particles: Particle[] = [];
  let floaters: Floater[] = [];
  let lastVolley: TankDebug["lastVolley"] = [];

  function boot(): void {
    player = spawnTank("player", "You", playerBlueprint, 1000, 1080, 0, options.hull);
    rival = spawnTank("rival", options.rivalName, options.rivalGrid, 1040, 380, Math.PI, options.rivalHull);
    shots = [];
    particles = [];
    floaters = [];
    shake = 0;
    phase = "play";
    paid = false;
    endcard.hidden = true;
    syncHud();
  }

  function update(dt: number): void {
    const playerCmd = commandsFromPlayer(input, player);
    const rivalCmd = rivalAi.commands({
      self: rival,
      foe: player,
      arena: { w: ARENA_W, h: ARENA_H },
      incoming: shots.filter((shot) => shot.owner !== "rival").map(shotView),
      dt,
    });
    stepTank(player, playerCmd, dt);
    stepTank(rival, rivalCmd, dt);
    separateTanks();

    for (let i = shots.length - 1; i >= 0; i -= 1) {
      const shot = shots[i];
      shot.x += shot.vx * dt;
      shot.y += shot.vy * dt;
      shot.life -= dt;
      if (shot.life <= 0 || shot.x < 0 || shot.y < 0 || shot.x > ARENA_W || shot.y > ARENA_H || shotHitsPillar(shot)) {
        shots.splice(i, 1);
        continue;
      }
      const target = shot.owner === "player" ? rival : player;
      if (strike(target, shot)) {
        shots.splice(i, 1);
        if (defeated(target)) finish(target.id === "player" ? "lose" : "win");
      }
    }
    stepDecor(dt);
    if (shake > 0) shake = Math.max(0, shake - dt * 18);
    syncHud();
  }

  function stepTank(tank: Tank, cmd: TankCommands, dt: number): void {
    const job = nextRepair(tank.grid, tank.plate, tank.blueprint);
    const bays = repairBays(tank);
    const working = Boolean(job) && bays > 0;
    const stats = computeStats(tank.grid, { repairActive: working });
    if (tank.fuel > stats.fuel) tank.fuel = stats.fuel;
    const throttle = Math.max(Math.abs(cmd.forward), Math.abs(cmd.turn) * 0.5);
    if (tank.fuel > 0 && throttle > 0.02) {
      tank.fuel = Math.max(0, tank.fuel - fuelDrainPerSecond(stats, throttle) * dt);
    }
    const signed = cmd.forward < 0 ? cmd.forward * 0.8 : cmd.forward;
    const speed = maxDriveSpeed(stats, tank.fuel);
    const wishX = Math.sin(tank.angle) * speed * signed;
    const wishY = -Math.cos(tank.angle) * speed * signed;
    const blend = 1 - Math.exp(-7 * dt);
    tank.vx += (wishX - tank.vx) * blend;
    tank.vy += (wishY - tank.vy) * blend;
    tank.x += tank.vx * dt;
    tank.y += tank.vy * dt;
    tank.angle += cmd.turn * maxTurnRate(stats) * dt;
    const solved = resolveCircle(tank.x, tank.y, tank.radius);
    tank.x = solved.x;
    tank.y = solved.y;
    if (cmd.aimAngle !== null) tank.turret = rotateToward(tank.turret, cmd.aimAngle, TURRET_TURN * dt);
    tank.flash = Math.max(0, tank.flash - dt);
    tank.muzzle = Math.max(0, tank.muzzle - dt);
    tank.sparkLife = Math.max(0, tank.sparkLife - dt);
    if (working && stats.powerFactor > 0 && job) {
      tank.repairTimer -= dt * bays * stats.powerFactor;
      if (tank.repairTimer <= 0) {
        applyRepair(tank.grid, tank.plate, tank.blueprint, job);
        tank.repairTimer = 4;
        tank.sparkLife = 0.55;
        tank.sparkCells = job.cells.map((cell) => ({ r: cell.r, c: cell.c }));
      }
    } else {
      tank.repairTimer = 4;
    }
    const moving = Math.hypot(tank.vx, tank.vy) > 18;
    if (moving) {
      tank.puff -= dt;
      if (tank.puff <= 0) {
        tank.puff = reduceMotion ? 0.28 : 0.1;
        emitExhaust(tank);
      }
    }
    if (tank.cooldown > 0) tank.cooldown -= dt;
    if (cmd.fire && tank.cooldown <= 0 && stats.fireRate > 0) {
      fireGuns(tank);
      tank.cooldown = 1 / stats.fireRate;
    }
  }

  function fireGuns(tank: Tank): void {
    const guns = listGuns(tank.grid, tank.hull);
    for (const gun of guns) {
      const angle = gun.mount === "turret" ? tank.turret : tank.angle;
      const reach = gun.heavy ? 1.7 : 0.95;
      const muzzle = mountPoint(tank, gun.lx, gun.ly - CELL * reach, gun.mount === "turret");
      const speed = 540;
      shots.push({
        x: muzzle.x,
        y: muzzle.y,
        vx: Math.sin(angle) * speed,
        vy: -Math.cos(angle) * speed,
        r: gun.heavy ? 6.4 : 4.5,
        damage: gun.damage,
        life: gun.life,
        owner: tank.id,
        color: gun.heavy ? (tank.id === "player" ? "#b8fff4" : "#ffd0c4") : tank.id === "player" ? "#8ef6ea" : "#ffb0a0",
      });
    }
    if (tank.id === "player") {
      lastVolley = guns.map((gun) => ({
        mount: gun.mount,
        angle: gun.mount === "turret" ? tank.turret : tank.angle,
      }));
    }
    if (shots.length > 80) shots.splice(0, shots.length - 80);
    tank.flash = 0.06;
    tank.muzzle = 0.09;
    if (tank.id === "player") sfxShot();
  }

  function strike(tank: Tank, shot: Shot): boolean {
    const rows = tank.grid.length;
    const cols = tank.grid[0]?.length ?? 0;
    let best: { r: number; c: number; d: number; turret: boolean } | null = null;
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const turret = isTurretCell(r, c, cols, rows, tank.hull);
        if (!shotInCell(tank, shot, r, c)) continue;
        const center = cellCenter(c, r, cols, rows);
        const world = mountPoint(tank, center.x, center.y, turret);
        const dist = Math.hypot(shot.x - world.x, shot.y - world.y);
        if (!best || dist < best.d) best = { r, c, d: dist, turret };
      }
    }
    if (!best) return false;
    if (tank.grid[best.r][best.c]) {
      hurtCell(tank, best.r, best.c, shot.damage);
      sfxHit();
      return true;
    }
    if (!best.turret) return false;
    tank.core -= shot.damage;
    tank.flash = 0.12;
    sfxHit();
    const center = cellCenter(best.c, best.r, cols, rows);
    const world = mountPoint(tank, center.x, center.y, true);
    floaters.push({ x: world.x, y: world.y, text: "Core hit", life: 0.7 });
    if (!reduceMotion) shake = Math.min(8, shake + (tank.id === "player" ? 3 : 1));
    return true;
  }

  function hurtCell(tank: Tank, row: number, col: number, amount: number): void {
    const mod = cellModule(tank.grid[row][col]);
    const hit = damageInstance(tank.grid, tank.plate, row, col, amount);
    tank.flash = 0.08;
    if (hit.overflow > 0) tank.core -= hit.overflow;
    if (!hit.popped) return;
    const cols = tank.grid[0]?.length ?? 1;
    const rows = tank.grid.length;
    const center = cellCenter(col, row, cols, rows);
    const onTurret = isTurretCell(row, col, cols, rows, tank.hull);
    const world = mountPoint(tank, center.x, center.y, onTurret);
    burst(world.x, world.y, mod?.color ?? "#f6f1e6", 10);
    floaters.push({ x: world.x, y: world.y, text: mod ? `${mod.name} lost` : "Lost", life: 0.8 });
    if (tank.id === "player") {
      sfxBoom();
      if (!reduceMotion) shake = Math.min(10, shake + 4);
    }
  }

  function finish(result: "win" | "lose"): void {
    if (phase !== "play") return;
    phase = result;
    if (result === "win" && !paid) {
      paid = true;
      bank += options.scrap;
      options.onCurrency(bank);
      options.onWin();
    }
    endTitle.textContent = result === "win" ? "You won" : "Hull breached";
    endCopy.textContent = result === "win" ? `${options.scrap} scrap banked.` : `${options.rivalName} kept the field.`;
    endcard.hidden = false;
    sfxBoom();
  }

  function draw(): void {
    const view = currentView();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    const jx = shake > 0 && !reduceMotion ? (Math.random() - 0.5) * shake : 0;
    const jy = shake > 0 && !reduceMotion ? (Math.random() - 0.5) * shake : 0;
    context.setTransform(
      view.dpr * view.zoom,
      0,
      0,
      view.dpr * view.zoom,
      (-view.camX + jx) * view.dpr * view.zoom,
      (-view.camY + jy) * view.dpr * view.zoom,
    );
    context.fillStyle = "#10141c";
    context.fillRect(-400, -400, ARENA_W + 800, ARENA_H + 800);
    context.fillStyle = "#1b2333";
    context.fillRect(0, 0, ARENA_W, ARENA_H);
    context.strokeStyle = "rgba(255,255,255,0.045)";
    context.lineWidth = 2;
    for (let x = 0; x <= ARENA_W; x += 64) {
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, ARENA_H);
      context.stroke();
    }
    for (let y = 0; y <= ARENA_H; y += 64) {
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(ARENA_W, y);
      context.stroke();
    }
    context.strokeStyle = "#465064";
    context.lineWidth = 16;
    context.strokeRect(8, 8, ARENA_W - 16, ARENA_H - 16);
    for (const pillar of PILLARS) {
      traceRoundRect(context, pillar.x, pillar.y, pillar.w, pillar.h, 8);
      context.fillStyle = "#2c3546";
      context.fill();
      context.strokeStyle = "#0e1116";
      context.lineWidth = 4;
      context.stroke();
    }
    drawTank(rival, "#5a2430");
    drawTank(player, "#2a3142");
    for (const shot of shots) {
      context.save();
      context.translate(shot.x, shot.y);
      context.rotate(Math.atan2(shot.vy, shot.vx));
      context.fillStyle = shot.color;
      traceRoundRect(context, -12, -3, 16, 6, 3);
      context.fill();
      context.restore();
    }
    for (const bit of particles) {
      context.globalAlpha = Math.max(0, bit.life / bit.max);
      context.fillStyle = bit.color;
      if (bit.puff) {
        context.beginPath();
        context.arc(bit.x, bit.y, bit.size, 0, Math.PI * 2);
        context.fill();
      } else {
        context.fillRect(bit.x, bit.y, bit.size, bit.size);
      }
      context.globalAlpha = 1;
    }
    context.font = "700 16px Trebuchet MS, Verdana, sans-serif";
    context.textAlign = "center";
    for (const floater of floaters) {
      context.globalAlpha = Math.max(0, floater.life);
      context.fillStyle = "#f6f1e6";
      context.fillText(floater.text, floater.x, floater.y);
      context.globalAlpha = 1;
    }
  }

  function drawTank(tank: Tank, chassis: string): void {
    const cols = tank.grid[0]?.length ?? 1;
    const rows = tank.grid.length;
    const bodyW = cols * CELL;
    const bodyH = rows * CELL;
    context.save();
    context.translate(tank.x + 4, tank.y + 6);
    context.rotate(tank.angle);
    context.fillStyle = "rgba(0,0,0,0.28)";
    context.beginPath();
    context.ellipse(0, 0, bodyW * 0.42, bodyH * 0.42, 0, 0, Math.PI * 2);
    context.fill();
    context.restore();

    context.save();
    context.globalAlpha = tank.flash > 0 ? 0.72 : 1;
    context.translate(tank.x, tank.y);
    context.rotate(tank.angle);
    traceRoundRect(context, -bodyW / 2 - 4, -bodyH / 2 - 4, bodyW + 8, bodyH + 8, 12);
    context.fillStyle = chassis;
    context.fill();
    context.strokeStyle = "#0e1116";
    context.lineWidth = 4;
    context.stroke();
    context.fillStyle = "#ffb703";
    context.beginPath();
    context.moveTo(0, -bodyH / 2 - 12);
    context.lineTo(10, -bodyH / 2 + 2);
    context.lineTo(-10, -bodyH / 2 + 2);
    context.closePath();
    context.fill();
    drawCells(tank, false);
    context.restore();

    const pivot = turretPivot(cols, rows, tank.hull);
    const pivoted = localToWorld(pivot.x, pivot.y, tank.angle);
    context.save();
    context.translate(tank.x + pivoted.x, tank.y + pivoted.y);
    context.rotate(tank.turret);
    context.translate(-pivot.x, -pivot.y);
    drawCells(tank, true);
    const origin = turretOrigin(tank.hull);
    const top = cellCenter(origin.c, origin.r, cols, rows);
    context.strokeStyle = "#ffb703";
    context.lineWidth = 3;
    traceRoundRect(context, top.x - CELL / 2 - 2, top.y - CELL / 2 - 2, TURRET_SIZE * CELL + 4, TURRET_SIZE * CELL + 4, 8);
    context.stroke();
    context.restore();

    context.fillStyle = "#f6f1e6";
    context.font = "700 14px Trebuchet MS, Verdana, sans-serif";
    context.textAlign = "center";
    context.fillText(tank.name, tank.x, tank.y - bodyH * 0.62);
    const barW = 54;
    context.fillStyle = "#0e1116";
    context.fillRect(tank.x - barW / 2, tank.y - bodyH * 0.62 + 6, barW, 5);
    context.fillStyle = tank.id === "player" ? "#7dcf6a" : "#ff5d5d";
    context.fillRect(tank.x - barW / 2, tank.y - bodyH * 0.62 + 6, barW * clamp(tank.core / tank.coreMax, 0, 1), 5);
  }

  function drawCells(tank: Tank, turretLayer: boolean): void {
    const cols = tank.grid[0]?.length ?? 1;
    const rows = tank.grid.length;
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const turret = isTurretCell(r, c, cols, rows, tank.hull);
        if (turret !== turretLayer) continue;
        const id = tank.grid[r][c];
        const center = cellCenter(c, r, cols, rows);
        const size = CELL - 3;
        const x = center.x - size / 2;
        const y = center.y - size / 2;
        const mod = cellModule(id);
        context.beginPath();
        context.rect(x, y, size, size);
        context.fillStyle = mod?.color ?? "#141820";
        context.fill();
        context.lineWidth = mod?.id === "heavy-armor" ? 3.5 : 2;
        context.strokeStyle = mod?.id === "heavy-armor" ? "#1a222c" : "#0e1116";
        context.stroke();
        if (isCoreCell(r, c, cols, rows, tank.hull)) {
          context.fillStyle = "#ff5d5d";
          context.beginPath();
          context.arc(x + size - 5, y + size - 5, 2.4, 0, Math.PI * 2);
          context.fill();
        }
        if (!id || !mod) continue;
        const moving = Math.hypot(tank.vx, tank.vy) > 18;
        const anchor = isAnchorCell(id, r, c);
        if (mod.kind === "weapon") {
          if (mod.id === "medium-cannon" && !anchor) drawBreech(center.x, center.y, size);
          else drawCannon(center.x, center.y, size, tank.muzzle > 0, (mod.rows ?? 1) > 1);
        } else if (mod.kind === "engine") drawEngine(center.x, center.y, size, moving, simTime + r * 1.7 + c);
        else {
          context.fillStyle = "rgba(255,255,255,0.22)";
          context.fillRect(x + 3, y + 3, size - 6, 4);
          if (mod.id === "heavy-armor") drawRivets(x, y, size);
          else if (mod.repairs) drawPlus(center.x, center.y, size * 0.28);
          else drawGlyph(mod.kind, center.x, center.y, size * 0.26);
        }
        if (tank.sparkLife > 0 && tank.sparkCells.some((cell) => cell.r === r && cell.c === c)) {
          drawSpark(center.x, center.y, size, tank.sparkLife);
        }
        const plateMax = blockPlate(id);
        const left = plateMax > 0 ? tank.plate[r][c] / plateMax : 0;
        if (left < 0.999) {
          context.fillStyle = "rgba(14,17,22,0.45)";
          context.fillRect(x + 3, y + size - 6, size - 6, 3);
          context.fillStyle = "#f6f1e6";
          context.fillRect(x + 3, y + size - 6, (size - 6) * clamp(left, 0, 1), 3);
        }
      }
    }
  }

  function drawGlyph(kind: ModuleKind, x: number, y: number, s: number): void {
    context.save();
    context.translate(x, y);
    context.strokeStyle = "rgba(14,17,22,0.55)";
    context.fillStyle = "rgba(14,17,22,0.55)";
    context.lineWidth = 2;
    context.lineCap = "round";
    context.beginPath();
    if (kind === "armor") {
      context.rect(-s, -s, s * 2, s * 2);
      context.stroke();
    } else if (kind === "tracks") {
      context.moveTo(-s, -s * 0.5);
      context.lineTo(s, -s * 0.5);
      context.moveTo(-s, 0);
      context.lineTo(s, 0);
      context.moveTo(-s, s * 0.5);
      context.lineTo(s, s * 0.5);
      context.stroke();
    } else if (kind === "power") {
      context.moveTo(s * 0.15, -s);
      context.lineTo(-s * 0.45, s * 0.1);
      context.lineTo(0, s * 0.1);
      context.lineTo(-s * 0.1, s);
      context.lineTo(s * 0.55, -s * 0.05);
      context.closePath();
      context.fill();
    } else if (kind === "fuel") {
      context.arc(0, 0, s * 0.55, 0, Math.PI * 2);
      context.fill();
    }
    context.restore();
  }

  function drawCannon(x: number, y: number, size: number, flash: boolean, heavy = false): void {
    const half = size / 2;
    const width = size * (heavy ? 0.48 : 0.3);
    const length = size * (heavy ? 1.9 : 1.05);
    context.save();
    context.translate(x, y);
    context.fillStyle = "#d8fff8";
    context.strokeStyle = "#0e1116";
    context.lineWidth = 2;
    traceRoundRect(context, -width / 2, -half - length * 0.62, width, length, 2);
    context.fill();
    context.stroke();
    context.fillStyle = "#12312e";
    context.fillRect(-width * 0.22, -half - length * 0.62, width * 0.44, 3);
    context.fillStyle = "rgba(14,17,22,0.35)";
    context.fillRect(-half * 0.7, half * 0.15, half * 1.4, half * 0.55);
    if (flash) {
      context.fillStyle = "rgba(255, 236, 160, 0.95)";
      context.beginPath();
      context.arc(0, -half - length * 0.7, size * 0.32, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = "#fff7d6";
      context.beginPath();
      context.arc(0, -half - length * 0.7, size * 0.14, 0, Math.PI * 2);
      context.fill();
    }
    context.restore();
  }

  function drawBreech(x: number, y: number, size: number): void {
    const half = size / 2;
    context.save();
    context.translate(x, y);
    context.fillStyle = "rgba(14,17,22,0.4)";
    context.strokeStyle = "#0e1116";
    context.lineWidth = 2;
    traceRoundRect(context, -half * 0.72, -half * 0.2, half * 1.44, half * 0.9, 2);
    context.fill();
    context.stroke();
    context.restore();
  }

  function drawRivets(x: number, y: number, size: number): void {
    context.fillStyle = "#d5dde6";
    const inset = 5;
    for (const [px, py] of [
      [inset, inset],
      [size - inset, inset],
      [inset, size - inset],
      [size - inset, size - inset],
    ]) {
      context.beginPath();
      context.arc(x + px, y + py, 1.7, 0, Math.PI * 2);
      context.fill();
    }
  }

  function drawPlus(x: number, y: number, s: number): void {
    context.save();
    context.translate(x, y);
    context.strokeStyle = "rgba(14,17,22,0.7)";
    context.lineWidth = 2.4;
    context.lineCap = "round";
    context.beginPath();
    context.moveTo(0, -s);
    context.lineTo(0, s);
    context.moveTo(-s, 0);
    context.lineTo(s, 0);
    context.stroke();
    context.restore();
  }

  function drawSpark(x: number, y: number, size: number, life: number): void {
    context.save();
    context.globalAlpha = Math.min(1, life * 2.2);
    context.strokeStyle = "#e7ffc8";
    context.fillStyle = "#b6f58a";
    context.lineWidth = 1.5;
    const s = size * 0.18;
    for (const [ox, oy] of [
      [-s, -s],
      [s, -s * 0.2],
      [0, s],
    ]) {
      context.beginPath();
      context.moveTo(x + ox - 3, y + oy);
      context.lineTo(x + ox + 3, y + oy);
      context.moveTo(x + ox, y + oy - 3);
      context.lineTo(x + ox, y + oy + 3);
      context.stroke();
    }
    context.restore();
  }

  function drawEngine(x: number, y: number, size: number, moving: boolean, phase: number): void {
    const half = size / 2;
    context.save();
    context.translate(x, y);
    context.fillStyle = "#3a1612";
    context.strokeStyle = "#0e1116";
    context.lineWidth = 1.6;
    for (let i = 0; i < 3; i += 1) {
      const bob = moving && !reduceMotion ? Math.sin(phase * 22 + i * 1.4) * 1.5 : 0;
      const px = (i - 1) * size * 0.28;
      const ph = size * (i === 1 ? 0.34 : 0.42);
      traceRoundRect(context, px - size * 0.09, -half * 0.15 + bob - ph, size * 0.18, ph, 1.5);
      context.fill();
      context.stroke();
    }
    context.strokeStyle = "#1a0c0a";
    context.lineWidth = 2.4;
    context.lineCap = "round";
    context.beginPath();
    context.moveTo(-size * 0.2, half * 0.15);
    context.lineTo(-size * 0.2, half + size * 0.28);
    context.moveTo(size * 0.2, half * 0.35);
    context.lineTo(size * 0.2, half + size * 0.22);
    context.stroke();
    context.restore();
  }

  function currentView(): { zoom: number; camX: number; camY: number; dpr: number; rect: DOMRect } {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const viewW = Math.max(1, rect.width);
    const viewH = Math.max(1, rect.height);
    const dist = Math.hypot(player.x - rival.x, player.y - rival.y);
    const focus = clamp(dist + 380, 620, 1040);
    const zoom = Math.min(viewW, viewH) / focus;
    const midX = (player.x + rival.x) / 2;
    const midY = (player.y + rival.y) / 2;
    const thumbBias = viewH > viewW ? 36 : 0;
    let camX = midX - viewW / (2 * zoom);
    let camY = midY - (viewH / 2 - thumbBias) / zoom;
    camX = clamp(camX, -160, ARENA_W - viewW / zoom + 160);
    camY = clamp(camY, -160, ARENA_H - viewH / zoom + 160);
    return { zoom, camX, camY, dpr, rect };
  }

  function clientToWorld(clientX: number, clientY: number): { x: number; y: number } {
    const view = currentView();
    return {
      x: (clientX - view.rect.left) / view.zoom + view.camX,
      y: (clientY - view.rect.top) / view.zoom + view.camY,
    };
  }

  function commandsFromPlayer(source: InputController, tank: Tank): TankCommands {
    const drive = source.getDrive();
    const aim = source.getAimStick();
    if (aim.active) return { forward: drive.forward, turn: drive.turn, aimAngle: aim.angle, fire: true };
    let aimAngle: number | null = null;
    const mouse = source.getMouseClient();
    if (mouse.valid) {
      const world = clientToWorld(mouse.x, mouse.y);
      aimAngle = Math.atan2(world.x - tank.x, -(world.y - tank.y));
    }
    return { forward: drive.forward, turn: drive.turn, aimAngle, fire: source.isFiringFromPointer() };
  }

  function syncHud(): void {
    const fixing = Boolean(nextRepair(player.grid, player.plate, player.blueprint)) && repairBays(player) > 0;
    const stats = computeStats(player.grid, { repairActive: fixing });
    coreFill.style.width = `${clamp(player.core / player.coreMax, 0, 1) * 100}%`;
    fuelFill.style.width = `${stats.fuel > 0 ? clamp(player.fuel / stats.fuel, 0, 1) * 100 : 0}%`;
    rivalFill.style.width = `${clamp(rival.core / rival.coreMax, 0, 1) * 100}%`;
    const coreText = coreLabel.querySelector(".meter-value");
    const fuelText = fuelLabel.querySelector(".meter-value");
    const rivalText = rivalLabel.querySelector(".meter-value");
    if (coreText) coreText.textContent = String(Math.max(0, Math.ceil(player.core)));
    if (fuelText) fuelText.textContent = String(Math.ceil(player.fuel));
    if (rivalText) rivalText.textContent = String(Math.max(0, Math.ceil(rival.core)));
    coreMeter.classList.toggle("low", player.core / player.coreMax < 0.3);
    scrapValue.textContent = `${bank.toLocaleString()} scrap`;
    const next = statusLine(stats.plates, stats.weaponCount, stats.fireRate);
    if (next !== lastStatus) {
      lastStatus = next;
      status.textContent = next;
      status.hidden = next.length === 0;
    }
  }

  function statusLine(plates: number, weapons: number, rate: number): string {
    if (phase === "win") return "Rival down";
    if (phase === "lose") return "";
    if (player.fuel <= 0) return "Fuel empty — crawling";
    if (weapons === 0) return "No cannon left";
    if (rate <= 0) return "Cannons unpowered";
    if (plates === 0) return "Armor gone — core exposed";
    return "";
  }

  function frame(now: number): void {
    if (stopped) return;
    if (!lastTime || document.hidden) {
      lastTime = now;
      raf = requestAnimationFrame(frame);
      return;
    }
    const dt = Math.min(0.05, (now - lastTime) / 1000);
    lastTime = now;
    simTime += dt;
    if (phase === "play") {
      acc += dt;
      const step = 1 / 60;
      let guard = 0;
      while (acc >= step && guard < 4 && phase === "play") {
        update(step);
        acc -= step;
        guard += 1;
      }
    } else {
      stepDecor(dt);
      acc = 0;
    }
    draw();
    raf = requestAnimationFrame(frame);
  }

  const onKey = (event: KeyboardEvent): void => {
    if (event.code === "Escape") options.onExit();
  };
  exit.addEventListener("click", () => options.onExit());
  garage.addEventListener("click", () => options.onGarage());
  rivals.addEventListener("click", () => options.onRivals());
  retry.addEventListener("click", () => boot());
  window.addEventListener("keydown", onKey);

  if (import.meta.env.DEV) {
    window.__TANK_DEBUG__ = () => ({
      x: player.x,
      y: player.y,
      angle: player.angle,
      turret: player.turret,
      core: player.core,
      fuel: player.fuel,
      speed: computeStats(player.grid, { repairActive: false }).speed,
      shots: shots.length,
      phase,
      guns: listGuns(player.grid, player.hull).map((gun) => gun.mount),
      modules: player.grid.flat().filter(Boolean).length,
      rivalCore: rival.core,
      rivalModules: rival.grid.flat().filter(Boolean).length,
      rivalTurret: rival.turret,
      rivalX: rival.x,
      rivalY: rival.y,
      lastVolley,
    });
  }

  boot();
  raf = requestAnimationFrame(frame);

  return () => {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(raf);
    input.destroy();
    window.removeEventListener("keydown", onKey);
    if (import.meta.env.DEV && window.__TANK_DEBUG__) delete window.__TANK_DEBUG__;
  };

  function separateTanks(): void {
    const dx = rival.x - player.x;
    const dy = rival.y - player.y;
    const min = player.radius + rival.radius * 0.85;
    const dist = Math.hypot(dx, dy);
    if (dist <= 0 || dist >= min) return;
    const push = (min - dist) / 2;
    const nx = dx / dist;
    const ny = dy / dist;
    const a = resolveCircle(player.x - nx * push, player.y - ny * push, player.radius);
    const b = resolveCircle(rival.x + nx * push, rival.y + ny * push, rival.radius);
    player.x = a.x;
    player.y = a.y;
    rival.x = b.x;
    rival.y = b.y;
  }

  function stepDecor(dt: number): void {
    for (let i = particles.length - 1; i >= 0; i -= 1) {
      const bit = particles[i];
      bit.life -= dt;
      bit.x += bit.vx * dt;
      bit.y += bit.vy * dt;
      if (bit.life <= 0) particles.splice(i, 1);
    }
    for (let i = floaters.length - 1; i >= 0; i -= 1) {
      const floater = floaters[i];
      floater.life -= dt;
      floater.y -= 26 * dt;
      if (floater.life <= 0) floaters.splice(i, 1);
    }
  }

  function emitExhaust(tank: Tank): void {
    const cols = tank.grid[0]?.length ?? 1;
    const rows = tank.grid.length;
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const id = tank.grid[r][c];
        if (!id || cellModule(id)?.kind !== "engine") continue;
        const center = cellCenter(c, r, cols, rows);
        const onTurret = isTurretCell(r, c, cols, rows, tank.hull);
        const angle = onTurret ? tank.turret : tank.angle;
        const rear = localToWorld(0, 1, angle);
        for (let n = 0; n < 2; n += 1) {
          const mouth = mountPoint(tank, center.x + (n === 0 ? -4 : 4), center.y + CELL * 0.82, onTurret);
          const speed = 22 + Math.random() * 20;
          particles.push({
            x: mouth.x,
            y: mouth.y,
            vx: rear.x * speed + (Math.random() - 0.5) * 12,
            vy: rear.y * speed + (Math.random() - 0.5) * 12,
            life: 0.45 + Math.random() * 0.25,
            max: 0.7,
            color: n === 0 ? "#c5ccd6" : "#6e7782",
            size: 4 + Math.random() * 3.5,
            puff: true,
          });
        }
      }
    }
  }

  function burst(x: number, y: number, color: string, count: number): void {
    for (let i = 0; i < count; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 40 + Math.random() * 120;
      particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0.35 + Math.random() * 0.25,
        max: 0.6,
        color,
        size: 4 + Math.random() * 5,
      });
    }
  }
}

function spawnTank(
  id: Side,
  name: string,
  blueprint: (string | null)[][],
  x: number,
  y: number,
  angle: number,
  hull = "standard",
): Tank {
  const grid = cloneGrid(blueprint);
  const stats = computeStats(grid, { repairActive: false });
  const cols = grid[0]?.length ?? 1;
  const rows = grid.length;
  return {
    id,
    name,
    x,
    y,
    angle,
    turret: angle,
    vx: 0,
    vy: 0,
    core: stats.hp,
    coreMax: stats.hp,
    fuel: stats.fuel,
    cooldown: 0.45,
    flash: 0,
    muzzle: 0,
    puff: 0,
    hull,
    repairTimer: 4,
    sparkLife: 0,
    sparkCells: [],
    grid,
    plate: grid.map((row) => row.map((cell) => (cell ? blockPlate(cell) : 0))),
    blueprint: cloneGrid(blueprint),
    radius: Math.max(cols, rows) * CELL * 0.34,
  };
}

function cellModule(token: string | null) {
  return getModule(moduleIdOf(token) ?? "");
}

function repairBays(tank: Tank): number {
  let count = 0;
  tank.grid.forEach((row, r) => {
    row.forEach((token, c) => {
      if (!isAnchorCell(token, r, c)) return;
      if (cellModule(token)?.repairs) count += 1;
    });
  });
  return count;
}

function defeated(tank: Tank): boolean {
  if (tank.core <= 0) return true;
  return !tank.grid.some((row) => row.some((cell) => cell));
}

function turretPivot(cols: number, rows: number, hull: string): { x: number; y: number } {
  const origin = turretOrigin(hull);
  return cellCenter(origin.c + 1, origin.r + 1, cols, rows);
}

/** World position of a hull-local point. Turret points spin around the 3×3, which stays bolted to the hull. */
function mountPoint(tank: Tank, lx: number, ly: number, onTurret: boolean): { x: number; y: number } {
  if (!onTurret) {
    const p = localToWorld(lx, ly, tank.angle);
    return { x: tank.x + p.x, y: tank.y + p.y };
  }
  const cols = tank.grid[0]?.length ?? 1;
  const rows = tank.grid.length;
  const pivot = turretPivot(cols, rows, tank.hull);
  const base = localToWorld(pivot.x, pivot.y, tank.angle);
  const spun = localToWorld(lx - pivot.x, ly - pivot.y, tank.turret);
  return { x: tank.x + base.x + spun.x, y: tank.y + base.y + spun.y };
}

function shotInCell(tank: Tank, shot: Shot, row: number, col: number): boolean {
  const cols = tank.grid[0]?.length ?? 1;
  const rows = tank.grid.length;
  const onTurret = isTurretCell(row, col, cols, rows, tank.hull);
  const center = cellCenter(col, row, cols, rows);
  const world = mountPoint(tank, center.x, center.y, onTurret);
  const local = worldToLocal(shot.x - world.x, shot.y - world.y, onTurret ? tank.turret : tank.angle);
  const half = CELL * 0.46 + shot.r;
  return Math.abs(local.x) <= half && Math.abs(local.y) <= half;
}

function shotView(shot: Shot): ShotView {
  return { x: shot.x, y: shot.y, vx: shot.vx, vy: shot.vy };
}

function joystick(kind: "move" | "aim", label: string, aria: string): {
  root: HTMLElement;
  base: HTMLElement;
  knob: HTMLElement;
} {
  const root = el("div", `joystick joystick-${kind}`);
  const base = el("div", "joystick-base");
  base.dataset.joystick = kind;
  base.setAttribute("role", "application");
  base.setAttribute("aria-label", aria);
  const knob = el("div", "joystick-knob");
  base.append(knob);
  root.append(base, el("span", "joystick-label", label));
  return { root, base, knob };
}

function resolveCircle(x: number, y: number, r: number): { x: number; y: number } {
  let px = x;
  let py = y;
  for (let pass = 0; pass < 2; pass += 1) {
    px = clamp(px, r, ARENA_W - r);
    py = clamp(py, r, ARENA_H - r);
    for (const pillar of PILLARS) {
      const nearestX = clamp(px, pillar.x, pillar.x + pillar.w);
      const nearestY = clamp(py, pillar.y, pillar.y + pillar.h);
      const dx = px - nearestX;
      const dy = py - nearestY;
      const distSq = dx * dx + dy * dy;
      if (distSq >= r * r) continue;
      if (distSq < 1e-6) {
        const left = px - pillar.x;
        const right = pillar.x + pillar.w - px;
        const top = py - pillar.y;
        const bottom = pillar.y + pillar.h - py;
        const min = Math.min(left, right, top, bottom);
        if (min === left) px = pillar.x - r;
        else if (min === right) px = pillar.x + pillar.w + r;
        else if (min === top) py = pillar.y - r;
        else py = pillar.y + pillar.h + r;
        continue;
      }
      const dist = Math.sqrt(distSq);
      px += (dx / dist) * (r - dist + 0.25);
      py += (dy / dist) * (r - dist + 0.25);
    }
  }
  return { x: clamp(px, r, ARENA_W - r), y: clamp(py, r, ARENA_H - r) };
}

function shotHitsPillar(shot: Shot): boolean {
  return PILLARS.some(
    (pillar) =>
      shot.x > pillar.x - shot.r &&
      shot.x < pillar.x + pillar.w + shot.r &&
      shot.y > pillar.y - shot.r &&
      shot.y < pillar.y + pillar.h + shot.r,
  );
}
