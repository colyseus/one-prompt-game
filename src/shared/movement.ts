import { HERO_HALF, HERO_SPEED, SWORD_COOLDOWN_TICKS } from "./constants.js";
import { moveBox, type Dungeon } from "./dungeon.js";

/**
 * Structural types on purpose: the same step runs on a server Schema instance
 * and on the client reconciler's plain predicted copy, with no schema runtime
 * involved in the simulation.
 */
export interface HeroState { x: number; y: number; facing: number; cooldown: number; }
export interface HeroInputLike { moveX: number; moveY: number; attack: boolean; }

const D = Math.SQRT1_2;

/** Unit vector per facing, clockwise from east (y grows downwards). */
export const FACING: ReadonlyArray<readonly [number, number]> = [
  [1, 0], [D, D], [0, 1], [-D, D], [-1, 0], [-D, -D], [0, -1], [D, -D],
];

// Indexed by (moveX + 1) * 3 + (moveY + 1); -1 means "not moving".
const FACING_OF_AXES = [5, 4, 3, 6, -1, 2, 7, 0, 1];

/**
 * The single hero step, run identically by the server (once per received
 * input) and by the client reconciler (predict, then replay on rollback).
 *
 * Pure function of (hero, input, map, dt): no clocks, no randomness, no reads
 * outside its arguments. The cooldown counts steps, so a replay reproduces it
 * exactly. Returns true on the step a swing starts; judging what it hits is
 * the server's job.
 */
export function stepHero(hero: HeroState, input: HeroInputLike, map: Dungeon, dt: number): boolean {
  if (hero.cooldown > 0) { hero.cooldown -= 1; }

  const facing = FACING_OF_AXES[(input.moveX + 1) * 3 + (input.moveY + 1)] ?? -1;
  if (facing >= 0) {
    const [fx, fy] = FACING[facing];
    hero.facing = facing;
    moveBox(hero, fx * HERO_SPEED * dt, fy * HERO_SPEED * dt, HERO_HALF, map);
  }

  if (input.attack && hero.cooldown === 0) {
    hero.cooldown = SWORD_COOLDOWN_TICKS;
    return true;
  }
  return false;
}
