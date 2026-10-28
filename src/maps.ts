import { clamp } from "./math";
import { PAL } from "./palette";

/** A tank is 7 blocks long. Arenas stay inside eight of those. */
export const TANK_LENGTH = 7 * 24;
export const MAX_ARENA = TANK_LENGTH * 8;
export const TILE = 32;
/** Each authored tile is repeated this many times on both axes. */
const LAYOUT_SCALE = 2;

const NAV_R = 58;
const STEP = 16;

export interface MapBlock {
  x: number;
  y: number;
  w: number;
  h: number;
  kind: string;
  color: string;
}

export interface ArenaMap {
  id: string;
  name: string;
  w: number;
  h: number;
  ground: string;
  alt: string;
  edge: string;
  spawnA: { x: number; y: number };
  spawnB: { x: number; y: number };
  blocks: MapBlock[];
  hazards: MapBlock[];
  nav: Uint8Array;
  navCols: number;
  navRows: number;
}

interface KindStyle {
  color: string;
  hazard?: boolean;
}

interface MapSpec {
  id: string;
  name: string;
  ground: string;
  alt: string;
  edge: string;
  rows: string[];
  kinds: Record<string, KindStyle>;
}

/**
 * Rows are TILE pixels tall. `.` is open, `A` is the player spawn (bottom, faces up),
 * `B` is the rival (top). Every other glyph is a themed block. Lava is a hazard:
 * it hurts a tank and bots will not path through it, but shots fly over it.
 * Side lanes stay open so a tank-sized circle can always drive spawn to spawn.
 * Each glyph is scaled up so cover grows with the arena.
 */
const SPECS: readonly MapSpec[] = [
  {
    id: "default",
    name: "Default",
    ground: PAL.navy,
    alt: PAL.blueDark,
    edge: PAL.steel,
    kinds: { "#": { color: PAL.panel }, P: { color: PAL.steel } },
    rows: [
      "....................",
      "....................",
      "..........B.........",
      "....................",
      "....................",
      ".......##..##.......",
      ".......##..##.......",
      ".......####.##......",
      "....................",
      "..........####......",
      ".......##..##.......",
      "....................",
      "....................",
      "..........A.........",
      "....................",
      "....................",
    ],
  },
  {
    id: "plains",
    name: "Plains",
    ground: PAL.grass,
    alt: PAL.grassLite,
    edge: PAL.greenDark,
    kinds: {
      H: { color: PAL.hay },
      R: { color: PAL.gray },
      W: { color: PAL.brown },
    },
    rows: [
      "....................",
      "....................",
      "..........B.........",
      "....................",
      "....................",
      ".......HH..R........",
      ".........RR..W......",
      ".......WW..WW.......",
      ".......R....HH......",
      "............HH......",
      ".......RR..W........",
      "....................",
      "....................",
      "..........A.........",
      "....................",
      "....................",
    ],
  },
  {
    id: "fortress",
    name: "Fortress",
    ground: PAL.stone,
    alt: PAL.stoneDark,
    edge: PAL.shadow,
    kinds: { "#": { color: PAL.stone }, K: { color: PAL.grayDark } },
    rows: [
      "....................",
      "....................",
      "..........B.........",
      "....................",
      "....................",
      "#######......#######",
      ".KKKK............KKK",
      ".KKK..............KK",
      ".KKK..............KK",
      ".KKKK............KKK",
      "#######......#######",
      "....................",
      "....................",
      "..........A.........",
      "....................",
      "....................",
    ],
  },
  {
    id: "graveyard",
    name: "Graveyard",
    ground: PAL.greenDark,
    alt: PAL.grass,
    edge: PAL.shadow,
    kinds: {
      T: { color: PAL.tan },
      C: { color: PAL.brownDark },
      Y: { color: PAL.brown },
      F: { color: PAL.mist },
    },
    rows: [
      "....................",
      "....................",
      "..........B.........",
      "....................",
      "....................",
      ".......TT..T........",
      ".......CC..YY.......",
      ".........FF.........",
      ".......FF..FF.......",
      ".......TT..CC.......",
      ".......YY..TT.......",
      "....................",
      "....................",
      "..........A.........",
      "....................",
      "....................",
    ],
  },
  {
    id: "town",
    name: "Town",
    ground: PAL.brown,
    alt: PAL.sand,
    edge: PAL.brownDark,
    kinds: {
      U: { color: PAL.house },
      N: { color: PAL.houseLite },
      X: { color: PAL.crate },
    },
    rows: [
      "....................",
      "....................",
      "..........B.........",
      "....................",
      "....................",
      ".......UU..NN.......",
      ".......UU..NN.......",
      ".......XX..XX.......",
      "....................",
      ".......NN..UU.......",
      ".......NN..XX.......",
      "....................",
      "....................",
      "..........A.........",
      "....................",
      "....................",
    ],
  },
  {
    id: "volcano",
    name: "Volcano",
    ground: PAL.ink,
    alt: PAL.grayDark,
    edge: PAL.shadow,
    kinds: {
      P: { color: PAL.void },
      R: { color: PAL.stoneDark },
      L: { color: PAL.lava, hazard: true },
    },
    rows: [
      "....................",
      "....................",
      "..........B.........",
      "....................",
      "....................",
      ".......PP..PP.......",
      ".......LL..LL.......",
      "........LLLL........",
      "..........RR........",
      ".......LL..LL.......",
      ".......RR..PP.......",
      "....................",
      "....................",
      "..........A.........",
      "....................",
      "....................",
    ],
  },
  {
    id: "junkyard",
    name: "Junkyard",
    ground: PAL.stoneDark,
    alt: PAL.brownDark,
    edge: PAL.shadow,
    kinds: {
      S: { color: PAL.scrap },
      V: { color: PAL.car },
      D: { color: PAL.carBlue },
      I: { color: PAL.tire },
    },
    rows: [
      "....................",
      "....................",
      "..........B.........",
      "....................",
      "....................",
      ".......SS..II.......",
      ".......VV..DD.......",
      ".......II..SS.......",
      ".........SS.........",
      ".......DDDD.........",
      ".......II..VV.......",
      "....................",
      "....................",
      "..........A.........",
      "....................",
      "....................",
    ],
  },
];

