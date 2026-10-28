import { BOTS, botOpen } from "./bots";
import { el } from "./dom";
import { commitPlacement } from "./grid";
import { applyArtStyle, readArtStyle, writeArtStyle, type ArtStyle } from "./config";
import { iconSvg } from "./icons";
import { mountSprite } from "./sprites";
import {
  createDefaultGrid,
  getHull,
  getModule,
  hullsFor,
  hasTurret,
  isAnchorCell,
  isTurretCell,
  moduleIdOf,
  modulesFor,
  partRole,
  SHOP_ITEMS,
  type PartRole,
} from "./modules";
import {
  cleanCallsign,
  findOpponent,
  loadLeaderboard,
  publishDefense,
  readIdentity,
  readRating,
  registerCallsign,
  type PvpLaunch,
} from "./pvp";
import { activeLayout, purchase } from "./save";
import { sfxTap } from "./sfx";
import { computeStats } from "./stats";
import type { ModuleDef, SaveData, ShopItem, TankStats } from "./types";

export type ScreenId = "menu" | "garage" | "battle" | "shop" | "bots" | "pvp" | "board";

function scrapLabel(amount: number): string {
  return `${amount.toLocaleString()} scrap`;
}

function scrapPill(amount: number): HTMLElement {
  const pill = el("div", "scrap-pill");
  pill.append(el("span", "scrap-nut", "⬡"), el("span", undefined, scrapLabel(amount)));
  return pill;
}

export function renderMenu(save: SaveData, go: (screen: ScreenId) => void): HTMLElement {
  const root = el("div", "screen menu-screen");
  const bar = el("header", "topbar");
  bar.append(el("span", "brand", "Tank Builder"), scrapPill(save.currency));

  const hero = el("div", "menu-hero");
  hero.append(logoTank(), heroCopy());

  const actions = el("div", "menu-actions");
  actions.append(
    menuButton("Garage", "Build and refit the hull", () => go("garage")),
    menuButton("Battle", "Pick a rival and duel", () => go("bots"), true),
    menuButton("PvP", "Fight another pilot's tank", () => go("pvp")),
    menuButton("Shop", "Spend scrap on new blocks", () => go("shop")),
  );

  root.append(bar, hero, actions);
  return root;
}

function heroCopy(): HTMLElement {
  const copy = el("div", "hero-copy");
  copy.append(
    el("p", "eyebrow", "Top-down workshop"),
    el("h1", undefined, "Stack a tank. Drive it."),
    el(
      "p",
      "lede",
      "Fill the hull and the gold 3×3 turret with armor, tracks, fuel, power, engines, and cannons. The duel uses whatever you bolt on.",
    ),
  );
  return copy;
}

function menuButton(title: string, detail: string, onClick: () => void, primary = false): HTMLButtonElement {
  const button = el("button", primary ? "btn btn-primary menu-btn" : "btn menu-btn");
  button.type = "button";
  const label = el("span", "menu-btn-title", title);
  const sub = el("span", "menu-btn-detail", detail);
  button.append(label, sub);
  button.addEventListener("click", () => {
    sfxTap();
    onClick();
  });
  return button;
}

function logoTank(): HTMLElement {
  const logo = el("div", "logo-tank");
  logo.setAttribute("aria-hidden", "true");
  logo.append(el("div", "logo-barrel"), el("div", "logo-turret"), el("div", "logo-hull"));
  return logo;
}

