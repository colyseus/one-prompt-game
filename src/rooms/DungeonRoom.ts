import { Room, type Client, CloseCode, type StepContext } from "colyseus";
import { DungeonState, Hero, HeroInput, Slime } from "./schema/DungeonState.js";
import { stepHero, FACING } from "../shared/movement.js";
import { generateDungeon, distanceField, isWall, moveBox, tileCenter, tileOf, type Dungeon } from "../shared/dungeon.js";
import { mulberry32, randInt } from "../shared/rng.js";
import {
  TICK_RATE, TILE, COLS, ROWS, HERO_HALF, HERO_MAX_HP, TEAM_LIVES,
  SWORD_REACH, SWORD_ARC_COS, SLIME_HALF, SLIME_SPEED, HIT_INVULN_TICKS,
  RESPAWN_INVULN_TICKS, slimeCountFor, type GameMode,
} from "../shared/constants.js";

/** One-shot events the clients turn into effects. State carries everything lasting. */
type DungeonClient = Client<{
  messages: {
    downed: { id: string; x: number; y: number };
    slain: { id: string; x: number; y: number };
    restart: { floor: number };
  };
}>;

export interface JoinOptions { mode?: GameMode; }

/** Where each palette slot appears on a floor, around the entrance tile's centre. */
const SPAWN_OFFSETS = [[-12, -12], [12, -12], [-12, 12], [12, 12]] as const;

const CONTACT_DISTANCE = HERO_HALF + SLIME_HALF - 2;
const SLIME_KNOCKBACK = 22;
const SLIME_HIT_STUN_TICKS = 10;
const SLIME_CONTACT_STUN_TICKS = 14;
/** Steps between flow-field rebuilds; slimes path toward heroes along it. */
const FLOW_REFRESH_TICKS = 5;

const randomSeed = () => (Math.random() * 0x100000000) >>> 0;

export class DungeonRoom extends Room<{ state: DungeonState, input: HeroInput, client: DungeonClient }> {
  maxClients = 4;
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

  /** Sword hits are judged against where the swinging client saw the slimes. */
  rewind = this.allowRewindState({ maxRewindMs: 500 });

  /** The current floor, regenerated from `state.seed` exactly as clients do. */
  map: Dungeon;

  private flow = new Int16Array(COLS * ROWS);
  private flowAge = 0;
  private nextSlimeId = 0;

  messages = {
    // movement and the sword arrive through the input buffer above — register
    // handlers here only for things that are not inputs (chat, emotes, …).
  };

  onCreate(options: JoinOptions) {
    this.state.mode = options?.mode === "hard" ? "hard" : "normal";
    this.loadFloor(1, randomSeed());

    this.rewind.attachAll(this.state.slimes, { fields: ["x", "y"] });
    this.setFixedTimestep((ctx) => this.step(ctx), TICK_RATE);
  }

  onJoin(client: DungeonClient, options: JoinOptions) {
    const taken = new Set<number>();
    this.state.heroes.forEach((hero) => taken.add(hero.color));
    let color = 0;
    while (taken.has(color)) { color++; }

    this.state.heroes.set(client.sessionId, new Hero({
      ...this.spawnPoint(color),
      color,
      invuln: RESPAWN_INVULN_TICKS,
    }));
  }

  /**
   * Called on any disconnection the client did not ask for — a network blip, a
   * suspended tab, a tunnel change. Holding the seat lets the SDK retry into the
   * same session, so the player keeps their hero and their place in the room.
   */
  onDrop(client: DungeonClient, code: CloseCode) {
    // Deliberately not awaited: the framework routes the outcome to onReconnect()
    // or onLeave() by itself. The catch is only here because the promise also
    // rejects when the room is already disposing (server shutdown), which would
    // otherwise surface as an unhandled rejection.
    this.allowReconnection(client, 30).catch(() => {});

    const hero = this.state.heroes.get(client.sessionId);
    if (hero) { hero.connected = false; }
  }

  onReconnect(client: DungeonClient) {
    const hero = this.state.heroes.get(client.sessionId);
    if (hero) { hero.connected = true; }
  }

  onLeave(client: DungeonClient, code: CloseCode) {
    this.state.heroes.delete(client.sessionId);
  }

