import { Room, Client, CloseCode, type StepContext } from "colyseus";
import { DungeonState, Hero, HeroInput, Slime } from "./schema/DungeonState.js";
import {
  FLOOR_INVULN_TICKS, GAME_OVER_SECONDS, HERO_NAMES, HERO_RADIUS, HURT_INVULN_TICKS, KEY_PICKUP_RADIUS,
  KNOCKBACK_SPEED, MAX_HEROES, MAX_LIVES, START_LIVES, STAIRS_RADIUS, TICK_RATE,
} from "../shared/constants.js";
import { bfsDistances, generateDungeon, hasLineOfSight, slimeSpawns, type Dungeon } from "../shared/dungeon.js";
import { moveBody, stepHero } from "../shared/movement.js";
import { swordHits } from "../shared/combat.js";
import { SLIME_KINDS, slimeAggroRange, slimeSpeedMultiplier } from "../shared/slimes.js";
import { createRng, type Rng } from "../shared/rng.js";

/** Server-only AI state, kept off the schema so it never costs bandwidth. */
export interface SlimeBrain {
  /** Knockback velocity from a sword hit. */
  kx: number;
  ky: number;
  /** Steps the slime stays dazed (no chasing) after a hit. */
  stun: number;
  /** Steps of death animation left once hp reaches 0. */
  dying: number;
  wanderX: number;
  wanderY: number;
  wanderTicks: number;
}

const SLIME_KNOCKBACK = 7;
const SLIME_STUN_TICKS = Math.round(TICK_RATE * 0.35);
const SLIME_DEATH_TICKS = Math.round(TICK_RATE * 0.5);
const SPAWN_OFFSETS = [[-0.6, -0.6], [0.6, -0.6], [-0.6, 0.6], [0.6, 0.6]] as const;

export interface DungeonOptions {
  /** "normal" or "hard"; rooms are matched by it (see `filterBy` in app.config). */
  mode?: string;
  /** Fixed run seed, for sharing a layout or reproducible tests. */
  seed?: number;
}

export class DungeonRoom extends Room<{ state: DungeonState, input: HeroInput }> {
  maxClients = MAX_HEROES;
  state = new DungeonState();

  /**
   * Per-client input buffer. `sanitize` clamps every field as it is decoded —
   * never trust the wire — and the buffer holds ~2s of inputs at this tick rate
   * so a burst after a stall still replays in order.
   */
  inputs = this.defineInput(HeroInput, {
    bufferMaxSize: 64,
    sanitize: { moveX: [-1, 1], moveY: [-1, 1] },
  });

  /** Slime position history, so sword hits land where the attacker saw them. */
  rewind = this.allowRewindState({ maxRewindMs: 500 });

  dungeon!: Dungeon;
  readonly brains = new Map<string, SlimeBrain>();

  private hard = false;
  private rng: Rng = createRng(1);
  private flow = new Int16Array(0);
  private nextSlimeId = 0;
  private restartTicks = 0;

  onCreate(options: DungeonOptions = {}) {
    this.hard = options.mode === "hard";

    // Every client draws slimes interpolated (lerp), so hits rewind them on the
    // default snapshot timeline. Attach before anyone joins: the room derives
    // which lag-comp stamp clients must send from these groups.
    this.rewind.attachAll(this.state.slimes, { fields: ["x", "y"] });

    const seed = typeof options.seed === "number" ? options.seed >>> 0 : (Math.random() * 0xffffffff) >>> 0;
    this.startRun(seed);
    this.setFixedTimestep((ctx) => this.step(ctx), TICK_RATE);
  }

  onJoin(client: Client, options: DungeonOptions) {
    const taken = new Set([...this.state.heroes.values()].map((h) => h.seat));
    let seat = 0;
    while (taken.has(seat)) { seat++; }

    const hero = new Hero({ name: HERO_NAMES[seat % HERO_NAMES.length], seat });
    this.placeAtSpawn(hero);
    this.state.heroes.set(client.sessionId, hero);
  }

