import { createBotController, type BotTuning, type ShotView, type TankCommands } from "./control";
import { el } from "./dom";
import { CELL, cellCenter, listGuns, pushBox, pushCircleFromBox, type OrientedBox } from "./geometry";
import { applyRepair, damageInstance, nextRepair } from "./grid";
import { attachInput, type InputController } from "./input";
import { readArtStyle } from "./config";
import { angleDelta, clamp, localToWorld, rotateToward, traceRoundRect, worldToLocal } from "./math";
import { hitsBlock, hitsHazard, pickMap, resolveTank, TILE, type ArenaMap, type MapBlock } from "./maps";
import { PAL } from "./palette";
import { CELL_ART, boomArt, droneArt, moduleArt, nearestScale, obstacleArt, shotArt } from "./sprites";
import {
  blockPlate,
  cloneGrid,
  createDefaultGrid,
  getModule,
  hasTurret,
  isAnchorCell,
  isTurretCell,
  moduleIdOf,
  partRole,
  turretOrigin,
  TURRET_SIZE,
  type PartRole,
} from "./modules";
import { sfxBoom, sfxHit, sfxShot } from "./sfx";
import { computeStats, fuelDrainPerSecond, maxDriveSpeed, maxTurnRate } from "./stats";
import type { ModuleKind } from "./types";

const TURRET_TURN = 4.6;
const LAVA_DPS = 16;
const CUTTER_DPS = 28;
const HARPOON_PULL = 240;
const HARPOON_TIME = 1.15;
/** Shield HP added by each generator. Recharge rate also scales with the count. */
const SHIELD_HP = 80;
const SHIELD_DELAY = 3.5;
const SHIELD_REGEN = 24;
const DRONE_HP = 34;
const DRONE_PERIOD = 8;
const DRONE_FIRST = 0.7;
const DRONE_DAMAGE = 8;
const DRONE_LIFE = 1.45;
const DRONE_SPEED = 188;
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
  shield: number;
  shieldMax: number;
  shieldDelay: number;
  launch: Record<string, number>;
}

interface Drone {
  owner: Side;
  bay: string;
  x: number;
  y: number;
  angle: number;
  hp: number;
  hpMax: number;
  cooldown: number;
  radius: number;
  flash: number;
  muzzle: number;
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
  hook?: boolean;
}

interface Tether {
  owner: Side;
  life: number;
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
  fuel: number;
  weapons: number;
  power: number;
  speed: number;
  shots: number;
  phase: "play" | "win" | "lose";
  guns: Array<"hull" | "turret">;
  modules: number;
  rivalWeapons: number;
  rivalPower: number;
  rivalModules: number;
  tether: number;
  overlap: boolean;
  rivalTurret: number;
  rivalX: number;
  rivalY: number;
  map: string;
  cam: number;
  viewW: number;
  lastVolley: Array<{ mount: "hull" | "turret"; angle: number }>;
  shield: number;
  shieldMax: number;
  drones: number;
  droneX: number;
  droneY: number;
  droneAngle: number;
  hull: string;
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
  const fuelLabel = el("div", "meter-label");
  fuelLabel.append(el("span", undefined, "Fuel"), el("span", "meter-value", ""));
  const fuelMeter = el("div", "meter meter-fuel");
  const fuelFill = el("span");
  fuelMeter.append(fuelFill);
  readout.append(fuelLabel, fuelMeter);
  const scrap = el("div", "scrap-pill hud-scrap");
  const scrapValue = el("span", undefined, "");
  scrap.append(el("span", "scrap-nut", "⬡"), scrapValue);
  hud.append(exit, readout, scrap);

  const turreted = hasTurret(options.hull);
  const help = el(
    "p",
    "battle-help",
    turreted
      ? "Up/down drives, left/right turns. Aim stick spins the turret and fires every gun."
      : "Up/down drives, left/right turns. Guns fire along the hull. Hold the aim stick to shoot.",
  );
  const status = el("p", "battle-status");
  status.setAttribute("aria-live", "polite");

  const moveStick = joystick("move", "Move", "Move. Up and down drive. Left and right turn.");
  const aimStick = joystick(
    "aim",
    "Aim",
    turreted ? "Aim. Spins the turret and fires while held." : "Aim. Fires every hull gun while held.",
  );

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
  let drones: Drone[] = [];
  let tether: Tether | null = null;
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
    drones = [];
    tether = null;
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
    stepDrones(dt);
    stepTether(dt);
    separateBodies();
    stepCutters(dt);
    if (defeated(player)) finish("lose");
    else if (defeated(rival)) finish("win");
    if (phase !== "play") {
      stepDecor(dt);
      syncHud();
      return;
    }

