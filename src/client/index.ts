import { ColyseusSDK, Callbacks, CloseCode } from "@colyseus/sdk";
import { Predict, type StepContext } from "@colyseus/sdk/predict";
import type { default as server } from "../app.config.js";
import type { HeroInput } from "../rooms/schema/DungeonState.js";
import { generateDungeon, type Dungeon } from "../shared/dungeon.js";
import { HERO_SIM_FIELDS, stepHero, type HeroCommand, type HeroSim } from "../shared/movement.js";
import { swordHits } from "../shared/combat.js";
import { SLIME_KINDS } from "../shared/slimes.js";
import { Controls } from "./controls.js";
import { Sfx } from "./audio.js";
import { Hud, type MapDot, type PartyMember } from "./hud.js";
import { Stage } from "./render/stage.js";
import { LevelView } from "./render/level.js";
import { Particles } from "./render/particles.js";
import { HeroView, SEAT_COLORS } from "./render/heroView.js";
import { SlimeView, SLIME_COLORS } from "./render/slimeView.js";

/**
 * Remotes render this far in the past. The same number is the interp term of
 * the lag-comp stamp on every input, so the server rewinds slimes to exactly
 * where they were drawn.
 */
const INTERP_DELAY_MS = 100;

/** Larger than any legit per-patch move, smaller than a floor change: pop, don't glide. */
const TELEPORT_SNAP = 3;

const hud = new Hud();
const sfx = new Sfx();

