# How this was made

This repository is the unedited output of one prompt, given to a fresh AI coding agent session
in an empty folder. It's the proof behind [colyseus.io/ai](https://colyseus.io/ai).

| | |
|---|---|
| Prompt | [`PROMPT.md`](PROMPT.md), the "Co-op dungeon" preset, also at [colyseus.io/ai/prompts/coop-dungeon.txt](https://colyseus.io/ai/prompts/coop-dungeon.txt) (sha256 `9f088c5bbd0b688b72354df1f44af579025885615871da595310f47666715241`) |
| Agent | Claude Code 2.1.286, headless (`claude -p`), model Claude Opus 5.5 (`claude-opus-5-5[1m]`), macOS, Node.js 22.19.0 |
| Date | 2026-10-01, prompt at 13:22:23 UTC, agent's last commit at 13:56:28 UTC: **34 min**, including the agent's own headless-browser playtests (session total 34 min 39 s, 134 turns) |
| Attempts | 2, see below |
| Follow-up messages | 0 |
| Human edits to the code | 0 |
| Result | 27 files changed, +2869 / −391 (`package-lock.json` excluded), 13 tests passing; added `three` and `@types/three` for the 3D look the prompt asks for |
| Resolved versions | colyseus 0.18.9, @colyseus/core 0.18.18, @colyseus/auth 0.18.4, @colyseus/schema 5.0.35, @colyseus/sdk 0.18.4, vite 8.3.2, three 0.186.1 |

## Attempts

The same prompt was run twice, each time as a brand-new session in its own empty folder.

1. **Lost to a network outage.** After 45 minutes the session failed with `API Error: Can't reach
   the API server — check your internet or DNS (ENOTFOUND)`, during its final browser checks and
   before committing. It was not resumed or finished by hand.
2. **This repository.** Same prompt, byte for byte, from scratch.

## How it was run

```sh
mkdir run-2 && cd run-2
claude -p --output-format stream-json --verbose \
  --permission-mode acceptEdits \
  --allowedTools Bash Read Edit Write Glob Grep WebFetch WebSearch TodoWrite Skill Agent \
  < ../PROMPT.md
```

The prompt went in on stdin, byte for byte, with nothing before or after it. Headless mode can't
ask for permission, so the tools were pre-approved instead.

## History

- `a4d1657` Initial commit: the untouched `create-colyseus-app` scaffold (`--git`).
- `5a920bd` and `694daaa`, tag `one-prompt-v1`: everything the agent wrote, in its own two commits.
  [Diff](../../compare/a4d1657...694daaa).
- Later commits on `main` only add this file, `PROMPT.md` and the MIT license (plus the matching
  `license` field in `package.json`); the code is exactly as the agent left it.
- The `production` branch adds what the live demo needs on top: the server URL for the static
  client, a health route, and the pm2/nginx deploy scripts for the shared demos server.

An earlier, longer version of this prompt produced Neon Crypt, kept under the tag `neon-crypt-v1`.

## Disclosures

- The session loaded the operator's global Claude Code setup, as any session on that machine
  would: instructions about comment and commit-message style, personal skills, and claude.ai
  connectors (none were used).
- Environment variables from the Claude Code session that launched the run were removed, so it
  ran as a standalone session.
- The Colyseus skill was installed one level up (`../.agents/skills/colyseus`), so it isn't part of this repo.
- Outside its folder, the agent fetched four docs pages, installed `puppeteer-core` under
  `/tmp/browser-tools` for its own playtests, and stopped Vite dev servers with
  `pkill -f "node_modules/.bin/vite"`, which matches any Vite dev server on the machine.

## Independent check

After the run, from a fresh clone:

- `npm ci && npx tsc --noEmit && npm test && npm run build`: all pass, 13 tests.
- With `npm start` running, two `@colyseus/sdk` clients join `dungeon` with `{ mode: "normal" }`
  and land in the same room; each sees both heroes, and one client's input moves its hero in the
  other client's state.
- Prediction (`Predict.get`, `predict.reconciler`) and lag compensation (`allowRewindState`,
  `rewind.lastSeenBy`) use the 0.18 netcode APIs; a grep of `src/` and `test/` for pre-0.18 APIs
  finds nothing, and the shared code never calls `Math.random` or `Date.now`.

The clip on colyseus.io/ai is two Chrome windows at 150 ms ± 20 ms simulated round trip (the SDK
debug panel's latency simulator), each driven by a small keyboard bot. The bot reads positions from
the dev build's `globalThis.room`, path-finds over the game's own `generateDungeon()` map, and plays
only through key presses.
