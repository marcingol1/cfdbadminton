# Deadminton — Technical Plan

Status: **draft for approval**. Companion documents: `GAME_DESIGN.md` (rules and mechanics)
and `ROADMAP.md` (milestones and scope).

## 1. The one architectural decision that matters

**A deterministic, headless simulation core, fully separate from rendering.**

```
            ┌────────────────────────────────────────────┐
 inputs ──▶ │  sim  (pure TypeScript, no DOM, no clock)  │ ──▶ events (hit, boom, point, KO)
 (per tick) │  state' = step(state, [inputP1, inputP2])  │ ──▶ state  (plain serializable data)
            └────────────────────────────────────────────┘
                 ▲                  ▲                 ▲
     humans (keyboard,         bots (same          network (inputs
     gamepad, touch)           input interface)    from a remote peer)
```

Everything we want falls out of this one design:

| Need                  | How the sim core provides it                                                   |
| --------------------- | ------------------------------------------------------------------------------ |
| Bot vs Bot showcase   | Two bot controllers feed inputs. There is no special mode                      |
| Balancing             | Run thousands of matches headless in Node in seconds                           |
| Bots that can "think" | Bots forward-simulate shuttle and rocket trajectories with the real physics    |
| Replays               | A replay is just `seed + input log`, a few KB per match                        |
| Online multiplayer    | Rollback netcode needs only inputs on the wire, and snapshots for resimulation |
| Anti-cheat (later)    | The server replays the input log to verify a result                            |
| Mobile port           | The sim is plain TypeScript and runs unchanged anywhere JavaScript runs        |
| Tests                 | Rules are pure functions of state, so they are trivial to unit-test            |

### Determinism rules (enforced by lint and tests)

- **Fixed timestep:** 60 ticks/s. Rendering interpolates between ticks.
- **No `Math.random`**: a seeded PRNG (sfc32) lives inside the state.
- **No `Math.sin/cos/atan2/exp/pow`** in the sim. They are not guaranteed to give
  identical results across engines, and iOS (JavaScriptCore) and Android (V8) must agree
  bit-for-bit for online play. Basic IEEE arithmetic (`+ - * /` and `Math.sqrt`) _is_
  deterministic in JavaScript. We ship our own polynomial `sin/cos/atan2` and a lookup
  table for drag.
- **No wall-clock time, `Date`, or iteration over unordered collections.** All entities
  live in arrays.
- **Inputs are quantized:** move as an int8, aim as a uint16 angle, buttons as bitflags.
  This is critical for netcode and replays.
- **State is plain JSON-able data:** no classes holding hidden state. That gives
  `snapshot()` and `restore()` for free.
- **A CI determinism test** runs the same seed and inputs for 10 000 ticks, hashes the
  state, and compares the hash across **Node, Chromium and WebKit** (Playwright).

## 2. Physics (custom, no physics engine)

The game needs very little general physics, and the special cases (shuttle drag, heightmap
terrain) are easier to write than to coax out of Box2D or Matter. Owning the physics also
guarantees determinism.

- **Shuttle:** gravity plus **quadratic drag against the relative air velocity (wind)**.
  `a = g − k·|v − w|·(v − w)` with `k = g / v_t²`, starting at a terminal velocity of
  v_t ≈ 6.8 m/s, as for a real shuttle. This gives the signature badminton trajectory
  (a fast start, then a steep drop) almost for free. Each weapon shuttle overrides `k`
  (the Lead Shuttle has low drag).
- **Rockets and mortars:** ballistic, with a wind multiplier per weapon.
- **Players:** kinematic movement with simple AABB-versus-heightmap collision, plus
  knockback impulses with friction.
- **Terrain:** a **1D heightmap** (one height per 5 cm column). Craters subtract a circle
  profile. It is cheap, deterministic, and trivial to render and serialize. Worms uses
  bitmap terrain, which we don't need for a flat court.
- **Hit model:** the racket is a circle around the shoulder. On a hit press, the sim
  checks for the shuttle within reach during an active window of about 6 ticks. The
  outgoing velocity comes from (shot type, timing quality, player velocity), with seeded
  error scaled by timing.