function circleHits(x: number, y: number, r: number, block: MapBlock): boolean {
  const nx = clamp(x, block.x, block.x + block.w);
  const ny = clamp(y, block.y, block.y + block.h);
  const dx = x - nx;
  const dy = y - ny;
  return dx * dx + dy * dy <= r * r;
}

function walkable(map: Pick<ArenaMap, "w" | "h" | "blocks" | "hazards">, x: number, y: number): boolean {
  if (x < NAV_R || y < NAV_R || x > map.w - NAV_R || y > map.h - NAV_R) return false;
  if (map.blocks.some((block) => circleHits(x, y, NAV_R, block))) return false;
  if (map.hazards.some((block) => circleHits(x, y, NAV_R, block))) return false;
  return true;
}

function buildNav(map: Pick<ArenaMap, "w" | "h" | "blocks" | "hazards">): Pick<ArenaMap, "nav" | "navCols" | "navRows"> {
  const navCols = Math.floor(map.w / STEP);
  const navRows = Math.floor(map.h / STEP);
  const nav = new Uint8Array(navCols * navRows);
  for (let gy = 0; gy < navRows; gy += 1) {
    for (let gx = 0; gx < navCols; gx += 1) {
      const x = gx * STEP + STEP / 2;
      const y = gy * STEP + STEP / 2;
      if (walkable(map, x, y)) nav[gy * navCols + gx] = 1;
    }
  }
  return { nav, navCols, navRows };
}

function scaleLayout(rows: readonly string[]): string[] {
  const out: string[] = [];
  for (const row of rows) {
    let wide = "";
    for (const glyph of row) wide += glyph.repeat(LAYOUT_SCALE);
    for (let copy = 0; copy < LAYOUT_SCALE; copy += 1) out.push(wide);
  }
  return out;
}

function centroid(points: { x: number; y: number }[]): { x: number; y: number } | null {
  if (points.length === 0) return null;
  const sum = points.reduce((acc, point) => ({ x: acc.x + point.x, y: acc.y + point.y }), { x: 0, y: 0 });
  return { x: sum.x / points.length, y: sum.y / points.length };
}

