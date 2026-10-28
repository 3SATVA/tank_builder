import { PAL } from "./palette";

/** Source pixels for one module block. Battle and the garage both start from these. */
export const CELL_ART = 10;
export const TILE_ART = 16;

const INK: Record<string, string> = {
  K: PAL.shadow,
  W: PAL.paper,
  C: PAL.cream,
  G: PAL.gold,
  A: PAL.amber,
  O: PAL.orange,
  R: PAL.red,
  r: PAL.redDark,
  B: PAL.blue,
  D: PAL.blueDark,
  N: PAL.navy,
  T: PAL.teal,
  t: PAL.tealDark,
  Y: PAL.cyan,
  E: PAL.green,
  e: PAL.greenDark,
  S: PAL.steel,
  M: PAL.mist,
  P: PAL.panel,
  V: PAL.void,
  H: PAL.hay,
  h: PAL.hayDark,
  U: PAL.house,
  u: PAL.houseLite,
  X: PAL.crate,
  Q: PAL.scrap,
  Z: PAL.stone,
  z: PAL.stoneDark,
  I: PAL.gray,
  i: PAL.grayDark,
  L: PAL.lava,
  F: PAL.white,
  d: PAL.brownDark,
  b: PAL.brown,
};

const baked = new Map<string, HTMLCanvasElement>();