export function renderGarage(
  save: SaveData,
  go: (screen: ScreenId) => void,
  persist: () => void,
  note = "",
): HTMLElement {
  const root = el("div", "screen garage-screen");
  const ownedAtStart = modulesFor(save.unlocked);
  let selected = ownedAtStart.some((mod) => mod.id === "cannon")
    ? "cannon"
    : ownedAtStart[0]?.id ?? "armor";

  const paint = (): void => {
    const owned = modulesFor(save.unlocked);
    if (!owned.some((mod) => mod.id === selected)) selected = owned[0]?.id ?? "armor";
    const grid = activeLayout(save);
    const stats = computeStats(grid, { repairActive: true });
    const cols = grid[0]?.length ?? 1;

    const bar = el("header", "topbar");
    const back = el("button", "btn btn-ghost", "Menu");
    back.type = "button";
    back.addEventListener("click", () => go("menu"));
    const drive = el("button", "btn btn-primary", "Battle");
    drive.type = "button";
    drive.addEventListener("click", () => {
      sfxTap();
      go("battle");
    });
    const barActions = el("div", "topbar-actions");
    barActions.append(back, drive);
    bar.append(el("span", "brand", "Garage"), scrapPill(save.currency), barActions);

    const layout = el("div", "garage-layout");
    layout.append(
      buildStage(save, cols, selected, persist, paint, note),
      buildSide(save, stats, owned, selected, (id) => {
        selected = id;
        paint();
      }),
    );

    root.replaceChildren(bar, layout);
  };

  paint();
  return root;
}

function buildStage(
  save: SaveData,
  cols: number,
  selected: string,
  persist: () => void,
  paint: () => void,
  note = "",
): HTMLElement {
  const stage = el("section", "builder");
  stage.append(el("h2", undefined, "Hull"), hullPicker(save, persist, paint), artStyleToggle(paint), hint(save.hull));
  if (note) {
    const warning = el("p", "battle-note", note);
    warning.setAttribute("role", "status");
    stage.append(warning);
  }

  const wrap = el("div", "tank-stage");
  wrap.append(el("div", "front-flag", "Front"));
  const frame = el("div", "hull-frame");
  const grid = el("div", "tank-grid");
  grid.style.setProperty("--cols", String(cols));
  grid.setAttribute("role", "grid");
  grid.setAttribute("aria-label", "Tank hull");

  const layout = activeLayout(save);
  const rows = layout.length;
  layout.forEach((row, r) => {
    row.forEach((token, c) => {
      const mod = getModule(moduleIdOf(token) ?? "");
      const turret = isTurretCell(r, c, cols, rows, save.hull);
      const cell = el("button", mod ? "cell filled" : "cell empty");
      if (turret) cell.classList.add("turret");
      const anchor = isAnchorCell(token, r, c);
      const role = partRole(token, r, c);
      if (mod?.id === "medium-cannon") cell.classList.add(anchor ? "medium-front" : "medium-rear");
      else if (mod?.id === "heavy-cannon") cell.classList.add("heavy-gun", `seg-${role}`);
      else if (mod?.id === "robot-bay") cell.classList.add("robot", `seg-${role}`);
      else if (mod?.id === "shield-gen") cell.classList.add("shield", `seg-${role}`);
      else if (mod?.kind === "weapon") cell.classList.add("cannon");
      if (mod?.kind === "engine") cell.classList.add("engine");
      if (mod?.id === "heavy-armor") cell.classList.add("heavy");
      if (mod?.id === "repair-bay") cell.classList.add("repair");
      cell.type = "button";
      cell.style.setProperty("--cell", mod?.color ?? "transparent");
      if (mod && mod.id === selected) cell.classList.add("matches");
      cell.dataset.row = String(r);
      cell.dataset.col = String(c);
      if (turret) cell.dataset.turret = "true";
      if (mod) cell.dataset.module = mod.id;
      cell.setAttribute("role", "gridcell");
      const place = `${turret ? "Turret" : "Hull"} row ${r + 1} column ${c + 1}`;
      cell.setAttribute(
        "aria-label",
        mod
          ? mod.id === selected
            ? `${mod.name}, ${place}. Tap to remove.`
            : `${mod.name}, ${place}. Tap to replace.`
          : `Empty bay, ${place}. Tap to place.`,
      );
      if (mod) cell.append(moduleFace(mod, role));
      cell.addEventListener("click", () => {
        const board = activeLayout(save);
        if (!commitPlacement(board, save.hull, selected, r, c)) return;
        sfxTap();
        persist();
        paint();
      });
      grid.append(cell);
    });
  });

  frame.append(grid);
  wrap.append(frame);

  const tools = el("div", "builder-tools");
  const reset = el("button", "btn btn-ghost", "Reset loadout");
  reset.type = "button";
  reset.addEventListener("click", () => {
    save.layouts[save.hull] = createDefaultGrid(save.hull);
    sfxTap();
    persist();
    paint();
  });
  const defend = el("button", "btn", "Set as PvP defense");
  defend.type = "button";
  const posted = el("p", "pvp-status", "");
  posted.setAttribute("role", "status");
  defend.addEventListener("click", () => {
    sfxTap();
    defend.disabled = true;
    posted.textContent = "Posting defense…";
    void publishDefense(save.hull, activeLayout(save))
      .then((message) => {
        posted.textContent = message;
      })
      .catch((err: unknown) => {
        posted.textContent = err instanceof Error ? err.message : "Couldn't post the defense.";
      })
      .finally(() => {
        defend.disabled = false;
      });
  });
  tools.append(reset, defend, posted);
  stage.append(wrap, tools);
  return stage;
}

