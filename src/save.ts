import { cloneGrid, createDefaultGrid, getModule, GRID_COLS, GRID_ROWS } from "./modules";
import type { SaveData, ShopItem } from "./types";

const KEY = "tank-builder-save-v3";
const OLD_KEYS = ["tank-builder-save-v2", "tank-builder-save-v1"];

function blank(currency = 0, unlocked: string[] = []): SaveData {
  return {
    version: 1,
    currency,
    unlocked,
    grid: createDefaultGrid(),
  };
}

function isGrid(value: unknown): value is (string | null)[][] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 8) return false;
  const width = Array.isArray(value[0]) ? value[0].length : 0;
  if (width < 1 || width > 8) return false;
  return value.every(
    (row) =>
      Array.isArray(row) &&
      row.length === width &&
      row.every((cell) => cell === null || typeof cell === "string"),
  );
}

function fitsCurrentTank(grid: (string | null)[][]): boolean {
  return grid.length === GRID_ROWS && grid[0]?.length === GRID_COLS;
}

function readCurrency(raw: Partial<SaveData> | null): number {
  return raw && Number.isFinite(raw.currency) ? Math.max(0, Math.floor(raw.currency as number)) : 0;
}

function readUnlocked(raw: Partial<SaveData> | null): string[] {
  if (!raw || !Array.isArray(raw.unlocked)) return [];
  return raw.unlocked.filter((id): id is string => typeof id === "string" && Boolean(getModule(id)));
}

/** Saves from the wide 7×5 or the older 5×3 keep scrap and unlocks, and get a fresh long hull. */
function sanitize(raw: Partial<SaveData> | null): SaveData {
  const currency = readCurrency(raw);
  const unlocked = readUnlocked(raw);
  if (!raw || !isGrid(raw.grid) || !fitsCurrentTank(raw.grid)) {
    return blank(currency, unlocked);
  }
  const grid = raw.grid.map((row) => row.map((id) => (id && getModule(id) ? id : null)));
  return { version: 1, currency, unlocked, grid };
}

export function loadSave(): SaveData {
  try {
    const current = localStorage.getItem(KEY);
    if (current) {
      const parsed = JSON.parse(current) as Partial<SaveData>;
      const save = sanitize(parsed);
      if (!parsed.grid || !isGrid(parsed.grid) || !fitsCurrentTank(parsed.grid)) saveGame(save);
      return save;
    }
    for (const key of OLD_KEYS) {
      const legacy = localStorage.getItem(key);
      if (!legacy) continue;
      const migrated = sanitize(JSON.parse(legacy) as Partial<SaveData>);
      migrated.grid = createDefaultGrid();
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
  const payload: SaveData = {
    version: 1,
    currency: Math.max(0, Math.floor(data.currency)),
    unlocked: [...data.unlocked],
    grid: cloneGrid(data.grid),
  };
  localStorage.setItem(KEY, JSON.stringify(payload));
}

/** Ready for when SHOP_ITEMS is filled in. Returns false if the player can't buy it. */
export function purchase(save: SaveData, item: ShopItem): boolean {
  if (save.unlocked.includes(item.moduleId)) return false;
  if (save.currency < item.cost) return false;
  const mod = getModule(item.moduleId);
  if (!mod || mod.starter) return false;
  save.currency -= item.cost;
  save.unlocked.push(item.moduleId);
  return true;
}
