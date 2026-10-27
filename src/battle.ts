import { el } from "./dom";
import { attachInput, type InputController } from "./input";
import { clamp, rotateToward, traceRoundRect } from "./math";
import { createDefaultGrid, getModule } from "./modules";
import { sfxBoom, sfxHit, sfxShot } from "./sfx";
import { computeStats, fuelDrainPerSecond, maxDriveSpeed, maxTurnRate, mountedWeapons } from "./stats";
import type { ModuleKind } from "./types";

const ARENA_W = 2000;
const ARENA_H = 1400;
const CELL = 28;

interface Pillar {
  x: number;
  y: number;
  w: number;
  h: number;
}

const PILLARS: readonly Pillar[] = [
  { x: 220, y: 160, w: 130, h: 90 },
  { x: 1640, y: 180, w: 140, h: 90 },
  { x: 200, y: 1100, w: 150, h: 90 },
  { x: 1620, y: 1080, w: 150, h: 100 },
  { x: 880, y: 150, w: 180, h: 70 },
  { x: 900, y: 1160, w: 170, h: 70 },
  { x: 160, y: 560, w: 80, h: 200 },
  { x: 1760, y: 540, w: 80, h: 200 },
];

interface Tank {
  x: number;
  y: number;
  /** 0 faces up the screen. Positive rotation is clockwise. */
  angle: number;
  turret: number;
  vx: number;
  vy: number;
  hp: number;
  fuel: number;
  iframe: number;
  flash: number;
}

interface Target {
  kind: "enemy" | "crate";
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  hp: number;
  hpMax: number;
  alive: boolean;
  respawn: number;
  shoot: number;
  touch: number;
  flash: number;
  wander: number;
  scrap: number;
}

interface Shot {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  damage: number;
  life: number;
  friendly: boolean;
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
}

interface Floater {
  x: number;
  y: number;
  text: string;
  life: number;
}

export interface BattleOptions {
  grid: (string | null)[][];
  currency: number;
  onCurrency: (next: number) => void;
  onExit: () => void;
}

export interface TankDebug {
  x: number;
  y: number;
  angle: number;
  turret: number;
  hp: number;
  fuel: number;
  shots: number;
  enemies: number;
  crates: number;
  bank: number;
  earned: number;
  phase: "play" | "dead";
  targets: { x: number; y: number; kind: "enemy" | "crate"; alive: boolean; hp: number }[];
}

declare global {
  interface Window {
    __TANK_DEBUG__?: () => TankDebug;
  }
}

/**
 * Angle convention for the whole battle: 0 points up the screen, clockwise is positive.
 * Move stick up/down scales velocity along the hull facing. Left/right adds to hull angle.
 * Aim stick sets a world direction (screen up is 0) and fires while it is held out.
 */