- **Collision against fast objects:** use swept segment tests for the shuttle against the
  net, players and floor, so smashes at 60 m/s can't tunnel through.

## 3. Technology stack

| Layer                   | Choice                                                                                      | Why                                                                                                                                                                                                           |
| ----------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Language                | **TypeScript (strict)** everywhere                                                          | One language for sim, client, bots, server and tools                                                                                                                                                          |
| Repo                    | **npm workspaces monorepo**                                                                 | Simple. The sim is shared by client, server and tools                                                                                                                                                         |
| Build                   | **Vite**                                                                                    | Fast dev loop, PWA plugin, static output                                                                                                                                                                      |
| Rendering, input, audio | **Phaser** (latest stable)                                                                  | Gives us scenes, sprites, particles, camera shake, audio, gamepad and touch input. We do **not** use its physics. The renderer is a thin "view of sim state", so it stays swappable (for PixiJS, for example) |
| Menus and HUD overlays  | DOM overlay (plain TypeScript, no framework)                                                | Accessible, crisp text, easy settings screens                                                                                                                                                                 |
| Tests                   | **Vitest** (sim, bots); **Playwright** (smoke and e2e, cross-engine determinism)            |                                                                                                                                                                                                               |
| Lint / format           | ESLint + Prettier, with a custom rule banning non-deterministic APIs in `packages/sim`      |                                                                                                                                                                                                               |
| Mobile                  | **Capacitor** wrapping the same web build for iOS and Android                               | One codebase. Native plugins for haptics, status bar, store builds                                                                                                                                            |
| Server (later)          | Node + `ws`. Rooms, relay, matchmaking                                                      | Minimal. See §7                                                                                                                                                                                               |
| CI                      | GitHub Actions: lint, typecheck, test, determinism, bot-vs-bot smoke batch, build           |                                                                                                                                                                                                               |
| Hosting (web)           | **Vercel** (`vercel.json` at the repo root): production from `master`, a preview URL per PR | The client is fully static until online play                                                                                                                                                                  |

**Why not Unity or Godot?** Both would work. We are choosing web-first because it gives
instant sharing via a link, needs no install, and has the fastest iteration loop. The
team already knows TypeScript and Node. Capacitor covers mobile for a 2D game of this
size. If performance on low-end phones ever becomes a wall, the sim core can be ported,
because it is engine-agnostic by design.

### What happens to the current repo contents?

The repo currently holds a 2020 NestJS 6 "hello world" scaffold (and, in its history, CRA,
Next, Prisma and serverless experiments). None of it is game code, and the dependencies
are 6+ years old. **Recommendation:** remove the scaffold in milestone M0 (git history
keeps it), and add a fresh, minimal server package only in the online milestone.
The old Prisma models (`Server`, `Match`, `Player`, `Region`) are a useful sketch for that
later server.

## 4. Repository layout

```
/
├─ packages/
│  ├─ sim/          # deterministic core: state, step(), rules R-xx, physics, weapons, PRNG, math
│  │  ├─ src/
│  │  │  ├─ math/        # fixed trig, vec2, PRNG
│  │  │  ├─ physics/     # shuttle, projectiles, players, terrain heightmap
│  │  │  ├─ rules/       # serve, rally, scoring, revenge turn, match state machine
│  │  │  ├─ weapons/     # behaviours keyed by weapon id
│  │  │  └─ data/        # weapons.json, schemes.json, arenas.json (tuning lives here)
│  │  └─ test/           # one test file per rule group, tests named after rule IDs
│  ├─ bots/         # AI controllers: perception, planner, difficulty and personality profiles
│  └─ shared/       # input encoding, replay format, protocol types (for later)
├─ apps/
│  ├─ web/          # Vite + Phaser client: scenes, renderer, input adapters, audio, UI
│  ├─ mobile/       # Capacitor config + native projects (milestone M6)
│  └─ server/       # rooms / relay / matchmaking (milestone M5)
├─ tools/
│  └─ simbatch/     # headless bot-vs-bot runner → JSON/CSV balance reports
└─ docs/
```

## 5. Sim API (sketch)

