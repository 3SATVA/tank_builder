import { createDefaultGrid, getModule } from "./modules";
import type { SaveData, ShopItem } from "./types";

const KEY = "tank-builder-save-v1";

function blank(): SaveData {
  return {
    version: 1,
    currency: 0,
    unlocked: [],
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

function sanitize(raw: Partial<SaveData> | null): SaveData {
  const fallback = blank();
  if (!raw || raw.version !== 1) return fallback;
  const currency = Number.isFinite(raw.currency) ? Math.max(0, Math.floor(raw.currency as number)) : 0;
  const unlocked = Array.isArray(raw.unlocked)
    ? raw.unlocked.filter((id): id is string => typeof id === "string" && Boolean(getModule(id)))
    : [];
  if (!isGrid(raw.grid)) {
    return { ...fallback, currency, unlocked };
  }
  const grid = raw.grid.map((row) => row.map((id) => (id && getModule(id) ? id : null)));
  return { version: 1, currency, unlocked, grid };
}

export function loadSave(): SaveData {
  try {
    const text = localStorage.getItem(KEY);
    if (!text) return blank();
    return sanitize(JSON.parse(text) as Partial<SaveData>);
  } catch {
    return blank();
  }
}

export function saveGame(data: SaveData): void {
  const payload: SaveData = {
    version: 1,
    currency: Math.max(0, Math.floor(data.currency)),
    unlocked: [...data.unlocked],
    grid: data.grid.map((row) => row.slice()),
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
