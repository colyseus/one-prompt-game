import { schema, t, type SchemaType } from "@colyseus/schema";

/**
 * One input frame, consumed by `Room.defineInput()`. Flat primitives only, and
 * deliberately minimal:
 *   - no `seq`  — the engine's input counter is the sequence
 *   - no `dt`   — fixed timestep: one input advances exactly one step
 *   - no time   — the SDK stamps lag-comp timing on the wire envelope
 *
 * `int8<-1 | 0 | 1>` narrows the type for your code; the room's `sanitize`
 * clamp is what actually enforces it against a modified client.
 */
export const HeroInput = schema({
  moveX: t.int8<-1 | 0 | 1>(),
  moveY: t.int8<-1 | 0 | 1>(),
  attack: t.boolean(),
}, "HeroInput");
export type HeroInput = SchemaType<typeof HeroInput>;

export const Hero = schema({
  // Everything `stepHero()` reads or writes (HERO_SIM_FIELDS): the owner predicts these.
  // float64, not `t.number()`: the auto codec drops to float32 when the loss is
  // under 1e-4, and the reconciler should adopt the server's pose bit-for-bit.
  x: t.float64().default(0),
  y: t.float64().default(0),
  kx: t.float64().default(0),
  ky: t.float64().default(0),
  facing: t.uint8().default(2),
  swing: t.uint8().default(0),
  cooldown: t.uint8().default(0),

  name: t.string(),
  seat: t.uint8(),
  /** Steps of post-hit invulnerability left; heroes blink while > 0. */
  invuln: t.uint8().default(0),
  connected: t.boolean().default(true),
  kills: t.uint16().default(0),
}, "Hero");
export type Hero = SchemaType<typeof Hero>;

export const Slime = schema({
  // Interpolated by clients, never predicted: float32 is plenty.
  x: t.float32(),
  y: t.float32(),
  kind: t.uint8(),
  /** 0 while the death animation plays, just before the slime is removed. */
  hp: t.uint8(),
  maxHp: t.uint8(),
}, "Slime");
export type Slime = SchemaType<typeof Slime>;

export const DungeonState = schema({
  /** The floor layout is `generateDungeon(seed, floor)`, rebuilt by each client. */
  seed: t.uint32(),
  floor: t.uint8(),
  /** Shared by the whole party. */
  lives: t.uint8(),
  keyTaken: t.boolean(),
  stairsOpen: t.boolean(),
  gameOver: t.boolean(),
  /** Seconds until the run restarts, while `gameOver`. */
  restartIn: t.uint8(),
  heroes: t.map(Hero),
  slimes: t.map(Slime),
}, "DungeonState");
export type DungeonState = SchemaType<typeof DungeonState>;
