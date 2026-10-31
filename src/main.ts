import { mountBattle } from "./battle";
import { applyArtStyle } from "./config";
import { ACE_TUNING, getBot } from "./bots";
import { outfitProblem } from "./modules";
import { PVP_SCRAP, ratingLine, reportResult, scheduleDefense, standInGrid, veteranTuning, type PvpLaunch } from "./pvp";
import { activeLayout, loadSave, saveGame } from "./save";
import { renderCampaign, renderGarage, renderLeaderboard, renderPvp, renderShop, renderTabs, type ScreenId, type TabId } from "./screens";
import { unlockAudio } from "./sfx";
import "./style.css";

installZoomLock();
applyArtStyle();

const root = document.querySelector<HTMLElement>("#app");
if (!root) throw new Error("Missing #app");
const app: HTMLElement = root;
const slot = document.createElement("div");
slot.className = "app-slot";
const tabs = renderTabs((id) => show(id));
app.append(slot, tabs.element);

const save = loadSave();
let stopBattle: (() => void) | null = null;
let opponentId = "rookie";
let outfitNote = "";
let pvpLaunch: PvpLaunch | null = null;

function persist(): void {
  saveGame(save);
  scheduleDefense(save.hull, activeLayout(save));
}

function show(screen: ScreenId, botId?: string): void {
  if (botId) opponentId = botId;
  if (screen !== "battle") pvpLaunch = null;
  stopBattle?.();
  stopBattle = null;
  const tab: TabId | null = screen === "board" ? "pvp" : screen === "battle" ? null : screen;
  document.body.classList.toggle("in-battle", screen === "battle");
  tabs.setActive(tab);
  if (screen === "garage") {
    const note = outfitNote;
    outfitNote = "";
    slot.replaceChildren(renderGarage(save, show, persist, note));
    return;
  }
  if (screen === "shop") {
    slot.replaceChildren(renderShop(save, persist));
    return;
  }
  if (screen === "campaign") {
    slot.replaceChildren(renderCampaign(save, show));
    return;
  }
  if (screen === "pvp") {
    slot.replaceChildren(renderPvp(save, show, (launch) => {
      pvpLaunch = launch;
      show("battle");
    }));
    return;
  }
  if (screen === "board") {
    slot.replaceChildren(renderLeaderboard(show));
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
    slot.replaceChildren(host);
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
      onExit: () => show("pvp"),
      onGarage: () => show("garage"),
      onRivals: () => show("pvp"),
    });
    return;
  }
  const bot = getBot(opponentId);
  if (bot.index > save.botsBeaten) {
    show("campaign");
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
  slot.replaceChildren(host);
  stopBattle = mountBattle(host, {
    grid: activeLayout(save).map((row) => row.slice()),
    hull: save.hull,
    rivalName: bot.name,
    rivalHull: bot.hull,
    rivalGrid: bot.grid.map((row) => row.slice()),
    rivalTuning: bot.tuning,
    driver: new URLSearchParams(location.search).get("sim") ? ACE_TUNING : undefined,
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
    onExit: () => show("campaign"),
    onGarage: () => show("garage"),
    onRivals: () => show("campaign"),
  });
}

if (import.meta.env.DEV) {
  window.__TANK_DUEL__ = (a, b) => {
    stopBattle?.();
    document.body.classList.add("in-battle");
    const host = document.createElement("div");
    host.className = "screen battle-screen";
    slot.replaceChildren(host);
    stopBattle = mountBattle(host, {
      grid: a.grid,
      hull: a.hull,
      rivalName: b.name,
      rivalHull: b.hull,
      rivalGrid: b.grid,
      rivalTuning: ACE_TUNING,
      driver: ACE_TUNING,
      scrap: 0,
      currency: 0,
      onCurrency: () => {},
      onWin: () => {},
      onExit: () => {},
      onGarage: () => {},
      onRivals: () => {},
    });
  };
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
show("campaign");