    for (let i = shots.length - 1; i >= 0; i -= 1) {
      const shot = shots[i];
      shot.x += shot.vx * dt;
      shot.y += shot.vy * dt;
      shot.life -= dt;
      if (shot.life <= 0 || shot.x < -20 || shot.y < -20 || shot.x > map.w + 20 || shot.y > map.h + 20 || hitsBlock(map, shot.x, shot.y, shot.r)) {
        shots.splice(i, 1);
        continue;
      }
      const drone = drones.find(
        (unit) => unit.hp > 0 && unit.owner !== shot.owner && Math.hypot(shot.x - unit.x, shot.y - unit.y) <= unit.radius + shot.r,
      );
      if (drone) {
        hurtDrone(drone, shot.damage);
        if (drone.hp <= 0) drones.splice(drones.indexOf(drone), 1);
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
    scorch(tank, dt);
    if (!hasTurret(tank.hull)) tank.turret = tank.angle;
    else if (cmd.aimAngle !== null) tank.turret = rotateToward(tank.turret, cmd.aimAngle, TURRET_TURN * dt);
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
    stepShield(tank, dt, stats.powerFactor);
    stepLaunch(tank, dt, stats.powerFactor);
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
      const reach = gun.hook ? 1.35 : gun.siege ? 2.35 : gun.heavy ? 1.7 : 0.95;
      const muzzle = mountPoint(tank, gun.lx, gun.ly - CELL * reach, gun.mount === "turret");
      const speed = gun.hook ? 430 : gun.siege ? 470 : 540;
      shots.push({
        x: muzzle.x,
        y: muzzle.y,
        vx: Math.sin(angle) * speed,
        vy: -Math.cos(angle) * speed,
        r: gun.hook ? 3.2 : gun.siege ? 8.2 : gun.heavy ? 6.4 : 4.5,
        damage: gun.damage,
        life: gun.life,
        owner: tank.id,
        hook: gun.hook,
        color: gun.hook
          ? PAL.cream
          : gun.siege
            ? tank.id === "player"
              ? PAL.gold
              : PAL.amber
            : gun.heavy
              ? tank.id === "player"
                ? PAL.cyan
                : PAL.cream
              : tank.id === "player"
                ? PAL.teal
                : PAL.orange,
      });
    }
    if (tank.id === "player") {
      lastVolley = guns.map((gun) => ({
        mount: gun.mount,
        angle: gun.mount === "turret" ? tank.turret : tank.angle,
      }));
    }
    if (shots.length > 120) shots.splice(0, shots.length - 120);
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
        if (!tank.grid[r][c] || !shotInCell(tank, shot, r, c)) continue;
        const center = cellCenter(c, r, cols, rows);
        const world = mountPoint(tank, center.x, center.y, turret);
        const dist = Math.hypot(shot.x - world.x, shot.y - world.y);
        if (!best || dist < best.d) best = { r, c, d: dist, turret };
      }
    }
    const bubble = tank.shield > 0 && inBubble(tank, shot);
    let damage = shot.damage;
    if (bubble) {
      damage = absorb(tank, damage);
      if (damage <= 0) {
        const edge = shieldRadius(tank);
        burst(tank.x + ((shot.x - tank.x) / edge) * 8, tank.y + ((shot.y - tank.y) / edge) * 8, PAL.cyan, 5);
        return true;
      }
    }
    if (!best) return bubble;
    hurtCell(tank, best.r, best.c, damage);
    if (shot.hook) tether = { owner: shot.owner, life: HARPOON_TIME };
    sfxHit();
    return true;
  }

  function hurtCell(tank: Tank, row: number, col: number, amount: number): void {
    const mod = cellModule(tank.grid[row][col]);
    const hit = damageInstance(tank.grid, tank.plate, row, col, amount);
    tank.flash = 0.08;
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
    const pixel = readArtStyle() === "pixel";
    world.imageSmoothingEnabled = !pixel;
    world.setTransform(1, 0, 0, 1, 0, 0);
    world.fillStyle = PAL.void;
    world.fillRect(0, 0, cover, cover);
    if (pixel) {
      drawArena(world, view, cover);
    } else {
      const scale = view.cellPx / CELL;
      world.setTransform(scale, 0, 0, scale, cover / 2 - camX * scale, cover / 2 - camY * scale);
      pen = world;
      drawSmoothArena();
      drawSmoothTank(rival, "#5a2430");
      drawSmoothTank(player, "#2a3142");
      for (const tank of [rival, player]) drawSmoothShield(tank);
      for (const drone of drones) drawSmoothDrone(drone);
      drawSmoothTether();
      for (const shot of shots) {
        pen.save();
        pen.translate(shot.x, shot.y);
        pen.rotate(Math.atan2(shot.vy, shot.vx));
        pen.fillStyle = shot.color;
        const length = shot.hook ? 26 : 8 + shot.r * 1.7;
        const thick = shot.hook ? 3 : Math.max(4, shot.r * 0.72);
        traceRoundRect(pen, -length, -thick / 2, length + 4, thick, shot.hook ? 1 : 3);
        pen.fill();
        if (shot.hook) {
          pen.fillStyle = PAL.gold;
          pen.beginPath();
          pen.moveTo(4, 0);
          pen.lineTo(-2, -5);
          pen.lineTo(-2, 5);
          pen.closePath();
          pen.fill();
        }
        pen.restore();
      }
      for (const bit of particles) {
        pen.globalAlpha = Math.max(0, bit.life / bit.max);
        pen.fillStyle = bit.color;
        if (bit.puff) {
          pen.beginPath();
          pen.arc(bit.x, bit.y, bit.size, 0, Math.PI * 2);
          pen.fill();
        } else {
          pen.fillRect(bit.x, bit.y, bit.size, bit.size);
        }
        pen.globalAlpha = 1;
      }
      pen = context;
    }

    const jx = shake > 0 && !reduceMotion ? Math.round((Math.random() - 0.5) * 4) : 0;
    const jy = shake > 0 && !reduceMotion ? Math.round((Math.random() - 0.5) * 4) : 0;
    context.imageSmoothingEnabled = !pixel;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.fillStyle = PAL.void;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.setTransform(1, 0, 0, 1, view.deviceW / 2 + jx, view.deviceH / 2 + jy);
    context.rotate(-camAngle);
    context.drawImage(worldBuffer.canvas, -cover / 2, -cover / 2);
    context.setTransform(1, 0, 0, 1, 0, 0);
    if (pixel) {
      drawTank(rival, PAL.redDark, view);
      drawTank(player, PAL.navy, view);
      for (const tank of [rival, player]) drawPixelShield(tank, view);
      for (const drone of drones) drawPixelDrone(drone, view);
      drawPixelTether(view);
      for (const shot of shots) drawShot(shot, view);
      for (const bit of particles) drawBit(bit, view);
    }
    context.font = pixel
      ? `${Math.max(16, view.cellPx)}px 'Press Start 2P', monospace`
      : "700 32px Trebuchet MS, Verdana, sans-serif";
    context.textAlign = "center";
    context.textBaseline = "bottom";
    for (const floater of floaters) {
      if (floater.life < 0.25) continue;
      artText(floater.text, floater.x, floater.y, view, PAL.paper);
    }
    for (const tank of [rival, player]) drawTankLabel(tank, view);
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

  function drawSmoothArena(): void {
    pen.fillStyle = "#10141c";
    pen.fillRect(-900, -900, map.w + 1800, map.h + 1800);
    const cols = Math.round(map.w / TILE);
    const rows = Math.round(map.h / TILE);
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        pen.fillStyle = (c + r) % 2 === 0 ? map.ground : map.alt;
        pen.fillRect(c * TILE, r * TILE, TILE, TILE);
        const n = (Math.imul(c + r * 17 + map.w, 1103515245) + 12345) >>> 16;
        if ((n & 3) === 0) {
          pen.fillStyle = "rgba(0,0,0,0.16)";
          pen.fillRect(c * TILE + (n & 15), r * TILE + ((n >> 4) & 15), 7, 7);
        }
      }
    }
    for (const pool of map.hazards) drawSmoothLava(pool);
    for (const block of map.blocks) drawSmoothCover(block);
    pen.strokeStyle = map.edge;
    pen.lineWidth = 10;
    pen.strokeRect(5, 5, map.w - 10, map.h - 10);
  }

  function drawSmoothCover(block: MapBlock): void {
    const { x, y, w, h, kind, color } = block;
    pen.fillStyle = color;
    pen.fillRect(x, y, w, h);
    pen.strokeStyle = "#0e1116";
    pen.lineWidth = 3;
    pen.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3);
    if (kind === "H") {
      pen.fillStyle = "#8a6a32";
      pen.fillRect(x + 4, y + 8, w - 8, 5);
      pen.fillRect(x + 4, y + 18, w - 8, 5);
    } else if (kind === "R" || kind === "P" || kind === "#") {
      pen.fillStyle = "rgba(0,0,0,0.28)";
      pen.fillRect(x + 6, y + 6, 10, 10);
      pen.fillRect(x + w - 14, y + h - 14, 8, 8);
    } else if (kind === "K") {
      pen.fillStyle = "#8a8478";
      pen.fillRect(x + 3, y + 3, 6, 6);
      pen.fillRect(x + w / 2 - 3, y + 3, 6, 6);
      pen.fillRect(x + w - 9, y + 3, 6, 6);
    } else if (kind === "T") {
      pen.fillStyle = "#4a4038";
      pen.fillRect(x + w / 2 - 2, y + 6, 4, h - 14);
      pen.fillRect(x + 8, y + 10, w - 16, 4);
    } else if (kind === "C") {
      pen.fillStyle = "#1a1614";
      pen.fillRect(x + 10, y + 12, w - 20, h - 16);
      pen.fillStyle = "#cfc6b8";
      pen.fillRect(x + 4, y + 4, w - 8, 5);
    } else if (kind === "Y") {
      pen.fillStyle = "#241810";
      pen.fillRect(x + w / 2 - 3, y + 6, 6, h - 8);
      pen.fillRect(x + 6, y + 8, w - 12, 5);
      pen.fillRect(x + 8, y + 16, w - 16, 4);
    } else if (kind === "F") {
      pen.fillStyle = "#c5ccd4";
      pen.fillRect(x + 5, y + 4, 3, h - 8);
      pen.fillRect(x + w / 2 - 1, y + 4, 3, h - 8);
      pen.fillRect(x + w - 8, y + 4, 3, h - 8);
      pen.fillRect(x + 4, y + 8, w - 8, 3);
    } else if (kind === "U" || kind === "N") {
      pen.fillStyle = kind === "U" ? "#6e2f22" : "#8d7d62";
      pen.fillRect(x, y, w, 9);
      pen.fillStyle = "#f6f1e6";
      pen.fillRect(x + 6, y + 14, 7, 7);
      pen.fillRect(x + w - 13, y + 14, 7, 7);
    } else if (kind === "X") {
      pen.fillStyle = "#8a5a22";
      pen.fillRect(x + 4, y + w / 2 - 2, w - 8, 4);
      pen.fillRect(x + w / 2 - 2, y + 4, 4, h - 8);
    } else if (kind === "S") {
      pen.fillStyle = "#c4a15a";
      pen.fillRect(x + 4, y + 6, 12, 8);
      pen.fillStyle = "#4a4038";
      pen.fillRect(x + 14, y + 14, 12, 10);
    } else if (kind === "V" || kind === "D") {
      pen.fillStyle = "#141820";
      pen.fillRect(x + 3, y + h - 10, 8, 7);
      pen.fillRect(x + w - 11, y + h - 10, 8, 7);
      pen.fillStyle = "#d7e2ea";
      pen.fillRect(x + 7, y + 6, w - 14, 8);
    } else if (kind === "I") {
      pen.fillStyle = "#2a2a2a";
      pen.fillRect(x + 5, y + 4, w - 10, 7);
      pen.fillRect(x + 5, y + 13, w - 10, 7);
      pen.fillRect(x + 5, y + 22, w - 10, 6);
      pen.fillStyle = "#5c5346";
      pen.fillRect(x + 12, y + 5, 8, 5);
      pen.fillRect(x + 12, y + 14, 8, 5);
    }
  }

  function drawSmoothLava(block: MapBlock): void {
    pen.fillStyle = block.color;
    pen.fillRect(block.x, block.y, block.w, block.h);
    const flicker = reduceMotion ? 0 : Math.sin(simTime * 5 + block.x * 0.08) * 2;
    pen.fillStyle = "#ffba08";
    pen.fillRect(block.x + 7, block.y + 7 + flicker * 0.15, block.w - 14, block.h - 14);
    pen.fillStyle = "#fff3bf";
    pen.fillRect(block.x + 13, block.y + 13, 6, 6);
  }

  function drawSmoothTank(tank: Tank, chassis: string): void {
    const cols = tank.grid[0]?.length ?? 1;
    const rows = tank.grid.length;
    const bodyW = cols * CELL;
    const bodyH = rows * CELL;
    pen.save();
    pen.translate(tank.x + 4, tank.y + 6);
    pen.rotate(tank.angle);
    pen.fillStyle = "rgba(0,0,0,0.28)";
    pen.beginPath();
    pen.ellipse(0, 0, bodyW * 0.42, bodyH * 0.42, 0, 0, Math.PI * 2);
    pen.fill();
    pen.restore();

    pen.save();
    pen.globalAlpha = tank.flash > 0 ? 0.72 : 1;
    pen.translate(tank.x, tank.y);
    pen.rotate(tank.angle);
    traceRoundRect(pen, -bodyW / 2 - 4, -bodyH / 2 - 4, bodyW + 8, bodyH + 8, 12);
    pen.fillStyle = chassis;
    pen.fill();
    pen.strokeStyle = "#0e1116";
    pen.lineWidth = 4;
    pen.stroke();
    pen.fillStyle = "#ffb703";
    pen.beginPath();
    pen.moveTo(0, -bodyH / 2 - 12);
    pen.lineTo(10, -bodyH / 2 + 2);
    pen.lineTo(-10, -bodyH / 2 + 2);
    pen.closePath();
    pen.fill();
    drawSmoothCells(tank, false);
    pen.restore();

    const origin = turretOrigin(tank.hull);
    if (!origin) return;
    const pivot = turretPivot(cols, rows, tank.hull);
    if (!pivot) return;
    const pivoted = localToWorld(pivot.x, pivot.y, tank.angle);
    pen.save();
    pen.translate(tank.x + pivoted.x, tank.y + pivoted.y);
    pen.rotate(tank.turret);
    pen.translate(-pivot.x, -pivot.y);
    drawSmoothCells(tank, true);
    const top = cellCenter(origin.c, origin.r, cols, rows);
    pen.strokeStyle = "#ffb703";
    pen.lineWidth = 3;
    traceRoundRect(pen, top.x - CELL / 2 - 2, top.y - CELL / 2 - 2, TURRET_SIZE * CELL + 4, TURRET_SIZE * CELL + 4, 8);
    pen.stroke();
    pen.restore();

  }

  function drawSmoothCells(tank: Tank, turretLayer: boolean): void {
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
        pen.beginPath();
        pen.rect(x, y, size, size);
        pen.fillStyle = mod?.color ?? "#141820";
        pen.fill();
        pen.lineWidth = mod?.id === "heavy-armor" ? 3.5 : 2;
        pen.strokeStyle = mod?.id === "heavy-armor" ? "#1a222c" : "#0e1116";
        pen.stroke();
        if (!id || !mod) continue;
        const moving = Math.hypot(tank.vx, tank.vy) > 18;
        const role = partRole(id, r, c);
        if (mod.kind === "weapon") {
          if (mod.hook) drawSmoothHarpoon(center.x, center.y, size, role, tank.muzzle > 0 && role === "front");
          else if (mod.cutter) drawSmoothCutter(center.x, center.y, size);
          else if (mod.id === "heavy-cannon") drawSmoothHeavy(center.x, center.y, size, role, tank.muzzle > 0 && role === "front");
          else if (mod.id === "medium-cannon" && role === "rear") drawSmoothBreech(center.x, center.y, size);
          else drawSmoothCannon(center.x, center.y, size, tank.muzzle > 0, (mod.rows ?? 1) > 1);
        } else if (mod.drone) drawSmoothBay(center.x, center.y, size, role);
        else if (mod.generator) drawSmoothGenerator(center.x, center.y, size, role);
        else if (mod.kind === "engine") drawSmoothEngine(center.x, center.y, size, moving, simTime + r * 1.7 + c);
        else {
          pen.fillStyle = "rgba(255,255,255,0.22)";
          pen.fillRect(x + 3, y + 3, size - 6, 4);
          if (mod.id === "heavy-armor") drawSmoothRivets(x, y, size);
          else if (mod.repairs) drawSmoothPlus(center.x, center.y, size * 0.28);
          else drawSmoothGlyph(mod.kind, center.x, center.y, size * 0.26);
        }
        if (tank.sparkLife > 0 && tank.sparkCells.some((cell) => cell.r === r && cell.c === c)) {
          drawSmoothSpark(center.x, center.y, size, tank.sparkLife);
        }
        const plateMax = blockPlate(id);
        const left = plateMax > 0 ? tank.plate[r][c] / plateMax : 0;
        if (left < 0.999) {
          pen.fillStyle = "rgba(14,17,22,0.45)";
          pen.fillRect(x + 3, y + size - 6, size - 6, 3);
          pen.fillStyle = "#f6f1e6";
          pen.fillRect(x + 3, y + size - 6, (size - 6) * clamp(left, 0, 1), 3);
        }
      }
    }
  }

  function drawSmoothGlyph(kind: ModuleKind, x: number, y: number, s: number): void {
    pen.save();
    pen.translate(x, y);
    pen.strokeStyle = "rgba(14,17,22,0.55)";
    pen.fillStyle = "rgba(14,17,22,0.55)";
    pen.lineWidth = 2;
    pen.lineCap = "round";
    pen.beginPath();
    if (kind === "armor") {
      pen.rect(-s, -s, s * 2, s * 2);
      pen.stroke();
    } else if (kind === "tracks") {
      pen.moveTo(-s, -s * 0.5);
      pen.lineTo(s, -s * 0.5);
      pen.moveTo(-s, 0);
      pen.lineTo(s, 0);
      pen.moveTo(-s, s * 0.5);
      pen.lineTo(s, s * 0.5);
      pen.stroke();
    } else if (kind === "power") {
      pen.moveTo(s * 0.15, -s);
      pen.lineTo(-s * 0.45, s * 0.1);
      pen.lineTo(0, s * 0.1);
      pen.lineTo(-s * 0.1, s);
      pen.lineTo(s * 0.55, -s * 0.05);
      pen.closePath();
      pen.fill();
    } else if (kind === "fuel") {
      pen.arc(0, 0, s * 0.55, 0, Math.PI * 2);
      pen.fill();
    }
    pen.restore();
  }

  function drawSmoothCannon(x: number, y: number, size: number, flash: boolean, heavy = false): void {
    const half = size / 2;
    const width = size * (heavy ? 0.48 : 0.3);
    const length = size * (heavy ? 1.9 : 1.05);
    pen.save();
    pen.translate(x, y);
    pen.fillStyle = "#d8fff8";
    pen.strokeStyle = "#0e1116";
    pen.lineWidth = 2;
    traceRoundRect(pen, -width / 2, -half - length * 0.62, width, length, 2);
    pen.fill();
    pen.stroke();
    pen.fillStyle = "#12312e";
    pen.fillRect(-width * 0.22, -half - length * 0.62, width * 0.44, 3);
    pen.fillStyle = "rgba(14,17,22,0.35)";
    pen.fillRect(-half * 0.7, half * 0.15, half * 1.4, half * 0.55);
    if (flash) {
      pen.fillStyle = "rgba(255, 236, 160, 0.95)";
      pen.beginPath();
      pen.arc(0, -half - length * 0.7, size * 0.32, 0, Math.PI * 2);
      pen.fill();
      pen.fillStyle = "#fff7d6";
      pen.beginPath();
      pen.arc(0, -half - length * 0.7, size * 0.14, 0, Math.PI * 2);
      pen.fill();
    }
    pen.restore();
  }

  function drawSmoothHarpoon(x: number, y: number, size: number, role: PartRole, flash: boolean): void {
    const half = size / 2;
    pen.save();
    pen.translate(x, y);
    pen.strokeStyle = "#0e1116";
    pen.lineWidth = 2;
    if (role === "rear") {
      pen.fillStyle = "#6a5a48";
      pen.beginPath();
      pen.arc(0, 0, half * 0.62, 0, Math.PI * 2);
      pen.fill();
      pen.stroke();
      pen.strokeStyle = "#c8b090";
      pen.lineWidth = 3;
      pen.beginPath();
      pen.arc(0, 0, half * 0.34, 0.4, 4.2);
      pen.stroke();
      pen.fillStyle = "#2a241c";
      pen.beginPath();
      pen.arc(0, 0, half * 0.16, 0, Math.PI * 2);
      pen.fill();
    } else {
      pen.fillStyle = "#c8b090";
      pen.fillRect(-2.2, -half - size * 1.15, 4.4, size * 1.35);
      pen.strokeRect(-2.2, -half - size * 1.15, 4.4, size * 1.35);
      pen.fillStyle = flash ? "#fff1c2" : "#f4ecd4";
      pen.beginPath();
      pen.moveTo(0, -half - size * 1.45);
      pen.lineTo(7, -half - size * 1.05);
      pen.lineTo(-7, -half - size * 1.05);
      pen.closePath();
      pen.fill();
      pen.stroke();
      pen.fillStyle = "#3a3028";
      traceRoundRect(pen, -half * 0.7, half * 0.05, half * 1.4, half * 0.7, 2);
      pen.fill();
      pen.stroke();
    }
    pen.restore();
  }

  function drawSmoothCutter(x: number, y: number, size: number): void {
    pen.save();
    pen.translate(x, y);
    pen.rotate(simTime * 9);
    pen.fillStyle = "#d7deea";
    pen.strokeStyle = "#0e1116";
    pen.lineWidth = 2;
    pen.beginPath();
    pen.arc(0, 0, size * 0.34, 0, Math.PI * 2);
    pen.fill();
    pen.stroke();
    pen.fillStyle = "#3a3a48";
    for (let i = 0; i < 8; i += 1) {
      pen.rotate(Math.PI / 4);
      pen.beginPath();
      pen.moveTo(size * 0.16, -2);
      pen.lineTo(size * 0.42, 0);
      pen.lineTo(size * 0.16, 2);
      pen.closePath();
      pen.fill();
    }
    pen.fillStyle = "#f4ecd4";
    pen.beginPath();
    pen.arc(0, 0, size * 0.1, 0, Math.PI * 2);
    pen.fill();
    pen.stroke();
    pen.restore();
  }

  function drawSmoothTether(): void {
    if (!tether || tether.life <= 0) return;
    const owner = tether.owner === "player" ? player : rival;
    const target = tether.owner === "player" ? rival : player;
    const from = harpoonTip(owner) ?? { x: owner.x, y: owner.y };
    pen.save();
    pen.strokeStyle = PAL.cream;
    pen.lineWidth = 3;
    pen.lineCap = "round";
    pen.beginPath();
    pen.moveTo(from.x, from.y);
    pen.lineTo(target.x, target.y);
    pen.stroke();
    pen.fillStyle = PAL.gold;
    pen.beginPath();
    pen.arc(target.x, target.y, 6, 0, Math.PI * 2);
    pen.fill();
    pen.restore();
  }

  function drawSmoothHeavy(x: number, y: number, size: number, role: PartRole, flash: boolean): void {
    const half = size / 2;
    pen.save();
    pen.translate(x, y);
    pen.strokeStyle = "#0e1116";
    pen.lineWidth = 2;
    if (role === "rear") {
      pen.fillStyle = "#6a5830";
      traceRoundRect(pen, -half * 0.78, -half * 0.55, half * 1.56, half * 1.25, 3);
      pen.fill();
      pen.stroke();
      pen.fillStyle = "#241c10";
      pen.fillRect(-half * 0.42, -half * 0.22, half * 0.84, half * 0.62);
      pen.fillStyle = "#f0d78a";
      pen.beginPath();
      pen.arc(-half * 0.42, -half * 0.28, 2.2, 0, Math.PI * 2);
      pen.arc(half * 0.42, half * 0.28, 2.2, 0, Math.PI * 2);
      pen.fill();
    } else if (role === "mid") {
      const grad = pen.createLinearGradient(-half * 0.4, 0, half * 0.4, 0);
      grad.addColorStop(0, "#4a3514");
      grad.addColorStop(0.45, "#fff1c2");
      grad.addColorStop(1, "#3a2a10");
      pen.fillStyle = grad;
      pen.fillRect(-half * 0.36, -half * 1.15, half * 0.72, half * 2.3);
      pen.strokeRect(-half * 0.36, -half * 1.15, half * 0.72, half * 2.3);
      pen.fillStyle = "#241c10";
      pen.fillRect(-half * 0.7, -half * 0.16, half * 1.4, half * 0.32);
    } else {
      const width = size * 0.42;
      const length = size * 2.35;
      const grad = pen.createLinearGradient(-width / 2, 0, width / 2, 0);
      grad.addColorStop(0, "#5c4318");
      grad.addColorStop(0.35, "#f0d78a");
      grad.addColorStop(0.5, "#fff6d0");
      grad.addColorStop(0.7, "#c8963a");
      grad.addColorStop(1, "#3a2a10");
      pen.fillStyle = grad;
      traceRoundRect(pen, -width / 2, -half - length * 0.72, width, length, 2);
      pen.fill();
      pen.stroke();
      pen.fillStyle = "#241c10";
      pen.fillRect(-width * 0.72, -half - length * 0.72, width * 1.44, 5);
      pen.fillRect(-width * 0.62, -half - length * 0.28, width * 1.24, 4);
      pen.fillStyle = "#2a2418";
      pen.fillRect(-half * 0.72, half * 0.05, half * 1.44, half * 0.7);
      if (flash) {
        pen.fillStyle = "rgba(255, 220, 120, 0.95)";
        pen.beginPath();
        pen.arc(0, -half - length * 0.78, size * 0.38, 0, Math.PI * 2);
        pen.fill();
        pen.fillStyle = "#fff7d6";
        pen.beginPath();
        pen.arc(0, -half - length * 0.78, size * 0.16, 0, Math.PI * 2);
        pen.fill();
      }
    }
    pen.restore();
  }

  function drawSmoothBay(x: number, y: number, size: number, role: PartRole): void {
    const half = size / 2;
    pen.save();
    pen.translate(x, y);
    pen.fillStyle = "#2a2c38";
    pen.strokeStyle = "#0e1116";
    pen.lineWidth = 1.6;
    pen.fillRect(-half * 0.7, -half * 0.7, half * 1.4, half * 1.4);
    pen.strokeRect(-half * 0.7, -half * 0.7, half * 1.4, half * 1.4);
    if (role === "nw" || role === "single") {
      pen.fillStyle = "#243044";
      traceRoundRect(pen, -half * 0.45, -half * 0.15, half * 0.9, half * 0.7, 2);
      pen.fill();
      pen.stroke();
      pen.fillStyle = "#d8fff8";
      pen.fillRect(-half * 0.12, -half * 0.85, half * 0.24, half * 0.75);
    }
    pen.restore();
  }

  function drawSmoothGenerator(x: number, y: number, size: number, role: PartRole): void {
    const half = size / 2;
    const ox = role === "ne" || role === "se" ? -half * 0.35 : half * 0.35;
    const oy = role === "sw" || role === "se" ? -half * 0.35 : half * 0.35;
    pen.save();
    pen.translate(x + ox, y + oy);
    pen.strokeStyle = "#d8fff8";
    pen.fillStyle = "rgba(136, 232, 216, 0.35)";
    pen.lineWidth = 2.4;
    pen.beginPath();
    pen.arc(0, 0, half * 0.72, 0, Math.PI * 2);
    pen.fill();
    pen.stroke();
    if (role === "nw" || role === "single") {
      pen.fillStyle = "#f0d050";
      pen.beginPath();
      pen.arc(half * 0.2, half * 0.2, 2.4, 0, Math.PI * 2);
      pen.fill();
    }
    pen.restore();
  }

  function drawSmoothShield(tank: Tank): void {
    if (tank.shield <= 0 || tank.shieldMax <= 0) return;
    const radius = shieldRadius(tank);
    const frac = clamp(tank.shield / tank.shieldMax, 0, 1);
    pen.save();
    pen.translate(tank.x, tank.y);
    pen.globalAlpha = 0.16 + frac * 0.22;
    pen.fillStyle = frac > 0.28 ? "#88e8d8" : "#f0d050";
    pen.beginPath();
    pen.arc(0, 0, radius, 0, Math.PI * 2);
    pen.fill();
    pen.globalAlpha = 0.55 + frac * 0.4;
    pen.strokeStyle = frac > 0.28 ? "#e8fffb" : "#fff1b0";
    pen.lineWidth = 4;
    pen.stroke();
    pen.restore();
  }

  function drawSmoothDrone(drone: Drone): void {
    if (drone.hp <= 0) return;
    pen.save();
    pen.translate(drone.x + 3, drone.y + 4);
    pen.rotate(drone.angle);
    pen.fillStyle = "rgba(0,0,0,0.3)";
    pen.beginPath();
    pen.ellipse(0, 0, 22, 28, 0, 0, Math.PI * 2);
    pen.fill();
    pen.restore();
    pen.save();
    pen.globalAlpha = drone.flash > 0 ? 0.72 : 1;
    pen.translate(drone.x, drone.y);
    pen.rotate(drone.angle);
    pen.lineWidth = 2;
    pen.strokeStyle = "#0e1116";
    pen.fillStyle = "#141820";
    pen.fillRect(-22, -18, 6, 36);
    pen.fillRect(16, -18, 6, 36);
    pen.fillStyle = drone.owner === "player" ? "#1c6e66" : "#8a3a28";
    traceRoundRect(pen, -16, -22, 32, 44, 5);
    pen.fill();
    pen.stroke();
    pen.fillStyle = drone.owner === "player" ? "#d8fff8" : "#ffd0b0";
    traceRoundRect(pen, -5, -46, 10, 26, 2);
    pen.fill();
    pen.stroke();
    pen.fillStyle = "#241c10";
    pen.fillRect(-8, -48, 16, 5);
    pen.fillStyle = "#ffb703";
    pen.beginPath();
    pen.moveTo(0, -24);
    pen.lineTo(7, -14);
    pen.lineTo(-7, -14);
    pen.closePath();
    pen.fill();
    if (drone.muzzle > 0) {
      pen.fillStyle = "rgba(255, 236, 160, 0.95)";
      pen.beginPath();
      pen.arc(0, -50, 8, 0, Math.PI * 2);
      pen.fill();
    }
    pen.restore();
  }

  function drawSmoothBreech(x: number, y: number, size: number): void {
    const half = size / 2;
    pen.save();
    pen.translate(x, y);
    pen.fillStyle = "rgba(14,17,22,0.4)";
    pen.strokeStyle = "#0e1116";
    pen.lineWidth = 2;
    traceRoundRect(pen, -half * 0.72, -half * 0.2, half * 1.44, half * 0.9, 2);
    pen.fill();
    pen.stroke();
    pen.restore();
  }

  function drawSmoothRivets(x: number, y: number, size: number): void {
    pen.fillStyle = "#d5dde6";
    const inset = 5;
    for (const [px, py] of [
      [inset, inset],
      [size - inset, inset],
      [inset, size - inset],
      [size - inset, size - inset],
    ]) {
      pen.beginPath();
      pen.arc(x + px, y + py, 1.7, 0, Math.PI * 2);
      pen.fill();
    }
  }

  function drawSmoothPlus(x: number, y: number, s: number): void {
    pen.save();
    pen.translate(x, y);
    pen.strokeStyle = "rgba(14,17,22,0.7)";
    pen.lineWidth = 2.4;
    pen.lineCap = "round";
    pen.beginPath();
    pen.moveTo(0, -s);
    pen.lineTo(0, s);
    pen.moveTo(-s, 0);
    pen.lineTo(s, 0);
    pen.stroke();
    pen.restore();
  }

  function drawSmoothSpark(x: number, y: number, size: number, life: number): void {
    pen.save();
    pen.globalAlpha = Math.min(1, life * 2.2);
    pen.strokeStyle = "#e7ffc8";
    pen.fillStyle = "#b6f58a";
    pen.lineWidth = 1.5;
    const s = size * 0.18;
    for (const [ox, oy] of [
      [-s, -s],
      [s, -s * 0.2],
      [0, s],
    ]) {
      pen.beginPath();
      pen.moveTo(x + ox - 3, y + oy);
      pen.lineTo(x + ox + 3, y + oy);
      pen.moveTo(x + ox, y + oy - 3);
      pen.lineTo(x + ox, y + oy + 3);
      pen.stroke();
    }
    pen.restore();
  }

  function drawSmoothEngine(x: number, y: number, size: number, moving: boolean, phase: number): void {
    const half = size / 2;
    pen.save();
    pen.translate(x, y);
    pen.fillStyle = "#3a1612";
    pen.strokeStyle = "#0e1116";
    pen.lineWidth = 1.6;
    for (let i = 0; i < 3; i += 1) {
      const bob = moving && !reduceMotion ? Math.sin(phase * 22 + i * 1.4) * 1.5 : 0;
      const px = (i - 1) * size * 0.28;
      const ph = size * (i === 1 ? 0.34 : 0.42);
      traceRoundRect(pen, px - size * 0.09, -half * 0.15 + bob - ph, size * 0.18, ph, 1.5);
      pen.fill();
      pen.stroke();
    }
    pen.strokeStyle = "#1a0c0a";
    pen.lineWidth = 2.4;
    pen.lineCap = "round";
    pen.beginPath();
    pen.moveTo(-size * 0.2, half * 0.15);
    pen.lineTo(-size * 0.2, half + size * 0.28);
    pen.moveTo(size * 0.2, half * 0.35);
    pen.lineTo(size * 0.2, half + size * 0.22);
    pen.stroke();
    pen.restore();
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
    if (!origin) return;
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
    if (!pivot) return;
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
        const role = partRole(token, r, c);
        const quad = role === "ne" ? 1 : role === "sw" ? 2 : role === "se" ? 3 : 0;
        const art = moduleArt(id ?? "", {
          flash: Boolean(id && (id === "cannon" || id === "medium-cannon" || id === "heavy-cannon" || id === "harpoon") && anchor && tank.muzzle > 0),
          puff: id === "engine" && moving && Math.floor(simTime * 8) % 2 === 0,
          rear: role === "rear",
          mid: role === "mid",
          quad,
        });
        const scaled = nearestScale(
          art,
          Math.round((art.width * cell) / CELL_ART),
          Math.round((art.height * cell) / CELL_ART),
          `${id ?? "empty"}-${role}-${art.width}x${art.height}-${cell}-${tank.muzzle > 0}-${moving}`,
        );
        const body = scaled.height - cell;
        ctx.drawImage(scaled, pad + c * cell, pad + r * cell - Math.max(0, body));
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
    const w = Math.max(8, Math.round(view.cellPx * (shot.r > 7 ? 1.45 : shot.r > 5 ? 1.1 : 0.9)));
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
    // 1.5× the previous phone zoom. At dpr 2 the 7-long hull lands on a 30px cell and is about 105 CSS px tall.
    const targetCss = cssW >= 800 ? 96 : 111;
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
    fuelFill.style.width = `${stats.fuel > 0 ? clamp(player.fuel / stats.fuel, 0, 1) * 100 : 0}%`;
    const fuelText = fuelLabel.querySelector(".meter-value");
    if (fuelText) fuelText.textContent = String(Math.ceil(player.fuel));
    scrapValue.textContent = `${bank.toLocaleString()} scrap`;
    const next = statusLine(stats.plates, stats.weaponCount, stats.fireRate, stats.salvoDamage);
    if (next !== lastStatus) {
      lastStatus = next;
      status.textContent = next;
      status.hidden = next.length === 0;
    }
  }

  function statusLine(plates: number, weapons: number, rate: number, salvo: number): string {
    if (phase === "win") return "Rival down";
    if (phase === "lose") return "";
    if (player.fuel <= 0) return "Fuel empty — crawling";
    if (weapons === 0) return "No cannon left";
    if (rate <= 0 && salvo > 0) return "Cannons unpowered";
    if (plates === 0) return "Armor gone";
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
      fuel: player.fuel,
      weapons: tally(player).weapons,
      power: tally(player).power,
      speed: computeStats(player.grid, { repairActive: false }).speed,
      shots: shots.length,
      phase,
      guns: listGuns(player.grid, player.hull).map((gun) => gun.mount),
      modules: player.grid.flat().filter(Boolean).length,
      rivalWeapons: tally(rival).weapons,
      rivalPower: tally(rival).power,
      rivalModules: rival.grid.flat().filter(Boolean).length,
      tether: tether?.life ?? 0,
      overlap: pushBox(chassisBox(player), chassisBox(rival)) !== null,
      rivalTurret: rival.turret,
      rivalX: rival.x,
      rivalY: rival.y,
      map: map.id,
      cam: camAngle,
      viewW: measure().viewW,
      lastVolley,
      shield: player.shield,
      shieldMax: player.shieldMax,
      drones: drones.filter((drone) => drone.owner === "player" && drone.hp > 0).length,
      droneX: drones.find((drone) => drone.owner === "player" && drone.hp > 0)?.x ?? 0,
      droneY: drones.find((drone) => drone.owner === "player" && drone.hp > 0)?.y ?? 0,
      droneAngle: drones.find((drone) => drone.owner === "player" && drone.hp > 0)?.angle ?? 0,
      hull: player.hull,
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

  function chassisBox(tank: Tank): OrientedBox {
    const cols = tank.grid[0]?.length ?? 1;
    const rows = tank.grid.length;
    return { x: tank.x, y: tank.y, halfW: cols * CELL * 0.5, halfH: rows * CELL * 0.5, angle: tank.angle };
  }

  function turretBoxes(tank: Tank): OrientedBox[] {
    const cols = tank.grid[0]?.length ?? 1;
    const rows = tank.grid.length;
    const boxes: OrientedBox[] = [];
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        if (!isTurretCell(r, c, cols, rows, tank.hull)) continue;
        const center = cellCenter(c, r, cols, rows);
        const world = mountPoint(tank, center.x, center.y, true);
        boxes.push({ x: world.x, y: world.y, halfW: CELL * 0.46, halfH: CELL * 0.46, angle: tank.turret });
      }
    }
    return boxes;
  }

  function cellBox(tank: Tank, row: number, col: number): OrientedBox {
    const cols = tank.grid[0]?.length ?? 1;
    const rows = tank.grid.length;
    const turret = isTurretCell(row, col, cols, rows, tank.hull);
    const center = cellCenter(col, row, cols, rows);
    const world = mountPoint(tank, center.x, center.y, turret);
    return { x: world.x, y: world.y, halfW: CELL * 0.5, halfH: CELL * 0.5, angle: turret ? tank.turret : tank.angle };
  }

  function shoveTank(tank: Tank, push: { x: number; y: number }): void {
    tank.x += push.x;
    tank.y += push.y;
    const speed = tank.vx * push.x + tank.vy * push.y;
    const len = Math.hypot(push.x, push.y) || 1;
    if (speed > 0) {
      tank.vx -= (push.x / len) * speed;
      tank.vy -= (push.y / len) * speed;
    }
  }

  function separateBodies(): void {
    for (let pass = 0; pass < 4; pass += 1) {
      const hullPush = pushBox(chassisBox(player), chassisBox(rival));
      if (hullPush) {
        shoveTank(player, { x: -hullPush.x * 0.5, y: -hullPush.y * 0.5 });
        shoveTank(rival, { x: hullPush.x * 0.5, y: hullPush.y * 0.5 });
      }
      for (const box of turretBoxes(player)) {
        const push = pushBox(box, chassisBox(rival));
        if (push) {
          shoveTank(player, { x: -push.x * 0.5, y: -push.y * 0.5 });
          shoveTank(rival, { x: push.x * 0.5, y: push.y * 0.5 });
        }
      }
      for (const box of turretBoxes(rival)) {
        const push = pushBox(chassisBox(player), box);
        if (push) {
          shoveTank(player, { x: -push.x * 0.5, y: -push.y * 0.5 });
          shoveTank(rival, { x: push.x * 0.5, y: push.y * 0.5 });
        }
      }
      for (const drone of drones) {
        if (drone.hp <= 0) continue;
        for (const tank of [player, rival]) {
          const boxes = [chassisBox(tank), ...turretBoxes(tank)];
          for (const box of boxes) {
            const push = pushCircleFromBox(drone.x, drone.y, drone.radius, box);
            if (!push) continue;
            drone.x += push.x;
            drone.y += push.y;
          }
        }
      }
      for (let i = 0; i < drones.length; i += 1) {
        for (let j = i + 1; j < drones.length; j += 1) {
          const a = drones[i];
          const b = drones[j];
          if (!a || !b || a.hp <= 0 || b.hp <= 0) continue;
          nudgeApart(a, b, 2);
        }
      }
      const solvedPlayer = resolveTank(map, player.x, player.y, player.radius);
      const solvedRival = resolveTank(map, rival.x, rival.y, rival.radius);
      player.x = solvedPlayer.x;
      player.y = solvedPlayer.y;
      rival.x = solvedRival.x;
      rival.y = solvedRival.y;
      for (const drone of drones) {
        const solved = resolveTank(map, drone.x, drone.y, drone.radius);
        drone.x = solved.x;
        drone.y = solved.y;
      }
    }
  }

  function scorch(tank: Tank, dt: number): void {
    const rows = tank.grid.length;
    const cols = tank.grid[0]?.length ?? 0;
    const seen = new Set<string>();
    let burned = false;
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const token = tank.grid[r][c];
        if (!token) continue;
        const key = token.includes("@") ? token : `${r},${c}`;
        if (seen.has(key)) continue;
        const turret = isTurretCell(r, c, cols, rows, tank.hull);
        const center = cellCenter(c, r, cols, rows);
        const world = mountPoint(tank, center.x, center.y, turret);
        if (!hitsHazard(map, world.x, world.y, CELL * 0.32)) continue;
        seen.add(key);
        const left = absorb(tank, LAVA_DPS * dt);
        if (left > 0) hurtCell(tank, r, c, left);
        burned = true;
      }
    }
    if (burned) tank.flash = Math.max(tank.flash, 0.1);
  }

  function stepTether(dt: number): void {
    if (!tether) return;
    tether.life -= dt;
    const owner = tether.owner === "player" ? player : rival;
    const target = tether.owner === "player" ? rival : player;
    if (tether.life <= 0 || !hasHarpoon(owner)) {
      tether = null;
      return;
    }
    const tip = harpoonTip(owner) ?? { x: owner.x, y: owner.y };
    const dx = tip.x - target.x;
    const dy = tip.y - target.y;
    const dist = Math.hypot(dx, dy) || 1;
    const step = Math.min(HARPOON_PULL * dt, dist);
    target.x += (dx / dist) * step;
    target.y += (dy / dist) * step;
    target.vx *= 0.55;
    target.vy *= 0.55;
  }

  function stepCutters(dt: number): void {
    const amount = CUTTER_DPS * dt;
    for (const tank of [player, rival]) {
      const foe = tank.id === "player" ? rival : player;
      const rows = tank.grid.length;
      const cols = tank.grid[0]?.length ?? 0;
      for (let r = 0; r < rows; r += 1) {
        for (let c = 0; c < cols; c += 1) {
          if (!isAnchorCell(tank.grid[r][c], r, c) || !cellModule(tank.grid[r][c])?.cutter) continue;
          const blade = cellBox(tank, r, c);
          blade.halfW += 2;
          blade.halfH += 2;
          const seen = new Set<string>();
          for (let fr = 0; fr < foe.grid.length; fr += 1) {
            for (let fc = 0; fc < (foe.grid[fr]?.length ?? 0); fc += 1) {
              const token = foe.grid[fr][fc];
              if (!token || seen.has(token.includes("@") ? token : `${fr},${fc}`)) continue;
              if (!pushBox(blade, cellBox(foe, fr, fc))) continue;
              seen.add(token.includes("@") ? token : `${fr},${fc}`);
              hurtCell(foe, fr, fc, amount);
            }
          }
          for (const drone of drones) {
            if (drone.hp <= 0 || drone.owner === tank.id) continue;
            if (!pushCircleFromBox(drone.x, drone.y, drone.radius, blade)) continue;
            hurtDrone(drone, amount);
          }
        }
      }
    }
    for (let i = drones.length - 1; i >= 0; i -= 1) {
      if ((drones[i]?.hp ?? 1) <= 0) drones.splice(i, 1);
    }
  }

  function hasHarpoon(tank: Tank): boolean {
    return tank.grid.some((row, r) => row.some((token, c) => isAnchorCell(token, r, c) && cellModule(token)?.hook));
  }

  function harpoonTip(tank: Tank): { x: number; y: number } | null {
    const rows = tank.grid.length;
    const cols = tank.grid[0]?.length ?? 0;
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        if (!isAnchorCell(tank.grid[r][c], r, c) || !cellModule(tank.grid[r][c])?.hook) continue;
        const turret = isTurretCell(r, c, cols, rows, tank.hull);
        const center = cellCenter(c, r, cols, rows);
        return mountPoint(tank, center.x, center.y - CELL * 1.35, turret);
      }
    }
    return null;
  }

  function drawPixelTether(view: Frame): void {
    if (!tether || tether.life <= 0) return;
    const owner = tether.owner === "player" ? player : rival;
    const target = tether.owner === "player" ? rival : player;
    const from = harpoonTip(owner) ?? { x: owner.x, y: owner.y };
    const a = worldToArt(from.x, from.y, view);
    const b = worldToArt(target.x, target.y, view);
    const steps = 14;
    context.fillStyle = PAL.cream;
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      context.fillRect(Math.round(a.x + (b.x - a.x) * t), Math.round(a.y + (b.y - a.y) * t), 4, 4);
    }
    context.fillStyle = PAL.gold;
    context.fillRect(Math.round(b.x) - 4, Math.round(b.y) - 4, 8, 8);
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

  function shieldRadius(tank: Tank): number {
    const cols = tank.grid[0]?.length ?? 1;
    const rows = tank.grid.length;
    return Math.hypot(cols * CELL * 0.5, rows * CELL * 0.5) * 0.92;
  }

  function inBubble(tank: Tank, shot: Shot): boolean {
    return Math.hypot(shot.x - tank.x, shot.y - tank.y) <= shieldRadius(tank) + shot.r;
  }

  function absorb(tank: Tank, amount: number): number {
    if (tank.shield <= 0 || amount <= 0) return amount;
    const used = Math.min(tank.shield, amount);
    const broke = tank.shield - used <= 0;
    tank.shield -= used;
    tank.shieldDelay = SHIELD_DELAY;
    if (broke) {
      tank.shield = 0;
      floaters.push({ x: tank.x, y: tank.y - shieldRadius(tank), text: "Shield down", life: 0.8 });
      burst(tank.x, tank.y, PAL.cyan, 14);
    }
    return amount - used;
  }

  function stepShield(tank: Tank, dt: number, powerFactor: number): void {
    const gens = shieldGenerators(tank.grid);
    tank.shieldMax = gens * SHIELD_HP;
    if (tank.shield > tank.shieldMax) tank.shield = tank.shieldMax;
    if (tank.shieldMax <= 0) return;
    if (tank.shieldDelay > 0) tank.shieldDelay = Math.max(0, tank.shieldDelay - dt);
    else if (tank.shield < tank.shieldMax && powerFactor > 0) {
      tank.shield = Math.min(tank.shieldMax, tank.shield + SHIELD_REGEN * gens * powerFactor * dt);
    }
  }

  function stepLaunch(tank: Tank, dt: number, powerFactor: number): void {
    const bays = droneBays(tank);
    for (const key of bays) {
      const live = drones.some((drone) => drone.owner === tank.id && drone.bay === key && drone.hp > 0);
      if (live) {
        tank.launch[key] = DRONE_PERIOD;
        continue;
      }
      if (powerFactor <= 0) continue;
      const left = (tank.launch[key] ?? DRONE_FIRST) - dt;
      tank.launch[key] = left;
      if (left <= 0) {
        spawnDrone(tank, key);
        tank.launch[key] = DRONE_PERIOD;
      }
    }
  }

  function droneBays(tank: Tank): string[] {
    const keys: string[] = [];
    tank.grid.forEach((row, r) => {
      row.forEach((token, c) => {
        if (!isAnchorCell(token, r, c)) return;
        if (cellModule(token)?.drone) keys.push(`${r},${c}`);
      });
    });
    return keys;
  }

  function spawnDrone(tank: Tank, bay: string): void {
    const side = drones.filter((drone) => drone.owner === tank.id).length % 2 === 0 ? 1 : -1;
    const ang = tank.angle + side * 0.4;
    const dist = tank.radius + 40;
    const spot = resolveTank(map, tank.x + Math.sin(ang) * dist, tank.y - Math.cos(ang) * dist, 22);
    drones.push({
      owner: tank.id,
      bay,
      x: spot.x,
      y: spot.y,
      angle: tank.angle,
      hp: DRONE_HP,
      hpMax: DRONE_HP,
      cooldown: 0.2,
      radius: 22,
      flash: 0,
      muzzle: 0,
    });
  }

  function stepDrones(dt: number): void {
    for (let i = drones.length - 1; i >= 0; i -= 1) {
      const drone = drones[i];
      if (!drone || drone.hp <= 0) {
        drones.splice(i, 1);
        continue;
      }
      const parent = drone.owner === "player" ? player : rival;
      const foe = drone.owner === "player" ? rival : player;
      const aim = Math.atan2(foe.x - drone.x, -(foe.y - drone.y));
      const dist = Math.hypot(foe.x - drone.x, foe.y - drone.y);
      const probe = (angle: number, distance: number): boolean => {
        const x = drone.x + Math.sin(angle) * distance;
        const y = drone.y - Math.cos(angle) * distance;
        return (
          x < drone.radius ||
          y < drone.radius ||
          x > map.w - drone.radius ||
          y > map.h - drone.radius ||
          hitsBlock(map, x, y, drone.radius)
        );
      };
      let desired = aim;
      let bestScore = Number.NEGATIVE_INFINITY;
      for (let step = 0; step < 20; step += 1) {
        const turn = step === 0 ? 0 : (step % 2 === 0 ? 1 : -1) * Math.ceil(step / 2) * 0.34;
        const angle = aim + turn;
        let run = 0;
        for (const reach of [32, 70, 120, 180, 260]) {
          if (probe(angle, reach)) break;
          run = reach;
        }
        if (run === 0) continue;
        const nx = drone.x + Math.sin(angle) * run;
        const ny = drone.y - Math.cos(angle) * run;
        const closer = dist - Math.hypot(foe.x - nx, foe.y - ny);
        const score = run * 1.6 + closer * 0.35 - Math.abs(turn) * 8;
        if (score > bestScore) {
          bestScore = score;
          desired = angle;
        }
      }
      drone.angle = rotateToward(drone.angle, desired, 5.4 * dt);
      drone.x += Math.sin(drone.angle) * DRONE_SPEED * dt;
      drone.y -= Math.cos(drone.angle) * DRONE_SPEED * dt;
      nudgeApart(drone, parent, 6);
      nudgeApart(drone, foe, 4);
      for (const other of drones) {
        if (other !== drone && other.hp > 0) nudgeApart(drone, other, 2);
      }
      const solved = resolveTank(map, drone.x, drone.y, drone.radius);
      drone.x = solved.x;
      drone.y = solved.y;
      if (hitsHazard(map, drone.x, drone.y, drone.radius * 0.7)) hurtDrone(drone, 14 * dt);
      if (drone.hp <= 0) {
        drones.splice(i, 1);
        continue;
      }
      drone.cooldown -= dt;
      drone.flash = Math.max(0, drone.flash - dt);
      drone.muzzle = Math.max(0, drone.muzzle - dt);
      if (dist < 780 && Math.abs(angleDelta(drone.angle, aim)) < 0.7 && drone.cooldown <= 0 && !probe(aim, 36)) {
        const speed = 460;
        shots.push({
          x: drone.x + Math.sin(drone.angle) * 30,
          y: drone.y - Math.cos(drone.angle) * 30,
          vx: Math.sin(drone.angle) * speed,
          vy: -Math.cos(drone.angle) * speed,
          r: 5.4,
          damage: DRONE_DAMAGE,
          life: DRONE_LIFE,
          owner: drone.owner,
          color: drone.owner === "player" ? PAL.cyan : PAL.orange,
        });
        drone.cooldown = 0.55;
        drone.muzzle = 0.08;
      }
      if (drone.hp <= 0) drones.splice(i, 1);
    }
  }

  function nudgeApart(unit: { x: number; y: number; radius: number }, other: { x: number; y: number; radius: number }, pad: number): void {
    const dx = unit.x - other.x;
    const dy = unit.y - other.y;
    const min = unit.radius + other.radius + pad;
    const dist = Math.hypot(dx, dy) || 0.001;
    if (dist >= min) return;
    const push = (min - dist) / dist;
    unit.x += dx * push;
    unit.y += dy * push;
  }

  function hurtDrone(drone: Drone, amount: number): void {
    if (drone.hp <= 0) return;
    drone.hp -= amount;
    drone.flash = 0.12;
    if (amount > 0) sfxHit();
    if (drone.hp > 0) return;
    burst(drone.x, drone.y, drone.owner === "player" ? PAL.teal : PAL.orange, 12);
    floaters.push({ x: drone.x, y: drone.y, text: "Drone lost", life: 0.7 });
    if (drone.owner === "player") sfxBoom();
  }

  function drawPixelShield(tank: Tank, view: Frame): void {
    if (tank.shield <= 0 || tank.shieldMax <= 0) return;
    const at = worldToArt(tank.x, tank.y, view);
    const radius = (shieldRadius(tank) * view.cellPx) / CELL;
    const frac = clamp(tank.shield / tank.shieldMax, 0, 1);
    const steps = 32;
    const size = Math.max(3, Math.round(view.cellPx * 0.22));
    context.save();
    context.globalAlpha = 0.45 + frac * 0.5;
    context.fillStyle = frac > 0.28 ? PAL.cyan : PAL.gold;
    for (let i = 0; i < steps; i += 1) {
      const angle = (i / steps) * Math.PI * 2 + simTime * 0.6;
      const x = Math.round(at.x + Math.cos(angle) * radius);
      const y = Math.round(at.y + Math.sin(angle) * radius);
      context.fillRect(x, y, size, size);
    }
    context.globalAlpha = 0.18 + frac * 0.16;
    context.fillStyle = PAL.cyan;
    const inner = Math.round(radius * 0.72);
    for (let i = 0; i < 16; i += 1) {
      const angle = (i / 16) * Math.PI * 2;
      context.fillRect(Math.round(at.x + Math.cos(angle) * inner), Math.round(at.y + Math.sin(angle) * inner), Math.max(2, size - 1), Math.max(2, size - 1));
    }
    context.restore();
  }

  function drawPixelDrone(drone: Drone, view: Frame): void {
    if (drone.hp <= 0) return;
    const at = worldToArt(drone.x, drone.y, view);
    const src = droneArt(drone.owner, drone.muzzle > 0);
    const h = Math.max(18, Math.round(view.cellPx * 2.7));
    const w = Math.max(8, Math.round((h * src.width) / src.height));
    const scaled = nearestScale(src, w, h, `drone-${drone.owner}-${w}x${h}-${drone.muzzle > 0}`);
    context.save();
    context.imageSmoothingEnabled = false;
    context.translate(Math.round(at.x), Math.round(at.y));
    context.rotate(drone.angle - camAngle);
    context.drawImage(scaled, Math.round(-w / 2), Math.round(-h / 2));
    context.restore();
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
    shield: shieldGenerators(grid) * SHIELD_HP,
    shieldMax: shieldGenerators(grid) * SHIELD_HP,
    shieldDelay: 0,
    launch: launchClocks(grid),
  };
}

