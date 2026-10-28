# Tank Builder

A top-down tank you assemble out of blocks, then duel. Static Vite + TypeScript app — no backend. Layout and scrap are stored in `localStorage`.

```bash
npm install
npm run dev
npm run build
```

## Screens

- **Garage** — tap a block in the palette, tap a bay to place it. Tap the same block to pull it off, or a different one to replace it. A medium cannon takes the bay you tap and the one behind it, and replaces whatever was in both as long as both are on the hull or both are inside the turret, and neither is the core. The top row is the front of the hull. The gold 3×3 is the turret; those bays are module slots too. A hull switcher lists the chassis you own, and each hull keeps its own layout.
- **Battle** — pick Rookie, Veteran, or Warlord, then duel. Beating a rival opens the next one. Each fight rolls an arena: Default, Plains, Fortress, Graveyard, Town, Volcano, or Junkyard. The long side is about eight tank-lengths. The name shows at the start. The camera follows your tank and turns with it, so the hull always points up the screen and you see more of the field ahead. A north-up minimap shows which way you face, and an arrow points at a rival who is off screen. Cover stops shots and tanks. Lava on Volcano burns the core of a tank that drives through it. A rematch keeps the same field. Each bot uses the same drive commands a remote player would send later, paths around cover, and fires only with a clear shot.
- **Shop** — spend scrap from won duels. Each card shows the name, what the part does, its tradeoff, the price, and a Buy button. Bought blocks join the garage palette. The bought hull joins the switcher.

## Controls

Left stick (or WASD / arrows):

- Up drives forward along the hull’s facing
- Down drives backward
- Left and right turn the hull
- Diagonals do both

Right stick rotates the 3×3 turret toward that direction and fires every powered gun while you hold it off-center. Turret guns shoot along the aim. Hull guns stay fixed to the hull and shoot the way the hull faces. Mouse aim and click (or space) do the same thing. Escape or Menu leaves the arena. A win pays 50 scrap for Rookie, 80 for Veteran, and 120 for Warlord, then offers a rematch, the rival list, or the garage. Phones do not double-tap or pinch to zoom.

## Modules

Starter blocks, added on top of a bare core (70 core, 28 speed, 18 turning, 36 fuel). Armor does not add core HP. Each armor block soaks 48 damage on its own cell; every other block soaks 32. Overflow past a broken plate comes off the core. A shot that lands in an empty turret bay also hits the core, so opening a hole in the gold 3×3 is how you finish a tank. The tank is out when the core hits zero or every block is gone. Lost blocks change speed, turning, fuel, power, and guns immediately.

| Block | Effect |
| --- | --- |
| Armor | 48 plate on that cell |
| Tracks | +36 turning |
| Power | +2 power supply |
| Fuel | +40 fuel |
| Engine | +44 speed |
| Cannon | 16 damage, 0.55 shots/s, uses 1 power |
| Heavy armor | 96 plate, −30 speed, −12 turning. Shop, 150 scrap |
| Repair bay | Restores the most hurt block, or rebuilds a destroyed one, every few seconds. Never the core. Draws 2 power while it is working. Shop, 200 scrap |
| Medium cannon | 2 cells along the hull (this bay and the one behind it). 28 damage, longer range, 0.30 shots/s, uses 4 power. Both cells must be hull, or both inside the turret. Shop, 250 scrap |
| Rear turret tank | Same 5×7 size with the 3×3 turret on the back three rows. Own layout. Shop, 300 scrap |

The default hull is 5 blocks wide and 7 long, with the front row at the top. The long axis is forward: that is the way the hull drives and the way hull cannons fire. A centered 3×3 turret carries two of the four cannons; the other two sit on the front of the hull. The rear-turret hull keeps the same footprint and moves the gold 3×3 to rows 5–7. The rest of the starter loadout is eight armor, four tracks, two engines, four fuel, and two power cells. Fire rate is the average of the guns still mounted, scaled by power. It drops when weapon demand is higher than supply, and hits zero with no power. An empty fuel tank crawls at a quarter speed. A repair bay spends power only while a block is hurt or missing.

Hitting either cell of a medium cannon damages that one gun. It pops off as a single part and frees both bays. Heavy armor is slower. Module blocks are square; barrels, engines, and rivets keep their own shapes.

Rookie fields two cannons and a light hull, and aims loosely. Veteran adds a heavy plate, four cannons, and a repair bay, and starts to strafe and lead. Warlord rides the rear-turret hull with heavy cheeks, a medium cannon, and a repair bay, and leads, dodges, and holds range. Progress is `botsBeaten` in the save: 0 opens only Rookie, and each win unlocks the next name.

Arenas live in `src/maps.ts`. The long side is about eight tank-lengths. Spawns sit on opposite sides, clear of cover, with a drivable path between them. The picture is pixel art: a low internal resolution scaled up with nearest-neighbor, and the Press Start 2P font hosted in `public/fonts`.

Saves use `tank-builder-save-v4`, with one layout per hull. An older long-hull save keeps its scrap, unlocks, and 5×7 layout on the standard hull. A wide or 5×3 save keeps scrap and unlocks and gets a fresh standard hull. A save that has no rival progress starts at Rookie.

New block types are another entry in `src/modules.ts`. Shop stock is the `SHOP_ITEMS` list. Rivals live in `src/bots.ts`. A `TankController` in `src/control.ts` turns a tuning block into drive commands.

## Hosting

`vercel.json` builds the Vite app (`dist`) and sets `ignoreCommand` so Vercel only builds the `main` branch. A branch whose `VERCEL_GIT_COMMIT_REF` is not `main` exits 0 and the build is skipped. `main` exits 1 and the build runs.
