/** Simulation rate in Hz. One input advances exactly one step at this rate. */
export const TICK_RATE = 30;

/** Tile size in world units; a floor is COLS × ROWS tiles and fits on one screen. */
export const TILE = 32;
export const COLS = 30;
export const ROWS = 20;

export const WORLD_WIDTH = COLS * TILE;
export const WORLD_HEIGHT = ROWS * TILE;

/** Half-extent of a hero's collision box. */
export const HERO_HALF = 10;

/** Hero units per second at full stick. */
export const HERO_SPEED = 150;

export const HERO_MAX_HP = 3;
export const TEAM_LIVES = 5;

/** Sword cooldown, in fixed steps (never milliseconds: it is replayed by prediction). */
export const SWORD_COOLDOWN_TICKS = 12;

/** How many of the cooldown's first ticks draw the swing arc. */
export const SWORD_SWING_TICKS = 5;

/** Reach from the hero's centre to the tip of the blade. */
export const SWORD_REACH = 40;

/** Half-angle of the swing arc, as a cosine (≈ ±65°). */
export const SWORD_ARC_COS = Math.cos((65 * Math.PI) / 180);

export const SLIME_HALF = 10;
export const SLIME_HP = 2;
export const SLIME_SPEED = { normal: 58, hard: 96 } as const;

/** Server-side ticks of invulnerability after a hit, and after a respawn. */
export const HIT_INVULN_TICKS = 30;
export const RESPAWN_INVULN_TICKS = 60;

/** Slimes on a floor: grows with depth, capped so a floor stays readable. */
export function slimeCountFor(floor: number): number {
  return Math.min(3 + floor * 2, 28);
}

/** Remote interpolation buffer (ms); also the lag-comp render delay. */
export const INTERP_DELAY_MS = 100;

/** Any jump larger than this is a teleport (respawn, next floor): pop, don't glide. */
export const SNAP_DISTANCE = 64;

export type GameMode = "normal" | "hard";
