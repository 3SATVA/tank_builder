import { cloneGrid, createDefaultGrid, getHull, getModule, hullSize, moduleIdOf } from "./modules";
import type { SaveData, ShopItem } from "./types";

const KEY = "tank-builder-save-v4";
const OLD_KEYS = ["tank-builder-save-v3", "tank-builder-save-v2", "tank-builder-save-v1"];

function blank(currency = 0, unlocked: string[] = []): SaveData {
  return {
    version: 1,
    currency,
    unlocked,
    hull: "standard",
    layouts: { standard: createDefaultGrid("standard") },
    botsBeaten: 0,
  };
}

function isGrid(value: unknown): value is (string | null)[][] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 10) return false;
  const width = Array.isArray(value[0]) ? value[0].length : 0;
  if (width < 1 || width > 10) return false;
  return value.every(
    (row) =>
      Array.isArray(row) &&
      row.length === width &&
      row.every((cell) => cell === null || typeof cell === "string"),
  );
}

function fitsHull(grid: (string | null)[][], hullId: string): boolean {
  const size = hullSize(hullId);
  return grid.length === size.rows && grid[0]?.length === size.cols;
}

function cleanGrid(grid: (string | null)[][]): (string | null)[][] {
  return grid.map((row) => row.map((cell) => (cell && moduleIdOf(cell) ? cell : null)));
}

function readCurrency(raw: { currency?: unknown } | null): number {
  return raw && Number.isFinite(raw.currency) ? Math.max(0, Math.floor(raw.currency as number)) : 0;
}

function readUnlocked(raw: { unlocked?: unknown } | null): string[] {
  if (!raw || !Array.isArray(raw.unlocked)) return [];
  return raw.unlocked.filter(
    (id): id is string => typeof id === "string" && Boolean(getModule(id) || getHull(id)),
  );
}

function ownsHull(id: string, unlocked: readonly string[]): boolean {
  const hull = getHull(id);
  return Boolean(hull && (hull.starter || unlocked.includes(id)));
}

interface RawSave {
  currency?: unknown;
  unlocked?: unknown;
  hull?: unknown;
  layouts?: unknown;
  grid?: unknown;
  botsBeaten?: unknown;
}

function readBots(raw: { botsBeaten?: unknown } | null): number {
  const value = raw && typeof raw.botsBeaten === "number" ? Math.floor(raw.botsBeaten) : 0;
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(3, value));
}

function layoutFrom(value: unknown, hullId: string): (string | null)[][] | null {
  if (!isGrid(value) || !fitsHull(value, hullId)) return null;
  return cleanGrid(value);
}

function sanitize(raw: RawSave | null): SaveData {
  const currency = readCurrency(raw);
  const unlocked = readUnlocked(raw);
  const layouts: Record<string, (string | null)[][]> = {};
  if (raw && raw.layouts && typeof raw.layouts === "object") {
    for (const [id, grid] of Object.entries(raw.layouts as Record<string, unknown>)) {
      if (!ownsHull(id, unlocked)) continue;
      const clean = layoutFrom(grid, id);
      if (clean) layouts[id] = clean;
    }
  }
  if (!layouts.standard) {
    const legacy = raw ? layoutFrom(raw.grid, "standard") : null;
    layouts.standard = legacy ?? createDefaultGrid("standard");
  }
  let hull = typeof raw?.hull === "string" && ownsHull(raw.hull, unlocked) ? raw.hull : "standard";
  if (!layouts[hull]) layouts[hull] = createDefaultGrid(hull);
  for (const id of unlocked) {
    if (getHull(id) && !layouts[id]) layouts[id] = createDefaultGrid(id);
  }
  return { version: 1, currency, unlocked, hull, layouts, botsBeaten: readBots(raw) };
}

export function activeLayout(save: SaveData): (string | null)[][] {
  const grid = save.layouts[save.hull];
  if (grid && fitsHull(grid, save.hull)) return grid;
  const fresh = createDefaultGrid(save.hull);
  save.layouts[save.hull] = fresh;
  return fresh;
}

export function loadSave(): SaveData {
  try {
    const current = localStorage.getItem(KEY);
    if (current) {
      const parsed = JSON.parse(current) as RawSave;
      const save = sanitize(parsed);
      const legacyOnly = !parsed.layouts || !parsed.hull;
      if (legacyOnly) saveGame(save);
      return save;
    }
    for (const key of OLD_KEYS) {
      const legacy = localStorage.getItem(key);
      if (!legacy) continue;
      const parsed = JSON.parse(legacy) as RawSave;
      const migrated = sanitize(parsed);
      const kept = layoutFrom(parsed.grid, "standard");
      migrated.hull = "standard";
      migrated.layouts = { standard: kept ?? createDefaultGrid("standard") };
      migrated.botsBeaten = readBots(parsed);
      for (const stale of OLD_KEYS) localStorage.removeItem(stale);
      saveGame(migrated);
      return migrated;
    }
    return blank();
  } catch {
    return blank();
  }
}

export function saveGame(data: SaveData): void {
  const layouts: SaveData["layouts"] = {};
  for (const [id, grid] of Object.entries(data.layouts)) {
    if (!ownsHull(id, data.unlocked)) continue;
    layouts[id] = cloneGrid(grid);
  }
  if (!layouts.standard) layouts.standard = createDefaultGrid("standard");
  const hull = ownsHull(data.hull, data.unlocked) && layouts[data.hull] ? data.hull : "standard";
  if (!layouts[hull]) layouts[hull] = createDefaultGrid(hull);
  const payload: SaveData = {
    version: 1,
    currency: Math.max(0, Math.floor(data.currency)),
    unlocked: [...data.unlocked],
    hull,
    layouts,
    botsBeaten: Math.max(0, Math.min(3, Math.floor(data.botsBeaten) || 0)),
  };
  data.hull = hull;
  data.layouts = layouts;
  localStorage.setItem(KEY, JSON.stringify(payload));
}

function shopId(item: ShopItem): string {
  return item.kind === "module" ? item.moduleId : item.hullId;
}

/** Spends scrap on a module or a hull. Returns false if it is already owned or unaffordable. */
export function purchase(save: SaveData, item: ShopItem): boolean {
  const id = shopId(item);
  if (save.unlocked.includes(id)) return false;
  if (save.currency < item.cost) return false;
  if (item.kind === "module") {
    const mod = getModule(id);
    if (!mod || mod.starter) return false;
  } else {
    const hull = getHull(id);
    if (!hull || hull.starter) return false;
    if (!save.layouts[id]) save.layouts[id] = createDefaultGrid(id);
  }
  save.currency -= item.cost;
  save.unlocked.push(id);
  return true;
}
