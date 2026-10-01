import { HERO_RADIUS, SWORD_HALF_ARC, SWORD_REACH } from "./constants.js";
import { hasLineOfSight, type Dungeon } from "./dungeon.js";

/** Unit vector per facing index (0 = east, clockwise, +y south). */
export const FACING_VECTORS: ReadonlyArray<readonly [number, number]> =
  Array.from({ length: 8 }, (_, i) => [Math.cos((i * Math.PI) / 4), Math.sin((i * Math.PI) / 4)] as const);

/**
 * Whether a sword swung from (hx, hy) towards `facing` reaches a round target.
 * The arc widens by the target's angular size, so big slimes are easier to clip.
 */
export function swordHits(
  d: Dungeon, hx: number, hy: number, facing: number,
  tx: number, ty: number, targetRadius: number,
): boolean {
  const dx = tx - hx, dy = ty - hy;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist > SWORD_REACH + targetRadius) { return false; }
  if (!hasLineOfSight(d, hx, hy, tx, ty)) { return false; }
  if (dist <= HERO_RADIUS + targetRadius) { return true; }

  const [fx, fy] = FACING_VECTORS[facing & 7];
  const cos = Math.max(-1, Math.min(1, (dx * fx + dy * fy) / dist));
  const angularRadius = Math.asin(Math.min(1, targetRadius / dist));
  return Math.acos(cos) <= SWORD_HALF_ARC + angularRadius;
}