```ts
type PlayerId = 0 | 1;

interface InputFrame {
  // quantized, ~6 bytes on the wire
  move: number; // int8 -128..127
  buttons: number; // bitflags: JUMP | HIT | THROW | FIRE | WEAPON_NEXT | ...
  aim: number; // uint16 angle (revenge turn / throw)
  power: number; // uint8
  fuse: number; // 1..5
}

interface MatchConfig {
  arena: ArenaId;
  scheme: SchemeId;
  pointsToWin: 7 | 11 | 21;
  bestOf: 1 | 3;
  timeLimitSec?: number;
  classicTargeting: boolean;
}

function createMatch(config: MatchConfig, seed: number): MatchState;
function step(state: MatchState, inputs: [InputFrame, InputFrame]): StepResult; // mutates + returns events
function hashState(state: MatchState): number; // desync detection and tests
function snapshot(state: MatchState): Snapshot; // rollback and replays
function restore(s: Snapshot): MatchState;

// helpers bots may use (pure, no hidden information)
function predictShuttle(state: MatchState, maxTicks: number): TrajectoryPoint[];
function simulateShot(
  state: MatchState,
  by: PlayerId,
  weapon: WeaponId,
  aim: number,
  power: number,
): ShotOutcome;
```

`MatchState.phase` is a state machine:
`PreMatch → Serve → Rally → RallyEnd → RevengeTurn → CrateDrop → Serve … → MatchOver`.

Rendering consumes `state` (interpolated) and `events` (for sounds, particles and screen
shake). The renderer never mutates the sim.

## 6. Bots

Bots implement the **same interface as a human**: `(observation) → InputFrame` per tick.
They see only what a human sees (positions, velocities, wind, ammo counts, fuse timers),
never the opponent's inputs.

**Rally brain (runs about every 6 ticks, plus a reaction delay):**

1. **Perceive:** take the shuttle state, then forward-simulate the landing point and the
   _intercept window_ (where and when it will be within reach). Error is injected
   according to difficulty.
2. **Move:** steer toward the intercept point, with a footwork-speed factor. Between shots,
   recover to the court's center.
3. **Choose a shot:** score candidate shots (smash, clear, drop, drive, lift) by simulating
   each and evaluating where the opponent is, how far they must run, and the risk of going
   out or into the net. Add noise by difficulty.
4. **Weapon IQ:** utility scores for loading or throwing. Examples: load a Frag when the
   opponent is deep and slow to reach the net; refuse to return a Shock Shuttle when HP is
   low and the score lead is safe; flee a Frag whose fuse is ending.

**Revenge brain:** grid-search angle × power × weapon through `simulateShot`, then pick
the maximum of `expectedDamage − selfRisk`, plus aim noise. As the target, predict the
incoming impact and move out of the radius.

| Knob                     | Easy       | Medium    | Hard         |
| ------------------------ | ---------- | --------- | ------------ |
| Reaction delay           | 300 ms     | 180 ms    | 90 ms        |
| Landing prediction error | ±0.8 m     | ±0.35 m   | ±0.1 m       |
| Footwork speed           | 75 %       | 90 %      | 100 %        |
| Shot accuracy noise      | High       | Medium    | Low          |
| Revenge aim noise        | ±12°       | ±5°       | ±1.5°        |
| Weapon IQ                | Random-ish | Heuristic | Full utility |

Personalities (Purist, Berserker, Balanced; see the design document §12) are weight
vectors on the utility scores.

### Bot vs Bot and the balancing pipeline

- **Watch mode** in the client: pick two bots, an arena and a scheme (or random), seed
  shown. Speed 0.5×–8×, pause and single-step, intent overlay (predicted landing point,
  chosen shot, utility scores).
- **`tools/simbatch`**, for example
  `npm run simbatch -- --a hard:berserker --b hard:purist --n 2000 --seed 1`.
  It runs headless in Node and reports the win rate, the **KO % versus points %**, average
  match duration, rally length, and damage and usage per weapon, with self-KO rate as a
  "dumb weapon" signal.
- **Balance targets** (checked in CI as warnings): for balanced vs balanced at the same
  difficulty, KO matches are 35–65 %, no weapon exceeds 30 % of total damage, the median
  match lasts 3–7 minutes, and rallies last 4–12 hits.

