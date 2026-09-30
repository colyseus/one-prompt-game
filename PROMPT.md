Build a small multiplayer browser game with Colyseus 0.18. Work autonomously until every
"Done when" item passes; don't stop to ask me questions.

Setup (start in an empty folder):
1. Install the official Colyseus agent skill:
   npx skills add colyseus/skill -y -a <your agent: claude-code | codex | cursor | gemini-cli | github-copilot>
   If that fails: git clone --depth 1 https://github.com/colyseus/skill .agents/skills/colyseus
   Read its SKILL.md in full now, plus the bundled reference for any area you touch, and trust it
   over your memory: most Colyseus code you were trained on predates 0.18. Without the skill,
   use https://docs.colyseus.io/llms.txt (append .md to any docs URL for Markdown).
2. Scaffold: npm create colyseus-app@latest my-game -- --layout vite --netcode fixed --matchmaking filterby,reconnection --git --yes
   Work inside my-game/. Read its README and every generated file first; extend them, don't rewrite.

Game: a top-down co-op dungeon for 2-4 players. Each floor fits on one screen: a few rooms joined
by corridors, generated from a server seed. WASD/arrows move, Space swings a sword in the direction
you face. Slimes chase the nearest hero and hurt on contact; heroes have 3 HP, and the team shares
5 lives (a downed hero respawns at the entrance; at 0 lives the run restarts on floor 1). Killing
every slime opens the stairs, and each floor adds more slimes. Join with { mode: "normal" | "hard" }
(hard = faster slimes). Draw it on a <canvas> with a HUD: floor, shared lives, each hero's HP, your
ping (room.clock.smoothedRtt()) and connection status.

Rules:
- The server is authoritative: clients only send input; the room validates and simulates.
- Keep the scaffold's setFixedTimestep loop, defineInput + sanitize, and the pure step function in
  src/shared/. Hero movement and the sword cooldown live in that step so they are predicted exactly:
  count cooldowns in ticks; no Math.random, Date.now, or reads outside its arguments.
- Generate the map in src/shared/ from the seed with a seeded PRNG, so client and server build the
  same walls and your predicted movement collides exactly like the server's. Sync the seed, not
  the tiles.
- Predict only your own hero; interpolate other heroes and every slime. Hits, damage, lives and
  floors are decided by the server only.
- Keep reconnection: a dropped tab keeps its hero for 30 s.
- In development only, import "@colyseus/sdk/debug" so latency can be simulated from its panel.
- Make it feel good: a dark neon look, one color per player, short trails, hit flashes and a
  little screen shake. No new dependencies unless the game line asks for one.

Done when:
- npx tsc --noEmit, npm test and npm run build all pass.
- npm test covers: two clients join and each sees the other move; a sword swing damages a slime in
  reach; killing every slime on a floor opens the stairs (you may place entities directly in the
  server room's state).
- npm start (run it in the background, stop it afterwards) serves the game on http://localhost:5173.
- Nothing from the skill's "Do not write" column appears in src/ or test/.
- README.md has a "How to play" section, and all work is committed with a clear message.