function buildMap(spec: MapSpec): ArenaMap {
  const rows = scaleLayout(spec.rows);
  const width = rows[0]?.length ?? 0;
  const pad = ".".repeat(width);
  for (let extra = 0; extra < 4; extra += 1) {
    rows.unshift(pad);
    rows.push(pad);
  }
  if (width === 0 || rows.some((row) => row.length !== width)) {
    throw new Error(`${spec.id} rows must be the same width`);
  }
  const blocks: MapBlock[] = [];
  const hazards: MapBlock[] = [];
  const marksA: { x: number; y: number }[] = [];
  const marksB: { x: number; y: number }[] = [];
  rows.forEach((row, r) => {
    for (let c = 0; c < row.length; c += 1) {
      const glyph = row[c] ?? ".";
      if (glyph === ".") continue;
      const x = c * TILE + TILE / 2;
      const y = r * TILE + TILE / 2;
      if (glyph === "A") {
        marksA.push({ x, y });
        continue;
      }
      if (glyph === "B") {
        marksB.push({ x, y });
        continue;
      }
      const style = spec.kinds[glyph];
      if (!style) throw new Error(`${spec.id} has unknown glyph ${glyph}`);
      const block = { x: c * TILE, y: r * TILE, w: TILE, h: TILE, kind: glyph, color: style.color };
      if (style.hazard) hazards.push(block);
      else blocks.push(block);
    }
  });
  const spawnA = centroid(marksA);
  const spawnB = centroid(marksB);
  if (!spawnA || !spawnB) throw new Error(`${spec.id} needs spawn A and spawn B`);
  const w = width * TILE;
  const h = rows.length * TILE;
  const draft = { w, h, blocks, hazards };
  return {
    id: spec.id,
    name: spec.name,
    w,
    h,
    ground: spec.ground,
    alt: spec.alt,
    edge: spec.edge,
    spawnA,
    spawnB,
    blocks,
    hazards,
    ...buildNav(draft),
  };
}

export const MAPS: readonly ArenaMap[] = SPECS.map(buildMap);

export function mapById(id: string): ArenaMap | undefined {
  return MAPS.find((map) => map.id === id);
}

/** One arena per battle. In dev, `?map=fortress` forces a layout. */
export function pickMap(): ArenaMap {
  if (import.meta.env.DEV && typeof location !== "undefined") {
    const id = new URLSearchParams(location.search).get("map");
    const forced = id ? mapById(id) : undefined;
    if (forced) return forced;
  }
  return MAPS[Math.floor(Math.random() * MAPS.length)] ?? MAPS[0];
}

function nearestCell(map: ArenaMap, x: number, y: number): { gx: number; gy: number } | null {
  let best: { gx: number; gy: number; d: number } | null = null;
  for (let gy = 0; gy < map.navRows; gy += 1) {
    for (let gx = 0; gx < map.navCols; gx += 1) {
      if (!map.nav[gy * map.navCols + gx]) continue;
      const cx = gx * STEP + STEP / 2;
      const cy = gy * STEP + STEP / 2;
      const d = (cx - x) * (cx - x) + (cy - y) * (cy - y);
      if (!best || d < best.d) best = { gx, gy, d };
    }
  }
  return best;
}

function bfs(map: ArenaMap, start: { gx: number; gy: number }, goal: { gx: number; gy: number }): { gx: number; gy: number }[] | null {
  const cols = map.navCols;
  const startI = start.gy * cols + start.gx;
  const goalI = goal.gy * cols + goal.gx;
  if (!map.nav[startI] || !map.nav[goalI]) return null;
  if (startI === goalI) return [start];
  const parent = new Int32Array(map.nav.length);
  parent.fill(-1);
  parent[startI] = startI;
  const queue = [startI];
  let found = -1;
  for (let head = 0; head < queue.length && found < 0; head += 1) {
    const cur = queue[head] ?? 0;
    const cx = cur % cols;
    const neighbors = [cx > 0 ? cur - 1 : -1, cx + 1 < cols ? cur + 1 : -1, cur - cols, cur + cols];
    for (const next of neighbors) {
      if (next < 0 || next >= map.nav.length || !map.nav[next] || parent[next] !== -1) continue;
      parent[next] = cur;
      if (next === goalI) {
        found = next;
        break;
      }
      queue.push(next);
    }
  }
  if (found < 0) return null;
  const path: { gx: number; gy: number }[] = [];
  let n = found;
  while (n !== startI) {
    path.push({ gx: n % cols, gy: Math.floor(n / cols) });
    n = parent[n] ?? startI;
  }
  path.push(start);
  path.reverse();
  return path;
}

