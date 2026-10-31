# Tank Builder

A top-down tank you assemble out of blocks, then duel. Static Vite + TypeScript app — no backend. Layout and scrap are stored in `localStorage`.

```bash
npm install
npm run dev
npm run build
```

## Screens

A tab bar stays along the bottom: Shop, Garage, Campaign, PvP. Campaign is the tab that opens. The bar hides during a fight.

- **Shop** — spend scrap from won duels. Each card shows an icon, the name, the price, and a Buy button. Bought blocks join the garage palette. The bought hull joins the switcher.
- **Garage** — tap a block in the palette, tap a bay to place it. Tap the same block to pull it off, or a different one to replace it. A long gun takes the bay you tap and the cells behind it. A 2×2 part takes a square. It replaces whatever was in those cells as long as every cell is on the hull or every cell is inside the turret. The top row is the front of the hull. The gold 3×3 is the turret, on hulls that have one; those bays are module slots too. A hull switcher lists the chassis you own by name, and each hull keeps its own layout.
- **Campaign** — Rookie, Veteran, and Warlord, with the same locks and scrap payouts. Beating a rival opens the next one. Each fight rolls an arena: Default, Plains, Fortress, Graveyard, Town, Volcano, or Junkyard. The long side is about eight tank-lengths. The name shows at the start. The camera follows your tank and turns with it, so the hull always points up the screen and you see more of the field ahead. On a phone the hull is about 105 CSS pixels tall. An arrow points at a rival who is off screen. Cover stops shots and tanks. Lava on Volcano burns the blocks touching it. Tanks push each other aside and cannot overlap. A rematch keeps the same field. Each bot uses the same drive commands a remote player would send later, paths around cover, and fires only with a clear shot.
- **PvP** — the tank equipped in the garage is the defense. It is drawn above Battle, with the callsign and rating, and a small Syncing or Defending line. A tank with no weapon or no power block shows that note and is not replaced by another build. Battle posts that same tank, then finds another pilot's saved tank. The veteran bot drives it on a random map. A win pays 60 scrap and both ratings move. If nobody else has posted, a yard bot stands in. Opening the app, switching hulls, or editing the layout posts the defense again after a short pause. The leaderboard lists the top 20. The yard being offline leaves the campaign playable.

## Controls

Left stick (or WASD / arrows):

- Up drives forward along the hull’s facing
- Down drives backward
- Left and right turn the hull
- Diagonals do both

Right stick rotates the 3×3 turret toward that direction and fires every powered gun while you hold it off-center. Turret guns shoot along the aim. Hull guns stay fixed to the hull and shoot the way the hull faces. On the Gun Deck there is no turret, so every gun fires along the hull and the aim stick only fires. Mouse aim and click (or space) do the same thing. Escape or Back leaves the arena. A win pays 50 scrap for Rookie, 80 for Veteran, and 120 for Warlord, then offers a rematch, the rival list, or the garage. Phones do not double-tap or pinch to zoom.

## Modules

Starter blocks sit on a bare hull (28 speed, 18 turning, 36 fuel). Each armor block soaks 48 damage on its own cell; every other block soaks 32. A shot hurts the block it hits. The tank is destroyed when every weapon is gone, or every power block is gone. Lost blocks change speed, turning, fuel, power, and guns immediately. A fight needs at least one weapon and one power block.

| Block | Effect |
| --- | --- |
| Armor | 48 plate on that cell |
| Tracks | +22 turning |
| Power | +3 power supply |
| Fuel | +36 fuel |
| Engine | +30 speed |
| Cannon | 16 damage, 0.62 shots/s, short range, uses 1 power |
| Heavy armor | 100 plate, −16 speed, −6 turning. Shop, 150 scrap |
| Repair bay | Restores the most hurt block, or rebuilds a destroyed one, about every 5.5 seconds. Draws 2 power whenever it is mounted. Shop, 200 scrap |
| Harpoon | 2 cells along the mount. 22 damage, short range, pulls the enemy in on a hit. Uses 3 power. Shop |
| Cutter | Saws enemy blocks and drones that touch it, 46 damage per second. Uses 2 power. Shop |
| Medium cannon | 2 cells along the hull (this bay and the one behind it). 42 damage, longer range, 0.50 shots/s, uses 3 power. Both cells must be hull, or both inside the turret. Shop, 250 scrap |
| Heavy cannon | 3 cells in a line. 64 damage, one-shots a normal plate, longest range, 0.48 shots/s, uses 5 power. All three cells on the hull or all three in the turret. Shop |
| Robot bay | 2×2. Launches one light drone that flanks and shoots for 5 damage. One drone per bay. Uses 5 power. Shop |
| Shield generator | 2×2. The first bubble is the big one. Extra generators add less HP and less recharge. Uses 4 power. Shop |
| Rear turret tank | Same 5×7 size with the 3×3 turret on the back three rows, so the nose can be armor. Own layout. Shop, 300 scrap |
| Gun deck | No turret. 6 wide × 7 long, more bays than the standard hull. Every gun faces with the hull, so it suits a committed gun line. Starts empty. Shop |

