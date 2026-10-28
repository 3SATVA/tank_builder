import { createClient } from "@supabase/supabase-js";
import { footprint } from "./grid";
import { BOTS } from "./bots";
import {
  emptyGrid,
  getHull,
  getModule,
  hullSize,
  moduleIdOf,
  outfitProblem,
} from "./modules";
import type { BotTuning } from "./control";

const URL = "https://wzlloqwrqammrcnyfyda.supabase.co";
const KEY = "sb_publishable__OlZIUH2Ns1gfF0uXrXubA_yGTNMq94";

const supabase = createClient(URL, KEY);

const ID_KEY = "tank-builder-pvp-id";
const TOKEN_KEY = "tank-builder-pvp-token";
const NAME_KEY = "tank-builder-pvp-name";
const RATING_KEY = "tank-builder-pvp-rating";

export const PVP_SCRAP = 60;
export const LAYOUT_VERSION = 1;

export interface PvpIdentity {
  playerId: string;
  token: string;
  name: string;
}

export interface Opponent {
  playerId: string;
  name: string;
  rating: number;
  wins: number;
  losses: number;
  hull: string;
  grid: (string | null)[][];
}

export interface BoardRow {
  name: string;
  rating: number;
  wins: number;
  losses: number;
}

export type PvpLaunch = { kind: "rival"; opponent: Opponent } | { kind: "standin" };

const veteran = BOTS.find((bot) => bot.id === "veteran") ?? BOTS[0];

export function veteranTuning(): BotTuning {
  return veteran.tuning;
}

export function standInGrid(): (string | null)[][] {
  return veteran.grid.map((row) => row.slice());
}

export function readIdentity(): PvpIdentity | null {
  try {
    const playerId = localStorage.getItem(ID_KEY) ?? "";
    const token = localStorage.getItem(TOKEN_KEY) ?? "";
    const name = localStorage.getItem(NAME_KEY) ?? "";
    if (!playerId || !token || !name) return null;
    return { playerId, token, name };
  } catch {
    return null;
  }
}