function shieldGenerators(grid: (string | null)[][]): number {
  let count = 0;
  grid.forEach((row, r) => {
    row.forEach((token, c) => {
      if (!isAnchorCell(token, r, c)) return;
      if (cellModule(token)?.generator) count += 1;
    });
  });
  return count;
}

function launchClocks(grid: (string | null)[][]): Record<string, number> {
  const clocks: Record<string, number> = {};
  grid.forEach((row, r) => {
    row.forEach((token, c) => {
      if (!isAnchorCell(token, r, c)) return;
      if (cellModule(token)?.drone) clocks[`${r},${c}`] = DRONE_FIRST;
    });
  });
  return clocks;
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

function tally(tank: Tank): { weapons: number; power: number } {
  let weapons = 0;
  let power = 0;
  tank.grid.forEach((row, r) => {
    row.forEach((token, c) => {
      if (!isAnchorCell(token, r, c)) return;
      const mod = cellModule(token);
      if (mod?.kind === "weapon") weapons += 1;
      if (mod?.kind === "power") power += 1;
    });
  });
  return { weapons, power };
}

function defeated(tank: Tank): boolean {
  const counts = tally(tank);
  return counts.weapons === 0 || counts.power === 0;
}

function turretPivot(cols: number, rows: number, hull: string): { x: number; y: number } | null {
  const origin = turretOrigin(hull);
  if (!origin) return null;
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
  const pivot = turretPivot(cols, rows, tank.hull) ?? { x: 0, y: 0 };
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