/** A point a few steps along a walkable path from (x, y) toward (gx, gy). Null when no path exists. */
export function steerPoint(map: ArenaMap, x: number, y: number, gx: number, gy: number): { x: number; y: number } | null {
  const start = nearestCell(map, x, y);
  const goal = nearestCell(map, gx, gy);
  if (!start || !goal) return null;
  const path = bfs(map, start, goal);
  if (!path) return null;
  const node = path[Math.min(path.length - 1, 6)] ?? path[0];
  if (!node) return null;
  return { x: node.gx * STEP + STEP / 2, y: node.gy * STEP + STEP / 2 };
}

/** True when no solid block sits between the two points. Lava does not block a shot. */
export function hasLineOfSight(map: ArenaMap, x1: number, y1: number, x2: number, y2: number): boolean {
  const dist = Math.hypot(x2 - x1, y2 - y1);
  const steps = Math.max(1, Math.ceil(dist / 8));
  for (let i = 1; i < steps; i += 1) {
    const t = i / steps;
    const x = x1 + (x2 - x1) * t;
    const y = y1 + (y2 - y1) * t;
    if (map.blocks.some((block) => x >= block.x && x < block.x + block.w && y >= block.y && y < block.y + block.h)) {
      return false;
    }
  }
  return true;
}

export function hitsBlock(map: ArenaMap, x: number, y: number, r: number): boolean {
  return map.blocks.some((block) => circleHits(x, y, r, block));
}

export function hitsHazard(map: ArenaMap, x: number, y: number, r: number): boolean {
  return map.hazards.some((block) => circleHits(x, y, r, block));
}

/** Push a tank circle out of solid cover and back inside the arena. Lava does not shove. */
export function resolveTank(map: ArenaMap, x: number, y: number, r: number): { x: number; y: number } {
  let px = x;
  let py = y;
  for (let pass = 0; pass < 3; pass += 1) {
    px = clamp(px, r, map.w - r);
    py = clamp(py, r, map.h - r);
    for (const block of map.blocks) {
      const nearestX = clamp(px, block.x, block.x + block.w);
      const nearestY = clamp(py, block.y, block.y + block.h);
      const dx = px - nearestX;
      const dy = py - nearestY;
      const distSq = dx * dx + dy * dy;
      if (distSq >= r * r) continue;
      if (distSq < 1e-6) {
        const left = px - block.x;
        const right = block.x + block.w - px;
        const top = py - block.y;
        const bottom = block.y + block.h - py;
        const min = Math.min(left, right, top, bottom);
        if (min === left) px = block.x - r;
        else if (min === right) px = block.x + block.w + r;
        else if (min === top) py = block.y - r;
        else py = block.y + block.h + r;
        continue;
      }
      const dist = Math.sqrt(distSq);
      px += (dx / dist) * (r - dist + 0.25);
      py += (dy / dist) * (r - dist + 0.25);
    }
  }
  return { x: clamp(px, r, map.w - r), y: clamp(py, r, map.h - r) };
}

/** Size, spawn clearance, and a drivable path. Empty means every arena is legal. */
export function auditMaps(maps: readonly ArenaMap[] = MAPS): string[] {
  const issues: string[] = [];
  for (const map of maps) {
    if (map.w > MAX_ARENA || map.h > MAX_ARENA) issues.push(`${map.id} is larger than ${MAX_ARENA}`);
    if (map.w < TILE * 8 || map.h < TILE * 8) issues.push(`${map.id} is too small`);
    if (!walkable(map, map.spawnA.x, map.spawnA.y)) issues.push(`${map.id} spawn A is blocked`);
    if (!walkable(map, map.spawnB.x, map.spawnB.y)) issues.push(`${map.id} spawn B is blocked`);
    const start = nearestCell(map, map.spawnA.x, map.spawnA.y);
    const goal = nearestCell(map, map.spawnB.x, map.spawnB.y);
    if (!start || !goal || !bfs(map, start, goal)) issues.push(`${map.id} has no path between spawns`);
    const nearA = start ? Math.hypot(start.gx * STEP + STEP / 2 - map.spawnA.x, start.gy * STEP + STEP / 2 - map.spawnA.y) : 999;
    const nearB = goal ? Math.hypot(goal.gx * STEP + STEP / 2 - map.spawnB.x, goal.gy * STEP + STEP / 2 - map.spawnB.y) : 999;
    if (nearA > STEP * 2) issues.push(`${map.id} spawn A is far from a drivable cell`);
    if (nearB > STEP * 2) issues.push(`${map.id} spawn B is far from a drivable cell`);
  }
  return issues;
}

const mapProblems = auditMaps();
if (mapProblems.length > 0) {
  throw new Error(mapProblems.join("\n"));
}
