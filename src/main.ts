import { mountBattle } from "./battle";
import { loadSave, saveGame } from "./save";
import { renderGarage, renderMenu, renderShop, type ScreenId } from "./screens";
import { unlockAudio } from "./sfx";
import "./style.css";

const root = document.querySelector<HTMLElement>("#app");
if (!root) throw new Error("Missing #app");
const app: HTMLElement = root;

const save = loadSave();
let stopBattle: (() => void) | null = null;

function persist(): void {
  saveGame(save);
}

function show(screen: ScreenId): void {
  stopBattle?.();
  stopBattle = null;
  document.body.classList.toggle("in-battle", screen === "battle");
  if (screen === "menu") {
    app.replaceChildren(renderMenu(save, show));
    return;
  }
  if (screen === "garage") {
    app.replaceChildren(renderGarage(save, show, persist));
    return;
  }
  if (screen === "shop") {
    app.replaceChildren(renderShop(save, show, persist));
    return;
  }
  const host = document.createElement("div");
  host.className = "screen battle-screen";
  app.replaceChildren(host);
  stopBattle = mountBattle(host, {
    grid: save.grid.map((row) => row.slice()),
    currency: save.currency,
    onCurrency: (value) => {
      save.currency = value;
      persist();
    },
    onExit: () => show("menu"),
  });
}

window.addEventListener("pointerdown", () => unlockAudio());
show("menu");