  /**
   * Called on any disconnection the client did not ask for — a network blip, a
   * suspended tab, a tunnel change. Holding the seat lets the SDK retry into the
   * same session, so the hero keeps their place in the party.
   */
  onDrop(client: Client, code: CloseCode) {
    // Deliberately not awaited: the framework routes the outcome to onReconnect()
    // or onLeave(). The catch only covers the room disposing mid-wait.
    this.allowReconnection(client, 30).catch(() => {});
    const hero = this.state.heroes.get(client.sessionId);
    if (hero) { hero.connected = false; }
  }

  onReconnect(client: Client) {
    const hero = this.state.heroes.get(client.sessionId);
    if (hero) { hero.connected = true; }
  }

  onLeave(client: Client, code: CloseCode) {
    this.state.heroes.delete(client.sessionId);
  }

  // --- run / floor lifecycle --------------------------------------------------

  private startRun(seed: number) {
    this.state.seed = seed;
    this.state.lives = this.hard ? START_LIVES - 2 : START_LIVES;
    this.state.gameOver = false;
    this.state.restartIn = 0;
    this.rng = createRng(seed ^ 0x9e3779b9);
    for (const hero of this.state.heroes.values()) { hero.kills = 0; }
    this.enterFloor(1);
  }

  private enterFloor(floor: number) {
    this.state.floor = floor;
    this.dungeon = generateDungeon(this.state.seed, floor);
    this.flow = new Int16Array(this.dungeon.width * this.dungeon.height);
    this.state.keyTaken = false;
    this.state.stairsOpen = false;

    this.state.slimes.clear();
    this.brains.clear();
    const party = Math.max(1, this.state.heroes.size) + (this.hard ? 2 : 0);
    for (const s of slimeSpawns(this.dungeon, party)) {
      this.spawnSlime(s.kind, s.x, s.y);
    }

    for (const hero of this.state.heroes.values()) { this.placeAtSpawn(hero); }
  }

  private placeAtSpawn(hero: Hero) {
    const [ox, oy] = SPAWN_OFFSETS[hero.seat % SPAWN_OFFSETS.length];
    hero.x = this.dungeon.spawn.x + ox;
    hero.y = this.dungeon.spawn.y + oy;
    hero.kx = 0;
    hero.ky = 0;
    hero.invuln = FLOOR_INVULN_TICKS;
  }

  spawnSlime(kind: number, x: number, y: number): string {
    const id = `s${++this.nextSlimeId}`;
    const hp = SLIME_KINDS[kind].hp;
    this.state.slimes.set(id, new Slime({ x, y, kind, hp, maxHp: hp }));
    this.brains.set(id, { kx: 0, ky: 0, stun: 0, dying: 0, wanderX: 0, wanderY: 0, wanderTicks: 0 });
    return id;
  }

  // --- simulation -------------------------------------------------------------

  /**
   * Heroes advance once per received input through the shared `stepHero`, so
   * the set the client predicted is exactly the set the server applied. The
   * world (slimes, pickups, floors) advances once per tick afterwards: anything
   * it does to a hero lands between inputs, where the client's replay picks it up.
   */
  private step(ctx: StepContext) {
    for (const [sessionId, hero] of this.state.heroes) {
      const channel = this.inputs.get(sessionId);
      if (channel) {
        for (const input of channel) {
          // Resolve the hit per input: lastSeenBy() reads the stamp of the input
          // just consumed, i.e. the instant this swing was pressed on screen.
          if (stepHero(this.dungeon, hero, input, ctx.dt)) { this.resolveSwing(sessionId, hero); }
        }
      }
      if (hero.invuln > 0) { hero.invuln--; }
    }

    if (this.state.gameOver) {
      this.tickGameOver();
      return;
    }

    this.stepSlimes(ctx.dt);
    this.checkPickups();
  }

