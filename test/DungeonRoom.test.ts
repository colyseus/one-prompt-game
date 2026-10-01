import assert from "assert";
import { ColyseusTestServer, boot } from "@colyseus/testing";

import appConfig from "../src/app.config.js";
import type { DungeonRoom } from "../src/rooms/DungeonRoom.js";
import type { HeroInput } from "../src/rooms/schema/DungeonState.js";
import { HERO_SPEED, TICK_RATE } from "../src/shared/constants.js";
import { swordHits } from "../src/shared/combat.js";
import { SLIME_BLUE, SLIME_KINDS } from "../src/shared/slimes.js";

const SEED = 1234;
const BLUE_HP = SLIME_KINDS[SLIME_BLUE].hp;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitUntil(condition: () => boolean, label: string, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) { throw new Error(`timed out waiting for ${label}`); }
    await sleep(5);
  }
}

/** An empty floor, so wandering slimes can't nudge anyone mid-test. */
function clearSlimes(room: DungeonRoom) {
  room.state.slimes.clear();
  room.brains.clear();
}

describe("DungeonRoom", () => {
  let colyseus: ColyseusTestServer<typeof appConfig>;

  before(async () => colyseus = await boot(appConfig));
  after(async () => colyseus.shutdown());

  beforeEach(async () => {
    await colyseus.cleanup();
  });

  it("spawns every hero on a floor tile of the same generated dungeon", async () => {
    const room = await colyseus.createRoom("dungeon", { seed: SEED });
    const alice = await colyseus.connectTo(room);

    await waitUntil(() => alice.state.seed === SEED && alice.state.floor === 1, "the floor to sync");
    const hero = room.state.heroes.get(alice.sessionId)!;
    assert.ok(room.state.slimes.size > 0, "the floor starts with slimes");
    assert.ok(Math.abs(hero.x - room.dungeon.spawn.x) < 1 && Math.abs(hero.y - room.dungeon.spawn.y) < 1);
  });

  it("two clients see each other move", async () => {
    const room = await colyseus.createRoom("dungeon", { seed: SEED });
    const alice = await colyseus.connectTo(room);
    const bob = await colyseus.connectTo(room);
    clearSlimes(room);

    await waitUntil(() => alice.state.heroes.size === 2 && bob.state.heroes.size === 2, "both heroes to sync");

    // Each client's view of the *other* hero.
    const aliceSeenByBob = bob.state.heroes.get(alice.sessionId)!;
    const bobSeenByAlice = alice.state.heroes.get(bob.sessionId)!;
    const aliceStartX = aliceSeenByBob.x;
    const bobStartY = bobSeenByAlice.y;

    const aliceInput = alice.input<HeroInput>();
    const bobInput = bob.input<HeroInput>();
    aliceInput.data.moveX = 1;  // alice walks east
    bobInput.data.moveY = 1;    // bob walks south

    const STEPS = 4;
    for (let i = 0; i < STEPS; i++) {
      aliceInput.send();
      bobInput.send();
      await sleep(1000 / TICK_RATE);
    }

    const travel = STEPS * HERO_SPEED / TICK_RATE;
    await waitUntil(
      () => aliceSeenByBob.x - aliceStartX > travel - 1e-6 && bobSeenByAlice.y - bobStartY > travel - 1e-6,
      "each client to see the other hero's full walk",
    );

    // What each client sees of the other is exactly the server's authoritative position.
    assert.strictEqual(aliceSeenByBob.x, room.state.heroes.get(alice.sessionId)!.x);
    assert.strictEqual(bobSeenByAlice.y, room.state.heroes.get(bob.sessionId)!.y);
    // Nobody moved sideways.
    assert.strictEqual(alice.state.heroes.get(alice.sessionId)!.y, room.state.heroes.get(alice.sessionId)!.y);
  });

  it("a sword swing damages a slime", async () => {
    const room = await colyseus.createRoom("dungeon", { seed: SEED });
    const alice = await colyseus.connectTo(room);
    clearSlimes(room);

    const hero = room.state.heroes.get(alice.sessionId)!;
    const id = room.spawnSlime(SLIME_BLUE, hero.x + 1, hero.y);

    // Face east (towards the slime) and swing, in a single step.
    const input = alice.input<HeroInput>();
    input.data.moveX = 1;
    input.data.attack = true;
    input.send();

    await waitUntil(() => room.state.slimes.get(id)!.hp === BLUE_HP - 1, "the server to register the hit");
    await waitUntil(() => alice.state.slimes.get(id)?.hp === BLUE_HP - 1, "the client to see the damage");
    assert.strictEqual(hero.facing, 0, "hero faces east");
    assert.ok(hero.swing > 0 || hero.cooldown > 0, "the swing started");
  });

  it("a swing in the wrong direction misses", async () => {
    const room = await colyseus.createRoom("dungeon", { seed: SEED });
    const alice = await colyseus.connectTo(room);
    clearSlimes(room);

    const hero = room.state.heroes.get(alice.sessionId)!;
    const id = room.spawnSlime(SLIME_BLUE, hero.x + 1, hero.y);
    room.brains.get(id)!.stun = Infinity;

    const input = alice.input<HeroInput>();
    input.data.moveX = -1;  // face west, away from the slime
    input.data.attack = true;
    input.send();

    await waitUntil(() => hero.cooldown > 0, "the swing to be processed");
    await room.waitForNextTimestep();
    assert.strictEqual(room.state.slimes.get(id)!.hp, BLUE_HP);
  });

  it("lag-compensates the swing to where the attacker saw the slime", async () => {
    const room = await colyseus.createRoom("dungeon", { seed: SEED });
    const alice = await colyseus.connectTo(room);
    clearSlimes(room);

    const hero = room.state.heroes.get(alice.sessionId)!;
    const id = room.spawnSlime(SLIME_BLUE, hero.x + 1, hero.y);
    const slime = room.state.slimes.get(id)!;
    room.brains.get(id)!.stun = Infinity;  // hold still: this test moves it by hand

    // No Predict here, so state the interp buffer the stamp should cover.
    const input = alice.input<HeroInput>({ renderDelay: 150 });

    // Idle inputs until the client clock syncs (it rides the input acks), and
    // the slime's rewind history has it standing east of the hero for a while.
    const since = Date.now();
    await waitUntil(() => {
      input.send();
      return alice.clock.lastServerTime() > 0 && Date.now() - since > 500;
    }, "the client clock to sync");

    // The slime slips out of reach on the server. Waiting for the patch makes the
    // newest rewind sample the moved one, so an unstamped (live) read would miss.
    slime.y += 5;
    await room.waitForNextPatch();
    assert.ok(!swordHits(room.dungeon, hero.x, hero.y, 0, slime.x, slime.y, SLIME_KINDS[SLIME_BLUE].radius),
      "out of reach at its live position");
    assert.ok(room.rewind.lastSeenBy(alice.sessionId).time > 0, "the client's inputs carry a render-time stamp");

    input.data.moveX = 1;
    input.data.attack = true;
    input.send();

    await waitUntil(() => slime.hp === BLUE_HP - 1, "the rewound hit to land");
  });

  it("opens the stairs when the key is picked up", async () => {
    const room = await colyseus.createRoom("dungeon", { seed: SEED });
    const alice = await colyseus.connectTo(room);
    const hero = room.state.heroes.get(alice.sessionId)!;

    assert.strictEqual(room.state.stairsOpen, false);
    hero.x = room.dungeon.key.x;
    hero.y = room.dungeon.key.y;
    await room.waitForNextTimestep();

    assert.strictEqual(room.state.keyTaken, true);
    assert.strictEqual(room.state.stairsOpen, true);

    // Stepping on the open stairs takes the whole party one floor down.
    hero.x = room.dungeon.stairs.x;
    hero.y = room.dungeon.stairs.y;
    await waitUntil(() => room.state.floor === 2, "the next floor");
    assert.strictEqual(room.state.keyTaken, false);
    assert.strictEqual(room.state.stairsOpen, false);
    assert.ok(Math.abs(hero.x - room.dungeon.spawn.x) < 1, "hero moved to the new floor's spawn");
  });

  it("slime contact drains the shared lives, and an empty pool ends the run", async () => {
    const room = await colyseus.createRoom("dungeon", { seed: SEED });
    const alice = await colyseus.connectTo(room);
    const bob = await colyseus.connectTo(room);
    clearSlimes(room);

    const aliceHero = room.state.heroes.get(alice.sessionId)!;
    const bobHero = room.state.heroes.get(bob.sessionId)!;
    aliceHero.invuln = 0;
    bobHero.invuln = 0;
    const lives = room.state.lives;

    const first = room.spawnSlime(SLIME_BLUE, aliceHero.x, aliceHero.y);
    room.brains.get(first)!.stun = Infinity;
    await waitUntil(() => room.state.lives === lives - 1, "alice's hit to cost a life");
    assert.ok(aliceHero.invuln > 0, "alice is briefly invulnerable");

    room.state.lives = 1;
    const second = room.spawnSlime(SLIME_BLUE, bobHero.x, bobHero.y);
    room.brains.get(second)!.stun = Infinity;
    await waitUntil(() => room.state.gameOver, "the run to end");
    assert.strictEqual(room.state.lives, 0);
    await waitUntil(() => bob.state.gameOver === true, "the clients to see game over");
  });
});
