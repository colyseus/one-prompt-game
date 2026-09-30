import assert from "assert";
import { ColyseusTestServer, boot } from "@colyseus/testing";

import appConfig from "../src/app.config.js";
import { Slime, type HeroInput } from "../src/rooms/schema/DungeonState.js";
import { generateDungeon, isWall, tileCenter, tileOf } from "../src/shared/dungeon.js";
import { stepHero } from "../src/shared/movement.js";
import {
  HERO_HALF, HERO_MAX_HP, HERO_SPEED, SLIME_HP, TEAM_LIVES, TICK_RATE, slimeCountFor,
} from "../src/shared/constants.js";

/** Polls until `predicate` holds; patches and steps arrive asynchronously. */
async function waitFor(predicate: () => boolean, what: string, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) { throw new Error(`timed out waiting for ${what}`); }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe("DungeonRoom", () => {
  let colyseus: ColyseusTestServer<typeof appConfig>;

  before(async () => colyseus = await boot(appConfig));
  after(async () => colyseus.shutdown());

  beforeEach(async () => {
    await colyseus.cleanup();
  });

  it("shows each of two heroes the other one moving", async () => {
    const room = await colyseus.createRoom("dungeon", {});
    const alice = await colyseus.connectTo(room);
    const bob = await colyseus.connectTo(room);

    await waitFor(() => alice.state.heroes?.size === 2 && bob.state.heroes?.size === 2, "both heroes to sync");
    const aliceSeenByBob = bob.state.heroes.get(alice.sessionId);
    const bobSeenByAlice = alice.state.heroes.get(bob.sessionId);
    const aliceStartX = aliceSeenByBob.x;
    const bobStartY = bobSeenByAlice.y;

    const aliceInput = alice.input<HeroInput>({ mode: "reliable" });
    const bobInput = bob.input<HeroInput>({ mode: "reliable" });
    for (let i = 0; i < 3; i++) {
      aliceInput.data.moveX = 1;
      aliceInput.send();
      bobInput.data.moveY = 1;
      bobInput.send();
    }

    await waitFor(() => aliceSeenByBob.x > aliceStartX, "Bob to see Alice move right");
    await waitFor(() => bobSeenByAlice.y > bobStartY, "Alice to see Bob move down");

    // Three inputs are exactly three steps on the server, and both clients agree.
    const stride = HERO_SPEED / TICK_RATE;
    assert.ok(Math.abs(aliceSeenByBob.x - (aliceStartX + 3 * stride)) < 1e-9);
    await waitFor(() => alice.state.heroes.get(alice.sessionId).x === aliceSeenByBob.x, "Alice's own copy to agree");
  });

  it("damages a slime in reach of a sword swing, and only that one", async () => {
    const room = await colyseus.createRoom("dungeon", {});
    const client = await colyseus.connectTo(room);
    const hero = room.state.heroes.get(client.sessionId);
    assert.strictEqual(hero.facing, 0, "heroes start facing east");

    room.state.slimes.clear();
    room.state.slimes.set("ahead", new Slime({ x: hero.x + 28, y: hero.y }));
    room.state.slimes.set("behind", new Slime({ x: hero.x - 30, y: hero.y }));

    const input = client.input<HeroInput>({ mode: "reliable" });
    input.data.attack = true;
    input.send();

    await room.waitForNextMessage();  // the input reaches the server
    await room.waitForNextTimestep(); // the step that consumes it runs

    assert.strictEqual(hero.cooldown > 0, true, "the swing started its cooldown");
    assert.strictEqual(room.state.slimes.get("ahead").hp, SLIME_HP - 1);
    assert.strictEqual(room.state.slimes.get("behind").hp, SLIME_HP);

    await waitFor(() => client.state.slimes.get("ahead")?.hp === SLIME_HP - 1, "the client to see the hit");
  });

  it("opens the stairs once every slime on the floor is dead", async () => {
    const room = await colyseus.createRoom("dungeon", {});
    const client = await colyseus.connectTo(room);
    const hero = room.state.heroes.get(client.sessionId);

    room.state.slimes.clear();
    room.state.slimes.set("last", new Slime({ x: hero.x + 28, y: hero.y, hp: 1 }));

    await room.waitForNextTimestep();
    assert.strictEqual(room.state.stairsOpen, false, "stairs stay shut while a slime lives");

    const input = client.input<HeroInput>({ mode: "reliable" });
    input.data.attack = true;
    input.send();

    await room.waitForNextMessage();
    await room.waitForNextTimestep();

    assert.strictEqual(room.state.slimes.size, 0);
    assert.strictEqual(room.state.stairsOpen, true);
    await waitFor(() => client.state.stairsOpen === true, "the client to see the stairs open");
  });

  it("descends to a new floor with more slimes when a hero takes the open stairs", async () => {
    const room = await colyseus.createRoom("dungeon", {});
    const client = await colyseus.connectTo(room);
    const hero = room.state.heroes.get(client.sessionId);
    const firstSeed = room.state.seed;
    assert.strictEqual(room.state.slimes.size, slimeCountFor(1));

    room.state.slimes.clear();
    hero.x = tileCenter(room.map.stairs.tx);
    hero.y = tileCenter(room.map.stairs.ty);

    await waitFor(() => room.state.floor === 2, "floor 2");
    assert.notStrictEqual(room.state.seed, firstSeed);
    assert.strictEqual(room.state.stairsOpen, false);
    assert.strictEqual(room.state.slimes.size, slimeCountFor(2));
    assert.ok(slimeCountFor(2) > slimeCountFor(1));
    assert.strictEqual(tileOf(hero.x), room.map.entrance.tx, "heroes restart at the new entrance");
    assert.strictEqual(tileOf(hero.y), room.map.entrance.ty);
  });

  it("costs a shared life when a hero goes down, and restarts the run at zero", async () => {
    const room = await colyseus.createRoom("dungeon", {});
    const client = await colyseus.connectTo(room);
    const hero = room.state.heroes.get(client.sessionId);

    // Walk into a slime at 1 HP.
    room.state.slimes.clear();
    room.state.slimes.set("biter", new Slime({ x: hero.x, y: hero.y }));
    hero.hp = 1;
    hero.invuln = 0;
    await waitFor(() => room.state.lives === TEAM_LIVES - 1, "a life to be lost");
    assert.strictEqual(hero.hp, HERO_MAX_HP, "respawned at full health");
    assert.strictEqual(tileOf(hero.x), room.map.entrance.tx, "respawned at the entrance");

    // The last life lost sends the team back to floor 1.
    room.state.floor = 3;
    room.state.lives = 1;
    room.state.slimes.set("biter2", new Slime({ x: hero.x, y: hero.y }));
    hero.hp = 1;
    hero.invuln = 0;
    await waitFor(() => room.state.lives === TEAM_LIVES, "the run to restart");
    assert.strictEqual(room.state.floor, 1);
  });

  it("keeps a dropped hero in the room while its seat is held", async () => {
    const room = await colyseus.createRoom("dungeon", {});
    const client = await colyseus.connectTo(room);
    const sessionId = client.sessionId;

    client.leave(false); // an abrupt drop, like a closed laptop lid
    await waitFor(() => room.state.heroes.get(sessionId)?.connected === false, "the hero to be marked dropped");
    assert.ok(room.state.heroes.has(sessionId), "the hero is kept for reconnection");
  });

  it("clamps input that is out of range", async () => {
    const room = await colyseus.createRoom("dungeon", {});
    const client = await colyseus.connectTo(room);
    const hero = room.state.heroes.get(client.sessionId);
    const startX = hero.x;

    // A modified client claiming a huge axis value: sanitize clamps it to 1.
    const input = client.input<HeroInput>({ mode: "reliable" });
    input.data.moveX = 100 as any;
    input.send();

    await room.waitForNextMessage();
    await room.waitForNextTimestep();

    // The room steps once per received input, so one input is exactly one step
    // of travel — at moveX clamped to 1, not the 100 the client asked for.
    assert.strictEqual(hero.x, startX + HERO_SPEED * (1 / TICK_RATE));
  });
});

