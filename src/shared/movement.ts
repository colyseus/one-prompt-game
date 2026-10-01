import {
  ATTACK_COOLDOWN_TICKS, HERO_RADIUS, HERO_SPEED, KNOCKBACK_DECAY, SWING_SLOWDOWN, SWING_TICKS,
} from "./constants.js";
import { isWall, type Dungeon } from "./dungeon.js";

/**
 * Structural types on purpose: the same step runs on a server Schema instance
 * and on the client reconciler's plain predicted copy, with no schema runtime
 * involved in the simulation.
 */
export interface Body { x: number; y: number; }

export interface HeroSim extends Body {
  /** Knockback velocity (tiles/s), set by the server when a slime lands a hit. */
  kx: number;
  ky: number;
  /** 0..7, clockwise from east (+y points south). */
  facing: number;
  /** Steps left in the current swing. */
  swing: number;
  /** Steps until the next swing may start. */
  cooldown: number;
}

/** The fields of {@link HeroSim}, i.e. what the owning client predicts and reconciles. */
export const HERO_SIM_FIELDS = ["x", "y", "kx", "ky", "facing", "swing", "cooldown"] as const;

export interface HeroCommand { moveX: -1 | 0 | 1; moveY: -1 | 0 | 1; attack: boolean; }

/** Facing index for each (moveX, moveY) pair, indexed by `(moveY + 1) * 3 + (moveX + 1)`. */
const FACING_BY_AXES = [5, 6, 7, 4, -1, 0, 3, 2, 1];

const EPS = 1e-4;
const MAX_SUBSTEP = 0.4;

/**
 * Moves an axis-aligned box of half-size `r` through the tile grid, sliding
 * along walls. Each sub-move stays under one tile, so only the tile column (or
 * row) at the leading edge can be newly entered.
 */
export function moveBody(d: Dungeon, body: Body, dx: number, dy: number, r: number): { hitX: boolean; hitY: boolean } {
  const n = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / MAX_SUBSTEP));
  const sx = dx / n, sy = dy / n;
  let hitX = false, hitY = false;
  for (let i = 0; i < n; i++) {
    if (sx !== 0 && moveX(d, body, sx, r)) { hitX = true; }
    if (sy !== 0 && moveY(d, body, sy, r)) { hitY = true; }
  }
  return { hitX, hitY };
}

function moveX(d: Dungeon, b: Body, dx: number, r: number): boolean {
  const nx = b.x + dx;
  const y0 = Math.floor(b.y - r), y1 = Math.floor(b.y + r);
  const tx = dx > 0 ? Math.floor(nx + r) : Math.floor(nx - r);
  for (let ty = y0; ty <= y1; ty++) {
    if (isWall(d, tx, ty)) {
      b.x = dx > 0 ? tx - r - EPS : tx + 1 + r + EPS;
      return true;
    }
  }
  b.x = nx;
  return false;
}

function moveY(d: Dungeon, b: Body, dy: number, r: number): boolean {
  const ny = b.y + dy;
  const x0 = Math.floor(b.x - r), x1 = Math.floor(b.x + r);
  const ty = dy > 0 ? Math.floor(ny + r) : Math.floor(ny - r);
  for (let tx = x0; tx <= x1; tx++) {
    if (isWall(d, tx, ty)) {
      b.y = dy > 0 ? ty - r - EPS : ty + 1 + r + EPS;
      return true;
    }
  }
  b.y = ny;
  return false;
}

const decay = (v: number) => {
  const next = v * KNOCKBACK_DECAY;
  return Math.abs(next) < 0.05 ? 0 : next;
};

/**
 * The single hero step, run identically by the server (once per received
 * input) and by the client reconciler (predict, then replay on rollback).
 *
 * Pure function of (dungeon, hero, command, dt): no clocks, no randomness, no
 * trig. Returns whether a sword swing started on this step, so the server can
 * resolve the hit and the client can play the swing the instant it's pressed.
 */
export function stepHero(d: Dungeon, hero: HeroSim, cmd: HeroCommand, dt: number): boolean {
  if (hero.swing > 0) { hero.swing--; }
  if (hero.cooldown > 0) { hero.cooldown--; }

  const mx = cmd.moveX, my = cmd.moveY;
  if (mx !== 0 || my !== 0) { hero.facing = FACING_BY_AXES[(my + 1) * 3 + (mx + 1)]; }

  let speed = hero.swing > 0 ? HERO_SPEED * SWING_SLOWDOWN : HERO_SPEED;
  if (mx !== 0 && my !== 0) { speed *= Math.SQRT1_2; }

  const hit = moveBody(d, hero, (mx * speed + hero.kx) * dt, (my * speed + hero.ky) * dt, HERO_RADIUS);
  hero.kx = hit.hitX ? 0 : decay(hero.kx);
  hero.ky = hit.hitY ? 0 : decay(hero.ky);

  if (cmd.attack && hero.cooldown === 0) {
    hero.swing = SWING_TICKS;
    hero.cooldown = ATTACK_COOLDOWN_TICKS;
    return true;
  }
  return false;
}
