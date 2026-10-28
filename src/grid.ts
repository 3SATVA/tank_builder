import { blockPlate, getModule, isCoreCell, isTurretCell, moduleIdOf } from "./modules";

export type Grid = (string | null)[][];

export function footprint(moduleId: string, row: number, col: number): { r: number; c: number }[] {
  const mod = getModule(moduleId);
  const rows = mod?.rows ?? 1;
  const cols = mod?.cols ?? 1;
  const cells: { r: number; c: number }[] = [];
  for (let dr = 0; dr < rows; dr += 1) {
    for (let dc = 0; dc < cols; dc += 1) {
      cells.push({ r: row + dr, c: col + dc });
    }
  }
  return cells;
}

export function instanceCells(grid: Grid, row: number, col: number): { r: number; c: number }[] {
  const token = grid[row]?.[col];
  if (!token || !moduleIdOf(token)) return [];
  if (!token.includes("@")) return [{ r: row, c: col }];
  const cells: { r: number; c: number }[] = [];
  for (let r = 0; r < grid.length; r += 1) {
    for (let c = 0; c < grid[r].length; c += 1) {
      if (grid[r][c] === token) cells.push({ r, c });
    }
  }
  return cells;
}

/** Both cells in bounds and empty, and the whole footprint is hull or the whole footprint is turret. */
export function canPlace(grid: Grid, hull: string, moduleId: string, row: number, col: number): boolean {
  const cells = footprint(moduleId, row, col);
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;
  if (cells.some((cell) => cell.r < 0 || cell.c < 0 || cell.r >= rows || cell.c >= cols)) return false;
  if (cells.some((cell) => grid[cell.r][cell.c])) return false;
  const flags = cells.map((cell) => isTurretCell(cell.r, cell.c, cols, rows, hull));
  const onTurret = flags.some(Boolean);
  return !onTurret || flags.every(Boolean);
}

/**
 * Place `moduleId` on the tapped cell, swapping out whatever is already there.
 * The same block type still comes off. A multi-cell part has to sit entirely on
 * the hull or entirely inside the turret, and it cannot cover the core cell.
 * Overlapping an existing multi-cell part removes that whole part first.
 */
export function commitPlacement(grid: Grid, hull: string, moduleId: string, row: number, col: number): boolean {
  if (!getModule(moduleId)) return false;
  const current = moduleIdOf(grid[row]?.[col] ?? null);
  if (current === moduleId) {
    removeInstance(grid, row, col);
    return true;
  }
  const cells = footprint(moduleId, row, col);
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;
  if (cells.some((cell) => cell.r < 0 || cell.c < 0 || cell.r >= rows || cell.c >= cols)) return false;
  const flags = cells.map((cell) => isTurretCell(cell.r, cell.c, cols, rows, hull));
  if (flags.some(Boolean) && !flags.every(Boolean)) return false;
  if (cells.length > 1 && cells.some((cell) => isCoreCell(cell.r, cell.c, cols, rows, hull))) return false;
  const seen = new Set<string>();
  for (const cell of cells) {
    const token = grid[cell.r][cell.c];
    if (!token || seen.has(token)) continue;
    seen.add(token);
    removeInstance(grid, cell.r, cell.c);
  }
  placeModule(grid, moduleId, row, col);
  return true;
}

export function placeModule(grid: Grid, moduleId: string, row: number, col: number): void {
  const mod = getModule(moduleId);
  const token = mod && ((mod.rows ?? 1) > 1 || (mod.cols ?? 1) > 1) ? `${moduleId}@${row},${col}` : moduleId;
  for (const cell of footprint(moduleId, row, col)) grid[cell.r][cell.c] = token;
}

export function removeInstance(grid: Grid, row: number, col: number): void {
  for (const cell of instanceCells(grid, row, col)) grid[cell.r][cell.c] = null;
}

export function damageInstance(
  grid: Grid,
  plate: number[][],
  row: number,
  col: number,
  amount: number,
): { popped: boolean; overflow: number; id: string | null } {
  const cells = instanceCells(grid, row, col);
  const id = moduleIdOf(grid[row]?.[col] ?? null);
  if (cells.length === 0 || !id) return { popped: false, overflow: 0, id: null };
  const next = plate[row][col] - amount;
  for (const cell of cells) plate[cell.r][cell.c] = next;
  if (next > 0) return { popped: false, overflow: 0, id };
  for (const cell of cells) {
    grid[cell.r][cell.c] = null;
    plate[cell.r][cell.c] = 0;
  }
  return { popped: true, overflow: -next, id };
}

export interface RepairJob {
  cells: { r: number; c: number }[];
  /** True when the block was gone and is being put back. */
  rebuild: boolean;
}

/** Lowest remaining plate first. A destroyed blueprint part is the fallback. Never the core. */
export function nextRepair(grid: Grid, plate: number[][], blueprint: Grid): RepairJob | null {
  let best: { cells: { r: number; c: number }[]; fraction: number } | null = null;
  for (let r = 0; r < grid.length; r += 1) {
    for (let c = 0; c < grid[r].length; c += 1) {
      const token = grid[r][c];
      const id = moduleIdOf(token);
      if (!id || !token) continue;
      if (token.includes("@") && !token.endsWith(`@${r},${c}`)) continue;
      const max = blockPlate(id);
      const left = plate[r][c];
      if (max <= 0 || left <= 0 || left >= max - 0.01) continue;
      const cells = instanceCells(grid, r, c);
      const fraction = left / max;
      if (!best || fraction < best.fraction) best = { cells, fraction };
    }
  }
  if (best) return { cells: best.cells, rebuild: false };

  const seen = new Set<string>();
  for (let r = 0; r < blueprint.length; r += 1) {
    for (let c = 0; c < (blueprint[r]?.length ?? 0); c += 1) {
      const token = blueprint[r][c];
      const id = moduleIdOf(token);
      if (!id || !token) continue;
      if (token.includes("@") && !token.endsWith(`@${r},${c}`)) continue;
      const key = token.includes("@") ? token : `${r},${c}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const cells = token.includes("@")
        ? blueprint.flatMap((line, br) => line.flatMap((value, bc) => (value === token ? [{ r: br, c: bc }] : [])))
        : [{ r, c }];
      if (cells.some((cell) => grid[cell.r]?.[cell.c])) continue;
      return { cells: cells.map((cell) => ({ r: cell.r, c: cell.c })), rebuild: true };
    }
  }
  return null;
}

export function applyRepair(grid: Grid, plate: number[][], blueprint: Grid, job: RepairJob): void {
  for (const cell of job.cells) {
    const token = job.rebuild ? blueprint[cell.r]?.[cell.c] ?? null : grid[cell.r][cell.c];
    if (!token) continue;
    grid[cell.r][cell.c] = token;
    plate[cell.r][cell.c] = blockPlate(token);
  }
}