function hint(hull: string): HTMLElement {
  const turret = hasTurret(hull)
    ? "The gold 3×3 rotates toward your aim. Guns on the hull fire the way the hull faces."
    : "This hull has no turret, so every gun fires the way the hull faces. Hold the aim stick to shoot.";
  return el(
    "p",
    "hint",
    `Pick a block, tap a bay to place it. Tap the same block to pull it off, or a different one to replace it. A long gun takes this bay and the cells behind it. A 2×2 part takes a square. Every cell of a part has to sit on the hull or inside the turret. ${turret} A shot hurts the block it hits. The tank falls when every weapon is gone, or every power block is gone.`,
  );
}

function hullPicker(save: SaveData, persist: () => void, paint: () => void): HTMLElement {
  const picker = el("div", "hull-picker");
  picker.setAttribute("role", "group");
  picker.setAttribute("aria-label", "Hull");
  for (const hull of hullsFor(save.unlocked)) {
    const button = el("button", hull.id === save.hull ? "btn hull-btn selected" : "btn hull-btn", hull.name);
    button.type = "button";
    button.dataset.hull = hull.id;
    button.setAttribute("aria-pressed", hull.id === save.hull ? "true" : "false");
    button.title = hull.blurb;
    button.addEventListener("click", () => {
      if (save.hull === hull.id) return;
      save.hull = hull.id;
      if (!save.layouts[hull.id]) save.layouts[hull.id] = createDefaultGrid(hull.id);
      sfxTap();
      persist();
      paint();
    });
    picker.append(button);
  }
  return picker;
}

function moduleFace(mod: ModuleDef, role: PartRole = "single"): HTMLElement {
  if (readArtStyle() === "pixel") {
    const quad = role === "ne" ? 1 : role === "sw" ? 2 : role === "se" ? 3 : 0;
    return mountSprite(mod.id, 5, { rear: role === "rear", mid: role === "mid", quad });
  }
  if (mod.id === "heavy-cannon") return heavyFace(role);
  if (mod.id === "harpoon") return harpoonFace(role);
  if (mod.cutter) return sawFace();
  if (mod.id === "robot-bay") return bayFace(role);
  if (mod.id === "shield-gen") return shieldFace(role);
  if (mod.id === "medium-cannon") {
    const face = el("span", role === "rear" ? "cannon-face medium rear" : "cannon-face medium");
    if (role === "rear") face.append(el("span", "breech"));
    else face.append(el("span", "barrel"), el("span", "breech"));
    return face;
  }
  if (mod.kind === "weapon") {
    const face = el("span", "cannon-face");
    face.append(el("span", "barrel"), el("span", "breech"));
    return face;
  }
  if (mod.kind === "engine") {
    const face = el("span", "engine-face");
    const pots = el("span", "pots");
    pots.append(el("span", "pot"), el("span", "pot"), el("span", "pot"));
    face.append(pots, el("span", "pipe left"), el("span", "pipe right"), el("span", "puff"));
    return face;
  }
  const swatch = el("span", "cell-swatch");
  swatch.innerHTML = iconSvg(mod.kind, mod.id);
  return swatch;
}

