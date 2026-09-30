import { ColyseusSDK, Callbacks, CloseCode, type Room } from "@colyseus/sdk";
import { Predict } from "@colyseus/sdk/predict";
import type { default as server } from "../app.config.js";
import type { HeroInput } from "../rooms/schema/DungeonState.js";
import { stepHero } from "../shared/movement.js";
import { generateDungeon, type Dungeon } from "../shared/dungeon.js";
import { INTERP_DELAY_MS, SNAP_DISTANCE, type GameMode } from "../shared/constants.js";
import { Renderer, HERO_COLORS, type ConnectionStatus, type HeroSprite, type SlimeSprite } from "./renderer.js";
import { Fx } from "./fx.js";

// Dev only: the debug panel (latency simulation, prediction telemetry). It
// must load before the SDK connects so it can patch the client; production
// builds drop it entirely.
const debugPanel = import.meta.env.DEV ? import("@colyseus/sdk/debug") : Promise.resolve();

const TOKEN_KEY = "neon-crypt:reconnection";

const canvas = document.getElementById("game") as HTMLCanvasElement;
const menuEl = document.getElementById("menu")!;
const menuMessageEl = document.getElementById("menu-message")!;
const renderer = new Renderer(canvas);

// The Cloudflare Pages build points at the shared demos server (.env.client); dev serves both from one origin.
const client = new ColyseusSDK<typeof server>(
  import.meta.env.VITE_SERVER_URL ?? `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`
);

type DungeonRoom = Room<(typeof server)["~rooms"]["dungeon"]["~room"]>;

// --- keyboard --------------------------------------------------------------

const held = new Set<string>();
/** Space is a tap: buffered here, consumed by exactly one input step. */
let attackQueued = false;

const GAME_KEYS = new Set(["arrowup", "arrowdown", "arrowleft", "arrowright", " "]);
addEventListener("keydown", (e) => {
  const key = e.key.toLowerCase();
  if (GAME_KEYS.has(key)) { e.preventDefault(); }
  if (key === " " && !e.repeat) { attackQueued = true; }
  held.add(key);
});
addEventListener("keyup", (e) => held.delete(e.key.toLowerCase()));
addEventListener("blur", () => held.clear());

/** Opposite keys cancel out, so the axis is always exactly -1, 0 or 1. */
function axis(negative: string[], positive: string[]): -1 | 0 | 1 {
  const back = negative.some((k) => held.has(k));
  const forward = positive.some((k) => held.has(k));
  if (back === forward) { return 0; }
  return back ? -1 : 1;
}

// --- menu ------------------------------------------------------------------

function showMenu(message = "") {
  menuMessageEl.textContent = message;
  menuEl.hidden = false;
}

for (const button of menuEl.querySelectorAll<HTMLButtonElement>("button[data-mode]")) {
  button.addEventListener("click", async () => {
    const mode = button.dataset.mode as GameMode;
    menuMessageEl.textContent = "Connecting…";
    try {
      await debugPanel;
      play(await client.joinOrCreate("dungeon", { mode }));
    } catch (e) {
      console.error(e);
      menuMessageEl.textContent = "Could not connect.";
    }
  });
}

// --- a session in one room -------------------------------------------------

