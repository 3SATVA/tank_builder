import { el } from "./dom";
import { iconSvg } from "./icons";
import { createDefaultGrid, getModule, isTurretCell, modulesFor, SHOP_ITEMS } from "./modules";
import { purchase } from "./save";
import { sfxTap } from "./sfx";
import { computeStats } from "./stats";
import type { SaveData, ShopItem, TankStats } from "./types";

export type ScreenId = "menu" | "garage" | "battle" | "shop";

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
    menuButton("Battle", "Duel another built tank", () => go("battle"), true),
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
    const stats = computeStats(save.grid);
    const cols = save.grid[0]?.length ?? 1;

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
  stage.append(
    el("h2", undefined, "Hull"),
    el(
      "p",
      "hint",
      "Pick a block, tap a bay to place it. Tap a bay that already holds that block to pull it off. The gold 3×3 is the turret — it rotates toward your aim. Guns on the hull fire the way the hull faces.",
    ),
  );

  const wrap = el("div", "tank-stage");
  wrap.append(el("div", "front-flag", "Front"));
  const frame = el("div", "hull-frame");
  const grid = el("div", "tank-grid");
  grid.style.setProperty("--cols", String(cols));
  grid.setAttribute("role", "grid");
  grid.setAttribute("aria-label", "Tank hull");

  const rows = save.grid.length;
  save.grid.forEach((row, r) => {
    row.forEach((id, c) => {
      const mod = id ? getModule(id) : undefined;
      const turret = isTurretCell(r, c, cols, rows);
      const cell = el("button", mod ? "cell filled" : "cell empty");
      if (turret) cell.classList.add("turret");
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
      if (mod) {
        const swatch = el("span", "cell-swatch");
        swatch.innerHTML = iconSvg(mod.kind);
        cell.append(swatch);
      }
      cell.addEventListener("click", () => {
        const current = save.grid[r][c];
        save.grid[r][c] = current === selected ? null : selected;
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
    save.grid = createDefaultGrid();
    sfxTap();
    persist();
    paint();
  });
  tools.append(reset);
  stage.append(wrap, tools);
  return stage;
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
    swatch.innerHTML = iconSvg(mod.kind);
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
  for (const id of save.grid.flat()) {
    if (!id) continue;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const parts = [...counts.entries()]
    .map(([id, count]) => {
      const mod = getModule(id);
      return mod ? `${count} ${mod.name.toLowerCase()}` : "";
    })
    .filter(Boolean);
  const line = el("p", "composition", parts.length > 0 ? parts.join(" · ") : "Empty hull — bolt blocks onto the bays.");
  return line;
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
    if (SHOP_ITEMS.length === 0) {
      body.append(emptyShop());
    } else {
      body.append(shopList(save, persist, paint));
    }
    root.replaceChildren(bar, body);
  };

  paint();
  return root;
}

function emptyShop(): HTMLElement {
  const empty = el("section", "empty-shop");
  const art = el("div", "empty-art");
  art.setAttribute("aria-hidden", "true");
  art.append(el("span", "crate c1"), el("span", "crate c2"), el("span", "crate c3"));
  empty.append(
    art,
    el("h2", undefined, "New modules coming soon"),
    el(
      "p",
      undefined,
      "Scrap from won duels is banked and ready. The racks are empty until the next shipment of blocks.",
    ),
  );
  return empty;
}

function shopList(save: SaveData, persist: () => void, paint: () => void): HTMLElement {
  const list = el("div", "shop-list");
  for (const item of SHOP_ITEMS) {
    list.append(shopCard(save, item, persist, paint));
  }
  return list;
}

function shopCard(save: SaveData, item: ShopItem, persist: () => void, paint: () => void): HTMLElement {
  const mod = getModule(item.moduleId);
  const card = el("article", "shop-card");
  const name = mod?.name ?? item.moduleId;
  const owned = save.unlocked.includes(item.moduleId);
  card.append(el("h3", undefined, name), el("p", undefined, item.tagline));
  const button = el("button", "btn btn-primary", owned ? "Owned" : `${item.cost} scrap`);
  button.type = "button";
  button.disabled = owned || save.currency < item.cost;
  button.addEventListener("click", () => {
    if (!purchase(save, item)) return;
    sfxTap();
    persist();
    paint();
  });
  card.append(button);
  return card;
}