describe("shared simulation", () => {
  it("builds the same floor from the same seed", () => {
    const a = generateDungeon(0xc0ffee);
    const b = generateDungeon(0xc0ffee);
    assert.deepStrictEqual(a, b);
    assert.notDeepStrictEqual(generateDungeon(1).tiles, a.tiles);
  });

  it("replays a hero bit-for-bit and never lets it into a wall", () => {
    const map = generateDungeon(42);
    const start = { x: tileCenter(map.entrance.tx), y: tileCenter(map.entrance.ty), facing: 0, cooldown: 0 };
    const axes = [-1, 0, 1] as const;
    let r = 7;
    const inputs = Array.from({ length: 600 }, () => {
      r = (r * 1103515245 + 12345) >>> 0;
      return { moveX: axes[r % 3], moveY: axes[(r >>> 4) % 3], attack: (r >>> 8) % 5 === 0 };
    });

    const a = { ...start }, b = { ...start };
    let swings = 0;
    for (const input of inputs) {
      if (stepHero(a, input, map, 1 / TICK_RATE)) { swings++; }
      for (const [cx, cy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const tx = tileOf(a.x + cx * (HERO_HALF - 0.01)), ty = tileOf(a.y + cy * (HERO_HALF - 0.01));
        assert.ok(!isWall(map, tx, ty), `hero corner inside a wall at ${a.x},${a.y}`);
      }
    }
    for (const input of inputs) { stepHero(b, input, map, 1 / TICK_RATE); }

    assert.deepStrictEqual(a, b);
    assert.ok(swings > 0 && swings < inputs.filter((i) => i.attack).length, "the cooldown gates swings");
  });
});