async function play(room: DungeonRoom) {
  menuEl.hidden = true;
  // A reload within the 30s grace window resumes this same hero.
  sessionStorage.setItem(TOKEN_KEY, room.reconnectionToken);

  const fx = new Fx();
  let status: ConnectionStatus = "online";
  let running = true;

  room.onDrop(() => { status = "reconnecting"; });
  room.onReconnect(() => {
    status = "online";
    sessionStorage.setItem(TOKEN_KEY, room.reconnectionToken);
  });
  room.onLeave((code) => {
    status = "offline";
    running = false;
    sessionStorage.removeItem(TOKEN_KEY);
    showMenu(code === CloseCode.FAILED_TO_RECONNECT ? "Connection lost. Jump back in?" : "You left the dungeon.");
  });

  const predict = Predict.get(room, { mode: "lerp", delay: INTERP_DELAY_MS });

  // Other heroes and every slime are interpolated, never predicted. `snap`
  // pops respawns and floor changes instead of gliding across the map.
  predict.attachAll("heroes", { mode: "lerp", fields: ["x", "y"], smoothMs: 25, snap: SNAP_DISTANCE });
  predict.attachAll("slimes", { mode: "lerp", fields: ["x", "y"], smoothMs: 25, snap: SNAP_DISTANCE });

  const input = room.input<HeroInput>({ mode: "reliable" });
  if (input.tickRate === undefined) { throw new Error("server did not advertise a fixed tick rate"); }

  // The first patch is what creates our own hero.
  if (!room.state.heroes?.has(room.sessionId)) {
    await new Promise<void>((resolve) => room.onStateChange.once(() => resolve()));
  }

  // Walls come from the synced seed; the predicted step collides against them.
  let map: Dungeon = generateDungeon(room.state.seed);
  renderer.setMap(map);

  const self = room.state.heroes.get(room.sessionId);
  const me = predict.reconciler(self, {
    input,
    fields: ["x", "y", "facing", "cooldown"],
    snap: SNAP_DISTANCE,
    // The same function the server runs — determinism is the whole contract.
    step: (ctx, hero, command) => {
      const swung = stepHero(hero, command, map, ctx.dt);
      if (swung && !ctx.isReplay) { fx.swing(room.sessionId, performance.now()); }
    },
  });

  const callbacks = Callbacks.get(room);

  /** Where each entity was last drawn, so effects land where the player saw them. */
  const drawn = new Map<string, { x: number; y: number }>();

  callbacks.listen("seed", (seed) => {
    if (seed === map.seed) { return; }
    map = generateDungeon(seed);
    renderer.setMap(map);
    // A new floor is a discontinuity the reconciler can't see: restart from the server's pose.
    me.reset();
    fx.trails.clear();
  });

  callbacks.listen("floor", (floor, previous) => {
    if (previous === undefined || floor <= previous) { return; }
    fx.showBanner(`FLOOR ${floor}`, "the slimes grow bolder", "#8a5cff", performance.now());
  });

  callbacks.listen("stairsOpen", (open, previous) => {
    if (open && previous === false) {
      fx.showBanner("STAIRS OPEN", "every slime is dust — descend!", "#ffd84a", performance.now());
    }
  });

  callbacks.onAdd("heroes", (hero, id) => {
    callbacks.listen(hero, "hp", (hp, previous) => {
      if (previous === undefined || hp >= previous) { return; }
      const now = performance.now();
      fx.hurt(id, now);
      if (id === room.sessionId) {
        fx.damageAt = now;
        fx.shake(7, now);
      }
    });
    // Someone else's cooldown jumping up means they just swung. They are drawn
    // INTERP_DELAY_MS in the past, so their arc waits that long too.
    callbacks.listen(hero, "cooldown", (cooldown, previous) => {
      if (id === room.sessionId || previous === undefined || cooldown <= previous) { return; }
      fx.swing(id, performance.now() + INTERP_DELAY_MS);
    });
  });
  callbacks.onRemove("heroes", (_hero, id) => fx.forget(id));

  callbacks.onAdd("slimes", (slime, id) => {
    callbacks.listen(slime, "hp", (hp, previous) => {
      if (previous === undefined || hp >= previous) { return; }
      const now = performance.now();
      fx.flash(id, now);
      const at = drawn.get(id) ?? slime;
      fx.burst(at.x, at.y, "#caffd4", 8, 160, now);
      fx.shake(2.5, now);
    });
  });
  callbacks.onRemove("slimes", (_slime, id) => {
    fx.forget(id);
    drawn.delete(id);
  });

  room.onMessage("slain", ({ id, x, y }) => {
    const now = performance.now();
    const at = drawn.get(id) ?? { x, y };
    fx.burst(at.x, at.y, "#5dff7a", 26, 260, now);
    fx.burst(at.x, at.y, "#ffffff", 6, 120, now);
    fx.shake(4, now);
  });

  room.onMessage("downed", ({ id, x, y }) => {
    const now = performance.now();
    const hero = room.state.heroes.get(id);
    const at = drawn.get(id) ?? { x, y };
    fx.burst(at.x, at.y, HERO_COLORS[(hero?.color ?? 0) % 4], 40, 320, now);
    fx.shake(id === room.sessionId ? 12 : 5, now);
    if (id === room.sessionId) {
      fx.showBanner("DOWN!", "back to the entrance — the team loses a life", "#ff3d6e", now);
    }
  });

  room.onMessage("restart", () => {
    fx.showBanner("RUN LOST", "out of lives — back to floor 1", "#ff3d6e", performance.now());
  });

  let last = performance.now();

  function frame(now: number) {
    if (!running) { return; }

    // Drives prediction, interpolation and the reconciler, and returns how many
    // fixed steps came due — so input rate follows the simulation rate, not the
    // monitor's refresh rate.
    const steps = predict.tick(now);
    for (let i = 0; i < steps; i++) {
      input.data.moveX = axis(["a", "arrowleft"], ["d", "arrowright"]);
      input.data.moveY = axis(["w", "arrowup"], ["s", "arrowdown"]);
      input.data.attack = attackQueued;
      attackQueued = false;
      input.send();
    }

    fx.update(now - last, now);
    last = now;

    const heroes: HeroSprite[] = [];
    room.state.heroes.forEach((hero, id) => {
      const isSelf = id === room.sessionId;
      // Predicted for us, interpolated for everyone else — one read either way.
      const x = predict.value(hero, "x");
      const y = predict.value(hero, "y");
      drawn.set(id, { x, y });
      fx.trail(id, x, y, now);
      heroes.push({
        id, x, y,
        facing: isSelf ? me.state.facing : hero.facing,
        color: hero.color,
        hp: hero.hp,
        connected: hero.connected,
        self: isSelf,
      });
    });

    const slimes: SlimeSprite[] = [];
    room.state.slimes.forEach((slime, id) => {
      const x = predict.value(slime, "x");
      const y = predict.value(slime, "y");
      drawn.set(id, { x, y });
      fx.trail(id, x, y, now);
      slimes.push({ id, x, y, hp: slime.hp });
    });

    renderer.draw({
      now,
      floor: room.state.floor,
      lives: room.state.lives,
      mode: room.state.mode,
      stairsOpen: room.state.stairsOpen,
      heroes,
      slimes,
      ping: room.clock.smoothedRtt(),
      status,
    }, fx);

    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}

// --- boot --------------------------------------------------------------------

const token = sessionStorage.getItem(TOKEN_KEY);
if (token) {
  menuMessageEl.textContent = "Resuming your run…";
  debugPanel
    // Room name as a type argument only: passing it as the 2nd argument throws at runtime.
    .then(() => client.reconnect<"dungeon">(token))
    .then((room) => play(room))
    .catch((e) => {
      console.warn("could not resume the previous run:", e);
      sessionStorage.removeItem(TOKEN_KEY);
      showMenu();
    });
} else {
  showMenu();
}