export function mountBattle(root: HTMLElement, options: BattleOptions): () => void {
  const grid = options.grid.length > 0 && options.grid[0]?.length ? options.grid : createDefaultGrid();
  const stats = computeStats(grid);
  const weapons = mountedWeapons(grid);
  const cols = grid[0].length;
  const rows = grid.length;
  const bodyW = cols * CELL;
  const bodyH = rows * CELL;
  const radius = Math.max(bodyW, bodyH) * 0.42;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const canvas = el("canvas");
  canvas.id = "battle-canvas";
  canvas.setAttribute("aria-label", "Battle arena");

  const hud = el("div", "hud");
  const exit = el("button", "btn btn-ghost hud-exit", "Menu");
  exit.type = "button";
  const readout = el("div", "hud-readout");
  const hpLabel = el("div", "meter-label");
  hpLabel.append(el("span", undefined, "Hull"), el("span", "meter-value", ""));
  const hpMeter = el("div", "meter meter-hp");
  const hpFill = el("span");
  hpMeter.append(hpFill);
  const fuelLabel = el("div", "meter-label");
  fuelLabel.append(el("span", undefined, "Fuel"), el("span", "meter-value", ""));
  const fuelMeter = el("div", "meter meter-fuel");
  const fuelFill = el("span");
  fuelMeter.append(fuelFill);
  readout.append(hpLabel, hpMeter, fuelLabel, fuelMeter);
  const scrap = el("div", "scrap-pill hud-scrap");
  const scrapValue = el("span", undefined, "");
  scrap.append(el("span", "scrap-nut", "⬡"), scrapValue);
  hud.append(exit, readout, scrap);

  const help = el(
    "p",
    "battle-help",
    "Move stick: up/down drives, left/right turns. Aim stick fires while held. WASD + mouse too.",
  );
  const status = el("p", "battle-status");
  status.setAttribute("aria-live", "polite");

  const moveStick = joystick("move", "Move", "Move. Up and down drive. Left and right turn.");
  const aimStick = joystick("aim", "Aim", "Aim. Hold a direction to turn the turret and fire.");

  const endcard = el("div", "endcard");
  endcard.hidden = true;
  const endTitle = el("h2", undefined, "Hull breached");
  const endCopy = el("p", "end-copy");
  const endActions = el("div", "end-actions");
  const retry = el("button", "btn btn-primary", "Retry");
  retry.type = "button";
  const endMenu = el("button", "btn", "Menu");
  endMenu.type = "button";
  endActions.append(retry, endMenu);
  const endPanel = el("div", "end-panel");
  endPanel.append(endTitle, endCopy, endActions);
  endcard.append(endPanel);

  root.append(canvas, hud, help, status, moveStick.root, aimStick.root, endcard);

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");
  const context = ctx;

  const input: InputController = attachInput(moveStick.base, moveStick.knob, aimStick.base, aimStick.knob);

  let bank = options.currency;
  let earned = 0;
  let phase: "play" | "dead" = "play";
  let cooldown = 0;
  let warmup = 6;
  let shake = 0;
  let lastStatus = "";
  let raf = 0;
  let lastTime = 0;
  let stopped = false;
  let acc = 0;

  let tank: Tank = makeTank();
  let targets: Target[] = [];
  let shots: Shot[] = [];
  let particles: Particle[] = [];
  let floaters: Floater[] = [];

  function makeTank(): Tank {
    return {
      x: ARENA_W / 2,
      y: ARENA_H / 2,
      angle: 0,
      turret: 0,
      vx: 0,
      vy: 0,
      hp: stats.hp,
      fuel: stats.fuel,
      iframe: 0,
      flash: 0,
    };
  }

  function boot(): void {
    tank = makeTank();
    shots = [];
    particles = [];
    floaters = [];
    targets = [];
    const rand = mulberry32(0x5eed);
    for (let i = 0; i < 6; i += 1) targets.push(makeTarget("crate", rand));
    for (let i = 0; i < 3; i += 1) targets.push(makeTarget("enemy", rand));
    cooldown = 0;
    warmup = 6;
    earned = 0;
    phase = "play";
    shake = 0;
    endcard.hidden = true;
    syncHud();
  }

  function makeTarget(kind: Target["kind"], rand: () => number): Target {
    const spot = openPoint(rand, 280);
    const enemy = kind === "enemy";
    const hp = enemy ? 48 : 20;
    return {
      kind,
      x: spot.x,
      y: spot.y,
      vx: 0,
      vy: 0,
      size: enemy ? 48 : 42,
      hp,
      hpMax: hp,
      alive: true,
      respawn: 0,
      shoot: 2.6 + rand() * 2,
      touch: 0,
      flash: 0,
      wander: rand() * 1.5,
      scrap: enemy ? 20 : 8,
    };
  }

  function openPoint(rand: () => number, minFromPlayer: number): { x: number; y: number } {
    for (let i = 0; i < 60; i += 1) {
      const x = 90 + rand() * (ARENA_W - 180);
      const y = 90 + rand() * (ARENA_H - 180);
      if (Math.hypot(x - tank.x, y - tank.y) < minFromPlayer) continue;
      if (PILLARS.some((pillar) => circleHitsRect(x, y, 40, pillar))) continue;
      if (targets.some((target) => target.alive && Math.hypot(target.x - x, target.y - y) < 90)) continue;
      return { x, y };
    }
    return { x: 160, y: 160 };
  }

  function award(amount: number, x: number, y: number): void {
    bank += amount;
    earned += amount;
    options.onCurrency(bank);
    floaters.push({ x, y: y - 20, text: `+${amount}`, life: 0.9 });
    if (floaters.length > 24) floaters.splice(0, floaters.length - 24);
  }

  function burst(x: number, y: number, color: string, count: number): void {
    for (let i = 0; i < count; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 40 + Math.random() * 160;
      particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0.35 + Math.random() * 0.35,
        max: 0.7,
        color,
        size: 4 + Math.random() * 6,
      });
    }
    if (particles.length > 120) particles.splice(0, particles.length - 120);
  }

  function hurtPlayer(amount: number): void {
    if (phase !== "play" || tank.iframe > 0) return;
    tank.hp = Math.max(0, tank.hp - amount);
    tank.iframe = 0.55;
    tank.flash = 0.12;
    sfxHit();
    if (!reduceMotion) shake = Math.min(12, shake + 5);
    if (tank.hp <= 0) {
      phase = "dead";
      sfxBoom();
      burst(tank.x, tank.y, "#e7edf5", 22);
      endCopy.textContent = earned > 0 ? `You hauled ${earned} scrap.` : "No scrap this run.";
      endcard.hidden = false;
    }
  }

  function update(dt: number): void {
    if (warmup > 0) warmup = Math.max(0, warmup - dt);
    const drive = input.getDrive();
    const throttle = Math.max(Math.abs(drive.forward), Math.abs(drive.turn) * 0.5);
    if (tank.fuel > 0 && throttle > 0.02) {
      tank.fuel = Math.max(0, tank.fuel - fuelDrainPerSecond(stats, throttle) * dt);
    }
    const signed = drive.forward < 0 ? drive.forward * 0.8 : drive.forward;
    const speed = maxDriveSpeed(stats, tank.fuel);
    const targetVx = Math.sin(tank.angle) * speed * signed;
    const targetVy = -Math.cos(tank.angle) * speed * signed;
    const blend = 1 - Math.exp(-7 * dt);
    tank.vx += (targetVx - tank.vx) * blend;
    tank.vy += (targetVy - tank.vy) * blend;
    tank.x += tank.vx * dt;
    tank.y += tank.vy * dt;
    tank.angle += drive.turn * maxTurnRate(stats) * dt;
    const solved = resolveCircle(tank.x, tank.y, radius);
    tank.x = solved.x;
    tank.y = solved.y;
    tank.iframe = Math.max(0, tank.iframe - dt);
    tank.flash = Math.max(0, tank.flash - dt);

    if (Math.abs(drive.forward) > 0.3 && Math.random() < dt * 20) {
      const bx = -Math.sin(tank.angle);
      const by = Math.cos(tank.angle);
      particles.push({
        x: tank.x + bx * radius * 0.85,
        y: tank.y + by * radius * 0.7,
        vx: bx * 20 + (Math.random() - 0.5) * 30,
        vy: by * 20 + (Math.random() - 0.5) * 30,
        life: 0.35,
        max: 0.35,
        color: "rgba(180, 186, 196, 0.7)",
        size: 5,
      });
    }

    const aim = input.getAimStick();
    let targetAngle = tank.turret;
    let firing = false;
    if (aim.active) {
      targetAngle = aim.angle;
      firing = true;
    } else {
      const mouse = input.getMouseClient();
      if (mouse.valid) {
        const world = clientToWorld(mouse.x, mouse.y);
        targetAngle = Math.atan2(world.x - tank.x, -(world.y - tank.y));
      }
      firing = input.isFiringFromPointer();
    }
    tank.turret = rotateToward(tank.turret, targetAngle, 5.4 * dt);

    if (cooldown > 0) cooldown -= dt;
    if (firing && cooldown <= 0 && stats.fireRate > 0 && weapons.length > 0) {
      fireSalvo();
      cooldown = 1 / stats.fireRate;
    }

    for (const target of targets) {
      target.flash = Math.max(0, target.flash - dt);
      target.touch = Math.max(0, target.touch - dt);
      if (!target.alive) {
        target.respawn -= dt;
        if (target.respawn <= 0) revive(target);
        continue;
      }
      if (target.kind === "enemy") updateEnemy(target, dt);
      const dist = Math.hypot(target.x - tank.x, target.y - tank.y);
      if (warmup <= 0 && target.kind === "enemy" && dist < radius + target.size * 0.45 && target.touch <= 0) {
        target.touch = 0.85;
        const nx = (tank.x - target.x) / (dist || 1);
        const ny = (tank.y - target.y) / (dist || 1);
        tank.x += nx * 14;
        tank.y += ny * 14;
        const bumped = resolveCircle(tank.x, tank.y, radius);
        tank.x = bumped.x;
        tank.y = bumped.y;
        hurtPlayer(12);
      }
    }
    separateTargets();

    for (let i = shots.length - 1; i >= 0; i -= 1) {
      const shot = shots[i];
      shot.x += shot.vx * dt;
      shot.y += shot.vy * dt;
      shot.life -= dt;
      const inside =
        shot.x < 0 || shot.y < 0 || shot.x > ARENA_W || shot.y > ARENA_H || shotHitsPillar(shot);
      if (shot.life <= 0 || inside) {
        shots.splice(i, 1);
        continue;
      }
      if (shot.friendly) {
        const hit = targets.find(
          (target) => target.alive && Math.hypot(target.x - shot.x, target.y - shot.y) < target.size * 0.5 + shot.r,
        );
        if (!hit) continue;
        hit.hp -= shot.damage;
        hit.flash = 0.08;
        shots.splice(i, 1);
        if (hit.hp <= 0) destroyTarget(hit);
        else sfxHit();
      } else if (Math.hypot(tank.x - shot.x, tank.y - shot.y) < radius * 0.72 + shot.r) {
        shots.splice(i, 1);
        hurtPlayer(shot.damage);
      }
    }

    stepDecor(dt);
    if (shake > 0) shake = Math.max(0, shake - dt * 18);
    syncHud();
  }

  function updateEnemy(target: Target, dt: number): void {
    target.wander -= dt;
    if (target.wander <= 0) {
      target.wander = 1.1 + Math.random() * 1.8;
      const angle = Math.random() * Math.PI * 2;
      const speed = 32 + Math.random() * 26;
      const dx = tank.x - target.x;
      const dy = tank.y - target.y;
      const dist = Math.hypot(dx, dy) || 1;
      target.vx = Math.cos(angle) * speed + (dx / dist) * 10;
      target.vy = Math.sin(angle) * speed + (dy / dist) * 10;
    }
    target.x += target.vx * dt;
    target.y += target.vy * dt;
    const solved = resolveCircle(target.x, target.y, target.size * 0.5);
    if (Math.abs(solved.x - target.x) > 0.4 || Math.abs(solved.y - target.y) > 0.4) {
      target.vx = 0;
      target.vy = 0;
      target.wander = 0;
    }
    target.x = solved.x;
    target.y = solved.y;

    const dist = Math.hypot(tank.x - target.x, tank.y - target.y);
    if (warmup <= 0 && dist < 420) {
      target.shoot -= dt;
      if (target.shoot <= 0) {
        target.shoot = 2.6 + Math.random() * 1.8;
        const angle = Math.atan2(tank.x - target.x, -(tank.y - target.y));
        const speed = 145;
        shots.push({
          x: target.x + Math.sin(angle) * 28,
          y: target.y - Math.cos(angle) * 28,
          vx: Math.sin(angle) * speed,
          vy: -Math.cos(angle) * speed,
          r: 6,
          damage: 8,
          life: 2.6,
          friendly: false,
          color: "#ffb703",
        });
      }
    }
  }

  function separateTargets(): void {
    for (let i = 0; i < targets.length; i += 1) {
      for (let j = i + 1; j < targets.length; j += 1) {
        const a = targets[i];
        const b = targets[j];
        if (!a.alive || !b.alive) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const min = (a.size + b.size) * 0.48;
        const dist = Math.hypot(dx, dy);
        if (dist <= 0 || dist >= min) continue;
        const push = (min - dist) / 2;
        const nx = dx / dist;
        const ny = dy / dist;
        a.x -= nx * push;
        a.y -= ny * push;
        b.x += nx * push;
        b.y += ny * push;
      }
    }
  }

  function destroyTarget(target: Target): void {
    target.alive = false;
    target.respawn = target.kind === "enemy" ? 2.6 : 3.4;
    award(target.scrap, target.x, target.y);
    burst(target.x, target.y, target.kind === "enemy" ? "#ff6b6b" : "#e0a15a", 14);
    sfxBoom();
    if (!reduceMotion) shake = Math.min(10, shake + 3);
  }

  function revive(target: Target): void {
    const spot = openPoint(Math.random, 320);
    target.x = spot.x;
    target.y = spot.y;
    target.vx = 0;
    target.vy = 0;
    target.hp = target.hpMax;
    target.alive = true;
    target.wander = 0.3;
    target.shoot = 1;
  }

  function fireSalvo(): void {
    const count = weapons.length;
    const spread = count <= 1 ? 0 : Math.min(0.1, 0.38 / count);
    for (let i = 0; i < count; i += 1) {
      const offset = count === 1 ? 0 : (i - (count - 1) / 2) * spread;
      const angle = tank.turret + offset;
      const muzzle = 34 + radius * 0.15;
      const speed = 560;
      shots.push({
        x: tank.x + Math.sin(angle) * muzzle,
        y: tank.y - Math.cos(angle) * muzzle,
        vx: Math.sin(angle) * speed,
        vy: -Math.cos(angle) * speed,
        r: 5,
        damage: weapons[i].damage,
        life: 1.15,
        friendly: true,
        color: "#8ef6ea",
      });
    }
    if (shots.length > 64) shots.splice(0, shots.length - 64);
    tank.flash = 0.07;
    sfxShot();
  }

  function stepDecor(dt: number): void {
    for (let i = particles.length - 1; i >= 0; i -= 1) {
      const bit = particles[i];
      bit.life -= dt;
      bit.x += bit.vx * dt;
      bit.y += bit.vy * dt;
      bit.vx *= 0.96;
      bit.vy *= 0.96;
      if (bit.life <= 0) particles.splice(i, 1);
    }
    for (let i = floaters.length - 1; i >= 0; i -= 1) {
      const floater = floaters[i];
      floater.life -= dt;
      floater.y -= 28 * dt;
      if (floater.life <= 0) floaters.splice(i, 1);
    }
  }

  function syncHud(): void {
    const hpPct = stats.hp > 0 ? Math.max(0, tank.hp) / stats.hp : 0;
    hpFill.style.width = `${hpPct * 100}%`;
    fuelFill.style.width = `${stats.fuel > 0 ? (tank.fuel / stats.fuel) * 100 : 0}%`;
    const hpText = hpLabel.querySelector(".meter-value");
    const fuelText = fuelLabel.querySelector(".meter-value");
    if (hpText) hpText.textContent = String(Math.ceil(tank.hp));
    if (fuelText) fuelText.textContent = String(Math.ceil(tank.fuel));
    hpMeter.classList.toggle("low", hpPct < 0.3);
    scrapValue.textContent = `${bank.toLocaleString()} scrap`;
    const next = statusLine();
    if (next !== lastStatus) {
      lastStatus = next;
      status.textContent = next;
      status.hidden = next.length === 0;
    }
  }

  function statusLine(): string {
    if (phase === "dead") return "";
    if (tank.fuel <= 0) return "Fuel empty — crawling";
    if (stats.weaponCount === 0) return "No cannon mounted";
    if (stats.fireRate <= 0) return "Cannons unpowered";
    return "";
  }

  function draw(): void {
    const view = currentView();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    const shakeX = shake > 0 && !reduceMotion ? (Math.random() - 0.5) * shake : 0;
    const shakeY = shake > 0 && !reduceMotion ? (Math.random() - 0.5) * shake : 0;
    context.setTransform(
      view.dpr * view.zoom,
      0,
      0,
      view.dpr * view.zoom,
      (-view.camX + shakeX) * view.dpr * view.zoom,
      (-view.camY + shakeY) * view.dpr * view.zoom,
    );

    context.fillStyle = "#10141c";
    context.fillRect(-600, -600, ARENA_W + 1200, ARENA_H + 1200);
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
    context.save();
    context.strokeStyle = "#ffb703";
    context.lineWidth = 4;
    context.setLineDash([18, 14]);
    context.strokeRect(20, 20, ARENA_W - 40, ARENA_H - 40);
    context.restore();

    for (const pillar of PILLARS) drawPillar(pillar);
    for (const target of targets) {
      if (target.alive) drawTarget(target);
    }
    for (const shot of shots) drawShot(shot);
    for (const bit of particles) {
      context.globalAlpha = Math.max(0, bit.life / bit.max);
      context.fillStyle = bit.color;
      context.fillRect(bit.x, bit.y, bit.size, bit.size);
      context.globalAlpha = 1;
    }
    drawTank();
    context.font = "700 18px Trebuchet MS, Verdana, sans-serif";
    context.textAlign = "center";
    for (const floater of floaters) {
      context.globalAlpha = Math.max(0, floater.life);
      context.fillStyle = "#f6f1e6";
      context.fillText(floater.text, floater.x, floater.y);
      context.globalAlpha = 1;
    }
  }

  function drawPillar(pillar: Pillar): void {
    traceRoundRect(context, pillar.x, pillar.y, pillar.w, pillar.h, 8);
    context.fillStyle = "#2c3546";
    context.fill();
    context.strokeStyle = "#0e1116";
    context.lineWidth = 4;
    context.stroke();
    context.fillStyle = "rgba(255,255,255,0.12)";
    context.fillRect(pillar.x + 6, pillar.y + 6, pillar.w - 12, 8);
  }

  function drawTarget(target: Target): void {
    const x = target.x - target.size / 2;
    const y = target.y - target.size / 2;
    traceRoundRect(context, x, y, target.size, target.size, 8);
    context.fillStyle = target.flash > 0 ? "#fff4d2" : target.kind === "enemy" ? "#ff5d5d" : "#d08a45";
    context.fill();
    context.strokeStyle = "#0e1116";
    context.lineWidth = 4;
    context.stroke();
    context.fillStyle = "rgba(255,255,255,0.2)";
    context.fillRect(x + 5, y + 5, target.size - 10, 7);
    if (target.kind === "enemy") {
      context.fillStyle = "#1a1208";
      context.fillRect(target.x - 10, target.y - 4, 6, 6);
      context.fillRect(target.x + 4, target.y - 4, 6, 6);
    } else {
      context.strokeStyle = "#6b3d1e";
      context.lineWidth = 3;
      context.beginPath();
      context.moveTo(target.x - 8, target.y);
      context.lineTo(target.x + 8, target.y);
      context.moveTo(target.x, target.y - 8);
      context.lineTo(target.x, target.y + 8);
      context.stroke();
    }
    const barY = y - 10;
    context.fillStyle = "#0e1116";
    context.fillRect(x, barY, target.size, 5);
    context.fillStyle = target.kind === "enemy" ? "#ffd0d0" : "#ffe0b0";
    context.fillRect(x, barY, target.size * clamp(target.hp / target.hpMax, 0, 1), 5);
  }

  function drawShot(shot: Shot): void {
    context.save();
    context.translate(shot.x, shot.y);
    context.rotate(Math.atan2(shot.vy, shot.vx));
    context.fillStyle = shot.color;
    traceRoundRect(context, -11, -3.5, shot.friendly ? 18 : 14, shot.friendly ? 7 : 7, 3);
    context.fill();
    context.restore();
  }

  function drawTank(): void {
    context.save();
    context.translate(tank.x + 5, tank.y + 7);
    context.rotate(tank.angle);
    context.fillStyle = "rgba(0,0,0,0.28)";
    context.beginPath();
    context.ellipse(0, 0, bodyW * 0.46, bodyH * 0.48, 0, 0, Math.PI * 2);
    context.fill();
    context.restore();

    const blink = tank.iframe > 0 && Math.floor(performance.now() / 80) % 2 === 0;
    context.save();
    context.globalAlpha = blink ? 0.45 : 1;
    context.translate(tank.x, tank.y);
    context.rotate(tank.angle);

    traceRoundRect(context, -bodyW / 2 - 5, -bodyH / 2 - 5, bodyW + 10, bodyH + 10, 10);
    context.fillStyle = "#2a3142";
    context.fill();
    context.strokeStyle = "#0e1116";
    context.lineWidth = 4;
    context.stroke();

    context.fillStyle = "#ffb703";
    context.beginPath();
    context.moveTo(0, -bodyH / 2 - 12);
    context.lineTo(9, -bodyH / 2 + 2);
    context.lineTo(-9, -bodyH / 2 + 2);
    context.closePath();
    context.fill();

    const gap = 3;
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const x = -bodyW / 2 + c * CELL + gap / 2;
        const y = -bodyH / 2 + r * CELL + gap / 2;
        const size = CELL - gap;
        const id = grid[r][c];
        const mod = id ? getModule(id) : undefined;
        traceRoundRect(context, x, y, size, size, 5);
        context.fillStyle = mod?.color ?? "#141820";
        context.fill();
        context.lineWidth = 2;
        context.strokeStyle = "#0e1116";
        context.stroke();
        if (mod) {
          context.fillStyle = "rgba(255,255,255,0.22)";
          context.fillRect(x + 3, y + 3, size - 6, 5);
          drawGlyph(mod.kind, x + size / 2, y + size / 2, size * 0.28);
        }
      }
    }

    context.rotate(tank.turret - tank.angle);
    context.fillStyle = tank.flash > 0 ? "#fff1c9" : "#d5ddea";
    context.beginPath();
    context.arc(0, 0, 16, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = "#0e1116";
    context.lineWidth = 3;
    context.stroke();
    traceRoundRect(context, -5, -40, 10, 26, 3);
    context.fillStyle = "#e7edf5";
    context.fill();
    context.stroke();
    context.fillStyle = "#1a1e27";
    context.fillRect(-4, -40, 8, 5);
    if (tank.flash > 0) {
      context.fillStyle = "rgba(255, 214, 120, 0.9)";
      context.beginPath();
      context.arc(0, -46, 7, 0, Math.PI * 2);
      context.fill();
    }
    context.restore();
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
      context.rect(-s * 0.45, -s * 0.45, s * 0.9, s * 0.9);
      context.stroke();
    } else if (kind === "tracks") {
      context.moveTo(-s, -s * 0.45);
      context.lineTo(s, -s * 0.45);
      context.moveTo(-s, 0);
      context.lineTo(s, 0);
      context.moveTo(-s, s * 0.45);
      context.lineTo(s, s * 0.45);
      context.stroke();
    } else if (kind === "power") {
      context.moveTo(s * 0.1, -s);
      context.lineTo(-s * 0.45, s * 0.05);
      context.lineTo(s * 0.05, s * 0.05);
      context.lineTo(-s * 0.1, s);
      context.lineTo(s * 0.5, -s * 0.08);
      context.lineTo(0, -s * 0.08);
      context.closePath();
      context.fill();
    } else if (kind === "fuel") {
      context.arc(0, s * 0.1, s * 0.48, 0, Math.PI * 2);
      context.fill();
    } else if (kind === "engine") {
      context.arc(0, 0, s * 0.46, 0, Math.PI * 2);
      context.stroke();
    } else {
      context.moveTo(-s, s * 0.25);
      context.lineTo(s * 0.2, s * 0.25);
      context.lineTo(s, -s * 0.05);
      context.lineTo(s, s * 0.55);
      context.lineTo(s * 0.2, s * 0.25);
      context.stroke();
    }
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
    const zoom = Math.min(viewW, viewH) / 560;
    const thumbBias = viewH > viewW ? 78 : 0;
    let camX = tank.x - viewW / (2 * zoom);
    let camY = tank.y - (viewH / 2 - thumbBias) / zoom;
    const worldW = viewW / zoom;
    const worldH = viewH / zoom;
    camX = clamp(camX, -120, ARENA_W - worldW + 120);
    camY = clamp(camY, -120, ARENA_H - worldH + 120);
    return { zoom, camX, camY, dpr, rect };
  }

  function clientToWorld(clientX: number, clientY: number): { x: number; y: number } {
    const view = currentView();
    const sx = clientX - view.rect.left;
    const sy = clientY - view.rect.top;
    return { x: sx / view.zoom + view.camX, y: sy / view.zoom + view.camY };
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
    if (phase === "play") {
      acc += dt;
      const step = 1 / 60;
      let guard = 0;
      while (acc >= step && guard < 4) {
        update(step);
        acc -= step;
        guard += 1;
        if (phase !== "play") break;
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
  endMenu.addEventListener("click", () => options.onExit());
  retry.addEventListener("click", () => boot());
  window.addEventListener("keydown", onKey);

  if (import.meta.env.DEV) {
    window.__TANK_DEBUG__ = () => ({
      x: tank.x,
      y: tank.y,
      angle: tank.angle,
      turret: tank.turret,
      hp: tank.hp,
      fuel: tank.fuel,
      shots: shots.length,
      enemies: targets.filter((target) => target.kind === "enemy" && target.alive).length,
      crates: targets.filter((target) => target.kind === "crate" && target.alive).length,
      bank,
      earned,
      phase,
      targets: targets.map((target) => ({
        x: target.x,
        y: target.y,
        kind: target.kind,
        alive: target.alive,
        hp: target.hp,
      })),
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
      let dx = px - nearestX;
      let dy = py - nearestY;
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
      const push = r - dist + 0.25;
      px += (dx / dist) * push;
      py += (dy / dist) * push;
    }
  }
  return { x: clamp(px, r, ARENA_W - r), y: clamp(py, r, ARENA_H - r) };
}

function circleHitsRect(cx: number, cy: number, cr: number, rect: Pillar): boolean {
  const nearestX = clamp(cx, rect.x, rect.x + rect.w);
  const nearestY = clamp(cy, rect.y, rect.y + rect.h);
  const dx = cx - nearestX;
  const dy = cy - nearestY;
  return dx * dx + dy * dy < cr * cr;
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

function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