function heavyFace(role: PartRole): HTMLElement {
  if (role === "rear") {
    const face = el("span", "cannon-face heavy rear");
    const boltA = el("span", "bolt");
    const boltB = el("span", "bolt");
    face.append(el("span", "breech"), boltA, boltB);
    return face;
  }
  if (role === "mid") {
    const face = el("span", "cannon-face heavy mid");
    face.append(el("span", "sleeve"), el("span", "trunnion"));
    return face;
  }
  const face = el("span", "cannon-face heavy");
  face.append(el("span", "barrel"), el("span", "breech"));
  return face;
}

function harpoonFace(role: PartRole): HTMLElement {
  if (role === "rear") {
    const face = el("span", "cannon-face harpoon rear");
    face.append(el("span", "reel"));
    return face;
  }
  const face = el("span", "cannon-face harpoon");
  face.append(el("span", "spear"), el("span", "barb"), el("span", "breech"));
  return face;
}

function sawFace(): HTMLElement {
  const face = el("span", "saw-face");
  face.append(el("span", "blade"), el("span", "hub"));
  return face;
}

function bayFace(role: PartRole): HTMLElement {
  const face = el("span", `bay-face seg-${role}`);
  face.append(el("span", "hatch"));
  if (role === "nw" || role === "single") face.append(el("span", "mini-hull"), el("span", "mini-barrel"));
  return face;
}

function shieldFace(role: PartRole): HTMLElement {
  const face = el("span", `shield-face seg-${role}`);
  face.append(el("span", "emitter"));
  if (role === "nw" || role === "single") face.append(el("span", "hub"));
  return face;
}

function artStyleToggle(repaint: () => void): HTMLElement {
  const row = el("div", "art-toggle");
  row.append(el("span", "art-label", "Art style"));
  const current = readArtStyle();
  for (const style of ["smooth", "pixel"] as const) {
    const button = el("button", style === current ? "btn art-style selected" : "btn art-style", style === "smooth" ? "Smooth" : "Pixel");
    button.type = "button";
    button.dataset.art = style;
    button.setAttribute("aria-pressed", style === current ? "true" : "false");
    button.addEventListener("click", () => {
      if (readArtStyle() === style) return;
      writeArtStyle(style as ArtStyle);
      applyArtStyle();
      sfxTap();
      repaint();
    });
    row.append(button);
  }
  return row;
}

function buildSide(
  save: SaveData,
  stats: TankStats,
  owned: ReturnType<typeof modulesFor>,
  selected: string,
  choose: (id: string) => void,
): HTMLElement {
  const side = el("div", "garage-side");
  side.append(statPanel(stats), palette(owned, selected, choose), composition(save));
  return side;
}

function statPanel(stats: TankStats): HTMLElement {
  const panel = el("section", "stats-panel");
  panel.append(el("h2", undefined, "Combined"));
  const list = el("dl", "stat-list");
  const rows: [string, number, number, string][] = [
    ["Plates", stats.plates, 16, String(stats.plates)],
    ["Speed", stats.speed, 250, String(Math.round(stats.speed))],
    ["Turning", stats.turn, 250, String(Math.round(stats.turn))],
    ["Fuel", stats.fuel, 280, String(Math.round(stats.fuel))],
  ];
  for (const [label, value, max, text] of rows) {
    list.append(statRow(label, value / max, text));
  }
  const powerText =
    stats.powerUse === 0 ? `${stats.power} supply` : `${stats.power} supply / ${stats.powerUse} draw`;
  list.append(statRow("Power", stats.powerUse === 0 ? 0 : stats.power / Math.max(stats.powerUse, stats.power), powerText));
  const damageText = stats.weaponCount > 0 ? `${Math.round(stats.damage)} × ${stats.weaponCount}` : "—";
  list.append(statRow("Damage", Math.min(1, stats.salvoDamage / 96), damageText));
  list.append(statRow("Fire rate", Math.min(1, stats.fireRate / 3), stats.fireRate > 0 ? `${stats.fireRate.toFixed(1)}/s` : "0/s"));
  panel.append(list, el("p", "stat-note", powerNote(stats)));
  return panel;
}

