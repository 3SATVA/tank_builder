# Tank Builder

A top-down tank you assemble out of blocks, then duel. Static Vite + TypeScript app — no backend. Layout and scrap are stored in `localStorage`.

```bash
npm install
npm run dev
npm run build
```

## Screens

- **Garage** — tap a block in the palette, tap a bay to place it. Tap the same block to pull it off, or a different one to replace it. A long gun takes the bay you tap and the cells behind it. A 2×2 part takes a square. It replaces whatever was in those cells as long as every cell is on the hull or every cell is inside the turret. The top row is the front of the hull. The gold 3×3 is the turret, on hulls that have one; those bays are module slots too. A hull switcher lists the chassis you own, and each hull keeps its own layout.
- **Battle** — pick Rookie, Veteran, or Warlord, then duel. Beating a rival opens the next one. Each fight rolls an arena: Default, Plains, Fortress, Graveyard, Town, Volcano, or Junkyard. The long side is about eight tank-lengths. The name shows at the start. The camera follows your tank and turns with it, so the hull always points up the screen and you see more of the field ahead. On a phone the hull is about 105 CSS pixels tall. An arrow points at a rival who is off screen. Cover stops shots and tanks. Lava on Volcano burns the blocks touching it. Tanks push each other aside and cannot overlap. A rematch keeps the same field. Each bot uses the same drive commands a remote player would send later, paths around cover, and fires only with a clear shot.
- **Shop** — spend scrap from won duels. Each card shows the name, what the part does, its tradeoff, the price, and a Buy button. Bought blocks join the garage palette. The bought hull joins the switcher.

## Controls

Left stick (or WASD / arrows):

- Up drives forward along the hull’s facing
- Down drives backward
- Left and right turn the hull
- Diagonals do both

Right stick rotates the 3×3 turret toward that direction and fires every powered gun while you hold it off-center. Turret guns shoot along the aim. Hull guns stay fixed to the hull and shoot the way the hull faces. On the Gun Deck there is no turret, so every gun fires along the hull and the aim stick only fires. Mouse aim and click (or space) do the same thing. Escape or Menu leaves the arena. A win pays 50 scrap for Rookie, 80 for Veteran, and 120 for Warlord, then offers a rematch, the rival list, or the garage. Phones do not double-tap or pinch to zoom.

## Modules

Starter blocks sit on a bare hull (28 speed, 18 turning, 36 fuel). Each armor block soaks 48 damage on its own cell; every other block soaks 32. A shot hurts the block it hits. The tank is destroyed when every weapon is gone, or every power block is gone. Lost blocks change speed, turning, fuel, power, and guns immediately. A fight needs at least one weapon and one power block.

| Block | Effect |
| --- | --- |
| Armor | 48 plate on that cell |
| Tracks | +36 turning |
| Power | +2 power supply |
| Fuel | +40 fuel |
| Engine | +44 speed |
| Cannon | 16 damage, 0.55 shots/s, uses 1 power |
| Heavy armor | 96 plate, −30 speed, −12 turning. Shop, 150 scrap |
| Repair bay | Restores the most hurt block, or rebuilds a destroyed one, every few seconds. Draws 2 power while it is working. Shop, 200 scrap |
| Harpoon | 2 cells along the mount. 18 damage, short range, slow reload, pulls the enemy in on a hit. Uses 3 power. Shop |
| Cutter | Saws enemy blocks and drones that touch it. Uses 1 power. Shop |
| Medium cannon | 2 cells along the hull (this bay and the one behind it). 28 damage, longer range, 0.30 shots/s, uses 4 power. Both cells must be hull, or both inside the turret. Shop, 250 scrap |
| Heavy cannon | 3 cells in a line. 46 damage, longer range than the medium, 0.16 shots/s, uses 8 power. All three cells on the hull or all three in the turret. Shop |
| Robot bay | 2×2. Launches one drone that drives, avoids cover, and shoots the enemy. One drone per bay. The rival can destroy it. Uses 3 power. Shop |
| Shield generator | 2×2. A bubble absorbs hits, then recharges after a delay. Extra generators add shield HP and recharge faster. Uses 3 power. Shop |
| Rear turret tank | Same 5×7 size with the 3×3 turret on the back three rows. Own layout. Shop, 300 scrap |
| Gun deck | No turret. 6 wide × 7 long, more bays than the standard hull, every gun on the hull. Starts empty. Shop |

The four newest shop entries (heavy cannon, robot bay, gun deck, shield generator) share `NEW_SHOP_COST` in `src/modules.ts`. It is 50 scrap while they are being tested. Change that one number to reprice all four.

The default hull is 5 blocks wide and 7 long, with the front row at the top. The long axis is forward: that is the way the hull drives and the way hull cannons fire. A centered 3×3 turret carries two of the four cannons; the other two sit on the front of the hull. The rear-turret hull keeps the same footprint and moves the gold 3×3 to rows 5–7. Bought hulls, including the rear turret and the gun deck, start with empty bays, and Reset clears them back to empty. The starter loadout is eight armor, four tracks, two engines, four fuel, and two power cells. A fight needs at least one weapon and one power block; otherwise the garage keeps you there with a note. Fire rate is the average of the guns still mounted, scaled by power. It drops when weapon demand is higher than supply, and hits zero with no power. An empty fuel tank crawls at a quarter speed. A repair bay spends power only while a block is hurt or missing.

Hitting any cell of a multi-cell part damages that one part. It pops off as a single piece and frees every bay it occupied. Heavy armor is slower. Module blocks are square; barrels, engines, bays, and rivets keep their own shapes. A shield bubble soaks a hit before the module under it does. A robot bay keeps at most one drone in the air.

Rookie fields two cannons and a light hull, and aims loosely. Veteran adds a heavy plate, four cannons, and a repair bay, and starts to strafe and lead. Warlord rides the rear-turret hull with heavy cheeks, a medium cannon, and a repair bay, and leads, dodges, and holds range. Progress is `botsBeaten` in the save: 0 opens only Rookie, and each win unlocks the next name.

Arenas live in `src/maps.ts`. The long side is about eight tank-lengths. Spawns sit on opposite sides, clear of cover, with a drivable path between them. The default look is smooth. Set `DEFAULT_ART_STYLE` in `src/config.ts` to `"pixel"` to ship the pixel-art sprites and Press Start 2P font instead. The garage toggle stores a choice in `localStorage` under `tank-builder-art-style` and overrides that default.

Saves use `tank-builder-save-v4`, with one layout per hull. An older long-hull save keeps its scrap, unlocks, and 5×7 layout on the standard hull. A wide or 5×3 save keeps scrap and unlocks and gets a fresh standard hull. A saved gun deck that is still 7×8 keeps every part that fits in 6×7 and drops the rest; a part that straddles the cut is removed whole. Placed blocks are not a separate inventory, so a dropped part is not refunded. A save that has no rival progress starts at Rookie.

New block types are another entry in `src/modules.ts`. Shop stock is the `SHOP_ITEMS` list. Rivals live in `src/bots.ts`. A `TankController` in `src/control.ts` turns a tuning block into drive commands.

## Hosting

`vercel.json` builds the Vite app (`dist`) and sets `ignoreCommand` so Vercel only builds the `main` branch. A branch whose `VERCEL_GIT_COMMIT_REF` is not `main` exits 0 and the build is skipped. `main` exits 1 and the build runs.