async function main() {
  // Dev panel + network simulator: `__net(150, 30)` in the console = 150ms RTT ± 30ms.
  if (import.meta.env.DEV) { await import("@colyseus/sdk/debug"); }

  // The Cloudflare Pages build points at the shared demos server (.env.client); dev serves both from one origin.
  const client = new ColyseusSDK<typeof server>(
    import.meta.env.VITE_SERVER_URL ?? `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`,
  );
  const mode = new URLSearchParams(location.search).get("mode") === "hard" ? "hard" : "normal";
  const room = await client.joinOrCreate("dungeon", { mode });
  if (import.meta.env.DEV) { Object.assign(globalThis, { room }); } // poke at it from the console

  // The first patch is what creates our own hero.
  await new Promise<void>((resolve) => room.onStateChange.once(() => resolve()));
  hud.setStatus(null);

  // --- world -----------------------------------------------------------------

  const stage = new Stage(document.getElementById("game")!);
  const level = new LevelView();
  const particles = new Particles();
  stage.scene.add(level.group, particles.mesh);

  // Only (seed, floor) is synced: every client regenerates the same layout, and
  // the predicted hero collides against it exactly like the server's does.
  let dungeon: Dungeon = generateDungeon(room.state.seed, room.state.floor);
  let snapCamera = true;
  level.build(dungeon);
  hud.buildMinimap(dungeon);
  hud.setFloor(dungeon.floor);
  hud.banner(`Floor ${dungeon.floor}`, "Find the key — or clear out every slime!");

  // onStateChange fires once the whole patch is applied, before the next
  // predict.tick() reconciles — so replays already run on the new floor.
  room.onStateChange(() => {
    const { seed, floor } = room.state;
    if (seed === dungeon.seed && floor === dungeon.floor) { return; }
    const restarted = seed !== dungeon.seed;
    dungeon = generateDungeon(seed, floor);
    level.build(dungeon);
    hud.buildMinimap(dungeon);
    hud.setFloor(floor);
    hud.banner(restarted ? "A fresh dungeon" : `Floor ${floor}`, restarted ? "Back to floor 1 — good luck!" : floorFlavor(floor));
    snapCamera = true;
  });

  // --- netcode -----------------------------------------------------------------

  const predict = Predict.get(room, { mode: "lerp", delay: INTERP_DELAY_MS });
  predict.attachAll("heroes", { mode: "lerp", fields: ["x", "y"], snap: TELEPORT_SNAP });
  // No output spring (smoothMs 0): slimes are drawn exactly where the server's
  // lag-compensated rewind will look for them.
  predict.attachAll("slimes", { mode: "lerp", fields: ["x", "y"], snap: TELEPORT_SNAP });

  const input = room.input<HeroInput>();
  const self = room.state.heroes.get(room.sessionId)!;

  const heroViews = new Map<string, HeroView>();
  const slimeViews = new Map<string, SlimeView>();
  const fadingSlimes = new Set<SlimeView>();

  /** Optimistic hit feedback: flash on our own swing, settle when the server's hp drops. */
  const hits = predict.defineEvent<string>({
    label: "sword hits",
    onPredict: (id) => slimeHitFx(id),
    // Someone else's hit, or one we didn't call: play it when it arrives.
    onUnpredicted: (id) => { if (typeof id === "string") { slimeHitFx(id); } },
  });

  const me = predict.reconciler(self, {
    input,
    fields: HERO_SIM_FIELDS,
    snap: TELEPORT_SNAP,
    // The same step the server runs, against the same generated floor.
    step: (ctx, hero, command) => {
      if (stepHero(dungeon, hero, command, ctx.dt) && !ctx.isReplay) { ownSwing(ctx, hero); }
    },
  });

  function ownSwing(ctx: StepContext, hero: HeroSim) {
    heroViews.get(room.sessionId)?.startSwing();
    sfx.swing();
    // Judge against the slimes as last drawn on screen — the instant the
    // server rewinds to — so a hit lands visually without waiting a round trip.
    for (const [id, view] of slimeViews) {
      const slime = room.state.slimes.get(id);
      if (!slime || slime.hp === 0) { continue; }
      const { x, z } = view.root.position;
      if (swordHits(dungeon, hero.x, hero.y, hero.facing, x, z, SLIME_KINDS[slime.kind].radius)) {
        ctx.predict(hits, id);
      }
    }
  }

  function slimeHitFx(id: string) {
    const view = slimeViews.get(id);
    if (!view) { return; }
    view.hit();
    sfx.hit();
    const { x, z } = view.root.position;
    for (let i = 0; i < 6; i++) {
      particles.spawn(x, 0.4, z, (Math.random() - 0.5) * 5, 2 + Math.random() * 2, (Math.random() - 0.5) * 5,
        "#fff4b0", 0.05, 0.3, 6);
    }
  }

  // --- entities ------------------------------------------------------------------

  const callbacks = Callbacks.get(room);

  callbacks.onAdd("heroes", (hero, sessionId) => {
    const view = new HeroView(hero.seat, hero.name, sessionId === room.sessionId);
    heroViews.set(sessionId, view);
    stage.scene.add(view.root);

    if (sessionId !== room.sessionId) {
      // A remote swing shows up in `swing` jumping back up; delay it to line up
      // with that hero's interpolated (past) position.
      callbacks.listen(hero, "swing", (swing, previous) => {
        if (previous !== undefined && swing > previous) { view.startSwing(INTERP_DELAY_MS / 1000); }
      });
    }
  });

  callbacks.onRemove("heroes", (_hero, sessionId) => {
    const view = heroViews.get(sessionId);
    if (!view) { return; }
    stage.scene.remove(view.root);
    view.dispose();
    heroViews.delete(sessionId);
  });

  callbacks.onAdd("slimes", (slime, id) => {
    const view = new SlimeView(slime.kind);
    view.root.position.set(slime.x, 0, slime.y);
    slimeViews.set(id, view);
    stage.scene.add(view.root);

    callbacks.listen(slime, "hp", (hp, previous) => {
      if (previous === undefined || hp >= previous) { return; }
      hits.confirm(id);
      if (hp === 0) {
        view.die();
        sfx.squish();
        const { x, z } = view.root.position;
        particles.burst(x, 0.3, z, SLIME_COLORS[slime.kind], 12 + slime.maxHp * 2, 3.5, 0.07 + SLIME_KINDS[slime.kind].radius * 0.12);
      }
    });
  });

  callbacks.onRemove("slimes", (_slime, id) => {
    const view = slimeViews.get(id);
    if (!view) { return; }
    slimeViews.delete(id);
    // Let a death animation finish; slimes cleared by a floor change just vanish.
    if (view.dying && !view.finished) {
      fadingSlimes.add(view);
    } else {
      stage.scene.remove(view.root);
      view.dispose();
    }
  });

  callbacks.listen("lives", (lives) => hud.setLives(lives));

  callbacks.listen("gameOver", (over, previous) => {
    if (over) {
      sfx.gameOver();
      hud.banner("Game over", `The slimes win this time… restarting in ${room.state.restartIn}`, 0);
    } else if (previous) {
      hud.hideBanner();
    }
  });
  callbacks.listen("restartIn", (seconds) => {
    if (room.state.gameOver) {
      hud.banner("Game over", `The slimes win this time… restarting in ${seconds}`, 0);
    }
  });

  room.onMessage("event", (event: { type: string; by?: string; sessionId?: string }) => {
    switch (event.type) {
      case "key": {
        hud.toast(`🗝️ ${event.by} found the key — the stairs are open!`);
        sfx.key();
        for (let i = 0; i < 24; i++) { particles.sparkle(dungeon.key.x, 0.5, dungeon.key.y, "#ffe07a", 0.8); }
        break;
      }
      case "cleared":
        hud.toast("✨ Floor cleared — the stairs are open!");
        sfx.open();
        break;
      case "descend":
        sfx.descend();
        break;
      case "hurt": {
        const view = heroViews.get(event.sessionId ?? "");
        if (view) {
          const { x, z } = view.root.position;
          particles.burst(x, 0.5, z, "#ff6f9a", 10, 2.5, 0.06);
        }
        if (event.sessionId === room.sessionId) {
          stage.addShake(0.35);
          sfx.hurt();
        }
        break;
      }
    }
  });

  // --- connection ------------------------------------------------------------------

  let connected = true;
  room.onDrop(() => {
    connected = false;
    hud.setStatus("Connection lost — reconnecting…");
  });
  room.onReconnect(() => {
    connected = true;
    hud.setStatus(null);
  });
  room.onLeave((code) => {
    connected = false;
    const text = code === CloseCode.FAILED_TO_RECONNECT ? "Couldn't reconnect to the dungeon." : "Disconnected.";
    hud.setStatus(text, { label: "Rejoin", run: () => location.reload() });
  });

  // --- frame loop ------------------------------------------------------------------

  const controls = new Controls(() => sfx.unlock());
  const command: HeroCommand = { moveX: 0, moveY: 0, attack: false };
  let lastFrame = performance.now();

  function frame(now: number) {
    const dt = Math.min(0.1, Math.max(0, (now - lastFrame) / 1000));
    lastFrame = now;
    const time = now / 1000;

    // One input per fixed step, sent before anything is read for rendering.
    const steps = predict.tick(now);
    for (let i = 0; i < steps; i++) {
      controls.sample(command);
      if (!connected) { continue; }
      input.data.moveX = command.moveX;
      input.data.moveY = command.moveY;
      input.data.attack = command.attack;
      input.send();
    }

    // Heroes: predicted for us, interpolated for everyone else — one read either way.
    for (const [sessionId, hero] of room.state.heroes) {
      const view = heroViews.get(sessionId);
      if (!view) { continue; }
      const facing = sessionId === room.sessionId ? me.state.facing : hero.facing;
      view.update(dt, time, predict.value(hero, "x"), predict.value(hero, "y"), facing, hero.invuln, hero.connected);
    }

    for (const [id, view] of slimeViews) {
      const slime = room.state.slimes.get(id);
      if (slime) { view.update(dt, time, predict.value(slime, "x"), predict.value(slime, "y"), slime.hp, slime.maxHp); }
    }
    for (const view of fadingSlimes) {
      view.update(dt, time, view.root.position.x, view.root.position.z, 0, 1);
      if (view.finished) {
        fadingSlimes.delete(view);
        stage.scene.remove(view.root);
        view.dispose();
      }
    }

    stage.follow(predict.value(self, "x"), predict.value(self, "y"), dt, snapCamera);
    snapCamera = false;
    level.update(dt, time, room.state.keyTaken, room.state.stairsOpen, particles);
    particles.update(dt);
    updateHud(time);
    stage.render();

    requestAnimationFrame(frame);
  }

  function updateHud(time: number) {
    const party: PartyMember[] = [];
    const dots: MapDot[] = [];
    let slimesLeft = 0;
    for (const [id, slime] of room.state.slimes) {
      if (slime.hp === 0) { continue; }
      slimesLeft++;
      const view = slimeViews.get(id);
      if (view) { dots.push({ x: view.root.position.x, y: view.root.position.z, color: "#ff6f9a", size: 0.5 }); }
    }
    if (!room.state.keyTaken) { dots.push({ x: dungeon.key.x, y: dungeon.key.y, color: "#ffd36a", size: 0.9 }); }
    dots.push({
      x: dungeon.stairs.x, y: dungeon.stairs.y, size: room.state.stairsOpen ? 1 + Math.sin(time * 6) * 0.2 : 0.8,
      color: room.state.stairsOpen ? "#fff6c9" : "#8a78b8",
    });
    for (const [sessionId, hero] of room.state.heroes) {
      party.push({
        sessionId, name: hero.name, seat: hero.seat, kills: hero.kills,
        connected: hero.connected, isSelf: sessionId === room.sessionId,
      });
      const view = heroViews.get(sessionId);
      if (view) {
        dots.push({ x: view.root.position.x, y: view.root.position.z, color: SEAT_COLORS[hero.seat % 4], size: 1 });
      }
    }
    party.sort((a, b) => a.seat - b.seat);
    hud.setParty(party);
    hud.setObjective(room.state.keyTaken, room.state.stairsOpen, slimesLeft);
    hud.drawMinimap(dots);
  }

  requestAnimationFrame(frame);
}

function floorFlavor(floor: number): string {
  if (floor === 2) { return "Blue slimes are quicker. Careful!"; }
  if (floor === 3) { return "Pink slimes take more bonks — and a king guards the stairs!"; }
  if (floor % 3 === 0) { return "A king slime guards the stairs…"; }
  return "The slimes are getting bolder.";
}

main().catch((e) => {
  console.error(e);
  hud.setStatus("Could not reach the dungeon.", { label: "Try again", run: () => location.reload() });
});