  /**
   * Lag-compensated sword hit: slimes are tested where this hero's client was
   * drawing them (interp delay + latency ago), not where they are now.
   */
  private resolveSwing(sessionId: string, hero: Hero) {
    const seen = this.rewind.lastSeenBy(sessionId);
    for (const [id, slime] of this.state.slimes) {
      if (slime.hp === 0) { continue; }
      const kind = SLIME_KINDS[slime.kind];
      const sx = seen.value(slime, "x");
      const sy = seen.value(slime, "y");
      if (!swordHits(this.dungeon, hero.x, hero.y, hero.facing, sx, sy, kind.radius)) { continue; }

      const brain = this.brains.get(id)!;
      slime.hp--;
      const [nx, ny] = direction(hero.x, hero.y, slime.x, slime.y);
      const push = SLIME_KNOCKBACK / Math.sqrt(kind.radius / 0.32);
      brain.kx = nx * push;
      brain.ky = ny * push;
      brain.stun = SLIME_STUN_TICKS;
      if (slime.hp === 0) {
        brain.dying = SLIME_DEATH_TICKS;
        hero.kills++;
      }
    }
  }

  private stepSlimes(dt: number) {
    const d = this.dungeon;
    const active = [...this.state.heroes.values()].filter((h) => h.connected);

    // Walking distance to the nearest hero, for every tile at once.
    bfsDistances(d, active.map((h) => Math.floor(h.y) * d.width + Math.floor(h.x)), this.flow);

    const aggro = slimeAggroRange(this.state.floor);
    const speedMul = slimeSpeedMultiplier(this.state.floor) * (this.hard ? 1.15 : 1);
    const living: Slime[] = [];

    for (const [id, slime] of this.state.slimes) {
      const brain = this.brains.get(id)!;
      if (slime.hp === 0) {
        if (--brain.dying <= 0) {
          this.state.slimes.delete(id);
          this.brains.delete(id);
        }
        continue;
      }
      living.push(slime);
      const kind = SLIME_KINDS[slime.kind];

      let dirX = 0, dirY = 0, speed = kind.speed * speedMul;
      if (brain.stun > 0) {
        brain.stun--;
      } else {
        const tile = Math.floor(slime.y) * d.width + Math.floor(slime.x);
        const pathDist = this.flow[tile];
        if (pathDist >= 0 && pathDist <= aggro && active.length > 0) {
          [dirX, dirY] = this.chaseDirection(slime, active);
        } else {
          [dirX, dirY] = this.wanderDirection(brain);
          speed *= 0.4;
        }
      }

      const vx = dirX * speed + brain.kx;
      const vy = dirY * speed + brain.ky;
      const hit = moveBody(d, slime, vx * dt, vy * dt, kind.radius);
      brain.kx = hit.hitX ? 0 : brain.kx * 0.8;
      brain.ky = hit.hitY ? 0 : brain.ky * 0.8;
    }

    // Keep slimes from stacking into one blob.
    for (let i = 0; i < living.length; i++) {
      for (let j = i + 1; j < living.length; j++) {
        const a = living[i], b = living[j];
        const ra = SLIME_KINDS[a.kind].radius, rb = SLIME_KINDS[b.kind].radius;
        const dx = b.x - a.x, dy = b.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const overlap = ra + rb - dist;
        if (overlap <= 0) { continue; }
        const [nx, ny] = dist > 1e-6 ? [dx / dist, dy / dist] : [1, 0];
        moveBody(d, a, -nx * overlap * 0.5, -ny * overlap * 0.5, ra);
        moveBody(d, b, nx * overlap * 0.5, ny * overlap * 0.5, rb);
      }
    }

    // Contact damage: costs the party one shared life.
    for (const [sessionId, hero] of this.state.heroes) {
      if (!hero.connected || hero.invuln > 0 || this.state.gameOver) { continue; }
      for (const slime of living) {
        const r = SLIME_KINDS[slime.kind].radius;
        const dx = hero.x - slime.x, dy = hero.y - slime.y;
        if (dx * dx + dy * dy < (HERO_RADIUS + r * 0.85) ** 2) {
          this.hurtHero(sessionId, hero, slime);
          break;
        }
      }
    }
  }