function powerNote(stats: TankStats): string {
  if (stats.weaponCount === 0) return "No weapons mounted.";
  if (stats.powerFactor <= 0) return "No power — cannons stay cold.";
  if (stats.powerFactor < 1) return "Low power — fire rate is reduced.";
  return "Weapons are fully powered.";
}

function statRow(label: string, fraction: number, value: string): HTMLElement {
  const row = el("div", "stat-row");
  const term = el("dt", undefined, label);
  const bar = el("div", "meter");
  const fill = el("span");
  fill.style.width = `${Math.max(0, Math.min(1, fraction)) * 100}%`;
  bar.append(fill);
  const num = el("dd", undefined, value);
  num.dataset.stat = label.toLowerCase().replace(/\s+/g, "-");
  row.append(term, bar, num);
  return row;
}

function palette(
  owned: ReturnType<typeof modulesFor>,
  selected: string,
  choose: (id: string) => void,
): HTMLElement {
  const section = el("section", "palette");
  section.append(el("h2", undefined, "Blocks"));
  const list = el("div", "palette-grid");
  for (const mod of owned) {
    const button = el("button", mod.id === selected ? "palette-btn selected" : "palette-btn");
    button.type = "button";
    button.dataset.module = mod.id;
    button.setAttribute("aria-pressed", mod.id === selected ? "true" : "false");
    const swatch = el("span", "swatch");
    swatch.style.background = mod.color;
    if (readArtStyle() === "pixel") swatch.append(mountSprite(mod.id, 4, {}, true));
    else swatch.innerHTML = iconSvg(mod.kind, mod.id);
    const text = el("span", "palette-copy");
    text.append(el("span", "palette-name", mod.name), el("span", "palette-blurb", mod.blurb));
    button.append(swatch, text);
    button.addEventListener("click", () => {
      sfxTap();
      choose(mod.id);
    });
    list.append(button);
  }
  section.append(list);
  return section;
}

function composition(save: SaveData): HTMLElement {
  const counts = new Map<string, number>();
  const grid = activeLayout(save);
  grid.forEach((row, r) => {
    row.forEach((token, c) => {
      if (!isAnchorCell(token, r, c)) return;
      const id = moduleIdOf(token);
      if (!id) return;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    });
  });
  const parts = [...counts.entries()]
    .map(([id, count]) => {
      const mod = getModule(id);
      return mod ? `${count} ${mod.name.toLowerCase()}` : "";
    })
    .filter(Boolean);
  const line = el("p", "composition", parts.length > 0 ? parts.join(" · ") : "Empty hull — bolt blocks onto the bays.");
  return line;
}

export function renderBots(save: SaveData, go: (screen: ScreenId, botId?: string) => void): HTMLElement {
  const root = el("div", "screen shop-screen");
  const bar = el("header", "topbar");
  const back = el("button", "btn btn-ghost", "Menu");
  back.type = "button";
  back.addEventListener("click", () => go("menu"));
  bar.append(el("span", "brand", "Rivals"), scrapPill(save.currency), back);

  const body = el("div", "shop-body");
  const list = el("div", "bot-list");
  for (const bot of BOTS) {
    const open = botOpen(save.botsBeaten, bot);
    const cleared = save.botsBeaten > bot.index;
    const card = el("article", open ? "bot-card shop-card" : "bot-card shop-card locked");
    card.dataset.bot = bot.id;
    if (!open) card.dataset.locked = "true";
    if (cleared) card.dataset.cleared = "true";
    const top = el("div", "bot-card-top");
    top.append(el("h3", undefined, bot.name), el("span", "bot-reward", `${bot.scrap} scrap`));
    const foot = el("div", "bot-foot");
    const state = el("div", "bot-state");
    if (!open) {
      const lock = el("span", "lock-icon");
      lock.innerHTML =
        '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="10"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';
      state.append(lock, el("span", undefined, bot.index === 1 ? "Beat Rookie" : "Beat Veteran"));
    } else if (cleared) {
      state.append(el("span", undefined, "Cleared"));
    } else {
      state.append(el("span", undefined, "Open"));
    }
    const button = el("button", "btn btn-primary", open ? "Fight" : "Locked");
    button.type = "button";
    button.disabled = !open;
    button.addEventListener("click", () => {
      if (!open) return;
      sfxTap();
      go("battle", bot.id);
    });
    foot.append(state, button);
    card.append(top, el("p", "shop-tagline", bot.blurb), foot);
    list.append(card);
  }
  body.append(list);
  root.append(bar, body);
  return root;
}

