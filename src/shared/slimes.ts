import type { Rng } from "./rng.js";

export interface SlimeKind {
  name: string;
  hp: number;
  /** Tiles per second, before the per-floor multiplier. */
  speed: number;
  radius: number;
}

export const SLIME_GREEN = 0;
export const SLIME_BLUE = 1;
export const SLIME_PINK = 2;
export const SLIME_KING = 3;

export const SLIME_KINDS: readonly SlimeKind[] = [
  { name: "green", hp: 2, speed: 1.7, radius: 0.32 },
  { name: "blue", hp: 3, speed: 2.3, radius: 0.34 },
  { name: "pink", hp: 5, speed: 1.9, radius: 0.42 },
  { name: "king", hp: 14, speed: 1.5, radius: 0.7 },
];

export function slimeCount(floor: number, heroCount: number): number {
  return Math.round(3 + floor * 1.6 + Math.max(0, heroCount - 1) * 1.5);
}

export function slimeSpeedMultiplier(floor: number): number {
  return Math.min(1.5, 1 + (floor - 1) * 0.06);
}

/** Walking distance (tiles) within which slimes notice a hero. */
export function slimeAggroRange(floor: number): number {
  return Math.min(14, 6 + floor * 0.8);
}

export function pickSlimeKind(floor: number, rng: Rng): number {
  const roll = rng();
  if (floor <= 1) { return SLIME_GREEN; }
  if (floor === 2) { return roll < 0.7 ? SLIME_GREEN : SLIME_BLUE; }
  if (floor === 3) { return roll < 0.45 ? SLIME_GREEN : roll < 0.85 ? SLIME_BLUE : SLIME_PINK; }
  return roll < 0.3 ? SLIME_GREEN : roll < 0.7 ? SLIME_BLUE : SLIME_PINK;
}
