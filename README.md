# Tank Builder

A top-down tank you assemble out of blocks, then drive. Static Vite + TypeScript app — no backend. Layout and scrap are stored in `localStorage`.

```bash
npm install
npm run dev
npm run build
```

## Screens

- **Garage** — tap a block in the palette, tap a bay to place it. Tap a bay that already holds that block to remove it. The top row is the front of the hull.
- **Battle** — drive the tank you built. Destroy wandering blocks and crates for scrap.
- **Shop** — scrap counter is live. The shelves are empty: “New modules coming soon.”

## Controls

Left stick (or WASD / arrows):

- Up drives forward along the hull’s facing
- Down drives backward
- Left and right turn the hull
- Diagonals do both

Right stick rotates the turret toward that direction and fires while you hold it off-center. Mouse aim and click (or space) do the same thing. Escape or Menu leaves the arena.

## Modules

Starter blocks, added on top of a bare hull (50 hull, 28 speed, 18 turning, 36 fuel):

| Block | Effect |
| --- | --- |
| Armor | +40 hull |
| Tracks | +36 turning |
| Power | +2 power supply |
| Fuel | +40 fuel |
| Engine | +44 speed |
| Cannon | +16 damage, +0.55 fire rate, uses 1 power |

The default 5×3 loadout is two cannons, four armor, four tracks, two engines, two fuel, and one power cell under the turret — enough power to run both guns. Fire rate drops when weapon demand is higher than power supply, and hits zero with no power. An empty fuel tank crawls at a quarter speed.

New block types are another entry in `src/modules.ts`. Shop stock is the `SHOP_ITEMS` list, which is intentionally empty.

## Hosting

`vercel.json` builds the Vite app (`dist`) and sets `ignoreCommand` so Vercel only builds the `main` branch. A branch whose `VERCEL_GIT_COMMIT_REF` is not `main` exits 0 and the build is skipped. `main` exits 1 and the build runs.