  /** Straight at the nearest hero when in sight, else down the distance field. */
  private chaseDirection(slime: Slime, heroes: Hero[]): [number, number] {
    let target = heroes[0], best = Infinity;
    for (const h of heroes) {
      const dist = (h.x - slime.x) ** 2 + (h.y - slime.y) ** 2;
      if (dist < best) { best = dist; target = h; }
    }
    if (hasLineOfSight(this.dungeon, slime.x, slime.y, target.x, target.y)) {
      return direction(slime.x, slime.y, target.x, target.y);
    }

    const d = this.dungeon;
    const tx = Math.floor(slime.x), ty = Math.floor(slime.y);
    let bestTile = -1, bestDist = this.flow[ty * d.width + tx];
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        const n = (ty + oy) * d.width + (tx + ox);
        const nd = this.flow[n];
        if (nd >= 0 && nd < bestDist) { bestDist = nd; bestTile = n; }
      }
    }
    if (bestTile < 0) { return [0, 0]; }
    const nx = bestTile % d.width, ny = (bestTile - nx) / d.width;
    return direction(slime.x, slime.y, nx + 0.5, ny + 0.5);
  }

  private wanderDirection(brain: SlimeBrain): [number, number] {
    if (--brain.wanderTicks <= 0) {
      brain.wanderTicks = Math.round(TICK_RATE * (0.8 + this.rng() * 1.5));
      if (this.rng() < 0.4) {
        brain.wanderX = 0;
        brain.wanderY = 0;
      } else {
        const angle = this.rng() * Math.PI * 2;
        brain.wanderX = Math.cos(angle);
        brain.wanderY = Math.sin(angle);
      }
    }
    return [brain.wanderX, brain.wanderY];
  }

  private hurtHero(sessionId: string, hero: Hero, slime: Slime) {
    this.state.lives = Math.max(0, this.state.lives - 1);
    hero.invuln = HURT_INVULN_TICKS;
    // Applied between inputs: the owner's reconciler adopts it and replays on top.
    const [nx, ny] = direction(slime.x, slime.y, hero.x, hero.y);
    hero.kx = nx * KNOCKBACK_SPEED;
    hero.ky = ny * KNOCKBACK_SPEED;
    this.broadcast("event", { type: "hurt", sessionId });
    if (this.state.lives === 0) {
      this.state.gameOver = true;
      this.restartTicks = GAME_OVER_SECONDS * TICK_RATE;
      this.state.restartIn = GAME_OVER_SECONDS;
    }
  }

  private checkPickups() {
    const { key, stairs } = this.dungeon;
    for (const hero of this.state.heroes.values()) {
      if (!hero.connected) { continue; }
      if (!this.state.keyTaken && distance(hero, key) < KEY_PICKUP_RADIUS) {
        this.state.keyTaken = true;
        this.state.stairsOpen = true;
        this.broadcast("event", { type: "key", by: hero.name });
      }
    }

    if (!this.state.stairsOpen && ![...this.state.slimes.values()].some((s) => s.hp > 0)) {
      this.state.stairsOpen = true;
      this.broadcast("event", { type: "cleared" });
    }

    if (this.state.stairsOpen) {
      for (const hero of this.state.heroes.values()) {
        if (hero.connected && distance(hero, stairs) < STAIRS_RADIUS) {
          this.state.lives = Math.min(MAX_LIVES, this.state.lives + 1);
          this.enterFloor(this.state.floor + 1);
          this.broadcast("event", { type: "descend", by: hero.name, floor: this.state.floor });
          return;
        }
      }
    }
  }

  private tickGameOver() {
    this.restartTicks--;
    this.state.restartIn = Math.ceil(this.restartTicks / TICK_RATE);
    if (this.restartTicks <= 0) {
      this.startRun((this.rng() * 0xffffffff) >>> 0);
    }
  }
}

function direction(fromX: number, fromY: number, toX: number, toY: number): [number, number] {
  const dx = toX - fromX, dy = toY - fromY;
  const len = Math.sqrt(dx * dx + dy * dy);
  return len > 1e-6 ? [dx / len, dy / len] : [0, 1];
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}
