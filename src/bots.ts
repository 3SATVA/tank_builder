import type { BotTuning } from "./control";

export interface BotDef {
  id: string;
  index: number;
  name: string;
  blurb: string;
  /** Scrap paid for a win. */
  scrap: number;
  hull: string;
  grid: (string | null)[][];
  tuning: BotTuning;
}

/**
 * Three fixed rivals. Each one mounts more plate and more gun than the last,
 * and the later two spend the shop parts. Tuning gets sharper in the same order.
 */
export const BOTS: readonly BotDef[] = [
  {
    id: "rookie",
    index: 0,
    name: "Rookie",
    blurb: "Two turret cannons and a light hull. The aim wanders, and the driver is slow to dodge.",
    scrap: 50,
    hull: "standard",
    tuning: { wobble: 0.34, lead: 0, reaction: 0.48, near: 200, far: 560, dodge: 110, aimSlack: 0.62, strafe: 0.15 },
    grid: [
      [null, "armor", null, "armor", null],
      ["tracks", "engine", null, null, "tracks"],
      [null, "cannon", "armor", "cannon", null],
      ["fuel", "fuel", "power", "fuel", "fuel"],
      [null, "armor", "armor", "armor", null],
      [null, null, null, null, null],
      [null, "tracks", null, "tracks", null],
    ],
  },
  {
    id: "veteran",
    index: 1,
    name: "Veteran",
    blurb: "A heavy nose plate, four cannons, and a repair bay. Strafes, leads a little, and holds a middle range.",
    scrap: 80,
    hull: "standard",
    tuning: { wobble: 0.1, lead: 0.55, reaction: 0.2, near: 280, far: 460, dodge: 200, aimSlack: 0.28, strafe: 0.65 },
    grid: [
      ["armor", "cannon", "heavy-armor", "cannon", "armor"],
      ["tracks", "engine", "repair-bay", "engine", "tracks"],
      [null, "cannon", "armor", "cannon", null],
      ["fuel", "armor", "power", "armor", "fuel"],
      [null, "fuel", "power", "fuel", null],
      ["armor", "armor", "armor", "armor", "armor"],
      ["armor", "tracks", "armor", "tracks", "armor"],
    ],
  },
  {
    id: "warlord",
    index: 2,
    name: "Warlord",
    blurb: "Rear turret, heavy cheeks, a medium cannon, and a repair bay. Leads shots, dodges early, and keeps range.",
    scrap: 120,
    hull: "rear",
    tuning: { wobble: 0.04, lead: 1, reaction: 0.06, near: 340, far: 500, dodge: 280, aimSlack: 0.12, strafe: 1 },
    grid: [
      ["heavy-armor", "cannon", "armor", "cannon", "heavy-armor"],
      ["tracks", "engine", "armor", "engine", "tracks"],
      ["armor", "armor", "repair-bay", "armor", "armor"],
      ["fuel", "power", "fuel", "power", "fuel"],
      [null, "medium-cannon@4,1", "armor", "cannon", null],
      ["armor", "medium-cannon@4,1", "armor", "armor", "armor"],
      ["tracks", "armor", "power", "armor", "tracks"],
    ],
  },
];

const BY_ID = new Map(BOTS.map((bot) => [bot.id, bot]));

export function getBot(id: string): BotDef {
  return BY_ID.get(id) ?? BOTS[0];
}

/** Rookie is always open. Each later rival opens after the one before it is beaten. */
export function botOpen(botsBeaten: number, bot: BotDef): boolean {
  return bot.index <= botsBeaten;
}
