import { createBotController, type BotTuning, type ShotView, type TankCommands } from "./control";
import { el } from "./dom";
import { CELL, cellCenter, listGuns } from "./geometry";
import { applyRepair, damageInstance, nextRepair } from "./grid";
import { attachInput, type InputController } from "./input";
import { angleDelta, clamp, localToWorld, rotateToward, worldToLocal } from "./math";
import { hitsBlock, hitsHazard, pickMap, resolveTank, TILE, type ArenaMap, type MapBlock } from "./maps";
import { PAL } from "./palette";
import { CELL_ART, boomArt, moduleArt, nearestScale, obstacleArt, shotArt } from "./sprites";
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
} from "./modules";
import { sfxBoom, sfxHit, sfxShot } from "./sfx";
import { computeStats, fuelDrainPerSecond, maxDriveSpeed, maxTurnRate } from "./stats";

const TURRET_TURN = 4.6;
const LAVA_DPS = 18;
/** Authored module sprites are CELL_ART pixels. On screen each of those maps to an integer run of device pixels. */

interface Sprite {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
}

function makeSprite(): Sprite {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");
  return { canvas, ctx };
}

const hullSprite = makeSprite();
const turretSprite = makeSprite();
const worldBuffer = makeSprite();

function snapWorld(value: number, cellPx: number): number {
  const step = CELL / cellPx;
  return Math.round(value / step) * step;
}

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
  map: string;
  cam: number;
  viewW: number;
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
  const map: ArenaMap = pickMap();
  const canvas = el("canvas");
  canvas.id = "battle-canvas";
  canvas.setAttribute("aria-label", `${map.name} arena`);

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

  const banner = el("p", "map-banner");
  banner.setAttribute("aria-live", "polite");
  let bannerTimer = 0;

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

  root.append(canvas, hud, help, status, banner, moveStick.root, aimStick.root, endcard);

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
  let player = spawnTank("player", "You", playerBlueprint, map.spawnA.x, map.spawnA.y, 0, options.hull);
  let rival = spawnTank("rival", options.rivalName, options.rivalGrid, map.spawnB.x, map.spawnB.y, Math.PI, options.rivalHull);
  let camX = 0;
  let camY = 0;
  let camAngle = 0;
  let shots: Shot[] = [];
  let particles: Particle[] = [];
  let floaters: Floater[] = [];
  let lastVolley: TankDebug["lastVolley"] = [];

  function showMapTitle(): void {
    banner.hidden = false;
    banner.textContent = map.name;
    banner.classList.remove("is-on");
    void banner.offsetWidth;
    banner.classList.add("is-on");
    window.clearTimeout(bannerTimer);
    bannerTimer = window.setTimeout(() => {
      banner.hidden = true;
    }, 2600);
  }

  function boot(): void {
    player = spawnTank("player", "You", playerBlueprint, map.spawnA.x, map.spawnA.y, 0, options.hull);
    rival = spawnTank("rival", options.rivalName, options.rivalGrid, map.spawnB.x, map.spawnB.y, Math.PI, options.rivalHull);
    shots = [];
    particles = [];
    floaters = [];
    shake = 0;
    phase = "play";
    paid = false;
    endcard.hidden = true;
    showMapTitle();
    syncHud();
    easeCamera(1);
  }

  function update(dt: number): void {
    const playerCmd = commandsFromPlayer(input, player);
    const rivalCmd = rivalAi.commands({
      self: rival,
      foe: player,
      arena: map,
      incoming: shots.filter((shot) => shot.owner !== "rival").map(shotView),
      dt,
    });
    stepTank(player, playerCmd, dt);
    stepTank(rival, rivalCmd, dt);
    if (defeated(player)) finish("lose");
    else if (defeated(rival)) finish("win");
    if (phase !== "play") {
      stepDecor(dt);
      syncHud();
      return;
    }
    separateTanks();

    for (let i = shots.length - 1; i >= 0; i -= 1) {
      const shot = shots[i];
      shot.x += shot.vx * dt;
      shot.y += shot.vy * dt;
      shot.life -= dt;
      if (shot.life <= 0 || shot.x < -20 || shot.y < -20 || shot.x > map.w + 20 || shot.y > map.h + 20 || hitsBlock(map, shot.x, shot.y, shot.r)) {
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
    const solved = resolveTank(map, tank.x, tank.y, tank.radius);
    tank.x = solved.x;
    tank.y = solved.y;
    if (hitsHazard(map, tank.x, tank.y, tank.radius * 0.72)) {
      tank.core -= LAVA_DPS * dt;
      tank.flash = Math.max(tank.flash, 0.1);
    }
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
        color: gun.heavy ? (tank.id === "player" ? PAL.cyan : PAL.cream) : tank.id === "player" ? PAL.teal : PAL.orange,
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
    const px = view.cellPx / CELL;
    const cover = Math.ceil(Math.hypot(view.viewW, view.viewH) * px) + 8;
    if (worldBuffer.canvas.width !== cover || worldBuffer.canvas.height !== cover) {
      worldBuffer.canvas.width = cover;
      worldBuffer.canvas.height = cover;
    }
    const world = worldBuffer.ctx;
    world.imageSmoothingEnabled = false;
    world.setTransform(1, 0, 0, 1, 0, 0);
    world.fillStyle = PAL.void;
    world.fillRect(0, 0, cover, cover);
    drawArena(world, view, cover);

    const jx = shake > 0 && !reduceMotion ? Math.round((Math.random() - 0.5) * 4) : 0;
    const jy = shake > 0 && !reduceMotion ? Math.round((Math.random() - 0.5) * 4) : 0;
    context.imageSmoothingEnabled = false;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.fillStyle = PAL.void;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.setTransform(1, 0, 0, 1, view.deviceW / 2 + jx, view.deviceH / 2 + jy);
    context.rotate(-camAngle);
    context.drawImage(worldBuffer.canvas, -cover / 2, -cover / 2);
    context.setTransform(1, 0, 0, 1, 0, 0);
    drawTank(rival, PAL.redDark, view);
    drawTank(player, PAL.navy, view);
    for (const shot of shots) drawShot(shot, view);
    for (const bit of particles) drawBit(bit, view);
    context.font = `${Math.max(16, view.cellPx)}px 'Press Start 2P', monospace`;
    context.textAlign = "center";
    context.textBaseline = "bottom";
    for (const floater of floaters) {
      if (floater.life < 0.25) continue;
      artText(floater.text, floater.x, floater.y, view, PAL.paper);
    }
    for (const tank of [rival, player]) drawTankLabel(tank, view);
    drawMinimap(view);
    drawArrow(view);
  }

  /** Screen art pixel for a world point after the camera rotation. Screen up is the player's facing. */
  function worldToArt(x: number, y: number, view: Frame): { x: number; y: number } {
    const dx = x - camX;
    const dy = y - camY;
    const cos = Math.cos(camAngle);
    const sin = Math.sin(camAngle);
    const rx = dx * cos + dy * sin;
    const ry = -dx * sin + dy * cos;
    return { x: view.deviceW / 2 + (rx * view.cellPx) / CELL, y: view.deviceH / 2 + (ry * view.cellPx) / CELL };
  }

  function artText(text: string, worldX: number, worldY: number, view: Frame, color: string): void {
    const at = worldToArt(worldX, worldY, view);
    const ax = Math.round(at.x);
    const ay = Math.round(at.y);
    context.fillStyle = PAL.shadow;
    context.fillText(text, ax + 1, ay + 1);
    context.fillStyle = color;
    context.fillText(text, ax, ay);
  }

  function drawTankLabel(tank: Tank, view: Frame): void {
    const at = worldToArt(tank.x, tank.y, view);
    const ax = Math.round(at.x);
    const ay = Math.round(at.y) - view.cellPx * 4;
    context.fillStyle = PAL.shadow;
    context.fillText(tank.name, ax + 1, ay + 1);
    context.fillStyle = PAL.paper;
    context.fillText(tank.name, ax, ay);
    const bar = view.cellPx * 2;
    context.fillStyle = PAL.shadow;
    context.fillRect(ax - bar / 2, ay + 4, bar, 3);
    context.fillStyle = tank.id === "player" ? PAL.green : PAL.red;
    context.fillRect(ax - bar / 2, ay + 4, Math.round(bar * clamp(tank.core / tank.coreMax, 0, 1)), 3);
  }

  function drawMinimap(view: Frame): void {
    const cols = Math.round(map.w / TILE);
    const rows = Math.round(map.h / TILE);
    const step = 2;
    const unit = 4;
    const mw = Math.ceil(cols / step);
    const mh = Math.ceil(rows / step);
    const ox = view.deviceW - mw * unit - 16;
    const oy = Math.max(16, Math.round(view.deviceH * 0.42));
    context.fillStyle = PAL.shadow;
    context.fillRect(ox - unit, oy - unit, mw * unit + unit * 2, mh * unit + unit * 2);
    context.fillStyle = PAL.paper;
    context.fillRect(ox - unit, oy - unit, mw * unit + unit * 2, 2);
    context.fillRect(ox - unit, oy - unit, 2, mh * unit + unit * 2);
    context.fillStyle = map.ground;
    context.fillRect(ox, oy, mw * unit, mh * unit);
    for (const block of map.blocks) {
      context.fillStyle = block.color;
      const gx = Math.floor(block.x / (TILE * step));
      const gy = Math.floor(block.y / (TILE * step));
      context.fillRect(ox + gx * unit, oy + gy * unit, unit, unit);
    }
    for (const pool of map.hazards) {
      context.fillStyle = PAL.lava;
      const gx = Math.floor(pool.x / (TILE * step));
      const gy = Math.floor(pool.y / (TILE * step));
      context.fillRect(ox + gx * unit, oy + gy * unit, unit, unit);
    }
    const mark = (x: number, y: number, color: string): void => {
      context.fillStyle = color;
      context.fillRect(ox + Math.round(x / (TILE * step)) * unit - 2, oy + Math.round(y / (TILE * step)) * unit - 2, unit + 2, unit + 2);
    };
    mark(rival.x, rival.y, PAL.red);
    mark(player.x, player.y, PAL.cyan);
    context.fillStyle = PAL.gold;
    context.fillRect(
      ox + Math.round(player.x / (TILE * step)) * unit + Math.round(Math.sin(player.angle) * unit * 2),
      oy + Math.round(player.y / (TILE * step)) * unit + Math.round(-Math.cos(player.angle) * unit * 2),
      unit,
      unit,
    );
  }

  function drawArrow(view: Frame): void {
    const at = worldToArt(rival.x, rival.y, view);
    const ax = at.x;
    const ay = at.y;
    const left = 16;
    const right = view.artW - 16;
    const top = Math.round(view.artH * 0.36);
    const bottom = Math.round(view.artH * 0.72);
    if (ax > left && ax < right && ay > top && ay < bottom) return;
    const cx = (left + right) / 2;
    const cy = (top + bottom) / 2;
    const dx = ax - cx;
    const dy = ay - cy;
    const dist = Math.hypot(dx, dy) || 1;
    const hw = (right - left) / 2;
    const hh = (bottom - top) / 2;
    const reach = Math.min(hw / Math.max(1e-4, Math.abs(dx) / dist), hh / Math.max(1e-4, Math.abs(dy) / dist));
    const px = Math.round(cx + (dx / dist) * reach);
    const py = Math.round(cy + (dy / dist) * reach);
    context.fillStyle = PAL.shadow;
    context.fillRect(px - 14, py - 14, 28, 28);
    context.fillStyle = PAL.red;
    context.fillRect(px - 11, py - 11, 22, 22);
    context.fillStyle = PAL.gold;
    const ux = Math.round((dx / dist) * 8);
    const uy = Math.round((dy / dist) * 8);
    context.fillRect(px - 4 + ux, py - 4 + uy, 8, 8);
  }

  function drawArena(world: CanvasRenderingContext2D, view: Frame, cover: number): void {
    const cols = Math.round(map.w / TILE);
    const rows = Math.round(map.h / TILE);
    const frame = Math.floor(simTime * 6);
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const x0 = bufX(c * TILE, cover, view);
        const y0 = bufY(r * TILE, cover, view);
        const x1 = bufX((c + 1) * TILE, cover, view);
        const y1 = bufY((r + 1) * TILE, cover, view);
        if (x1 < 0 || y1 < 0 || x0 > cover || y0 > cover) continue;
        world.fillStyle = (c + r) % 2 === 0 ? map.ground : map.alt;
        world.fillRect(x0, y0, x1 - x0, y1 - y0);
        const n = (Math.imul(c + r * 17 + map.w, 1103515245) + 12345) >>> 16;
        if ((n & 7) === 0) {
          world.fillStyle = PAL.shadow;
          world.fillRect(x0 + (n & 7), y0 + ((n >> 3) & 7), 2, 2);
        }
      }
    }
    for (const pool of map.hazards) stampBlock(world, pool, view, cover, frame);
    for (const block of map.blocks) stampBlock(world, block, view, cover, 0);
    const left = bufX(0, cover, view);
    const top = bufY(0, cover, view);
    const right = bufX(map.w, cover, view);
    const bottom = bufY(map.h, cover, view);
    world.fillStyle = map.edge;
    world.fillRect(left, top, right - left, 3);
    world.fillRect(left, bottom - 3, right - left, 3);
    world.fillRect(left, top, 3, bottom - top);
    world.fillRect(right - 3, top, 3, bottom - top);
  }

  function bufX(wx: number, cover: number, view: Frame): number {
    return Math.round(cover / 2 + ((wx - camX) * view.cellPx) / CELL);
  }

  function bufY(wy: number, cover: number, view: Frame): number {
    return Math.round(cover / 2 + ((wy - camY) * view.cellPx) / CELL);
  }

  function stampBlock(world: CanvasRenderingContext2D, block: MapBlock, view: Frame, cover: number, frame: number): void {
    const x0 = bufX(block.x, cover, view);
    const y0 = bufY(block.y, cover, view);
    const x1 = bufX(block.x + block.w, cover, view);
    const y1 = bufY(block.y + block.h, cover, view);
    const dw = Math.max(1, x1 - x0);
    const dh = Math.max(1, y1 - y0);
    const src = obstacleArt(block.kind, frame);
    const scaled = nearestScale(src, dw, dh, `obs-${block.kind}-${frame}-${dw}x${dh}`);
    world.drawImage(scaled, x0, y0);
  }

  function drawTank(tank: Tank, chassis: string, view: Frame): void {
    const cols = tank.grid[0]?.length ?? 1;
    const rows = tank.grid.length;
    const cell = view.cellPx;
    const gridW = cols * cell;
    const gridH = rows * cell;
    const pad = cell * 2;
    paintLayer(hullSprite, gridW + pad * 2, gridH + pad * 2, () => {
      const ctx = hullSprite.ctx;
      ctx.fillStyle = chassis;
      ctx.fillRect(pad - 2, pad - 2, gridW + 4, gridH + 4);
      ctx.fillStyle = PAL.shadow;
      ctx.fillRect(pad - 2, pad - 2, gridW + 4, 2);
      ctx.fillRect(pad - 2, pad + gridH, gridW + 4, 2);
      ctx.fillRect(pad - 2, pad, 2, gridH);
      ctx.fillRect(pad + gridW, pad, 2, gridH);
      drawNosePixels(ctx, pad, gridW);
      blitCells(ctx, tank, false, pad, cell);
    });
    const at = worldToArt(tank.x, tank.y, view);
    blitRotated(hullSprite.canvas, at.x, at.y, tank.angle - camAngle, pad + gridW / 2, pad + gridH / 2);

    const origin = turretOrigin(tank.hull);
    const pivotX = pad + (origin.c + 1) * cell + cell / 2;
    const pivotY = pad + (origin.r + 1) * cell + cell / 2;
    paintLayer(turretSprite, gridW + pad * 2, gridH + pad * 2, () => {
      blitCells(turretSprite.ctx, tank, true, pad, cell);
      const ctx = turretSprite.ctx;
      const x = pad + origin.c * cell;
      const y = pad + origin.r * cell;
      ctx.fillStyle = PAL.amber;
      ctx.fillRect(x, y, cell * 3, 2);
      ctx.fillRect(x, y + cell * 3 - 2, cell * 3, 2);
      ctx.fillRect(x, y, 2, cell * 3);
      ctx.fillRect(x + cell * 3 - 2, y, 2, cell * 3);
    });
    const pivot = turretPivot(cols, rows, tank.hull);
    const spun = localToWorld(pivot.x, pivot.y, tank.angle);
    const tip = worldToArt(tank.x + spun.x, tank.y + spun.y, view);
    blitRotated(turretSprite.canvas, tip.x, tip.y, tank.turret - camAngle, pivotX, pivotY);
  }

  function drawNosePixels(ctx: CanvasRenderingContext2D, pad: number, gridW: number): void {
    const cx = pad + gridW / 2;
    const y = pad - 8;
    ctx.fillStyle = PAL.gold;
    ctx.fillRect(cx - 6, y + 4, 12, 2);
    ctx.fillStyle = PAL.amber;
    ctx.fillRect(cx - 4, y + 2, 8, 2);
    ctx.fillRect(cx - 2, y, 4, 2);
  }

  function blitCells(ctx: CanvasRenderingContext2D, tank: Tank, turretLayer: boolean, pad: number, cell: number): void {
    const cols = tank.grid[0]?.length ?? 1;
    const rows = tank.grid.length;
    const moving = Math.hypot(tank.vx, tank.vy) > 18;
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        if (isTurretCell(r, c, cols, rows, tank.hull) !== turretLayer) continue;
        const token = tank.grid[r][c];
        const id = moduleIdOf(token);
        const anchor = isAnchorCell(token, r, c);
        const art = moduleArt(id ?? "", {
          flash: Boolean(id && (id === "cannon" || id === "medium-cannon") && anchor && tank.muzzle > 0),
          puff: id === "engine" && moving && Math.floor(simTime * 8) % 2 === 0,
          rear: id === "medium-cannon" && !anchor,
        });
        const scaled = nearestScale(art, Math.round((art.width * cell) / CELL_ART), Math.round((art.height * cell) / CELL_ART), `${id ?? "empty"}-${art.width}x${art.height}-${cell}-${tank.muzzle > 0}-${moving}`);
        const body = scaled.height - cell;
        ctx.drawImage(scaled, pad + c * cell, pad + r * cell - Math.max(0, body));
        if (isCoreCell(r, c, cols, rows, tank.hull)) {
          const pip = Math.max(4, Math.round(cell * 0.28));
          ctx.fillStyle = PAL.red;
          ctx.fillRect(pad + c * cell + cell - pip - 2, pad + r * cell + cell - pip - 2, pip, pip);
          ctx.fillStyle = PAL.gold;
          ctx.fillRect(pad + c * cell + cell - pip, pad + r * cell + cell - pip, Math.max(2, pip - 4), Math.max(2, pip - 4));
        }
        if (tank.flash > 0 && ((r + c) % 2 === 0)) {
          ctx.fillStyle = PAL.white;
          ctx.fillRect(pad + c * cell + 2, pad + r * cell + 2, 2, 2);
        }
        const plateMax = token ? blockPlate(token) : 0;
        const left = plateMax > 0 ? tank.plate[r][c] / plateMax : 1;
        if (token && left < 0.999) {
          ctx.fillStyle = PAL.shadow;
          ctx.fillRect(pad + c * cell + 2, pad + (r + 1) * cell - 4, cell - 4, 2);
          ctx.fillStyle = PAL.paper;
          ctx.fillRect(pad + c * cell + 2, pad + (r + 1) * cell - 4, Math.round((cell - 4) * clamp(left, 0, 1)), 2);
        }
      }
    }
  }

  function paintLayer(sprite: Sprite, width: number, height: number, drawLocal: () => void): void {
    if (sprite.canvas.width !== width || sprite.canvas.height !== height) {
      sprite.canvas.width = width;
      sprite.canvas.height = height;
    }
    const ctx = sprite.ctx;
    ctx.imageSmoothingEnabled = false;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);
    drawLocal();
  }

  function blitRotated(source: HTMLCanvasElement, x: number, y: number, angle: number, originX: number, originY: number): void {
    context.imageSmoothingEnabled = false;
    context.save();
    context.translate(Math.round(x), Math.round(y));
    context.rotate(angle);
    context.drawImage(source, Math.round(-originX), Math.round(-originY));
    context.restore();
  }

  function drawShot(shot: Shot, view: Frame): void {
    const at = worldToArt(shot.x, shot.y, view);
    const src = shotArt();
    const w = Math.max(8, Math.round(view.cellPx * 0.9));
    const h = Math.max(4, Math.round(w * 0.5));
    const scaled = nearestScale(src, w, h, `shot-${w}`);
    context.save();
    context.translate(Math.round(at.x), Math.round(at.y));
    context.rotate(Math.atan2(shot.vy, shot.vx) - camAngle);
    context.drawImage(scaled, -w + 2, Math.round(-h / 2));
    context.restore();
  }

  function drawBit(bit: Particle, view: Frame): void {
    const at = worldToArt(bit.x, bit.y, view);
    const size = bit.puff ? Math.max(3, Math.round(view.cellPx * 0.35)) : Math.max(4, Math.round(view.cellPx * 0.55));
    if (!bit.puff && bit.life > bit.max * 0.45) {
      const boom = nearestScale(boomArt(), size * 2, size * 2, `boom-${size}`);
      context.drawImage(boom, Math.round(at.x - size), Math.round(at.y - size));
      return;
    }
    context.fillStyle = bit.color;
    context.fillRect(Math.round(at.x), Math.round(at.y), size, size);
  }
  interface Frame {
    artW: number;
    artH: number;
    viewW: number;
    viewH: number;
    devicePerArt: number;
    deviceW: number;
    deviceH: number;
    cellPx: number;
    camX: number;
    camY: number;
    rect: DOMRect;
  }

  function measure(): Frame {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const cssW = Math.max(rect.width, 1);
    const cssH = Math.max(rect.height, 1);
    const targetCss = cssW >= 800 ? 64 : 74;
    const rawCell = Math.round((targetCss * dpr) / 7);
    const cellPx = Math.max(CELL_ART, Math.round(rawCell / CELL_ART) * CELL_ART);
    const deviceW = Math.max(1, Math.round(cssW * dpr));
    const deviceH = Math.max(1, Math.round(cssH * dpr));
    if (canvas.width !== deviceW || canvas.height !== deviceH) {
      canvas.width = deviceW;
      canvas.height = deviceH;
    }
    const pxPerWorld = cellPx / CELL;
    return {
      artW: deviceW,
      artH: deviceH,
      viewW: deviceW / pxPerWorld,
      viewH: deviceH / pxPerWorld,
      devicePerArt: 1,
      deviceW,
      deviceH,
      cellPx,
      camX,
      camY,
      rect,
    };
  }

  function easeCamera(dt: number): void {
    const frame = measure();
    const ahead = frame.viewH * 0.2;
    const targetX = player.x + Math.sin(player.angle) * ahead;
    const targetY = player.y - Math.cos(player.angle) * ahead;
    if (reduceMotion) {
      camX = targetX;
      camY = targetY;
      camAngle = player.angle;
    } else {
      const blend = 1 - Math.exp(-8 * dt);
      camX += (targetX - camX) * blend;
      camY += (targetY - camY) * blend;
      camAngle += angleDelta(camAngle, player.angle) * (1 - Math.exp(-12 * dt));
    }
    camX = snapWorld(camX, frame.cellPx);
    camY = snapWorld(camY, frame.cellPx);
  }

  function currentView(): Frame {
    return measure();
  }

  function clientToWorld(clientX: number, clientY: number): { x: number; y: number } {
    const view = currentView();
    const sx = ((clientX - view.rect.left) / Math.max(1, view.rect.width)) * view.deviceW - view.deviceW / 2;
    const sy = ((clientY - view.rect.top) / Math.max(1, view.rect.height)) * view.deviceH - view.deviceH / 2;
    const rx = (sx * CELL) / view.cellPx;
    const ry = (sy * CELL) / view.cellPx;
    const cos = Math.cos(camAngle);
    const sin = Math.sin(camAngle);
    return { x: camX + rx * cos - ry * sin, y: camY + rx * sin + ry * cos };
  }
  function commandsFromPlayer(source: InputController, tank: Tank): TankCommands {
    const drive = source.getDrive();
    const aim = source.getAimStick();
    if (aim.active) return { forward: drive.forward, turn: drive.turn, aimAngle: aim.angle + camAngle, fire: true };
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
    easeCamera(dt);
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
      map: map.id,
      cam: camAngle,
      viewW: measure().viewW,
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
    window.clearTimeout(bannerTimer);
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
    const a = resolveTank(map, player.x - nx * push, player.y - ny * push, player.radius);
    const b = resolveTank(map, rival.x + nx * push, rival.y + ny * push, rival.radius);
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

