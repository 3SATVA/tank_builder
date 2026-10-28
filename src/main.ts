import { mountBattle } from "./battle";
import { applyArtStyle } from "./config";
import { getBot } from "./bots";
import { gridHasModules } from "./modules";
import { activeLayout, loadSave, saveGame } from "./save";
import { renderBots, renderGarage, renderMenu, renderShop, type ScreenId } from "./screens";
import { unlockAudio } from "./sfx";
import "./style.css";

installZoomLock();
applyArtStyle();

const root = document.querySelector<HTMLElement>("#app");
if (!root) throw new Error("Missing #app");
const app: HTMLElement = root;

const save = loadSave();
let stopBattle: (() => void) | null = null;
let opponentId = "rookie";
let outfitNote = "";

function persist(): void {
  saveGame(save);
}

function show(screen: ScreenId, botId?: string): void {
  if (botId) opponentId = botId;
  stopBattle?.();
  stopBattle = null;
  document.body.classList.toggle("in-battle", screen === "battle");
  if (screen === "menu") {
    app.replaceChildren(renderMenu(save, show));
    return;
  }
  if (screen === "garage") {
    const note = outfitNote;
    outfitNote = "";
    app.replaceChildren(renderGarage(save, show, persist, note));
    return;
  }
  if (screen === "shop") {
    app.replaceChildren(renderShop(save, show, persist));
    return;
  }
  if (screen === "bots") {
    app.replaceChildren(renderBots(save, show));
    return;
  }
  const bot = getBot(opponentId);
  if (bot.index > save.botsBeaten) {
    show("bots");
    return;
  }
  if (!gridHasModules(activeLayout(save))) {
    outfitNote = "Mount at least one block before you fight.";
    show("garage");
    return;
  }
  const host = document.createElement("div");
  host.className = "screen battle-screen";
  app.replaceChildren(host);
  stopBattle = mountBattle(host, {
    grid: activeLayout(save).map((row) => row.slice()),
    hull: save.hull,
    rivalName: bot.name,
    rivalHull: bot.hull,
    rivalGrid: bot.grid.map((row) => row.slice()),
    rivalTuning: bot.tuning,
    scrap: bot.scrap,
    currency: save.currency,
    onCurrency: (value) => {
      save.currency = value;
      persist();
    },
    onWin: () => {
      if (save.botsBeaten < bot.index + 1) {
        save.botsBeaten = bot.index + 1;
        persist();
      }
    },
    onExit: () => show("menu"),
    onGarage: () => show("garage"),
    onRivals: () => show("bots"),
  });
}

/** Stops pinch and double-tap zoom on phones without blocking the joysticks. */
function installZoomLock(): void {
  const block = (event: Event): void => {
    event.preventDefault();
  };
  document.addEventListener("gesturestart", block, { passive: false });
  document.addEventListener("dblclick", block);
  let lastTouch = 0;
  document.addEventListener(
    "touchend",
    (event) => {
      const target = event.target;
      if (target instanceof Element && target.closest(".battle-screen, .joystick")) return;
      const now = Date.now();
      if (now - lastTouch < 300) event.preventDefault();
      lastTouch = now;
    },
    { passive: false },
  );
}

window.addEventListener("pointerdown", () => unlockAudio());
show("menu");
