# Tank Builder

A top-down tank you assemble out of blocks, then duel. Static Vite + TypeScript app — no backend. Layout and scrap are stored in `localStorage`.

```bash
npm install
npm run dev
npm run build
```

## Screens

- **Garage** — tap a block in the palette, tap a bay to place it. Tap a bay that already holds that block to remove it. The top row is the front of the hull. The gold 3×3 in the middle is the turret; those bays are module slots too.
- **Battle** — a 1v1 against another built tank. The rival is a bot today. It uses the same module grid and the same drive commands a remote player would send later.
- **Shop** — scrap counter is live. The shelves are empty: “New modules coming soon.”

## Controls

Left stick (or WASD / arrows):

- Up drives forward along the hull’s facing
- Down drives backward
- Left and right turn the hull
- Diagonals do both

Right stick rotates the 3×3 turret toward that direction and fires every powered gun while you hold it off-center. Turret guns shoot along the aim. Hull guns stay fixed to the hull and shoot the way the hull faces. Mouse aim and click (or space) do the same thing. Escape or Menu leaves the arena. A win pays 50 scrap and offers a rematch or a return to the garage.

## Modules

Starter blocks, added on top of a bare core (70 core, 28 speed, 18 turning, 36 fuel). Armor does not add core HP. Each armor block soaks 48 damage on its own cell; every other block soaks 32. Overflow past a broken plate comes off the core. A shot that lands in an empty turret bay also hits the core, so opening a hole in the gold 3×3 is how you finish a tank. The tank is out when the core hits zero or every block is gone. Lost blocks change speed, turning, fuel, power, and guns immediately.

| Block | Effect |
| --- | --- |
| Armor | 32 plate on that cell |
| Tracks | +36 turning |
| Power | +2 power supply |
| Fuel | +40 fuel |
| Engine | +44 speed |
| Cannon | 16 damage, 0.55 shots/s, uses 1 power |

The default 7×5 loadout puts a ring of hull around a centered 3×3 turret: four cannons (two on the hull, two on the turret), eight armor, four tracks, two engines, four fuel, and two power cells. Fire rate is the average of the guns still mounted, scaled by power. It drops when weapon demand is higher than supply, and hits zero with no power. An empty fuel tank crawls at a quarter speed.

Saves use `tank-builder-save-v2`. An older 5×3 save keeps its scrap and unlocks, and the layout resets to the new hull.

New block types are another entry in `src/modules.ts`. Shop stock is the `SHOP_ITEMS` list, which is intentionally empty. A rival is `createRivalGrid()` plus a `TankController` in `src/control.ts`.

## Hosting

`vercel.json` builds the Vite app (`dist`) and sets `ignoreCommand` so Vercel only builds the `main` branch. A branch whose `VERCEL_GIT_COMMIT_REF` is not `main` exits 0 and the build is skipped. `main` exits 1 and the build runs.
