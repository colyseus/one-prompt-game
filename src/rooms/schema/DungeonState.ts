import { schema, t, type SchemaType } from "@colyseus/schema";
import { HERO_MAX_HP, SLIME_HP, TEAM_LIVES } from "../../shared/constants.js";

/**
 * One input frame, consumed by `Room.defineInput()`. Flat primitives only, and
 * deliberately minimal:
 *   - no `seq`  — the engine's input counter is the sequence
 *   - no `dt`   — fixed timestep: one input advances exactly one step
 *   - no time   — the SDK stamps lag-comp timing on the wire envelope
 *
 * `int8<-1 | 0 | 1>` narrows the type for your code; the room's `sanitize`
 * clamp is what actually enforces it against a modified client. `attack` is a
 * tap: the client sets it on exactly one step per Space press.
 */
export const HeroInput = schema({
  moveX: t.int8<-1 | 0 | 1>(),
  moveY: t.int8<-1 | 0 | 1>(),
  attack: t.boolean(),
}, "HeroInput");
export type HeroInput = SchemaType<typeof HeroInput>;

export const Hero = schema({
  // Stepped by the shared `stepHero`, and predicted by the owning client.
  x: t.number(),
  y: t.number(),
  /** Index into `FACING` (0 = east, clockwise). */
  facing: t.uint8().default(0),
  /** Sword cooldown, in steps. */
  cooldown: t.uint8().default(0),

  // Server-decided.
  hp: t.uint8().default(HERO_MAX_HP),
  /** Palette slot, unique among the heroes in the room. */
  color: t.uint8(),
  connected: t.boolean().default(true),

  /** Steps of invulnerability left after a hit or a respawn. */
  invuln: t.uint8().noSync().default(0),
}, "Hero");
export type Hero = SchemaType<typeof Hero>;

export const Slime = schema({
  x: t.number(),
  y: t.number(),
  hp: t.uint8().default(SLIME_HP),

  /** Steps left reeling from a hit, during which it doesn't chase. */
  stun: t.uint8().noSync().default(0),
}, "Slime");
export type Slime = SchemaType<typeof Slime>;

export const DungeonState = schema({
  mode: t.string().default("normal"),
  /** The floor layout is generated from this on every peer; tiles are never synced. */
  seed: t.uint32(),
  floor: t.uint8().default(1),
  /** Shared by the whole team. */
  lives: t.uint8().default(TEAM_LIVES),
  stairsOpen: t.boolean(),

  heroes: t.map(Hero),
  slimes: t.map(Slime),
}, "DungeonState");
export type DungeonState = SchemaType<typeof DungeonState>;
