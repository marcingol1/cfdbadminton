# Deadminton — Roadmap and Scope for Approval

Read with `GAME_DESIGN.md` (what we build) and `TECHNICAL_PLAN.md` (how we build it).

## Proposed scope to approve now: **MVP = M0 → M3**

A web game, playable in the browser, with these features:

- ✅ Full badminton rules plus deadly weapons, and both win conditions (points and KO)
- ✅ **vs Bot**: 3 difficulties and 3 personalities
- ✅ **Bot vs Bot** Watch mode, including title-screen attract mode, plus a headless balance runner
- ✅ Local 2-player (cheap, because the input abstraction is shared)
- ✅ Architecture ready for online play and mobile (a deterministic sim, touch-ready input)
- ❌ Not in the MVP: online play, store builds, accounts, doubles, more than 2 arenas

## Milestones

Each milestone ends with something **playable** and a passing CI run.
Sizes are relative: S < M < L.

### M0 — Foundations (S) — ✅ done

- Remove the 2020 Nest scaffold. Set up an npm workspaces monorepo: `packages/sim`,
  `packages/bots`, `apps/web`, `tools/simbatch`.
- TypeScript strict, Vite, Vitest, ESLint (with the determinism ban rule), Prettier,
  GitHub Actions CI.
- Sim skeleton: fixed-timestep loop, seeded PRNG, deterministic math, `hashState`, and a
  snapshot/restore round-trip test.
- **Done when:** `npm run dev` shows an empty court rendered from sim state, and CI is green.

### M1 — "Just Badminton" (L) ← the most important milestone — ✅ done (playtested and approved 2026-10-09; gameplay kept as is)

- Court, net, the Hall arena, shuttle physics with drag and wind, player movement and
  jumping, the hit model with shot types and timing quality.
- Serve rules (R-10…R-14), rally rules (R-20…R-26, R-29), scoring, and point victory (R-01).
- A simple bot that predicts the landing point and returns shots.
- Keyboard, gamepad and **touch** controls, plus the PWA manifest for phone playtesting.
- A live tuning panel (dev only) for drag, speeds and the hit window.
- **Done when:** a "Purist" match against the bot is _fun_, playtested on desktop and on a
  phone. **Go/no-go gate:** we don't add weapons until rallies feel good.

### M2 — "Deadly" (L) — ✅ done (playtested; Revenge Turns made optional and random)

- HP, damage, knockback, death, KO victory and the double-KO rules (R-02…R-07).
- The terrain heightmap and craters. The Rooftop arena with pits.
- Loaded shots: Frag (with fuse), Shock, Lead, Cluster, Ghost. The mine throwable.
- The Revenge Turn (R-40…R-45) with Rocket, Mortar, Homing and Air Strike, plus the
  Medkit and Shield.
- Weapon delay, ammo, schemes (Purist / Standard / Chaos), supply crates.
- All tuning values in `data/*.json`.
- **Done when:** every rule `R-xx` has a passing test, and a human can win against a
  Medium bot either by points or by KO.

### M3 — Bots and Showcase (M) — ✅ built

- Full bot brain: intercept planning, shot scoring, weapon utility, Revenge aiming search,
  dodging. _(built during M2)_
- Difficulty profiles (Easy / Medium / Hard) × **personalities** (Purist / Balanced /
  Berserker), selectable in the menu and in `simbatch` (`--a hard:berserker`).
- **Watch mode** (speed 0.5×–8×, pause/step, intent overlay, seed), and attract mode on
  the title screen.
- `tools/simbatch` with a balance report.
- **Replays**: every match is recorded (seed, settings, run-length-encoded inputs, final
  state hash). Save to a file, load a file, rewatch the last match; playback verifies it
  reproduced the original exactly.
- Local 2-player.
- **Browser smoke tests in CI** (Playwright): menu, a game vs a bot, a full bot match and
  its verified replay.
- FPS counter (F3 / pause menu).
- **Done when:** a 2000-match batch runs cleanly, the balance targets are met, and Watch
  mode is fun to watch. _Result: 2000 Medium Balanced vs Medium Balanced matches, 0
  unfinished, wins 993–1007, 57.8% by KO (target 35–65%)._

**→ MVP release:** deploy the web build to Vercel (production from `master`, a preview for every PR).

### M4 — Polish (M)

Art pass (sprites, animation, particles), audio and music, game feel (hit-stop, slow
motion on KO, screen shake with an option to reduce it), menus and settings, key
remapping, accessibility (a colorblind-safe palette, a game-speed assist), a tutorial,
and challenges.

### M5 — Online multiplayer (L)

`apps/server` (Node + ws): private rooms with codes, and a relay. Rollback netcode in the
client. Desync detection. Then a quick-match queue. Later: accounts, Glicko-2 rating, and
server-verified replays.

### M6 — Mobile store builds (M)

Capacitor iOS and Android projects, haptics, performance profiling on low-end devices,
store listings, age rating, privacy policy, TestFlight and Play internal testing.

### Later backlog

Doubles 2v2, character classes, more arenas, a destructible net, cosmetics, a campaign,
a level editor, online spectating.

## Decisions (approved 2026-10-09)

| #   | Decision                 | Outcome                                                                                                                                                                               |
| --- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Core loop                | ✅ **Real-time rallies.** Worms-style Revenge Turns are an **option, off by default**; when on, a lost point triggers one at random (~18%, Chaos ~40%). Changed after M2 playtesting. |
| D2  | Revenge target           | ✅ **May move and dodge.** "Classic targeting" (frozen target) is a match option                                                                                                      |
| D3  | Default match length     | ✅ **11 points, win by 2, cap 15, single game**                                                                                                                                       |
| D4  | Existing NestJS scaffold | ✅ **Removed in M0.** Written from scratch; only the idea stays                                                                                                                       |
| D5  | Engine                   | ✅ **TypeScript + Phaser + custom sim + Capacitor**                                                                                                                                   |
| D6  | Art direction            | ✅ **Pixel art.** See `GAME_DESIGN.md` §15. All MVP art is drawn in code; no external assets are needed                                                                               |
| D7  | Web hosting              | ✅ **Vercel**: production from `master`, preview deployments for every pull request                                                                                                   |
| D8  | Name                     | ✅ (default) **"Deadminton"**, still a working title                                                                                                                                  |