export function renderShop(save: SaveData, go: (screen: ScreenId) => void, persist: () => void): HTMLElement {
  const root = el("div", "screen shop-screen");

  const paint = (): void => {
    const bar = el("header", "topbar");
    const back = el("button", "btn btn-ghost", "Menu");
    back.type = "button";
    back.addEventListener("click", () => go("menu"));
    bar.append(el("span", "brand", "Shop"), scrapPill(save.currency), back);

    const body = el("div", "shop-body");
    body.append(shopList(save, persist, paint));
    root.replaceChildren(bar, body);
  };

  paint();
  return root;
}

function shopList(save: SaveData, persist: () => void, paint: () => void): HTMLElement {
  const list = el("div", "shop-list");
  for (const item of SHOP_ITEMS) {
    list.append(shopCard(save, item, persist, paint));
  }
  return list;
}

function shopCard(save: SaveData, item: ShopItem, persist: () => void, paint: () => void): HTMLElement {
  const id = item.kind === "module" ? item.moduleId : item.hullId;
  const owned = save.unlocked.includes(id) || Boolean(item.kind === "hull" && getHull(id)?.starter);
  const card = el("article", "shop-card");
  card.dataset.item = id;
  const head = el("div", "shop-card-top");
  if (item.kind === "module") {
    const mod = getModule(id);
    const swatch = el("span", "swatch");
    if (mod) {
      swatch.style.background = mod.color;
      if (readArtStyle() === "pixel") swatch.append(mountSprite(mod.id, 4, {}, true));
      else swatch.innerHTML = iconSvg(mod.kind, mod.id);
    }
    head.append(swatch);
  } else {
    head.append(el("span", "swatch hull-mark", getHull(id)?.mark ?? "Hull"));
  }
  const copy = el("div", "shop-copy");
  copy.append(el("h3", undefined, item.name), el("p", "shop-tagline", item.tagline));
  head.append(copy);
  const foot = el("div", "shop-card-foot");
  foot.append(el("span", "shop-price", `${item.cost.toLocaleString()} scrap`));
  const button = el("button", "btn btn-primary", owned ? "Owned" : "Buy");
  button.type = "button";
  button.disabled = owned || save.currency < item.cost;
  button.addEventListener("click", () => {
    if (!purchase(save, item)) return;
    sfxTap();
    persist();
    paint();
  });
  foot.append(button);
  card.append(head, foot);
  return card;
}

export function renderPvp(go: (screen: ScreenId) => void, onFight: (launch: PvpLaunch) => void): HTMLElement {
  const root = el("div", "screen shop-screen");
  const paint = (): void => {
    const identity = readIdentity();
    const bar = el("header", "topbar");
    const back = el("button", "btn btn-ghost", "Menu");
    back.type = "button";
    back.addEventListener("click", () => go("menu"));
    const board = el("button", "btn", "Leaderboard");
    board.type = "button";
    board.addEventListener("click", () => {
      sfxTap();
      go("board");
    });
    bar.append(el("span", "brand", "PvP"), board, back);

    const body = el("div", "pvp-body");
    const rating = readRating();
    const who = identity
      ? `${identity.name} · ${rating === null ? "Unranked" : `rating ${rating}`}`
      : "Pick a callsign to join the yard.";
    body.append(el("p", "pvp-status", who));

    if (!identity) {
      body.append(callsignForm(paint));
    } else {
      body.append(finder(onFight));
    }
    root.replaceChildren(bar, body);
  };
  paint();
  return root;
}

