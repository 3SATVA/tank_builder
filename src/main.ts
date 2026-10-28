import { mountBattle } from "./battle";
import { applyArtStyle } from "./config";
import { getBot } from "./bots";
import { outfitProblem } from "./modules";
import { PVP_SCRAP, ratingLine, reportResult, standInGrid, veteranTuning, type PvpLaunch } from "./pvp";
import { activeLayout, loadSave, saveGame } from "./save";
import { renderBots, renderGarage, renderLeaderboard, renderMenu, renderPvp, renderShop, type ScreenId } from "./screens";
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
let pvpLaunch: PvpLaunch | null = null;

function persist(): void {
  saveGame(save);
}

function show(screen: ScreenId, botId?: string): void {
  if (botId) opponentId = botId;
  if (screen !== "battle") pvpLaunch = null;
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
  if (screen === "pvp") {
    app.replaceChildren(renderPvp(save, show, (launch) => {
      pvpLaunch = launch;
      show("battle");
    }));
    return;
  }
  if (screen === "board") {
    app.replaceChildren(renderLeaderboard(show));
    return;
  }
  if (pvpLaunch) {
    const launch = pvpLaunch;
    const blocked = outfitProblem(activeLayout(save));
    if (blocked) {
      outfitNote = blocked;
      show("garage");
      return;
    }
    const rival = launch.kind === "rival"
      ? launch.opponent
      : { playerId: "", name: "Yard bot", hull: "standard", grid: standInGrid() };
    const host = document.createElement("div");
    host.className = "screen battle-screen";
    app.replaceChildren(host);
    stopBattle = mountBattle(host, {
      grid: activeLayout(save).map((row) => row.slice()),
      hull: save.hull,
      rivalName: rival.name,
      rivalHull: rival.hull,
      rivalGrid: rival.grid.map((row) => row.slice()),
      rivalTuning: veteranTuning(),
      scrap: launch.kind === "rival" ? PVP_SCRAP : 0,
      currency: save.currency,
      onCurrency: (value) => {
        save.currency = value;
        persist();
      },
      onWin: () => {},
      summary: (won) => {
        if (launch.kind === "standin") {
          return won ? "No rivals yet, so the yard bot stood in. You won." : "No rivals yet, so the yard bot stood in.";
        }
        return won ? `${PVP_SCRAP} scrap banked.` : `${rival.name} kept the field.`;
      },
      onSettle: launch.kind === "rival"
        ? async (won) => {
          const result = await reportResult(launch.opponent.playerId, won);
          return ratingLine(result.rating, result.delta);
        }
        : undefined,
      rivalsLabel: "PvP",
      onExit: () => show("menu"),
      onGarage: () => show("garage"),
      onRivals: () => show("pvp"),
    });
    return;
  }
  const bot = getBot(opponentId);
  if (bot.index > save.botsBeaten) {
    show("bots");
    return;
  }
  const blocked = outfitProblem(activeLayout(save));
  if (blocked) {
    outfitNote = blocked;
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
