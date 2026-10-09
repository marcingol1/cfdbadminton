# Deadminton

Badminton, but the shuttlecock can be a grenade. Win by points, or by KO.

A browser-first 1v1 game: real-time badminton rallies plus a Worms-style arsenal (coming in
milestone M2). It ships to iOS and Android later through Capacitor.

- 📐 [Game design and rules](docs/GAME_DESIGN.md)
- 🛠️ [Technical plan](docs/TECHNICAL_PLAN.md)
- 🗺️ [Roadmap and decisions](docs/ROADMAP.md)
- 🤖 [How the bots and seeds work](docs/AI_AND_SEEDS.md)

## Quick start

```bash
npm install
npm run dev        # opens the game at http://localhost:5173
```

## Controls (M1)

| Action         | Keyboard                         | Gamepad    | Touch       |
| -------------- | -------------------------------- | ---------- | ----------- |
| Move           | A / D or ← / →                   | Left stick | Left stick  |
| Shot direction | W (clear) · S (drop) · D (smash) | Left stick | Left stick  |
| Jump           | Space                            | A          | JUMP button |
| Swing / serve  | J or left mouse button           | X          | HIT button  |
| Pause          | Esc                              | Start      | ❚❚ button   |
| Tuning panel   | ` (backtick)                     |            |             |

Hold a direction while you swing: **up** → clear / lift, **down** → drop / net shot,
**toward the net** → smash (when the shuttle is high) or drive, **nothing** → clear / lift.
Timing and racket distance decide how accurate the shot is.

## Repository layout

| Path             | What                                                            |
| ---------------- | --------------------------------------------------------------- |
| `packages/sim`   | Deterministic, headless game simulation (rules, physics, shots) |
| `packages/bots`  | AI players that drive the sim through the same inputs as humans |
| `apps/web`       | Vite + Phaser browser client (rendering, input, audio, menus)   |
| `tools/simbatch` | Headless bot-vs-bot batch runner for balancing                  |

## Scripts

```bash
npm test              # unit tests (rules are tested by their R-xx IDs)
npm run check         # lint + format + typecheck + tests (what CI runs)
npm run simbatch -- --a hard --b medium --n 200   # balance report
npm run build         # static web build in apps/web/dist
```

## Deployment

The web build deploys to **Vercel** through its GitHub integration: pushes to `master` go
to production, and every pull request gets a preview URL. `vercel.json` holds the build
settings (install `npm ci`, build `npm run build`, output `apps/web/dist`), so the Vercel
project needs no extra configuration.
