import { COLS, ROWS, TILE } from "./constants.js";
import { mulberry32, randInt } from "./rng.js";

/** A rectangle in tile coordinates. */
export interface Rect { x: number; y: number; w: number; h: number; }

export interface TilePoint { tx: number; ty: number; }

export const WALL = 1;
export const FLOOR = 0;

/**
 * One floor's layout. Built from a seed by {@link generateDungeon} on both the
 * server and the client, so the walls a predicted hero collides with are
 * exactly the server's.
 */
export interface Dungeon {
  seed: number;
  /** Row-major, `COLS × ROWS`: {@link WALL} or {@link FLOOR}. */
  tiles: Uint8Array;
  rooms: Rect[];
  entrance: TilePoint;
  stairs: TilePoint;
}

const roomCenter = (r: Rect): TilePoint =>
  ({ tx: r.x + Math.floor(r.w / 2), ty: r.y + Math.floor(r.h / 2) });

const overlaps = (a: Rect, b: Rect, margin: number) =>
  a.x - margin < b.x + b.w && a.x + a.w + margin > b.x &&
  a.y - margin < b.y + b.h && a.y + a.h + margin > b.y;

/**
 * A few rooms joined left-to-right by 2-tile-wide L-shaped corridors, plus the
 * occasional extra loop. The entrance is in the leftmost room; the stairs are
 * in the room farthest from it by walking distance.
 */
export function generateDungeon(seed: number): Dungeon {
  const rand = mulberry32(seed);
  const tiles = new Uint8Array(COLS * ROWS).fill(WALL);
  const carve = (tx: number, ty: number) => { tiles[ty * COLS + tx] = FLOOR; };

  const rooms: Rect[] = [];
  const target = randInt(rand, 5, 7);
  for (let attempt = 0; attempt < 400 && rooms.length < target; attempt++) {
    const w = randInt(rand, 5, 9);
    const h = randInt(rand, 4, 6);
    const room = { x: randInt(rand, 1, COLS - w - 1), y: randInt(rand, 1, ROWS - h - 1), w, h };
    if (!rooms.some((other) => overlaps(room, other, 2))) { rooms.push(room); }
  }
  rooms.sort((a, b) => (a.x - b.x) || (a.y - b.y));

  for (const r of rooms) {
    for (let ty = r.y; ty < r.y + r.h; ty++) {
      for (let tx = r.x; tx < r.x + r.w; tx++) { carve(tx, ty); }
    }
  }

  const corridor = (a: TilePoint, b: TilePoint, horizontalFirst: boolean) => {
    const hLine = (x0: number, x1: number, ty: number) => {
      for (let tx = Math.min(x0, x1); tx <= Math.max(x0, x1) + 1; tx++) { carve(tx, ty); carve(tx, ty + 1); }
    };
    const vLine = (y0: number, y1: number, tx: number) => {
      for (let ty = Math.min(y0, y1); ty <= Math.max(y0, y1) + 1; ty++) { carve(tx, ty); carve(tx + 1, ty); }
    };
    if (horizontalFirst) { hLine(a.tx, b.tx, a.ty); vLine(a.ty, b.ty, b.tx); }
    else { vLine(a.ty, b.ty, a.tx); hLine(a.tx, b.tx, b.ty); }
  };

  for (let i = 1; i < rooms.length; i++) {
    corridor(roomCenter(rooms[i - 1]), roomCenter(rooms[i]), rand() < 0.5);
  }
  if (rooms.length >= 4 && rand() < 0.6) {
    const i = randInt(rand, 0, rooms.length - 3);
    corridor(roomCenter(rooms[i]), roomCenter(rooms[i + 2]), rand() < 0.5);
  }

  const dungeon: Dungeon = { seed, tiles, rooms, entrance: roomCenter(rooms[0]), stairs: roomCenter(rooms[0]) };

  // Stairs go in whichever room is the longest walk from the entrance.
  const dist = distanceField(dungeon, [dungeon.entrance]);
  let best = -1;
  for (const r of rooms.slice(1)) {
    const c = roomCenter(r);
    const d = dist[c.ty * COLS + c.tx];
    if (d > best) { best = d; dungeon.stairs = c; }
  }
  if (best < 0) {
    // A single-room floor: the far corner will do.
    const r = rooms[0];
    dungeon.stairs = { tx: r.x + r.w - 1, ty: r.y + r.h - 1 };
  }
  return dungeon;
}

export function isWall(d: Dungeon, tx: number, ty: number): boolean {
  if (tx < 0 || ty < 0 || tx >= COLS || ty >= ROWS) { return true; }
  return d.tiles[ty * COLS + tx] === WALL;
}

export const tileOf = (v: number) => Math.floor(v / TILE);
export const tileCenter = (t: number) => t * TILE + TILE / 2;

// Keeps a box's far edge from counting as inside the next tile when it sits exactly on a boundary.
const EDGE = 1e-6;

/**
 * Moves an axis-aligned box by (dx, dy), one axis at a time, stopping flush
 * against walls so it slides along them. Moves must stay under one tile.
 * Pure arithmetic and `Math.floor` only: bit-identical on every peer.
 */
export function moveBox(body: { x: number; y: number }, dx: number, dy: number, half: number, d: Dungeon): void {
  if (dx !== 0) {
    let nx = body.x + dx;
    const top = tileOf(body.y - half);
    const bottom = tileOf(body.y + half - EDGE);
    const tx = dx > 0 ? tileOf(nx + half - EDGE) : tileOf(nx - half);
    for (let ty = top; ty <= bottom; ty++) {
      if (isWall(d, tx, ty)) { nx = dx > 0 ? tx * TILE - half : (tx + 1) * TILE + half; break; }
    }
    body.x = nx;
  }
  if (dy !== 0) {
    let ny = body.y + dy;
    const left = tileOf(body.x - half);
    const right = tileOf(body.x + half - EDGE);
    const ty = dy > 0 ? tileOf(ny + half - EDGE) : tileOf(ny - half);
    for (let tx = left; tx <= right; tx++) {
      if (isWall(d, tx, ty)) { ny = dy > 0 ? ty * TILE - half : (ty + 1) * TILE + half; break; }
    }
    body.y = ny;
  }
}

/**
 * Multi-source BFS over floor tiles (4-connected): steps from the nearest
 * source, or -1 where unreachable.
 */
export function distanceField(d: Dungeon, sources: TilePoint[], out = new Int16Array(COLS * ROWS)): Int16Array {
  out.fill(-1);
  const queue = new Int32Array(COLS * ROWS);
  let head = 0, tail = 0;
  for (const s of sources) {
    const i = s.ty * COLS + s.tx;
    if (isWall(d, s.tx, s.ty) || out[i] !== -1) { continue; }
    out[i] = 0;
    queue[tail++] = i;
  }
  while (head < tail) {
    const i = queue[head++];
    const tx = i % COLS, ty = (i / COLS) | 0;
    const next = out[i] + 1;
    const visit = (nx: number, ny: number) => {
      if (isWall(d, nx, ny)) { return; }
      const j = ny * COLS + nx;
      if (out[j] === -1) { out[j] = next; queue[tail++] = j; }
    };
    visit(tx + 1, ty); visit(tx - 1, ty); visit(tx, ty + 1); visit(tx, ty - 1);
  }
  return out;
}
