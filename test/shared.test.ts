import assert from "assert";

import { bfsDistances, generateDungeon, isWallAt, slimeSpawns, type Dungeon } from "../src/shared/dungeon.js";
import { stepHero, type HeroCommand, type HeroSim } from "../src/shared/movement.js";
import { createRng } from "../src/shared/rng.js";
import { HERO_RADIUS, TICK_RATE } from "../src/shared/constants.js";
import { SLIME_KINDS } from "../src/shared/slimes.js";

const DT = 1 / TICK_RATE;

function reachable(d: Dungeon, from: { x: number; y: number }, to: { x: number; y: number }): boolean {
  const dist = bfsDistances(d, [Math.floor(from.y) * d.width + Math.floor(from.x)]);
  return dist[Math.floor(to.y) * d.width + Math.floor(to.x)] >= 0;
}

function randomCommands(seed: number, count: number): HeroCommand[] {
  const rng = createRng(seed);
  const axis = () => (Math.floor(rng() * 3) - 1) as -1 | 0 | 1;
  return Array.from({ length: count }, () => ({ moveX: axis(), moveY: axis(), attack: rng() < 0.1 }));
}

describe("dungeon generation", () => {
  it("is a pure function of (seed, floor)", () => {
    for (const floor of [1, 2, 5]) {
      const a = generateDungeon(777, floor);
      const b = generateDungeon(777, floor);
      assert.deepStrictEqual(Array.from(a.tiles), Array.from(b.tiles));
      assert.deepStrictEqual([a.spawn, a.stairs, a.key], [b.spawn, b.stairs, b.key]);
    }
    assert.notDeepStrictEqual(Array.from(generateDungeon(777, 1).tiles), Array.from(generateDungeon(778, 1).tiles));
  });

  it("always connects the spawn to the key and the stairs", () => {
    for (let seed = 1; seed <= 40; seed++) {
      for (const floor of [1, 3, 7, 12]) {
        const d = generateDungeon(seed, floor);
        for (const p of [d.spawn, d.stairs, d.key]) { assert.ok(!isWallAt(d, p.x, p.y)); }
        assert.ok(reachable(d, d.spawn, d.stairs), `stairs reachable (seed ${seed}, floor ${floor})`);
        assert.ok(reachable(d, d.spawn, d.key), `key reachable (seed ${seed}, floor ${floor})`);
      }
    }
  });

  it("gets harder: bigger floors, more slimes, a king every third floor", () => {
    const one = generateDungeon(5, 1), six = generateDungeon(5, 6);
    assert.ok(six.width > one.width);
    assert.ok(slimeSpawns(six, 2).length > slimeSpawns(one, 2).length);
    assert.ok(slimeSpawns(generateDungeon(5, 3), 1).some((s) => SLIME_KINDS[s.kind].name === "king"));
    for (const s of slimeSpawns(six, 4)) { assert.ok(!isWallAt(six, s.x, s.y)); }
  });
});

describe("stepHero", () => {
  const d = generateDungeon(4242, 2);
  const start = (): HeroSim => ({ x: d.spawn.x, y: d.spawn.y, kx: 0, ky: 0, facing: 2, swing: 0, cooldown: 0 });

  it("is deterministic: the same inputs replay to the same state, bit for bit", () => {
    const commands = randomCommands(9, 600);
    const a = start(), b = start();
    for (const cmd of commands) { stepHero(d, a, cmd, DT); }
    for (const cmd of commands) { stepHero(d, b, cmd, DT); }
    assert.deepStrictEqual(a, b);
  });

  it("never ends a step inside a wall", () => {
    const hero = start();
    hero.kx = 9; // a knockback shove on top of random walking
    for (const cmd of randomCommands(3, 2000)) {
      stepHero(d, hero, cmd, DT);
      for (const [ox, oy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        assert.ok(!isWallAt(d, hero.x + ox * HERO_RADIUS * 0.999, hero.y + oy * HERO_RADIUS * 0.999));
      }
    }
  });

  it("starts a swing only when the cooldown allows", () => {
    const hero = start();
    assert.strictEqual(stepHero(d, hero, { moveX: 0, moveY: 0, attack: true }, DT), true);
    assert.strictEqual(stepHero(d, hero, { moveX: 0, moveY: 0, attack: true }, DT), false);
    while (hero.cooldown > 1) { stepHero(d, hero, { moveX: 0, moveY: 0, attack: false }, DT); }
    assert.strictEqual(stepHero(d, hero, { moveX: 0, moveY: 0, attack: true }, DT), true);
  });
});