The four newest shop entries (heavy cannon, robot bay, gun deck, shield generator) share `NEW_SHOP_COST` in `src/modules.ts`. It is 50 scrap while they are being tested. Change that one number to reprice all four.

The default hull is 5 blocks wide and 7 long, with the front row at the top. The long axis is forward: that is the way the hull drives and the way hull cannons fire. A centered 3×3 turret carries two of the four cannons; the other two sit on the front of the hull. The rear-turret hull keeps the same footprint and moves the gold 3×3 to rows 5–7. Bought hulls, including the rear turret and the gun deck, start with empty bays, and Reset clears them back to empty. The starter loadout is eight armor, four tracks, two engines, four fuel, and two power cells. Each power cell supplies 3, so the starter sits at 4 draw against 6 supply. Rookie keeps one power cell for two cannons. Veteran keeps two power cells for four cannons and a repair bay. Warlord keeps three for three cannons, a medium cannon, and a repair bay. A fight needs at least one weapon and one power block; otherwise the garage keeps you there with a note. Power is a hard budget. Weapons are fed first, then shields, repair bays, and robot bays. Anything past the supply is unpowered and does nothing, in the garage and in battle, including bots and posted tanks. A hull with no working tracks, no working engine, or no fuel cannot drive or turn. The turret and powered guns still work. The HUD says Immobile, and the garage warns without blocking the fight. The tank selected in the garage is the PvP defense. Opening the app, switching hulls, or editing that layout posts it after a short pause. Battle posts that same tank again before it searches. A tank with no weapon or no power block is not posted. A repair bay draws its power whenever it is mounted.

Hitting any cell of a multi-cell part damages that one part. It pops off as a single piece and frees every bay it occupied. Heavy armor is slower. Module blocks are square; barrels, engines, bays, and rivets keep their own shapes. A shield bubble soaks a hit before the module under it does. A robot bay keeps at most one drone in the air.

Rookie fields two cannons and a light hull, and aims loosely. Veteran adds a heavy plate, four cannons, and a repair bay, and starts to strafe and lead. Warlord rides the rear-turret hull with heavy cheeks, a medium cannon, and a repair bay, and leads, dodges, and holds range. Swarm sends two drones. Bulwark sits behind two shields and heavy plate. Gaff, Redoubt, and Ash Tyrant are bosses. The boss grapple and the mega cannon hit much harder, faster, and farther than anything in the shop. Their reactors, super shields, boss armor, and the citadel hull are not in the shop, cannot be placed in the garage, and are stripped out of any PvP upload. Rival drivers, including posted tanks, pick a spot and stay there for a few seconds. The turret still tracks. While they hold, the hull turns to face the player, and a hull with no turret stays on that aim so its guns can fire. The turn eases in and stops within a few degrees, so the nose does not shiver. The hull drives only to find range, clear a block, or step off heavy fire. Progress is `botsBeaten` in the save: 0 opens only Rookie, and each win unlocks the next name.

Arenas live in `src/maps.ts`. The long side is about eight tank-lengths. Spawns sit on opposite sides, clear of cover, with a drivable path between them. The default look is smooth. Set `DEFAULT_ART_STYLE` in `src/config.ts` to `"pixel"` to ship the pixel-art sprites and Press Start 2P font instead. The garage toggle stores a choice in `localStorage` under `tank-builder-art-style` and overrides that default.

Saves use `tank-builder-save-v4`, with one layout per hull. An older long-hull save keeps its scrap, unlocks, and 5×7 layout on the standard hull. A wide or 5×3 save keeps scrap and unlocks and gets a fresh standard hull. A saved gun deck that is still 7×8 keeps every part that fits in 6×7 and drops the rest; a part that straddles the cut is removed whole. Placed blocks are not a separate inventory, so a dropped part is not refunded. A save that has no rival progress starts at Rookie.

New block types are another entry in `src/modules.ts`. Shop stock is the `SHOP_ITEMS` list. Rivals live in `src/bots.ts`. A `TankController` in `src/control.ts` turns a tuning block into drive commands.

## Hosting

`vercel.json` builds the Vite app (`dist`) and sets `ignoreCommand` so Vercel only builds the `main` branch. A branch whose `VERCEL_GIT_COMMIT_REF` is not `main` exits 0 and the build is skipped. `main` exits 1 and the build runs.