  /**
   * One shared `stepHero` per received input, so the set the client predicted
   * is exactly the set the server applied. A client that sends nothing simply
   * does not move — an empty tick advances no one. Everything after the hero
   * loop is server-only: slimes, damage, lives and floors.
   */
  private step(ctx: StepContext) {
    for (const [sessionId, hero] of this.state.heroes) {
      const channel = this.inputs.get(sessionId);
      if (!channel) { continue; }

      for (const input of channel) {
        if (stepHero(hero, input, this.map, ctx.dt)) {
          this.swingSword(sessionId, hero);
        }
      }
    }

    this.moveSlimes(ctx.dt);
    this.resolveContacts();

    if (this.state.lives === 0) {
      this.state.lives = TEAM_LIVES;
      this.loadFloor(1, randomSeed());
      this.broadcast("restart", { floor: 1 });
      return;
    }

    this.state.heroes.forEach((hero) => {
      if (hero.invuln > 0) { hero.invuln--; }
    });

    if (!this.state.stairsOpen && this.state.slimes.size === 0) {
      this.state.stairsOpen = true;
    }
    if (this.state.stairsOpen && this.anyHeroOnStairs()) {
      this.loadFloor(this.state.floor + 1, randomSeed());
    }
  }

  /**
   * Regenerates the map from a fresh seed, repopulates it, and brings every hero
   * back to the entrance at full health. Clients rebuild the same walls from
   * `state.seed`.
   */
  loadFloor(floor: number, seed: number) {
    this.state.floor = floor;
    this.state.seed = seed;
    this.state.stairsOpen = false;
    this.map = generateDungeon(seed);
    this.flowAge = 0;

    this.state.slimes.clear();
    const rand = mulberry32(seed ^ 0x5bd1e995);
    const lairs = this.map.rooms.slice(1); // never the entrance room
    for (let i = 0; i < slimeCountFor(floor); i++) {
      const lair = lairs[randInt(rand, 0, lairs.length - 1)];
      this.state.slimes.set(`s${this.nextSlimeId++}`, new Slime({
        x: tileCenter(randInt(rand, lair.x, lair.x + lair.w - 1)),
        y: tileCenter(randInt(rand, lair.y, lair.y + lair.h - 1)),
      }));
    }

    this.state.heroes.forEach((hero) => {
      this.placeAtEntrance(hero);
      hero.hp = HERO_MAX_HP;
      hero.invuln = RESPAWN_INVULN_TICKS;
    });
  }

  private spawnPoint(color: number) {
    const [ox, oy] = SPAWN_OFFSETS[color % SPAWN_OFFSETS.length];
    return { x: tileCenter(this.map.entrance.tx) + ox, y: tileCenter(this.map.entrance.ty) + oy };
  }

  private placeAtEntrance(hero: Hero) {
    const { x, y } = this.spawnPoint(hero.color);
    hero.x = x;
    hero.y = y;
  }

  /**
   * Everything inside the arc in front of the hero takes a hit. Slimes are
   * rewound to where this client was rendering them when it pressed Space, so
   * what you see is what you hit.
   */
  private swingSword(sessionId: string, hero: Hero) {
    const [fx, fy] = FACING[hero.facing] ?? FACING[0];
    const seen = this.rewind.lastSeenBy(sessionId);
    const killed: string[] = [];

    this.state.slimes.forEach((slime, id) => {
      const dx = seen.value(slime, "x") - hero.x;
      const dy = seen.value(slime, "y") - hero.y;
      const dist = Math.hypot(dx, dy);
      if (dist > SWORD_REACH + SLIME_HALF) { return; }
      // Point-blank always connects; otherwise it must be inside the arc.
      const hugging = dist < HERO_HALF + SLIME_HALF;
      if (!hugging && (dx * fx + dy * fy) < SWORD_ARC_COS * dist) { return; }

      slime.hp = Math.max(0, slime.hp - 1);
      if (slime.hp === 0) {
        killed.push(id);
      } else {
        moveBox(slime, fx * SLIME_KNOCKBACK, fy * SLIME_KNOCKBACK, SLIME_HALF, this.map);
        slime.stun = SLIME_HIT_STUN_TICKS;
      }
    });

    for (const id of killed) {
      const slime = this.state.slimes.get(id);
      this.broadcast("slain", { id, x: slime.x, y: slime.y });
      this.state.slimes.delete(id);
    }
  }

