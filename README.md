# Slime Dungeon

A cute 3D co-op dungeon crawler for 2–4 players, built on Colyseus 0.18 and
three.js. Descend through procedurally generated floors, bonk slimes with your
sword, and share one pool of hearts with the rest of the party.

## Play

```
npm start
```

Open http://localhost:5173 in two or more tabs (or browsers). Add `?mode=hard`
for fewer hearts and more, faster slimes; hard and normal parties never share a
room.

- **WASD / arrow keys**: move. **Space**: swing (hold to keep swinging).
- Every slime that touches a hero costs the party one shared heart. At zero
  hearts the run restarts on a fresh dungeon.
- The stairs open once someone grabs the floor's key **or** the floor is
  cleared. Step on them to take the whole party down, and earn a heart back.
- Floors get bigger, with more and faster slimes. Blue ones appear on floor 2
  and pink ones on floor 3, and a king slime guards the stairs on every third
  floor.

### Trying it under latency

In development the client loads `@colyseus/sdk/debug`. The on-page panel shows
per-reconciler drift (✓ matched / ~ jitter / ✗ diverging) and lets you tune
interpolation. From the console, `__net(150, 30)` simulates 150 ms RTT ± 30 ms
jitter, and `__net()` turns it off. Your own hero should still respond
instantly, other heroes and slimes stay smooth, and swings still land on the
slime you see.

Walking and swinging should keep the reconciler at 0 drift at any latency.
Getting hit by a slime is the exception: the server shoves your hero, so you'll
see one correction spike per hit. Persistent drift with nobody getting hit
would mean the client and server steps have diverged.

## How the netcode fits together

| Concern | Where |
| --- | --- |
| One deterministic hero step, shared by server and client | `src/shared/movement.ts` (`stepHero`) |
| Floor layout from `(seed, floor)`, rebuilt by every client | `src/shared/dungeon.ts` |
| Authoritative room: inputs, slimes, lives, floors | `src/rooms/DungeonRoom.ts` |
| Prediction, interpolation, optimistic hit feedback | `src/client/index.ts` |

- **Fixed tick, buffered input.** The room runs `setFixedTimestep()` at 30 Hz
  and consumes each client's inputs from `defineInput(HeroInput)`, applying
  `stepHero` once per input. `sanitize` clamps the movement axes, because
  nothing off the wire is trusted.
- **Only the seed is synced.** The tile grid never crosses the wire: the state
  carries `seed` and `floor`, and `generateDungeon()` is a pure function of
  them. The predicted hero therefore collides against exactly the walls the
  server uses.
- **Your hero is predicted.** `predict.reconciler()` runs the same `stepHero`
  locally the moment an input is sent, then rolls back and replays
  unacknowledged inputs whenever a patch acknowledges one. Knockback from a
  slime is just a velocity on the hero that `stepHero` integrates, so a
  server-side shove replays cleanly. Hero positions are `float64`, so the
  reconciler adopts them bit for bit. `t.number()` would quietly drop to
  float32.
- **Everyone else is interpolated.** Other heroes and slimes render 100 ms in
  the past (`mode: "lerp"`). A `snap` threshold makes a floor change pop instead
  of gliding across the map.
- **Sword hits are lag-compensated.** Slime positions are recorded with
  `allowRewindState()`. When a swing starts, the server tests the arc against
  `rewind.lastSeenBy(attacker)`, which is where that player's screen was
  drawing the slimes. The input's render-time stamp is bound to the same 100 ms
  interpolation delay, so the drawn position and the rewound one agree.
- **Hits feel instant.** The client also judges its own swing against the
  slimes as last drawn, and flashes them through `predict.defineEvent()`. The
  server's hp drop confirms the prediction; a hit nobody predicted (someone
  else's) plays when it arrives.

## Structure

- `src/app.config.ts`: server configuration. Registers the `dungeon` room with
  `filterBy(["mode"])`
- `src/rooms/DungeonRoom.ts`: the authoritative game
- `src/rooms/schema/DungeonState.ts`: synchronized state and the input schema
- `src/shared/`: code both sides run (step, dungeon generator, combat, slime
  stats)
- `src/client/`: three.js renderer, HUD, controls, sound
- `test/DungeonRoom.test.ts`: boots the real server and connects real SDK
  clients
- `test/shared.test.ts`: determinism and generation checks for the shared code

## Scripts

- `npm start`: run Vite. Client and server share one port, with HMR
- `npm test`: run the mocha test suite
- `npm run build`: build the client (`dist/client/`) and the server
  (`dist/server/`)
- `npm run loadtest`: connect N simulated clients with
  [`@colyseus/loadtest`](https://github.com/colyseus/colyseus-loadtest/)

## Reconnection

`DungeonRoom.onDrop()` holds a dropped player's seat for 30 seconds. Their
hero stays in the dungeon, ghosted and ignored by slimes, while the SDK retries.
`onLeave()` removes the hero only once they're gone for good.

- https://docs.colyseus.io/netcode
- https://docs.colyseus.io/room/reconnection