## 7. Multiplayer (designed now, built later)

1v1 real-time with precise timing has the same requirements as a fighting game, so the
industry answer applies: **rollback netcode** (GGPO-style) over a deterministic sim.

- Only inputs travel over the network (about 6 bytes per tick, delta-compressed and
  redundant).
- There is a local input delay of 2 ticks, and rollback/resimulation of up to 8 ticks.
  This requires `step()` to cost **under 0.3 ms**, which is tracked in a CI benchmark.
- Revenge Turns are turn-based and tolerate latency naturally.
- Peers exchange a **state hash every 60 ticks** to detect desyncs. On a mismatch, report
  it and resync from the host's snapshot.
- **Transport:** start with a **WebSocket relay server**. It works on all networks
  including mobile carrier NAT. WebRTC peer-to-peer data channels can be added later to
  cut latency.
- **Server roles (grown incrementally):**
  1. Private rooms with a 5-letter code, plus the relay.
  2. Quick-match queue by region (latency bucket).
  3. Accounts, Glicko-2 rating, and match history (Postgres).
  4. **Server-side replay verification** of ranked results, possible because of determinism.
- Local 2-player comes first. It exercises the "two input sources" path at no network cost.

## 8. Mobile (iOS / Android)

The plan is to be **mobile-ready from milestone M1, and mobile-shipped at milestone M6.**

- Touch controls are designed alongside keyboard controls (design document §10), not
  retrofitted.
- Landscape lock, safe-area insets (notch), 44 pt minimum touch targets, and multi-touch
  (move and hit simultaneously).
- **Performance budget:** 60 fps on a mid-range phone (iPhone 11 / Pixel 6a class), sim
  under 0.5 ms per tick, under 150 draw calls, initial download under 5 MB, and audio
  unlocked on first touch.
- **PWA first:** installable to the home screen, which gives early mobile playtesting
  without stores.
- **Capacitor** wraps the same build for the stores, adding haptics on hits and
  explosions, the status bar, splash screen and an app icon.
- Stores need: an age rating (cartoon violence, so PEGI 7/12 and ESRB E10+), a privacy
  policy (even with no data collection), screenshots, and an Apple developer account plus
  a Google Play console account.
- Cross-engine determinism (§1) is what allows iOS-versus-Android online play later.

## 9. Quality strategy

| Layer          | What is tested                                                                                                                          |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Sim unit tests | Every rule `R-xx` has at least one test named after it (for example, "R-27 detonation counts as landing below")                         |
| Physics tests  | Trajectory sanity (a clear lands deep, a drop lands short), no tunneling at 80 m/s, crater math                                         |
| Determinism    | The same seed and inputs give the same hash across Node, Chromium and WebKit, and after a snapshot/restore round trip                   |
| Bot soak       | Every pull request runs a 200-match bot-vs-bot batch: no exceptions, every match terminates, no NaN in state                            |
| Golden replays | Recorded matches replayed after a refactor must produce the same final hash (or the change is intended and the replays are re-recorded) |
| E2E smoke      | Playwright loads the game, starts Watch mode at 8×, and asserts the match-over screen appears                                           |
| Benchmark      | The cost of `step()` is tracked per pull request                                                                                        |

## 10. Technical risks

| Risk                                                                               | Mitigation                                                                                                                            |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Real-time badminton **doesn't feel good** (the main risk)                          | M1 is _only_ badminton, with a live tuning panel (drag, hit window, speeds). Weapons only go in once the rally is fun                 |
| Touch is too imprecise for timing hits                                             | A generous hit window, auto-facing, aim assist, and an optional landing marker. Playtest on a real phone at the end of M1 via the PWA |
| Cross-engine determinism bugs                                                      | A deterministic math library, the lint ban, and a CI hash comparison in WebKit and Chromium                                           |
| Weapons dominate, or are useless                                                   | Data-driven tuning and simbatch balance targets                                                                                       |
| Scope creep and infrastructure churn (the repo history shows this happened before) | Gameplay first. No backend until M5. Every milestone ends with something playable                                                     |
