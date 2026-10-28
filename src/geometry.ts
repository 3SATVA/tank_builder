import { clamp, localToWorld, worldToLocal } from "./math";
import { getModule, isTurretCell } from "./modules";

export const CELL = 24;

export function cellCenter(col: number, row: number, cols: number, rows: number): { x: number; y: number } {
  const width = cols * CELL;
  const height = rows * CELL;
  return {
    x: -width / 2 + (col + 0.5) * CELL,
    y: -height / 2 + (row + 0.5) * CELL,
  };
}

export interface GunMount {
  damage: number;
  /** Turret guns rotate and shoot along the aim. Hull guns shoot the way the hull faces. */
  mount: "hull" | "turret";
  lx: number;
  ly: number;
  row: number;
  col: number;
  life: number;
  heavy: boolean;
  /** Three-cell cannon: slower shell, longer barrel. */
  siege: boolean;
  /** Spears the target and reels it in. */
  hook: boolean;
}

export function listGuns(grid: ReadonlyArray<ReadonlyArray<string | null>>, hull = "standard"): GunMount[] {
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;
  const guns: GunMount[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const token = grid[row][col];
      if (!token) continue;
      const anchor = token.split("@")[1];
      if (anchor && anchor !== `${row},${col}`) continue;
      const mod = getModule(token.split("@")[0] ?? "");
      if (!mod || mod.kind !== "weapon" || mod.cutter) continue;
      const center = cellCenter(col, row, cols, rows);
      guns.push({
        damage: mod.stats.damage ?? 0,
        mount: isTurretCell(row, col, cols, rows, hull) ? "turret" : "hull",
        lx: center.x,
        ly: center.y,
        row,
        col,
        life: mod.shotLife ?? 1.25,
        heavy: (mod.rows ?? 1) > 1 && !mod.hook,
        siege: (mod.rows ?? 1) >= 3,
        hook: Boolean(mod.hook),
      });
    }
  }
  return guns;
}

export interface OrientedBox {
  x: number;
  y: number;
  halfW: number;
  halfH: number;
  angle: number;
}

function boxAxes(angle: number): [{ x: number; y: number }, { x: number; y: number }] {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return [
    { x: cos, y: sin },
    { x: -sin, y: cos },
  ];
}

/** How far to move `b` so it no longer overlaps `a`. Null when they are clear. */
export function pushBox(a: OrientedBox, b: OrientedBox): { x: number; y: number } | null {
  const axes = [...boxAxes(a.angle), ...boxAxes(b.angle)];
  let best = Infinity;
  let px = 0;
  let py = 0;
  for (const axis of axes) {
    const len = Math.hypot(axis.x, axis.y) || 1;
    const ux = axis.x / len;
    const uy = axis.y / len;
    const span = (box: OrientedBox): number => {
      const [across, along] = boxAxes(box.angle);
      return (
        box.halfW * Math.abs(across.x * ux + across.y * uy) +
        box.halfH * Math.abs(along.x * ux + along.y * uy)
      );
    };
    const dist = (b.x - a.x) * ux + (b.y - a.y) * uy;
    const pen = span(a) + span(b) - Math.abs(dist);
    if (pen <= 0) return null;
    if (pen < best) {
      best = pen;
      const sign = dist < 0 ? -1 : 1;
      px = ux * (pen + 0.5) * sign;
      py = uy * (pen + 0.5) * sign;
    }
  }
  return { x: px, y: py };
}

/** How far to move a circle so it sits outside the box. */
export function pushCircleFromBox(
  cx: number,
  cy: number,
  radius: number,
  box: OrientedBox,
): { x: number; y: number } | null {
  const local = worldToLocal(cx - box.x, cy - box.y, box.angle);
  const nearestX = clamp(local.x, -box.halfW, box.halfW);
  const nearestY = clamp(local.y, -box.halfH, box.halfH);
  const inside = nearestX === local.x && nearestY === local.y;
  if (inside) {
    const left = local.x + box.halfW;
    const right = box.halfW - local.x;
    const back = local.y + box.halfH;
    const fore = box.halfH - local.y;
    const min = Math.min(left, right, back, fore);
    let lx = local.x;
    let ly = local.y;
    if (min === left) lx = -box.halfW - radius;
    else if (min === right) lx = box.halfW + radius;
    else if (min === back) ly = -box.halfH - radius;
    else ly = box.halfH + radius;
    const world = localToWorld(lx, ly, box.angle);
    return { x: box.x + world.x - cx, y: box.y + world.y - cy };
  }
  const nearest = localToWorld(nearestX, nearestY, box.angle);
  const wx = box.x + nearest.x;
  const wy = box.y + nearest.y;
  const ox = cx - wx;
  const oy = cy - wy;
  const dist = Math.hypot(ox, oy) || 0.001;
  if (dist >= radius) return null;
  const scale = (radius - dist + 0.4) / dist;
  return { x: ox * scale, y: oy * scale };
}
