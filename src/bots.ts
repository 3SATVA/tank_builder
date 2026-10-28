import type { BotTuning } from "./control";

export interface BotDef {
  id: string;
  index: number;
  name: string;
  blurb: string;
  /** Scrap paid for a win. */
  scrap: number;
  /** Uses parts the player cannot buy, place, or upload. */
  boss?: boolean;
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
  {
    id: "swarm",
    index: 3,
    name: "Swarm",
    blurb: "Two robot bays and a nose cannon. Closes in and fills the field with drones.",
    scrap: 160,
    hull: "standard",
    tuning: { wobble: 0.08, lead: 0.85, reaction: 0.12, near: 180, far: 360, dodge: 180, aimSlack: 0.2, strafe: 0.85 },
    grid: [
      ["tracks", "cannon", "armor", "armor", "tracks"],
      ["tracks", "engine", null, "engine", "tracks"],
      ["armor", "armor", "armor", "armor", "armor"],
      ["fuel", "power", "power", "power", "fuel"],
      ["fuel", "power", "armor", "power", "fuel"],
      ["robot-bay@5,0", "robot-bay@5,0", "armor", "robot-bay@5,3", "robot-bay@5,3"],
      ["robot-bay@5,0", "robot-bay@5,0", "fuel", "robot-bay@5,3", "robot-bay@5,3"],
    ],
  },
  {
    id: "bulwark",
    index: 4,
    name: "Bulwark",
    blurb: "Heavy plate and two shield bubbles. Slow, and happy to sit in your fire.",
    scrap: 220,
    hull: "standard",
    tuning: { wobble: 0.05, lead: 0.95, reaction: 0.1, near: 200, far: 320, dodge: 240, aimSlack: 0.16, strafe: 0.35 },
    grid: [
      ["heavy-armor", "cannon", "heavy-armor", "cannon", "heavy-armor"],
      ["tracks", "engine", "armor", "engine", "tracks"],
      ["heavy-armor", "shield-gen@2,1", "shield-gen@2,1", "armor", "heavy-armor"],
      ["fuel", "shield-gen@2,1", "shield-gen@2,1", "repair-bay", "fuel"],
      ["fuel", "power", "power", "armor", "armor"],
      ["shield-gen@5,0", "shield-gen@5,0", "power", "armor", "tracks"],
      ["shield-gen@5,0", "shield-gen@5,0", "power", "fuel", "tracks"],
    ],
  },
  {
    id: "gaff",
    index: 5,
    name: "Gaff",
    blurb: "Boss grapples and black plate. Reels you in and keeps shooting.",
    scrap: 300,
    boss: true,
    hull: "standard",
    tuning: { wobble: 0.04, lead: 1, reaction: 0.07, near: 140, far: 280, dodge: 180, aimSlack: 0.14, strafe: 0.9 },
    grid: [
      ["armor", "boss-grapple@0,1", "boss-armor", "armor", "armor"],
      ["tracks", "boss-grapple@0,1", "engine", "engine", "tracks"],
      ["armor", "cannon", "armor", "armor", "armor"],
      ["fuel", "fuel", "reactor", "fuel", "fuel"],
      ["tracks", "engine", "armor", "armor", "tracks"],
      ["armor", "armor", "fuel", "armor", "armor"],
      ["tracks", "boss-armor", "armor", "armor", "tracks"],
    ],
  },
  {
    id: "redoubt",
    index: 6,
    name: "Redoubt",
    blurb: "Two mega cannons on a crawling fortress, fed by a reactor.",
    scrap: 400,
    boss: true,
    hull: "standard",
    tuning: { wobble: 0.03, lead: 1.1, reaction: 0.05, near: 340, far: 520, dodge: 300, aimSlack: 0.1, strafe: 0.7 },
    grid: [
      ["mega-cannon@0,0", "boss-armor", "boss-armor", "boss-armor", "boss-armor"],
      ["mega-cannon@0,0", "tracks", "engine", "engine", "tracks"],
      ["mega-cannon@0,0", "boss-armor", "mega-cannon@2,2", "armor", "boss-armor"],
      ["fuel", "fuel", "mega-cannon@2,2", "reactor", "fuel"],
      ["tracks", "boss-armor", "mega-cannon@2,2", "power", "tracks"],
      ["boss-armor", "power", "armor", "fuel", "boss-armor"],
      ["tracks", "boss-armor", "fuel", "boss-armor", "tracks"],
    ],
  },
  {
    id: "ash-tyrant",
    index: 7,
    name: "Ash Tyrant",
    blurb: "A citadel hull, two turrets, two mega cannons, and a double bubble.",
    scrap: 520,
    boss: true,
    hull: "citadel",
    tuning: { wobble: 0.02, lead: 1.15, reaction: 0.04, near: 280, far: 460, dodge: 320, aimSlack: 0.08, strafe: 1 },
    grid: [
      ["armor", "tracks", "armor", "armor", "armor", "tracks", "armor"],
      ["tracks", "engine", "armor", "mega-cannon@1,3", "fuel", "engine", "tracks"],
      ["boss-armor", "fuel", "armor", "mega-cannon@1,3", "armor", "fuel", "boss-armor"],
      ["tracks", "fuel", "armor", "mega-cannon@1,3", "armor", "fuel", "tracks"],
      ["super-shield@4,0", "super-shield@4,0", "armor", "reactor", "armor", "fuel", "armor"],
      ["super-shield@4,0", "super-shield@4,0", "armor", "mega-cannon@5,3", "armor", "fuel", "tracks"],
      ["tracks", "engine", "fuel", "mega-cannon@5,3", "fuel", "engine", "tracks"],
      ["boss-armor", "fuel", "armor", "mega-cannon@5,3", "armor", "fuel", "boss-armor"],
      ["tracks", "armor", "tracks", "reactor", "tracks", "armor", "tracks"],
    ],
  },
];

/** A sharp pilot used by balance sims. Not a campaign rival. */
export const ACE_TUNING: BotTuning = {
  wobble: 0.03,
  lead: 1,
  reaction: 0.05,
  near: 240,
  far: 420,
  dodge: 260,
  aimSlack: 0.12,
  strafe: 0.85,
};

const BY_ID = new Map(BOTS.map((bot) => [bot.id, bot]));

export function getBot(id: string): BotDef {
  return BY_ID.get(id) ?? BOTS[0];
}

/** Rookie is always open. Each later rival opens after the one before it is beaten. */
export function botOpen(botsBeaten: number, bot: BotDef): boolean {
  return bot.index <= botsBeaten;
}
