import { createBotController, type BotTuning, type ShotView, type TankCommands } from "./control";
import { el } from "./dom";
import { CELL, cellCenter, listGuns } from "./geometry";
import { applyRepair, damageInstance, nextRepair } from "./grid";
import { attachInput, type InputController } from "./input";
import { angleDelta, clamp, localToWorld, rotateToward, worldToLocal } from "./math";
import { hitsBlock, hitsHazard, pickMap, resolveTank, TILE, type ArenaMap, type MapBlock } from "./maps";
import { PAL } from "./palette";
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

const TURRET_TURN = 4.6;
const LAVA_DPS = 18;
/**
 * World units per art pixel. 8 divides both the 24px cell and the 32px map tile,
 * so blocks stay on the pixel grid. The screen then scales those art pixels by an
 * integer so a tank is about 70–80 CSS px tall.
 */
const WORLD_PER_ART = 8;
const TANK_WORLD = 7 * 24;

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
const shotSprite = makeSprite();
const worldBuffer = makeSprite();

function quant(value: number): number {
  return Math.round(value / WORLD_PER_ART) * WORLD_PER_ART;
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
  let pen: CanvasRenderingContext2D = context;
  let surface: CanvasRenderingContext2D = context;
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
    const cover = Math.ceil(Math.hypot(view.artW, view.artH)) + 4;
    if (worldBuffer.canvas.width !== cover || worldBuffer.canvas.height !== cover) {
      worldBuffer.canvas.width = cover;
      worldBuffer.canvas.height = cover;
    }
    const world = worldBuffer.ctx;
    world.imageSmoothingEnabled = false;
    world.setTransform(1, 0, 0, 1, 0, 0);
    world.fillStyle = PAL.void;
    world.fillRect(0, 0, cover, cover);
    const scale = 1 / WORLD_PER_ART;
    world.setTransform(scale, 0, 0, scale, cover / 2 - camX * scale, cover / 2 - camY * scale);
    pen = world;
    surface = world;
    drawArena();
    drawTank(rival, PAL.redDark);
    drawTank(player, PAL.navy);
    for (const shot of shots) {
      paintSprite(shotSprite, 18, 8, 0, 0, () => {
        box(-8, -2, 12, 4, shot.color);
        box(2, -2, 4, 4, PAL.white);
      });
      blit(shotSprite, shot.x, shot.y, Math.atan2(shot.vy, shot.vx), 18, 8);
    }
    for (const bit of particles) {
      box(bit.x, bit.y, 8, 8, bit.color);
    }
    pen = context;
    surface = context;

    const jx = shake > 0 && !reduceMotion ? Math.round((Math.random() - 0.5) * 3) : 0;
    const jy = shake > 0 && !reduceMotion ? Math.round((Math.random() - 0.5) * 3) : 0;
    const ox = Math.floor((view.deviceW - view.artW * view.devicePerArt) / 2);
    const oy = Math.floor((view.deviceH - view.artH * view.devicePerArt) / 2);
    context.imageSmoothingEnabled = false;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.fillStyle = PAL.void;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.setTransform(view.devicePerArt, 0, 0, view.devicePerArt, ox + jx * view.devicePerArt, oy + jy * view.devicePerArt);
    context.translate(view.artW / 2, view.artH / 2);
    context.rotate(-camAngle);
    context.drawImage(worldBuffer.canvas, -cover / 2, -cover / 2);

    context.setTransform(view.devicePerArt, 0, 0, view.devicePerArt, ox, oy);
    context.font = "8px 'Press Start 2P', monospace";
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
  function worldToArt(x: number, y: number, artW: number, artH: number): { x: number; y: number } {
    const dx = x - camX;
    const dy = y - camY;
    const cos = Math.cos(camAngle);
    const sin = Math.sin(camAngle);
    const rx = dx * cos + dy * sin;
    const ry = -dx * sin + dy * cos;
    return { x: artW / 2 + rx / WORLD_PER_ART, y: artH / 2 + ry / WORLD_PER_ART };
  }

  function artText(text: string, worldX: number, worldY: number, view: Frame, color: string): void {
    const at = worldToArt(worldX, worldY, view.artW, view.artH);
    const ax = Math.round(at.x);
    const ay = Math.round(at.y);
    context.fillStyle = PAL.shadow;
    context.fillText(text, ax + 1, ay + 1);
    context.fillStyle = color;
    context.fillText(text, ax, ay);
  }

  function drawTankLabel(tank: Tank, view: Frame): void {
    const at = worldToArt(tank.x, tank.y, view.artW, view.artH);
    const ax = Math.round(at.x);
    const ay = Math.round(at.y) - 18;
    context.fillStyle = PAL.shadow;
    context.fillText(tank.name, ax + 1, ay + 1);
    context.fillStyle = PAL.paper;
    context.fillText(tank.name, ax, ay);
    context.fillStyle = PAL.shadow;
    context.fillRect(ax - 8, ay + 3, 16, 2);
    context.fillStyle = tank.id === "player" ? PAL.green : PAL.red;
    context.fillRect(ax - 8, ay + 3, Math.round(16 * clamp(tank.core / tank.coreMax, 0, 1)), 2);
  }

  function drawMinimap(view: Frame): void {
    const cols = Math.round(map.w / TILE);
    const rows = Math.round(map.h / TILE);
    const step = 2;
    const mw = Math.ceil(cols / step);
    const mh = Math.ceil(rows / step);
    const ox = view.artW - mw - 4;
    const oy = Math.max(4, Math.round(view.artH * 0.4));
    context.fillStyle = PAL.shadow;
    context.fillRect(ox - 1, oy - 1, mw + 2, mh + 2);
    context.fillStyle = PAL.paper;
    context.fillRect(ox - 1, oy - 1, mw + 2, 1);
    context.fillRect(ox - 1, oy - 1, 1, mh + 2);
    context.fillStyle = map.ground;
    context.fillRect(ox, oy, mw, mh);
    for (const block of map.blocks) {
      context.fillStyle = block.color;
      context.fillRect(Math.floor(ox + block.x / (TILE * step)), Math.floor(oy + block.y / (TILE * step)), 1, 1);
    }
    for (const pool of map.hazards) {
      context.fillStyle = PAL.lava;
      context.fillRect(Math.floor(ox + pool.x / (TILE * step)), Math.floor(oy + pool.y / (TILE * step)), 1, 1);
    }
    const mark = (x: number, y: number, color: string): void => {
      context.fillStyle = color;
      context.fillRect(Math.round(ox + x / (TILE * step) - 1), Math.round(oy + y / (TILE * step) - 1), 2, 2);
    };
    mark(rival.x, rival.y, PAL.red);
    mark(player.x, player.y, PAL.cyan);
    context.fillStyle = PAL.gold;
    context.fillRect(
      Math.round(ox + player.x / (TILE * step) + Math.sin(player.angle) * 3),
      Math.round(oy + player.y / (TILE * step) - Math.cos(player.angle) * 3),
      2,
      2,
    );
  }

  function drawArrow(view: Frame): void {
    const at = worldToArt(rival.x, rival.y, view.artW, view.artH);
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
    context.fillRect(px - 6, py - 6, 12, 12);
    context.fillStyle = PAL.red;
    context.fillRect(px - 5, py - 5, 10, 10);
    context.fillStyle = PAL.gold;
    const ux = Math.round((dx / dist) * 3);
    const uy = Math.round((dy / dist) * 3);
    context.fillRect(px - 2 + ux, py - 2 + uy, 4, 4);
  }

  function drawArena(): void {
    box(-TILE * 4, -TILE * 4, map.w + TILE * 8, map.h + TILE * 8, PAL.void);
    const cols = Math.round(map.w / TILE);
    const rows = Math.round(map.h / TILE);
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        box(c * TILE, r * TILE, TILE, TILE, (c + r) % 2 === 0 ? map.ground : map.alt);
        const n = (Math.imul(c + r * 17 + map.w, 1103515245) + 12345) >>> 16;
        if ((n & 7) === 0) box(c * TILE + (n & 14), r * TILE + ((n >> 4) & 14), 2, 2, PAL.shadow);
      }
    }
    for (const pool of map.hazards) drawLava(pool);
    for (const block of map.blocks) drawCover(block);
    edge(0, 0, map.w, map.h, 4, map.edge);
  }

  function drawCover(block: MapBlock): void {
    const { x, y, w, h, kind, color } = block;
    box(x, y, w, h, color);
    edge(x, y, w, h, 2, PAL.shadow);
    box(x + 2, y + 2, w - 4, 2, PAL.paper);
    if (kind === "H") {
      box(x + 4, y + 8, w - 8, 4, PAL.hayDark);
      box(x + 4, y + 18, w - 8, 4, PAL.hayDark);
    } else if (kind === "R" || kind === "P" || kind === "#") {
      box(x + 6, y + 6, 6, 6, PAL.shadow);
      box(x + w - 12, y + h - 12, 6, 6, PAL.gray);
    } else if (kind === "K") {
      box(x + 4, y + 4, 6, 6, PAL.stone);
      box(x + w / 2 - 3, y + 4, 6, 6, PAL.stone);
      box(x + w - 10, y + 4, 6, 6, PAL.stone);
    } else if (kind === "T") {
      box(x + w / 2 - 2, y + 6, 4, h - 12, PAL.brownDark);
      box(x + 8, y + 10, w - 16, 4, PAL.brownDark);
    } else if (kind === "C") {
      box(x + 8, y + 12, w - 16, h - 16, PAL.shadow);
      box(x + 4, y + 4, w - 8, 4, PAL.tan);
    } else if (kind === "Y") {
      box(x + w / 2 - 2, y + 8, 4, h - 10, PAL.brownDark);
      box(x + 6, y + 6, w - 12, 4, PAL.brownDark);
      box(x + 8, y + 14, w - 16, 4, PAL.ink);
    } else if (kind === "F") {
      box(x + 4, y + 4, 2, h - 8, PAL.paper);
      box(x + w / 2 - 1, y + 4, 2, h - 8, PAL.paper);
      box(x + w - 6, y + 4, 2, h - 8, PAL.paper);
      box(x + 4, y + 8, w - 8, 2, PAL.paper);
    } else if (kind === "U" || kind === "N") {
      box(x, y, w, 8, kind === "U" ? PAL.redDark : PAL.sand);
      box(x + 6, y + 14, 6, 6, PAL.gold);
      box(x + w - 12, y + 14, 6, 6, PAL.gold);
    } else if (kind === "X") {
      box(x + 4, y + h / 2 - 2, w - 8, 4, PAL.brownDark);
      box(x + w / 2 - 2, y + 4, 4, h - 8, PAL.brownDark);
    } else if (kind === "S") {
      box(x + 4, y + 6, 10, 6, PAL.sand);
      box(x + 14, y + 14, 10, 8, PAL.brownDark);
    } else if (kind === "V" || kind === "D") {
      box(x + 2, y + h - 10, 8, 6, PAL.tire);
      box(x + w - 10, y + h - 10, 8, 6, PAL.tire);
      box(x + 6, y + 6, w - 12, 6, PAL.cyan);
    } else if (kind === "I") {
      box(x + 4, y + 4, w - 8, 6, PAL.grayDark);
      box(x + 4, y + 12, w - 8, 6, PAL.grayDark);
      box(x + 4, y + 20, w - 8, 6, PAL.grayDark);
      box(x + 12, y + 6, 8, 2, PAL.stoneDark);
      box(x + 12, y + 14, 8, 2, PAL.stoneDark);
    }
  }

  function drawLava(block: MapBlock): void {
    box(block.x, block.y, block.w, block.h, PAL.lava);
    box(block.x + 4, block.y + 4, block.w - 8, block.h - 8, PAL.orange);
    const tick = reduceMotion ? 0 : Math.floor(simTime * 5 + block.x / TILE);
    const bob = (tick % 4) * 4;
    box(block.x + 6 + bob, block.y + 8, 4, 4, PAL.gold);
    box(block.x + 18 - bob, block.y + 18, 4, 4, PAL.cream);
    box(block.x + 10, block.y + 6 + (tick % 3) * 4, 4, 4, PAL.gold);
  }

  function drawTank(tank: Tank, chassis: string): void {
    const cols = tank.grid[0]?.length ?? 1;
    const rows = tank.grid.length;
    const bodyW = cols * CELL;
    const bodyH = rows * CELL;
    const span = Math.max(bodyW, bodyH) + CELL * 4;
    box(tank.x - bodyW * 0.28 + 4, tank.y - bodyH * 0.18 + 6, bodyW * 0.56, bodyH * 0.4, PAL.shadow);
    paintSprite(hullSprite, span, span, 0, 0, () => {
      box(-bodyW / 2 - 4, -bodyH / 2 - 4, bodyW + 8, bodyH + 8, chassis);
      edge(-bodyW / 2 - 4, -bodyH / 2 - 4, bodyW + 8, bodyH + 8, 2, PAL.shadow);
      drawNose(bodyH);
      drawCells(tank, false);
      if (tank.flash > 0) dither(tank, false);
    });
    blit(hullSprite, tank.x, tank.y, tank.angle, span, span);

    const pivot = turretPivot(cols, rows, tank.hull);
    const pivoted = localToWorld(pivot.x, pivot.y, tank.angle);
    paintSprite(turretSprite, span, span, pivot.x, pivot.y, () => {
      drawCells(tank, true);
      const origin = turretOrigin(tank.hull);
      const top = cellCenter(origin.c, origin.r, cols, rows);
      edge(top.x - CELL / 2, top.y - CELL / 2, TURRET_SIZE * CELL, TURRET_SIZE * CELL, 2, PAL.amber);
      if (tank.flash > 0) dither(tank, true);
    });
    blit(turretSprite, tank.x + pivoted.x, tank.y + pivoted.y, tank.turret, span, span);
  }

  function dither(tank: Tank, turretLayer: boolean): void {
    const cols = tank.grid[0]?.length ?? 1;
    const rows = tank.grid.length;
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        if (isTurretCell(r, c, cols, rows, tank.hull) !== turretLayer) continue;
        const center = cellCenter(c, r, cols, rows);
        box(center.x - 4, center.y - 4, 2, 2, PAL.white);
        box(center.x + 2, center.y + 2, 2, 2, PAL.white);
      }
    }
  }

  function drawNose(bodyH: number): void {
    const top = -bodyH / 2 - 10;
    box(-2, top, 4, 2, PAL.amber);
    box(-4, top + 2, 8, 2, PAL.amber);
    box(-6, top + 4, 12, 2, PAL.gold);
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
        const size = CELL - 2;
        const x = center.x - size / 2;
        const y = center.y - size / 2;
        const mod = cellModule(id);
        box(x, y, size, size, mod?.color ?? PAL.void);
        edge(x, y, size, size, 2, PAL.shadow);
        box(x + 2, y + 2, size - 4, 2, PAL.paper);
        if (isCoreCell(r, c, cols, rows, tank.hull)) box(x + size - 8, y + size - 8, 4, 4, PAL.red);
        if (!id || !mod) continue;
        const moving = Math.hypot(tank.vx, tank.vy) > 18;
        const anchor = isAnchorCell(id, r, c);
        if (mod.kind === "weapon") {
          if (mod.id === "medium-cannon" && !anchor) drawBreech(x, y, size);
          else drawCannon(x, y, size, tank.muzzle > 0, (mod.rows ?? 1) > 1);
        } else if (mod.kind === "engine") drawEngine(x, y, size, moving, r * 3 + c);
        else if (mod.id === "heavy-armor") drawRivets(x, y, size);
        else if (mod.repairs) drawPlus(center.x, center.y, 6);
        else drawGlyph(mod.kind, x, y, size);
        if (tank.sparkLife > 0 && tank.sparkCells.some((cell) => cell.r === r && cell.c === c)) {
          drawSpark(center.x, center.y);
        }
        const plateMax = blockPlate(id);
        const left = plateMax > 0 ? tank.plate[r][c] / plateMax : 0;
        if (left < 0.999) {
          box(x + 3, y + size - 6, size - 6, 2, PAL.shadow);
          box(x + 3, y + size - 6, (size - 6) * clamp(left, 0, 1), 2, PAL.paper);
        }
      }
    }
  }

  function drawGlyph(kind: ModuleKind, x: number, y: number, size: number): void {
    if (kind === "armor") {
      edge(x + 6, y + 6, size - 12, size - 12, 2, PAL.navy);
    } else if (kind === "tracks") {
      box(x + 4, y + 6, size - 8, 2, PAL.shadow);
      box(x + 4, y + size / 2 - 1, size - 8, 2, PAL.shadow);
      box(x + 4, y + size - 8, size - 8, 2, PAL.shadow);
    } else if (kind === "power") {
      box(x + size / 2, y + 4, 4, 6, PAL.brownDark);
      box(x + size / 2 - 4, y + 8, 8, 4, PAL.brownDark);
      box(x + size / 2 - 2, y + 12, 4, 6, PAL.brownDark);
    } else if (kind === "fuel") {
      box(x + size / 2 - 2, y + 4, 4, 2, PAL.brownDark);
      box(x + size / 2 - 4, y + 6, 8, 4, PAL.brownDark);
      box(x + size / 2 - 4, y + 10, 8, 6, PAL.brownDark);
      box(x + size / 2 - 2, y + 16, 4, 2, PAL.brownDark);
    }
  }

  function drawCannon(x: number, y: number, size: number, flash: boolean, heavy = false): void {
    const width = heavy ? 10 : 6;
    const length = heavy ? 28 : 16;
    const bx = x + size / 2 - width / 2;
    const by = y - length + 6;
    box(bx, by, width, length, heavy ? PAL.cyan : PAL.white);
    box(bx, by, width, 2, PAL.shadow);
    box(x + 4, y + size * 0.45, size - 8, 6, PAL.shadow);
    if (!flash) return;
    box(bx - 2, by - 4, width + 4, 4, PAL.gold);
    box(bx + 2, by - 8, width - 4, 4, PAL.white);
  }

  function drawBreech(x: number, y: number, size: number): void {
    box(x + 4, y + size * 0.35, size - 8, size * 0.4, PAL.shadow);
  }

  function drawRivets(x: number, y: number, size: number): void {
    box(x + 4, y + 4, 3, 3, PAL.cream);
    box(x + size - 7, y + 4, 3, 3, PAL.cream);
    box(x + 4, y + size - 7, 3, 3, PAL.cream);
    box(x + size - 7, y + size - 7, 3, 3, PAL.cream);
  }

  function drawPlus(x: number, y: number, s: number): void {
    box(x - 1, y - s, 2, s * 2, PAL.paper);
    box(x - s, y - 1, s * 2, 2, PAL.paper);
  }

  function drawSpark(x: number, y: number): void {
    box(x - 6, y - 1, 4, 2, PAL.gold);
    box(x + 2, y - 4, 2, 4, PAL.white);
    box(x - 1, y + 3, 2, 4, PAL.green);
  }

  function drawEngine(x: number, y: number, size: number, moving: boolean, phase: number): void {
    const bob = moving && !reduceMotion ? (Math.floor(simTime * 10 + phase) % 2) * 2 : 0;
    for (let i = 0; i < 3; i += 1) {
      const px = x + 4 + i * ((size - 8) / 3);
      const ph = i === 1 ? 8 : 12;
      box(px, y + 4 + bob, 4, ph, PAL.brownDark);
    }
    box(x + 6, y + size - 4, 2, 8, PAL.shadow);
    box(x + size - 8, y + size - 2, 2, 8, PAL.shadow);
    if (moving) box(x + size / 2 - 2, y + size + 4, 4, 4, (Math.floor(simTime * 8) % 2 === 0 ? PAL.mist : PAL.gray));
  }

  function box(x: number, y: number, w: number, h: number, color: string): void {
    pen.fillStyle = color;
    pen.fillRect(quant(x), quant(y), Math.max(WORLD_PER_ART, quant(w)), Math.max(WORLD_PER_ART, quant(h)));
  }

  function edge(x: number, y: number, w: number, h: number, t: number, color: string): void {
    box(x, y, w, t, color);
    box(x, y + h - t, w, t, color);
    box(x, y, t, h, color);
    box(x + w - t, y, t, h, color);
  }

  function paintSprite(
    sprite: Sprite,
    worldW: number,
    worldH: number,
    originX: number,
    originY: number,
    drawLocal: () => void,
  ): void {
    const artW = Math.max(1, Math.ceil(worldW / WORLD_PER_ART));
    const artH = Math.max(1, Math.ceil(worldH / WORLD_PER_ART));
    if (sprite.canvas.width !== artW || sprite.canvas.height !== artH) {
      sprite.canvas.width = artW;
      sprite.canvas.height = artH;
    }
    const ctx = sprite.ctx;
    ctx.imageSmoothingEnabled = false;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, artW, artH);
    ctx.setTransform(
      1 / WORLD_PER_ART,
      0,
      0,
      1 / WORLD_PER_ART,
      artW / 2 - originX / WORLD_PER_ART,
      artH / 2 - originY / WORLD_PER_ART,
    );
    pen = ctx;
    drawLocal();
    pen = surface;
  }

  function blit(sprite: Sprite, x: number, y: number, angle: number, worldW: number, worldH: number): void {
    surface.imageSmoothingEnabled = false;
    surface.save();
    surface.translate(quant(x), quant(y));
    surface.rotate(angle);
    surface.drawImage(sprite.canvas, -worldW / 2, -worldH / 2, worldW, worldH);
    surface.restore();
  }

  interface Frame {
    artW: number;
    artH: number;
    viewW: number;
    viewH: number;
    devicePerArt: number;
    deviceW: number;
    deviceH: number;
    camX: number;
    camY: number;
    rect: DOMRect;
  }

  function measure(): Frame {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const tankArt = TANK_WORLD / WORLD_PER_ART;
    const targetCss = rect.width >= 800 ? 60 : 76;
    const devicePerArt = Math.max(2, Math.round((targetCss * dpr) / tankArt));
    const deviceW = Math.max(1, Math.round(Math.max(rect.width, 1) * dpr));
    const deviceH = Math.max(1, Math.round(Math.max(rect.height, 1) * dpr));
    const artW = Math.max(1, Math.floor(deviceW / devicePerArt));
    const artH = Math.max(1, Math.floor(deviceH / devicePerArt));
    if (canvas.width !== deviceW || canvas.height !== deviceH) {
      canvas.width = deviceW;
      canvas.height = deviceH;
    }
    return {
      artW,
      artH,
      viewW: artW * WORLD_PER_ART,
      viewH: artH * WORLD_PER_ART,
      devicePerArt,
      deviceW,
      deviceH,
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
    camX = quant(camX);
    camY = quant(camY);
  }

  function currentView(): Frame {
    return measure();
  }

  function clientToWorld(clientX: number, clientY: number): { x: number; y: number } {
    const view = currentView();
    const sx = ((clientX - view.rect.left) / Math.max(1, view.rect.width)) * view.artW - view.artW / 2;
    const sy = ((clientY - view.rect.top) / Math.max(1, view.rect.height)) * view.artH - view.artH / 2;
    const rx = sx * WORLD_PER_ART;
    const ry = sy * WORLD_PER_ART;
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

