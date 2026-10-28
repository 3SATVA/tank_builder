import { BOTS, botOpen } from "./bots";
import { el } from "./dom";
import { commitPlacement } from "./grid";
import { mountSprite } from "./sprites";
import {
  createDefaultGrid,
  getHull,
  getModule,
  hullsFor,
  isAnchorCell,
  isCoreCell,
  isTurretCell,
  moduleIdOf,
  modulesFor,
  SHOP_ITEMS,
} from "./modules";
import { activeLayout, purchase } from "./save";
import { sfxTap } from "./sfx";
import { computeStats } from "./stats";
import type { ModuleDef, SaveData, ShopItem, TankStats } from "./types";

export type ScreenId = "menu" | "garage" | "battle" | "shop" | "bots";

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
      buildStage(save, cols, selected, persist, paint),
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
): HTMLElement {
  const stage = el("section", "builder");
  stage.append(el("h2", undefined, "Hull"), hullPicker(save, persist, paint), hint());

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
      if (isCoreCell(r, c, cols, rows, save.hull)) cell.classList.add("core");
      const anchor = isAnchorCell(token, r, c);
      if (mod?.id === "medium-cannon") cell.classList.add(anchor ? "medium-front" : "medium-rear");
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
      if (mod) cell.append(moduleFace(mod, mod.id === "medium-cannon" && !anchor ? "rear" : "front"));
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
  tools.append(reset);
  stage.append(wrap, tools);
  return stage;
}

function hint(): HTMLElement {
  return el(
    "p",
    "hint",
    "Pick a block, tap a bay to place it. Tap the same block to pull it off, or a different one to replace it. A medium cannon takes the bay you tap and the one behind it — both on the hull or both inside the turret, and not on the core. The gold 3×3 rotates toward your aim. Guns on the hull fire the way the hull faces. A shot through a hole in the turret hits the core.",
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

function moduleFace(mod: ModuleDef, end: "front" | "rear" = "front"): HTMLElement {
  return mountSprite(mod.id, 5, { rear: mod.id === "medium-cannon" && end === "rear" });
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
    ["Core", stats.hp, 140, String(Math.round(stats.hp))],
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
    swatch.append(mountSprite(mod.id, 4, {}, true));
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
      swatch.append(mountSprite(mod.id, 4, {}, true));
    }
    head.append(swatch);
  } else {
    head.append(el("span", "swatch hull-mark", "Rear"));
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