function callsignForm(done: () => void): HTMLElement {
  const form = el("form", "shop-card callsign-form");
  const label = el("label", "palette-name", "Callsign");
  label.htmlFor = "callsign";
  const input = el("input", "callsign-input") as HTMLInputElement;
  input.id = "callsign";
  input.type = "text";
  input.maxLength = 20;
  input.required = true;
  input.autocomplete = "off";
  input.placeholder = "Up to 20 characters";
  const status = el("p", "pvp-status", "");
  status.setAttribute("role", "status");
  const submit = el("button", "btn btn-primary", "Register");
  submit.type = "submit";
  form.append(label, input, status, submit);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const name = cleanCallsign(input.value);
    if (!name) {
      status.textContent = "Enter a callsign.";
      return;
    }
    submit.disabled = true;
    status.textContent = "Registering…";
    void registerCallsign(name)
      .then(() => done())
      .catch((err: unknown) => {
        status.textContent = err instanceof Error ? err.message : "Couldn't register.";
        submit.disabled = false;
      });
  });
  return form;
}

function finder(onFight: (launch: PvpLaunch) => void): HTMLElement {
  const wrap = el("div", "shop-list");
  const find = el("button", "btn btn-primary", "Find opponent");
  find.type = "button";
  const status = el("p", "pvp-status", "Find a posted defense, then fight it.");
  status.setAttribute("role", "status");
  const slot = el("div");
  find.addEventListener("click", () => {
    sfxTap();
    find.disabled = true;
    status.textContent = "Looking for a rival…";
    slot.replaceChildren();
    void findOpponent()
      .then((opponent) => {
        if (!opponent) {
          status.textContent = "No rivals yet. A yard bot will stand in.";
          const fight = el("button", "btn btn-primary", "Fight the stand-in");
          fight.type = "button";
          fight.addEventListener("click", () => {
            sfxTap();
            onFight({ kind: "standin" });
          });
          slot.append(fight);
          return;
        }
        status.textContent = "";
        const card = el("article", "shop-card");
        card.dataset.pvp = "found";
        card.append(
          el("h3", undefined, opponent.name),
          el("p", "shop-tagline", `Rating ${opponent.rating} · ${opponent.wins} wins · ${opponent.losses} losses`),
        );
        const fight = el("button", "btn btn-primary", "Fight");
        fight.type = "button";
        fight.addEventListener("click", () => {
          sfxTap();
          onFight({ kind: "rival", opponent });
        });
        card.append(fight);
        slot.append(card);
      })
      .catch((err: unknown) => {
        status.textContent = err instanceof Error ? err.message : "Couldn't look for a rival.";
      })
      .finally(() => {
        find.disabled = false;
      });
  });
  wrap.append(find, status, slot);
  return wrap;
}

export function renderLeaderboard(go: (screen: ScreenId) => void): HTMLElement {
  const root = el("div", "screen shop-screen");
  const bar = el("header", "topbar");
  const back = el("button", "btn btn-ghost", "PvP");
  back.type = "button";
  back.addEventListener("click", () => go("pvp"));
  bar.append(el("span", "brand", "Leaderboard"), back);
  const body = el("div", "pvp-body");
  const identity = readIdentity();
  const rating = readRating();
  body.append(
    el(
      "p",
      "pvp-status",
      identity ? `${identity.name} · ${rating === null ? "Unranked" : `rating ${rating}`}` : "Register under PvP to get a rating.",
    ),
  );
  const status = el("p", "pvp-status", "Loading…");
  status.setAttribute("role", "status");
  const list = el("div", "board-list");
  body.append(status, list);
  root.append(bar, body);
  void loadLeaderboard()
    .then((rows) => {
      status.textContent = rows.length === 0 ? "No rated pilots yet." : "Top 20";
      rows.forEach((row, index) => {
        const line = el("article", identity && row.name === identity.name ? "shop-card board-row you" : "shop-card board-row");
        line.append(
          el("span", "board-rank", String(index + 1)),
          el("span", "palette-name", row.name),
          el("span", undefined, String(row.rating)),
          el("span", "palette-blurb", `${row.wins}–${row.losses}`),
        );
        list.append(line);
      });
    })
    .catch((err: unknown) => {
      status.textContent = err instanceof Error ? err.message : "Leaderboard is offline.";
    });
  return root;
}
