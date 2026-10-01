/** Simulation rate in Hz. One input advances exactly one step at this rate. */
export const TICK_RATE = 30;

/** World units are tiles: 1 unit = 1 dungeon tile. */
export const HERO_RADIUS = 0.3;

/** Tiles per second at full stick. */
export const HERO_SPEED = 5;

/** Movement multiplier while a swing is in progress. */
export const SWING_SLOWDOWN = 0.55;

/** Steps a swing lasts (animation + slowdown), and steps before the next one. */
export const SWING_TICKS = 8;
export const ATTACK_COOLDOWN_TICKS = 11;

/** Sword reach from the hero's centre, and the half-angle of its arc. */
export const SWORD_REACH = 1.25;
export const SWORD_HALF_ARC = (75 * Math.PI) / 180;

/** Knockback: initial speed (tiles/s) and per-step decay factor. */
export const KNOCKBACK_SPEED = 9;
export const KNOCKBACK_DECAY = 0.8;

/** Invulnerability after a hero is hit, or after arriving on a new floor. */
export const HURT_INVULN_TICKS = Math.round(TICK_RATE * 1.5);
export const FLOOR_INVULN_TICKS = Math.round(TICK_RATE * 2);

/** Shared lives pool. */
export const START_LIVES = 5;
export const MAX_LIVES = 9;

/** Seconds the "game over" banner holds before the run restarts. */
export const GAME_OVER_SECONDS = 4;

export const MAX_HEROES = 4;

/** Hero colours/names by seat, for the cute palette. */
export const HERO_NAMES = ["Mochi", "Pip", "Taro", "Bun"] as const;

/** Pickup radius for the key and the stairs. */
export const KEY_PICKUP_RADIUS = 0.7;
export const STAIRS_RADIUS = 0.6;
