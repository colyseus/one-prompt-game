Build a multiplayer browser game with Colyseus 0.18. Work on your own until it's done; don't ask
me questions.

First, in an empty folder:
1. npx skills add colyseus/skill -y, then read its SKILL.md: it's newer than what you know about
   Colyseus. (No skills support? Use https://docs.colyseus.io/llms.txt instead.)
2. npm create colyseus-app@latest my-game -- --layout vite --netcode fixed --matchmaking filterby,reconnection --git --yes
   Build on the scaffold inside my-game/ rather than replacing it.

Game: A top-down co-op dungeon for 2-4 players. progressively harder floors generated from a server
seed, slimes that chase the nearest hero, a sword on Space, shared lives, and stairs that open once
a floor is cleared or key is found. 3d, cute looks

Netcode: the server is authoritative. Predict your own hero locally, running the same step function
on client and server, so it moves instantly; interpolate everything else; lag-compensate sword
hits so they land where the attacker saw the slime. Load @colyseus/sdk/debug in development to
try it under latency.

Done when npx tsc --noEmit, npm test and npm run build pass and everything is committed.
Tests should cover two clients seeing each other move and a sword swing damaging a slime.