  private moveSlimes(dt: number) {
    const hunters: Hero[] = [];
    this.state.heroes.forEach((hero) => { if (hero.connected) { hunters.push(hero); } });
    if (hunters.length === 0) { return; }

    if (--this.flowAge <= 0) {
      distanceField(this.map, hunters.map((h) => ({ tx: tileOf(h.x), ty: tileOf(h.y) })), this.flow);
      this.flowAge = FLOW_REFRESH_TICKS;
    }

    const speed = SLIME_SPEED[this.state.mode as GameMode] * (1 + Math.min(this.state.floor - 1, 8) * 0.04);
    const stride = speed * dt;
    const slimes: Slime[] = [];

    this.state.slimes.forEach((slime) => {
      slimes.push(slime);
      if (slime.stun > 0) { slime.stun--; return; }

      let prey = hunters[0];
      let preyDist = Infinity;
      for (const hero of hunters) {
        const d = Math.hypot(hero.x - slime.x, hero.y - slime.y);
        if (d < preyDist) { preyDist = d; prey = hero; }
      }

      let tx = prey.x, ty = prey.y;
      if (preyDist > TILE * 1.5) {
        const next = this.downhill(tileOf(slime.x), tileOf(slime.y));
        if (next) { tx = tileCenter(next.tx); ty = tileCenter(next.ty); }
      }

      const dx = tx - slime.x, dy = ty - slime.y;
      const len = Math.hypot(dx, dy);
      if (len < 0.001) { return; }
      const step = Math.min(stride, len);
      moveBox(slime, (dx / len) * step, (dy / len) * step, SLIME_HALF, this.map);
    });

    // Keep the pack from stacking into one blob.
    const minGap = SLIME_HALF * 2;
    for (let i = 0; i < slimes.length; i++) {
      for (let j = i + 1; j < slimes.length; j++) {
        const a = slimes[i], b = slimes[j];
        const dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.hypot(dx, dy);
        if (d >= minGap) { continue; }
        const nx = d > 0.001 ? dx / d : 1, ny = d > 0.001 ? dy / d : 0;
        const push = (minGap - d) / 2;
        moveBox(a, -nx * push, -ny * push, SLIME_HALF, this.map);
        moveBox(b, nx * push, ny * push, SLIME_HALF, this.map);
      }
    }
  }

  /** The neighbouring tile one step closer to a hero, without cutting wall corners. */
  private downhill(sx: number, sy: number) {
    let best = this.flow[sy * COLS + sx];
    if (best <= 0) { return null; }
    let pick: { tx: number; ty: number } | null = null;
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        if (ox === 0 && oy === 0) { continue; }
        const tx = sx + ox, ty = sy + oy;
        if (isWall(this.map, tx, ty)) { continue; }
        if (ox !== 0 && oy !== 0 && (isWall(this.map, sx + ox, sy) || isWall(this.map, sx, sy + oy))) { continue; }
        const d = this.flow[ty * COLS + tx];
        if (d >= 0 && d < best) { best = d; pick = { tx, ty }; }
      }
    }
    return pick;
  }

  private resolveContacts() {
    this.state.slimes.forEach((slime) => {
      this.state.heroes.forEach((hero, sessionId) => {
        if (!hero.connected || hero.invuln > 0 || this.state.lives === 0) { return; }
        const dx = hero.x - slime.x, dy = hero.y - slime.y;
        const dist = Math.hypot(dx, dy);
        if (dist >= CONTACT_DISTANCE) { return; }

        // The slime bounces off; the hero's own motion stays theirs to predict.
        const nx = dist > 0.001 ? dx / dist : 1, ny = dist > 0.001 ? dy / dist : 0;
        moveBox(slime, -nx * SLIME_KNOCKBACK, -ny * SLIME_KNOCKBACK, SLIME_HALF, this.map);
        slime.stun = SLIME_CONTACT_STUN_TICKS;

        hero.hp -= 1;
        hero.invuln = HIT_INVULN_TICKS;
        if (hero.hp === 0) { this.downHero(sessionId, hero); }
      });
    });
  }

  private downHero(sessionId: string, hero: Hero) {
    this.broadcast("downed", { id: sessionId, x: hero.x, y: hero.y });
    this.state.lives = Math.max(0, this.state.lives - 1);
    // At 0 lives step() restarts the run once contacts are resolved.

    this.placeAtEntrance(hero);
    hero.hp = HERO_MAX_HP;
    hero.invuln = RESPAWN_INVULN_TICKS;
  }

  private anyHeroOnStairs() {
    const sx = tileCenter(this.map.stairs.tx);
    const sy = tileCenter(this.map.stairs.ty);
    for (const hero of this.state.heroes.values()) {
      if (hero.connected && Math.abs(hero.x - sx) < TILE / 2 && Math.abs(hero.y - sy) < TILE / 2) {
        return true;
      }
    }
    return false;
  }
}
