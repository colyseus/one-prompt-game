# Neon Crypt

A top-down co-op dungeon crawler for 2–4 players, built on Colyseus 0.18.
Each floor is a handful of rooms and corridors generated from a server seed;
clear out the slimes, take the stairs, go deeper.

This project was created with [⚔️ `create-colyseus-app`](https://github.com/colyseus/create-colyseus-app/).

## How to play

```
npm install
npm start
```

Open http://localhost:5173, pick **Normal** or **Hard**, then open a second tab
(or send the link to a friend on your network) to add another hero. Players who
pick the same mode share a dungeon, up to four per run.

| Key | Action |
| --- | --- |
| <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> or arrow keys | Move (8 directions) |
| <kbd>Space</kbd> | Swing your sword in the direction you face |

- **Slimes** chase the nearest hero and hurt on contact. A sword hit knocks
  them back; two hits kill one.
- **Heroes** have 3 HP. A hero at 0 HP is downed and respawns at the entrance
  (the dashed ring), costing the team one of its **5 shared lives**.
- **Kill every slime** on a floor to open the **stairs**. Any hero stepping on
  them takes the whole team down a floor, healed, into a bigger slime pack.
- **Out of lives**, the run restarts on floor 1.
- **Hard** mode makes slimes much faster.
- **Dropped connection?** Your hero waits for you for 30 seconds, shown as
  *offline*. The game reconnects by itself; reloading the tab resumes the run
  too.

The HUD shows the floor, shared lives, every hero's HP, your ping and your
connection status.

### Simulating latency

In development (`npm start`) the Colyseus debug panel is loaded. Use its
latency controls, or run `__net(150, 30)` in the browser console
(150 ms round trip ± 30 ms jitter; `__net()` turns it off), to see prediction
at work: your own hero still responds instantly, and the Predict panel should
keep reporting the reconciler as *matched*.

## Structure

- `src/app.config.ts`: server configuration — rooms, HTTP routes, express middleware
- `src/rooms/DungeonRoom.ts`: the authoritative game — input, slimes, damage, lives, floors
- `src/rooms/schema/DungeonState.ts`: the state synchronized to every client, and the input schema
- `src/shared/`: code both sides run — the seeded dungeon generator, collision and the hero step
- `src/client/`: the browser game — prediction and input (`index.ts`), canvas drawing and HUD (`renderer.ts`), effects (`fx.ts`)
- `test/DungeonRoom.test.ts`: boots the real server and connects real clients
- `loadtest/example.ts`: scriptable client for `npm run loadtest`
- `ecosystem.config.cjs`: pm2 configuration, used when deploying to Colyseus Cloud

## Scripts

- `npm start`: run Vite on http://localhost:5173 — client, server and playground on one port, with HMR
- `npm test`: run the mocha test suite
- `npm run build`: build client (`dist/client/`) and server (`dist/server/`)
- `npm run loadtest`: connect N simulated clients with [`@colyseus/loadtest`](https://github.com/colyseus/colyseus-loadtest/)

## How it works

### Single Vite project

Client, server and shared code live in one project on one port. `npm start`
runs Vite with the `colyseus/vite` plugin: it boots the server in-process and
hot-reloads your rooms when you edit them, so there is no second terminal and no
build step in development.

`npm run build` produces both halves — `dist/client/` and `dist/server/server.mjs`.
`npm run build:client` skips the server, for deploying the client to a static
host while the server runs elsewhere.

Express runs *in front of* Vite in development, so `/` belongs to the client and
the playground lives at `/playground`.

- https://docs.colyseus.io/server/vite

### Seed, not tiles

`state.seed` is the only thing synchronized about the map. `generateDungeon()`
in `src/shared/dungeon.ts` turns it into rooms, corridors, an entrance and the
stairs with a seeded PRNG (mulberry32), so the server and every client build
the same walls. The next floor is just a new seed.

### Fixed tick + client prediction

The room advances on `setFixedTimestep()` at 30 Hz: every `step()` advances
exactly `1/30` s, which is what lets the client replay the same steps.

`defineInput(HeroInput, …)` gives each client a server-side input buffer, and
`sanitize` clamps every field as it arrives. The input is three fields — two
movement axes and an `attack` tap — with no sequence number or timestamp: the
engine's own counter is the sequence, and one input advances exactly one step.

`stepHero()` in `src/shared/movement.ts` is the one function both sides run:
movement, wall collision against the seeded map, facing, and the sword
cooldown, counted in steps. It is pure — no clocks, no randomness, no reads
outside its arguments — so the client predicts it exactly.

Only your own hero is predicted (`predict.reconciler`). Other heroes and all
slimes are interpolated 100 ms in the past (`mode: "lerp"`). Everything that
decides the game — what a swing hits, damage, lives, floors — runs on the
server only. Sword hits are lag-compensated with `allowRewindState()`: the
server rewinds slimes to where your screen showed them when you pressed Space.

- https://docs.colyseus.io/netcode/server-input
- https://docs.colyseus.io/netcode/client-prediction
- https://docs.colyseus.io/netcode/lag-compensation

### filterBy

`.filterBy(["mode"])` on the room definition splits matchmaking by the `mode`
join option, so Normal and Hard players never land in the same dungeon.

- https://docs.colyseus.io/matchmaker

### Reconnection

`DungeonRoom.onDrop()` holds a dropped client's seat for 30 seconds via
`allowReconnection()`, and marks the hero offline (slimes ignore offline
heroes). The SDK retries automatically with exponential backoff; `onReconnect()`
fires if it gets back in time, `onLeave()` if it does not. The client also keeps
the reconnection token in `sessionStorage`, so a page reload rejoins the same
hero with `client.reconnect()`.

- https://docs.colyseus.io/room/reconnection
