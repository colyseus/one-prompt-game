# How this was made

This repository is the unedited output of one prompt, run once, by a fresh AI coding agent
session in an empty folder. It's the proof behind [colyseus.io/ai](https://colyseus.io/ai).

| | |
|---|---|
| Prompt | [`PROMPT.md`](PROMPT.md), the "Co-op dungeon" preset, also at [colyseus.io/ai/prompts/coop-dungeon.txt](https://colyseus.io/ai/prompts/coop-dungeon.txt) (sha256 `c9743d789cab7ce16c965f5cf9cd87f0ac1e45f44e79db76735cd8c553613baf`) |
| Agent | Claude Code 2.1.286, headless (`claude -p`), model Claude Opus 5.5 (`claude-opus-5-5[1m]`), macOS, Node.js 22.19.0 |
| Date | 2026-09-30, prompt at 19:24:26 UTC, agent's commit at 19:45:17 UTC: **21 min**, including the agent's own headless-browser playtests (session total 21 min 10 s, 112 turns) |
| Attempts | 1 |
| Follow-up messages | 0 |
| Human edits to the code | 0 |
| Result | 19 files changed, +1878 / −338 (`package-lock.json` excluded), 9 tests passing, no new dependencies |
| Resolved versions | colyseus 0.18.8, @colyseus/core 0.18.18, @colyseus/auth 0.18.4, @colyseus/schema 5.0.35, @colyseus/sdk 0.18.4, vite 8.3.1 |

## How it was run

```sh
mkdir run-1 && cd run-1
claude -p --output-format stream-json --verbose \
  --permission-mode acceptEdits \
  --allowedTools Bash Read Edit Write Glob Grep WebFetch WebSearch TodoWrite Skill Agent \
  < ../PROMPT.md
```

The prompt went in on stdin, byte for byte, with nothing before or after it. Headless mode can't
ask for permission, so the tools were pre-approved instead.

## History

- `a7a48c5` Initial commit: the untouched `create-colyseus-app` scaffold (`--git`).
- `5cd09b9`, tag `one-prompt-v1`: everything the agent wrote. [Diff](../../compare/a7a48c5...5cd09b9).
- Later commits only add this file, `PROMPT.md` and the MIT license (plus the matching `license`
  field in `package.json`); the code is exactly as the agent left it.

## Disclosures

- The session loaded the operator's global Claude Code setup, as any session on that machine
  would: instructions about comment and commit-message style (hence the `Assisted-by` trailer),
  personal skills, and claude.ai connectors (none were used).
- Environment variables from the Claude Code session that launched the run were removed, so it
  ran as a standalone session.
- The Colyseus skill was installed one level up (`../.claude/skills/colyseus`), so it isn't part of this repo.
- Outside its folder, the agent downloaded a few docs pages and installed `puppeteer-core` under
  `/tmp` for its own playtests.

## Independent check

After the run, from a fresh clone:

- `npm ci && npx tsc --noEmit && npm test && npm run build`: all pass, 9 tests.
- With `npm start` running, two `@colyseus/sdk` clients join `dungeon` with `{ mode: "normal" }`
  and land in the same room; each sees both heroes, and one client's input moves its hero in the
  other client's state.
- A grep of `src/` and `test/` for pre-0.18 APIs (`colyseus.js`, `getStateCallbacks`, `client.id`,
  `onLeave(client, consented)`, …) finds nothing, and the shared code never calls `Math.random`
  or `Date.now`.

The clip on colyseus.io/ai is two Chrome windows at 150 ms ± 20 ms simulated round trip (the SDK
debug panel's latency simulator), each driven by a small keyboard bot that reads the canvas.
