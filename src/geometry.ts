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
      if (!mod || mod.kind !== "weapon") continue;
      const center = cellCenter(col, row, cols, rows);
      guns.push({
        damage: mod.stats.damage ?? 0,
        mount: isTurretCell(row, col, cols, rows, hull) ? "turret" : "hull",
        lx: center.x,
        ly: center.y,
        row,
        col,
        life: mod.shotLife ?? 1.25,
        heavy: (mod.rows ?? 1) > 1,
        siege: (mod.rows ?? 1) >= 3,
      });
    }
  }
  return guns;
}