export function bake(rows: readonly string[], key: string): HTMLCanvasElement {
  const hit = baked.get(key);
  if (hit) return hit;
  const height = rows.length;
  const width = rows[0]?.length ?? 0;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  ctx.imageSmoothingEnabled = false;
  for (let y = 0; y < height; y += 1) {
    const row = rows[y] ?? "";
    for (let x = 0; x < width; x += 1) {
      const color = INK[row[x] ?? "."];
      if (!color) continue;
      ctx.fillStyle = color;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  baked.set(key, canvas);
  return canvas;
}

/** Hard nearest-neighbor scale. Done once per size and cached. */
export function nearestScale(src: HTMLCanvasElement, dw: number, dh: number, key: string): HTMLCanvasElement {
  const hit = baked.get(key);
  if (hit && hit.width === dw && hit.height === dh) return hit;
  const dst = document.createElement("canvas");
  dst.width = dw;
  dst.height = dh;
  const from = src.getContext("2d");
  const to = dst.getContext("2d");
  if (!from || !to || src.width === 0 || src.height === 0) return dst;
  const image = from.getImageData(0, 0, src.width, src.height);
  const out = to.createImageData(dw, dh);
  for (let y = 0; y < dh; y += 1) {
    const sy = Math.min(src.height - 1, Math.floor((y * src.height) / dh));
    for (let x = 0; x < dw; x += 1) {
      const sx = Math.min(src.width - 1, Math.floor((x * src.width) / dw));
      const si = (sy * src.width + sx) * 4;
      const di = (y * dw + x) * 4;
      out.data[di] = image.data[si] ?? 0;
      out.data[di + 1] = image.data[si + 1] ?? 0;
      out.data[di + 2] = image.data[si + 2] ?? 0;
      out.data[di + 3] = image.data[si + 3] ?? 0;
    }
  }
  to.putImageData(out, 0, 0);
  baked.set(key, dst);
  return dst;
}

const EMPTY = ["VVVVVVVVVV", "VKKKKKKKKV", "VK......KV", "VK......KV", "VK......KV", "VK......KV", "VK......KV", "VK......KV", "VKKKKKKKKV", "VVVVVVVVVV"];

const ARMOR = ["BBBBBBBBBB", "BWWWWWWWWB", "BWBBBBBBWB", "BWBBBBBBWB", "BWBBBBBBWB", "BWBBBBBBWB", "BWBBBBBBWB", "BWBBBBBBWB", "BDDDDDDDDB", "DDDDDDDDDD"];

const HEAVY = ["NNNNNNNNNN", "NDDDDDDDDN", "NDWW..WWDN", "NDD....DDN", "ND..WW..DN", "NDD....DDN", "ND..WW..DN", "NDD....DDN", "NDDDDDDDDN", "NNNNNNNNNN"];

const TRACKS = ["KKKKKKKKKK", "KSKSKSKSKK", "K........K", "KSKSKSKSKK", "K........K", "KSKSKSKSKK", "K........K", "KSKSKSKSKK", "K........K", "KKKKKKKKKK"];

const ENGINE = [".RR.RR.RR.", ".rr.rr.rr.", ".RR.RR.RR.", ".rr.rr.rr.", ".RR.RR.RR.", "KKKKKKKKKK", "KOOOOOOOOK", "KOOOOOOOOK", "KOO.KK.OOK", "....KK...."];

const ENGINE_PUFF = [".RR.RR.RR.", ".rr.rr.rr.", ".RR.RR.RR.", ".rr.rr.rr.", ".RR.RR.RR.", "KKKKKKKKKK", "KOOOOOOOOK", "KOOOOOOOOK", "KOO.KK.OOK", "...MKKM..."];

const FUEL = ["...SSSS...", "...SWWS...", "..OOOOOO..", "..OOKKOO..", "..OOOOOO..", "..OOKKOO..", "..OOOOOO..", "..OOOOOO..", "...OOOO...", "....OO...."];

const POWER = ["KKKKKKKKKK", "KGGGGGGGGK", "KG....GG.K", "KG...GGG.K", "KG..GGGG.K", "KG..GGG..K", "KG.GGG...K", "KG.GG....K", "KGGGGGGGGK", "KKKKKKKKKK"];

const REPAIR = ["EEEEEEEEEE", "EWWWWWWWWE", "EW..WW..WE", "EW..WW..WE", "EWWWWWWWWE", "EWWWWWWWWE", "EW..WW..WE", "EW..WW..WE", "EWWWWWWWWE", "EEEEEEEEEE"];

const CANNON = [
  "....YY....",
  "....YY....",
  "....tt....",
  "....YY....",
  "....YY....",
  "....tt....",
  "....KK....",
  "...YYYY...",
  "...YKKY...",
  "..KKKKKK..",
  "TTTTTTTTTT",
  "TWWWWWWWWT",
  "TWTTTTTTWT",
  "TW..KK..WT",
  "TW......WT",
  "TW......WT",
  "TW......WT",
  "TW......WT",
  "TttttttttT",
  "tttttttttt",
];

const CANNON_FLASH = [
  "...AAAA...",
  "..AFFFFA..",
  "....YY....",
  "....YY....",
  "....tt....",
  "....YY....",
  "....KK....",
  "...YYYY...",
  "...YKKY...",
  "..KKKKKK..",
  "TTTTTTTTTT",
  "TWWWWWWWWT",
  "TWTTTTTTWT",
  "TW..KK..WT",
  "TW......WT",
  "TW......WT",
  "TW......WT",
  "TW......WT",
  "TttttttttT",
  "tttttttttt",
];

const MEDIUM = [
  "...YYYY...",
  "...YKKY...",
  "...YYYY...",
  "...YKKY...",
  "...YYYY...",
  "...YKKY...",
  "...YYYY...",
  "...YKKY...",
  "...YYYY...",
  "...YYYY...",
  "..YYYYYY..",
  "..YKKKKY..",
  ".KKYYYYKK.",
  "TTTTTTTTTT",
  "TWWWWWWWWT",
  "TWTTTTTTWT",
  "TW.KKKK.WT",
  "TW......WT",
  "TW......WT",
  "TW......WT",
  "TW......WT",
  "TttttttttT",
  "tttttttttt",
];

const MEDIUM_FLASH = [
  "..AAAAAA..",
  ".AFFFFFFA.",
  "...YYYY...",
  "...YKKY...",
  "...YYYY...",
  "...YKKY...",
  "...YYYY...",
  "...YKKY...",
  "...YYYY...",
  "...YYYY...",
  "..YYYYYY..",
  "..YKKKKY..",
  ".KKYYYYKK.",
  "TTTTTTTTTT",
  "TWWWWWWWWT",
  "TWTTTTTTWT",
  "TW.KKKK.WT",
  "TW......WT",
  "TW......WT",
  "TW......WT",
  "TW......WT",
  "TttttttttT",
  "tttttttttt",
];

const BREECH = ["TTTTTTTTTT", "TWWWWWWWWT", "TWTTTTTTWT", "TWKKKKKKWT", "TWK....KWT", "TWK....KWT", "TWTTTTTTWT", "TWWWWWWWWT", "TttttttttT", "tttttttttt"];

const SHOT = ["KKKKKKKK", "KWWYYYYK", "KWYYYYYK", "KKKKKKKK"];

const BOOM = ["..AA..AA..", ".AWWAAWWA.", "AWFFWWFFWA", "AWWAAAWWWA", ".AWWWWWA..", "..AAAAAA..", ".AR.AA.RA.", "AR..AA..RA", ".R......R.", "....RR...."];

export interface SpriteOpts {
  flash?: boolean;
  puff?: boolean;
  /** Rear half of a medium cannon: breech only, no barrel. */
  rear?: boolean;
}

export function moduleArt(id: string, opts: SpriteOpts = {}): HTMLCanvasElement {
  if (id === "heavy-armor") return bake(HEAVY, "heavy");
  if (id === "repair-bay") return bake(REPAIR, "repair");
  if (id === "medium-cannon") {
    if (opts.rear) return bake(BREECH, "breech");
    return bake(opts.flash ? MEDIUM_FLASH : MEDIUM, opts.flash ? "med-flash" : "med");
  }
  if (id === "cannon") return bake(opts.flash ? CANNON_FLASH : CANNON, opts.flash ? "can-flash" : "can");
  if (id === "engine") return bake(opts.puff ? ENGINE_PUFF : ENGINE, opts.puff ? "eng-puff" : "eng");
  if (id === "fuel") return bake(FUEL, "fuel");
  if (id === "power") return bake(POWER, "power");
  if (id === "tracks") return bake(TRACKS, "tracks");
  if (id === "armor") return bake(ARMOR, "armor");
  return bake(EMPTY, "empty");
}

const OBSTACLES: Record<string, readonly string[]> = {
  "#": [
    "ZZZZZZZZZZZZZZZZ",
    "ZWWWWWWWWWWWWWWZ",
    "ZWZZZZZZZZZZZZWZ",
    "ZWZ..ZZ..ZZ..ZWZ",
    "ZWZZZZZZZZZZZZWZ",
    "ZWZ..ZZ..ZZ..ZWZ",
    "ZWZZZZZZZZZZZZWZ",
    "ZWZ..ZZ..ZZ..ZWZ",
    "ZWZZZZZZZZZZZZWZ",
    "ZWZ..ZZ..ZZ..ZWZ",
    "ZWZZZZZZZZZZZZWZ",
    "ZWZ..ZZ..ZZ..ZWZ",
    "ZWZZZZZZZZZZZZWZ",
    "ZWZZZZZZZZZZZZWZ",
    "ZDDDDDDDDDDDDDDZ",
    "DDDDDDDDDDDDDDDD",
  ],
  P: [
    "....iiiiiiii....",
    "...iKKKKKKKKi...",
    "...iKiiiiiiKi...",
    "...iKi....iKi...",
    "...iKi....iKi...",
    "...iKi....iKi...",
    "...iKi....iKi...",
    "...iKi....iKi...",
    "...iKi....iKi...",
    "...iKi....iKi...",
    "...iKi....iKi...",
    "...iKiiiiiiKi...",
    "...iKKKKKKKKi...",
    "....iiiiiiii....",
    "..IIIIIIIIIIII..",
    ".IIIIIIIIIIIIII.",
  ],
  H: [
    "HHHHHHHHHHHHHHHH",
    "HhhhhhhhhhhhhhhH",
    "HhHHHHHHHHHHHHhH",
    "HhHhhhhhhhhhhHhH",
    "HhHHHHHHHHHHHHhH",
    "HhHhhhhhhhhhhHhH",
    "HhHHHHHHHHHHHHhH",
    "HhHhhhhhhhhhhHhH",
    "HhHHHHHHHHHHHHhH",
    "HhHhhhhhhhhhhHhH",
    "HhHHHHHHHHHHHHhH",
    "HhHhhhhhhhhhhHhH",
    "HhHHHHHHHHHHHHhH",
    "HhhhhhhhhhhhhhhH",
    "DDDDDDDDDDDDDDDD",
    "KKKKKKKKKKKKKKKK",
  ],
  R: [
    "...IIIIIIIIII...",
    "..IIWWWWWWWWII..",
    ".IIWIIIIIIIIWII.",
    ".IWII......IIWI.",
    "IIIII......IIIII",
    "IIII........IIII",
    "IIII........IIII",
    "IIIII......IIIII",
    ".IWIII....IIIIWI",
    ".IIWIIIIIIIIIWII",
    "..IIWWWWWWWWII..",
    "...IIIIIIIIII...",
    "....KKKKKKKK....",
    "................",
    "................",
    "................",
  ],
  W: [
    "ZZZZZZZZZZZZZZZZ",
    "ZWWWWWWWWWWWWWWZ",
    "ZWZZZWWZZZWWZZWZ",
    "ZWZZZWWZZZWWZZWZ",
    "ZWZZZWWZZZWWZZWZ",
    "ZDDDDDDDDDDDDDDZ",
    "DDDDDDDDDDDDDDDD",
    "bbbbbbbbbbbbbbbb",
    "bddddddddddddddb",
    "bbbbbbbbbbbbbbbb",
    "KKKKKKKKKKKKKKKK",
    "................",
    "................",
    "................",
    "................",
    "................",
  ],
  K: [
    "Z.Z.Z.Z.Z.Z.Z.Z.",
    "ZZZZZZZZZZZZZZZZ",
    "ZWWWWWWWWWWWWWWZ",
    "ZWZZZZZZZZZZZZWZ",
    "ZWZKKKKKKKKKKZWZ",
    "ZWZK......KKKZWZ",
    "ZWZK.iiii.KKKZWZ",
    "ZWZK.i..i.KKKZWZ",
    "ZWZK.i..i.KKKZWZ",
    "ZWZK.iiii.KKKZWZ",
    "ZWZKKKKKKKKKKZWZ",
    "ZWZZZZZZZZZZZZWZ",
    "ZDDDDDDDDDDDDDDZ",
    "DDDDDDDDDDDDDDDD",
    "zzzzzzzzzzzzzzzz",
    "KKKKKKKKKKKKKKKK",
  ],
  T: [
    "......WWWW......",
    "......WKKW......",
    "......WKKW......",
    "....WWKKKKWW....",
    "....WKKKKKKW....",
    "......WKKW......",
    "......WKKW......",
    "......WKKW......",
    "...WWWWWWWWWW...",
    "..WCzzzzzzzzCW..",
    "..WCzzzzzzzzCW..",
    "..WCzzzzzzzzCW..",
    "..WCzzzzzzzzCW..",
    "..KKKKKKKKKKKK..",
    "...KKKKKKKKKK...",
    "................",
  ],
  C: [
    "dddddddddddddddd",
    "dWWWWWWWWWWWWWWd",
    "dWddddddddddddWd",
    "dWd..........dWd",
    "dWd..KKKKKK..dWd",
    "dWd..K....K..dWd",
    "dWd..K.KK.K..dWd",
    "dWd..K.KK.K..dWd",
    "dWd..K....K..dWd",
    "dWd..KKKKKK..dWd",
    "dWd..........dWd",
    "dWddddddddddddWd",
    "dWWWWWWWWWWWWWWd",
    "dddddddddddddddd",
    "zzzzzzzzzzzzzzzz",
    "KKKKKKKKKKKKKKKK",
  ],
  Y: [
    "......dd......dd",
    ".....d..d....d..",
    "......dd......dd",
    "......dd........",
    ".....dddd.......",
    "......dd........",
    "......dd........",
    "......dd........",
    "......dd........",
    "......dd........",
    "......dd........",
    ".....dddd.......",
    "....dddddd......",
    "......dd........",
    ".....dddd.......",
    "....KKKKKK......",
  ],
  F: [
    "W.W.W.W.W.W.W.W.",
    "W.W.W.W.W.W.W.W.",
    "WWWWWWWWWWWWWWWW",
    "W.W.W.W.W.W.W.W.",
    "W.W.W.W.W.W.W.W.",
    "W.W.W.W.W.W.W.W.",
    "WWWWWWWWWWWWWWWW",
    "W.W.W.W.W.W.W.W.",
    "W.W.W.W.W.W.W.W.",
    "W.W.W.W.W.W.W.W.",
    "W.W.W.W.W.W.W.W.",
    "KKKKKKKKKKKKKKKK",
    "................",
    "................",
    "................",
    "................",
  ],
  U: [
    "......UUUU......",
    "....UUrUUUrU....",
    "..UUrUUUUUUrUU..",
    "UUrUUUUUUUUUrUUU",
    "UUUUUUUUUUUUUUUU",
    "UUuuuuuuuuuuuuUU",
    "UUuWW..uu..WWuUU",
    "UUuWW..uu..WWuUU",
    "UUuWW..uu..WWuUU",
    "UUuuuuuKKKuuuuUU",
    "UUuuuuuKKKuuuuUU",
    "UUuuuuuKKKuuuuUU",
    "UUUUUUUKKKUUUUUU",
    "UUUUUUUKKKUUUUUU",
    "KKKKKKKKKKKKKKKK",
    "................",
  ],
  N: [
    "......uuuu......",
    "....uubuuubu....",
    "..uubuuuuuubuu..",
    "uubuuuuuuuuubuuu",
    "uuuuuuuuuuuuuuuu",
    "uuWWWWWWWWWWWWuu",
    "uuW..GG..GG..Wuu",
    "uuW..GG..GG..Wuu",
    "uuW..GG..GG..Wuu",
    "uuWWWWW.KK.WWWuu",
    "uuWWWWW.KK.WWWuu",
    "uuWWWWW.KK.WWWuu",
    "uuuuuuu.KK.uuuuu",
    "uuuuuuu.KK.uuuuu",
    "KKKKKKKKKKKKKKKK",
    "................",
  ],
  X: [
    "..XXXXXXXXXXXX..",
    ".XWWWWWWWWWWWWX.",
    "XWXXXXXXXXXXXXWX",
    "WXXXXXXddXXXXXXW",
    "WXXddddddddddXXW",
    "WXXdXXXXXXXXXdXW",
    "WXXdXXXddXXXXdXW",
    "WXddddddddddddXW",
    "WXXdXXXddXXXXdXW",
    "WXXdXXXXXXXXXdXW",
    "WXXddddddddddXXW",
    "WXXXXXXddXXXXXXW",
    "XWXXXXXXXXXXXXWX",
    ".XDDDDDDDDDDDDX.",
    "..XXXXXXXXXXXX..",
    "....KKKKKKKK....",
  ],
  S: [
    "...QQQ....III...",
    "..QQQQQ..IIIII..",
    ".QWWQQQ.IIWWII..",
    ".QQQQQQQIIIIII..",
    "..QQQ..IIIIIII..",
    ".bbbbQQQ..III...",
    "bbWWbbbb........",
    "bbbbbbbb..QQQ...",
    ".bbbbbb..QQQQQ..",
    "....II..QQQQQQQ.",
    "...IIII.QWWQQQQ.",
    "..IIIIIIQQQQQQ..",
    "..IIIII..QQQQ...",
    "...III..........",
    "....KKKK........",
    "................",
  ],
  V: [
    "................",
    ".....RRRRRR.....",
    "...RRWWWWWWWRR..",
    "..RRWWWWWWWWWWR.",
    ".RRRRRRRRRRRRRR.",
    ".RWWWRRRRRRWWWR.",
    ".RRRRRRRRRRRRRR.",
    ".KKKR......RKKK.",
    "..KK......KK....",
    "...KK....KK.....",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
  ],
  D: [
    "................",
    ".....BBBBBB.....",
    "...BBWWWWWWWBB..",
    "..BBWWWWWWWWWWB.",
    ".BBBBBBBBBBBBBB.",
    ".BWWWBBBBBBWWWB.",
    ".BBBBBBBBBBBBBB.",
    ".KKKB......BKKK.",
    "..KK......KK....",
    "...KK....KK.....",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
  ],
  I: [
    "..KKKKKKKKKKKK..",
    ".KIIIIIIIIIIIIK.",
    "KII..........IIK",
    "KI..KKKKKKKK..IK",
    "KI.KIIIIIIIIK.IK",
    "KI.KI......IK.IK",
    "KI.KI......IK.IK",
    "KI.KIIIIIIIIK.IK",
    "KI..KKKKKKKK..IK",
    "KII..........IIK",
    ".KIIIIIIIIIIIIK.",
    "..KKKKKKKKKKKK..",
    "...KKKKKKKKKK...",
    "....KKKKKKKK....",
    "................",
    "................",
  ],
};

function lavaRows(frame: number): string[] {
  const rows = [
    "LLLLLLLLLLLLLLLL",
    "LOOOOOOOOOOOOOOL",
    "LOOLLLLLLLLLLOOL",
    "LOOL........LOOL",
    "LOL..........LOL",
    "LOL..........LOL",
    "LOL..........LOL",
    "LOL..........LOL",
    "LOL..........LOL",
    "LOL..........LOL",
    "LOL..........LOL",
    "LOOL........LOOL",
    "LOOLLLLLLLLLLOOL",
    "LOOOOOOOOOOOOOOL",
    "LLLLLLLLLLLLLLLL",
    "KKKKKKKKKKKKKKKK",
  ];
  const bubbles = [
    [3, 4],
    [10, 6],
    [6, 9],
    [12, 8],
  ];
  const copy = rows.map((row) => row.split(""));
  for (let i = 0; i < bubbles.length; i += 1) {
    const spot = bubbles[i] ?? [4, 4];
    const x = (spot[0] + frame * (i + 1)) % 12;
    const y = 3 + ((spot[1] + frame + i) % 9);
    const row = copy[y];
    if (!row) continue;
    const gx = 2 + (x % 12);
    if (row[gx] && row[gx] !== "K") row[gx] = "G";
    if (row[gx + 1]) row[gx + 1] = "A";
  }
  return copy.map((row) => row.join(""));
}

export function obstacleArt(kind: string, frame = 0): HTMLCanvasElement {
  if (kind === "L") return bake(lavaRows(frame % 4), `lava-${frame % 4}`);
  return bake(OBSTACLES[kind] ?? OBSTACLES["#"] ?? [], `obs-${kind}`);
}

export function shotArt(): HTMLCanvasElement {
  return bake(SHOT, "shot");
}

export function boomArt(): HTMLCanvasElement {
  return bake(BOOM, "boom");
}

/** Bottom block of a sprite, without a barrel that sticks out of the cell. */
export function bodyArt(id: string): HTMLCanvasElement {
  const full = moduleArt(id, { rear: id === "medium-cannon" });
  if (full.height <= CELL_ART) return full;
  const key = `body-${id}`;
  const hit = baked.get(key);
  if (hit) return hit;
  const canvas = document.createElement("canvas");
  canvas.width = CELL_ART;
  canvas.height = CELL_ART;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(full, 0, full.height - CELL_ART, CELL_ART, CELL_ART, 0, 0, CELL_ART, CELL_ART);
  }
  baked.set(key, canvas);
  return canvas;
}

/** A DOM canvas of the module sprite, scaled by an integer for the garage. */
export function mountSprite(id: string, scale: number, opts: SpriteOpts = {}, bodyOnly = false): HTMLCanvasElement {
  const src = bodyOnly ? bodyArt(id) : moduleArt(id, opts);
  const canvas = document.createElement("canvas");
  canvas.width = src.width;
  canvas.height = src.height;
  canvas.className = "pixel-sprite";
  canvas.style.width = `${src.width * scale}px`;
  canvas.style.height = `${src.height * scale}px`;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(src, 0, 0);
  }
  return canvas;
}