export function readRating(): number | null {
  try {
    const raw = localStorage.getItem(RATING_KEY);
    if (!raw) return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

function remember(identity: PvpIdentity): void {
  localStorage.setItem(ID_KEY, identity.playerId);
  localStorage.setItem(TOKEN_KEY, identity.token);
  localStorage.setItem(NAME_KEY, identity.name);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === "string") {
    try {
      return asRecord(JSON.parse(value));
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function num(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function friendly(error: { message?: string } | null): string {
  const message = error?.message ?? "";
  if (/failed to fetch|network|offline|load failed/i.test(message)) {
    return "The yard is offline. Bots are still here.";
  }
  if (/rate/i.test(message)) return "Too many fights this minute. Rating will catch up.";
  if (message && message.length < 160 && !message.includes(TOKEN_KEY)) return message;
  return "The yard didn't answer.";
}

export function cleanCallsign(raw: string): string {
  return raw.trim().slice(0, 20);
}

export async function registerCallsign(raw: string): Promise<PvpIdentity> {
  const name = cleanCallsign(raw);
  if (!name) throw new Error("Enter a callsign.");
  const { data, error } = await supabase.rpc("tank_register", { p_name: name });
  if (error) throw new Error(friendly(error));
  const row = asRecord(data);
  const playerId = typeof row?.player_id === "string" ? row.player_id : "";
  const token = typeof row?.token === "string" ? row.token : "";
  if (!playerId || !token) throw new Error("Registration came back empty.");
  const identity = { playerId, token, name };
  remember(identity);
  return identity;
}

function anchorCount(grid: ReadonlyArray<ReadonlyArray<string | null>>): number {
  let count = 0;
  for (let r = 0; r < grid.length; r += 1) {
    for (let c = 0; c < (grid[r]?.length ?? 0); c += 1) {
      const token = grid[r][c];
      if (!token || !moduleIdOf(token)) continue;
      const anchor = token.split("@")[1];
      if (anchor && anchor !== `${r},${c}`) continue;
      count += 1;
    }
  }
  return count;
}

export function packLayout(grid: ReadonlyArray<ReadonlyArray<string | null>>): { v: number; grid: (string | null)[][] } {
  return { v: LAYOUT_VERSION, grid: grid.map((row) => row.slice()) };
}

function clearToken(grid: (string | null)[][], token: string): void {
  for (let r = 0; r < grid.length; r += 1) {
    for (let c = 0; c < grid[r].length; c += 1) {
      if (grid[r][c] === token) grid[r][c] = null;
    }
  }
}

/** Drop unknown parts and anything that doesn't fit the hull. Returns null when it can't fight. */
export function readOpponentLayout(hullRaw: unknown, layoutRaw: unknown): { hull: string; grid: (string | null)[][] } | null {
  const hull = typeof hullRaw === "string" && getHull(hullRaw) ? hullRaw : "standard";
  const size = hullSize(hull);
  let cells: unknown = layoutRaw;
  const wrapped = asRecord(layoutRaw);
  if (wrapped) cells = wrapped.grid ?? wrapped.cells ?? wrapped.layout ?? null;
  if (!Array.isArray(cells)) return null;
  const grid = emptyGrid(hull);
  const rowLimit = Math.min(cells.length, size.rows, 12);
  for (let r = 0; r < rowLimit; r += 1) {
    const row = cells[r];
    if (!Array.isArray(row)) continue;
    const colLimit = Math.min(row.length, size.cols, 12);
    for (let c = 0; c < colLimit; c += 1) {
      const value = row[c];
      if (typeof value !== "string") continue;
      const id = value.split("@")[0] ?? "";
      if (!getModule(id)) continue;
      if (!value.includes("@")) {
        grid[r][c] = id;
        continue;
      }
      const anchor = value.split("@")[1] ?? "";
      if (!/^\d+,\d+$/.test(anchor)) continue;
      grid[r][c] = `${id}@${anchor}`;
    }
  }
  const tokens = new Set<string>();
  for (const row of grid) {
    for (const cell of row) {
      if (cell?.includes("@")) tokens.add(cell);
    }
  }
  for (const token of tokens) {
    const id = token.split("@")[0] ?? "";
    const anchor = token.split("@")[1] ?? "";
    const [ar, ac] = anchor.split(",").map((part) => Number(part));
    const mod = getModule(id);
    const cells = mod && Number.isFinite(ar) && Number.isFinite(ac) ? footprint(id, ar, ac) : [];
    const fits = cells.length > 0 && cells.every((cell) => grid[cell.r]?.[cell.c] === token);
    const marked = grid.flatMap((line, r) => line.flatMap((value, c) => (value === token ? [{ r, c }] : [])));
    const same = fits && marked.length === cells.length && cells.every((cell) => marked.some((spot) => spot.r === cell.r && spot.c === cell.c));
    if (!same) clearToken(grid, token);
  }
  if (outfitProblem(grid)) return null;
  return { hull, grid };
}

export async function publishDefense(hull: string, grid: ReadonlyArray<ReadonlyArray<string | null>>): Promise<string> {
  const identity = readIdentity();
  if (!identity) throw new Error("Choose a callsign under PvP first.");
  const problem = outfitProblem(grid);
  if (problem) throw new Error(problem);
  const { error } = await supabase.rpc("tank_save_build", {
    p_player: identity.playerId,
    p_token: identity.token,
    p_name: identity.name,
    p_hull: hull,
    p_layout: packLayout(grid),
    p_score: anchorCount(grid),
  });
  if (error) throw new Error(friendly(error));
  return "Defense tank is posted.";
}

export async function findOpponent(): Promise<Opponent | null> {
  const identity = readIdentity();
  if (!identity) throw new Error("Choose a callsign under PvP first.");
  const { data, error } = await supabase.rpc("tank_find_opponent", {
    p_player: identity.playerId,
    p_token: identity.token,
  });
  if (error) throw new Error(friendly(error));
  if (data == null) return null;
  const row = asRecord(data);
  if (!row) return null;
  const built = readOpponentLayout(row.hull, row.layout);
  if (!built) throw new Error("That rival's tank couldn't be read. Try again.");
  const name = typeof row.name === "string" && row.name.trim() ? row.name.trim().slice(0, 20) : "Rival";
  const playerId = typeof row.player_id === "string" ? row.player_id : "";
  if (!playerId) throw new Error("That rival came back without an id.");
  return {
    playerId,
    name,
    rating: num(row.rating),
    wins: num(row.wins),
    losses: num(row.losses),
    hull: built.hull,
    grid: built.grid,
  };
}

export async function reportResult(defenderId: string, won: boolean): Promise<{ rating: number; delta: number }> {
  const identity = readIdentity();
  if (!identity) throw new Error("Choose a callsign under PvP first.");
  const { data, error } = await supabase.rpc("tank_report_result", {
    p_player: identity.playerId,
    p_token: identity.token,
    p_defender: defenderId,
    p_won: won,
  });
  if (error) throw new Error(friendly(error));
  const row = asRecord(data);
  const rating = num(row?.rating);
  const delta = num(row?.delta);
  try {
    localStorage.setItem(RATING_KEY, String(rating));
  } catch {
    /* rating still shows in the end card */
  }
  return { rating, delta };
}

export function ratingLine(rating: number, delta: number): string {
  const sign = delta > 0 ? `+${delta}` : String(delta);
  return `Rating ${rating} (${sign}).`;
}

export async function loadLeaderboard(): Promise<BoardRow[]> {
  const { data, error } = await supabase.rpc("tank_leaderboard", { p_limit: 20 });
  if (error) throw new Error(friendly(error));
  if (!Array.isArray(data)) return [];
  return data.slice(0, 20).map((entry) => {
    const row = asRecord(entry) ?? {};
    const name = typeof row.name === "string" && row.name.trim() ? row.name.trim().slice(0, 20) : "Pilot";
    return { name, rating: num(row.rating), wins: num(row.wins), losses: num(row.losses) };
  });
}
