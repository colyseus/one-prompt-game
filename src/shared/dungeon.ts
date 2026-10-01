import { createRng, hashSeed, randInt, type Rng } from "./rng.js";
import { pickSlimeKind, slimeCount, SLIME_KING } from "./slimes.js";

export const FLOOR = 0;
export const WALL = 1;

export interface Point { x: number; y: number; }
export interface RoomRect { x: number; y: number; w: number; h: number; }
export interface SlimeSpawn { x: number; y: number; kind: number; }

/**
 * One generated floor. Pure function of `(seed, floor)`: the server only syncs
 * those two numbers and every client rebuilds the identical layout locally, so
 * the tile grid never crosses the wire and the predicted hero collides with the
 * same walls the server does.
 */
export interface Dungeon {
  seed: number;
  floor: number;
  width: number;
  height: number;
  /** Row-major, `tiles[y * width + x]`, FLOOR or WALL. */
  tiles: Uint8Array;
  rooms: RoomRect[];
  spawn: Point;
  stairs: Point;
  key: Point;
}

export function floorSize(floor: number): number {
  return Math.min(60, 28 + floor * 3);
}

export function roomCount(floor: number): number {
  return Math.min(14, 5 + floor);
}

export function isWall(d: Dungeon, tx: number, ty: number): boolean {
  if (tx < 0 || ty < 0 || tx >= d.width || ty >= d.height) { return true; }
  return d.tiles[ty * d.width + tx] === WALL;
}

export function isWallAt(d: Dungeon, x: number, y: number): boolean {
  return isWall(d, Math.floor(x), Math.floor(y));
}

const roomCenter = (r: RoomRect): Point => ({ x: r.x + (r.w >> 1), y: r.y + (r.h >> 1) });

export function generateDungeon(seed: number, floor: number): Dungeon {
  // A cramped seed can fail to fit enough rooms; re-roll deterministically.
  for (let attempt = 0; ; attempt++) {
    const d = tryGenerate(seed, floor, createRng(hashSeed(seed, floor, attempt)));
    if (d) { return d; }
  }
}

function tryGenerate(seed: number, floor: number, rng: Rng): Dungeon | undefined {
  const size = floorSize(floor);
  const width = size, height = size;
  const tiles = new Uint8Array(width * height).fill(WALL);
  const carve = (x: number, y: number) => {
    if (x > 0 && y > 0 && x < width - 1 && y < height - 1) { tiles[y * width + x] = FLOOR; }
  };

  const rooms: RoomRect[] = [];
  const target = roomCount(floor);
  for (let tries = 0; tries < 500 && rooms.length < target; tries++) {
    const w = randInt(rng, 4, 8);
    const h = randInt(rng, 4, 7);
    const x = randInt(rng, 1, width - w - 1);
    const y = randInt(rng, 1, height - h - 1);
    const overlaps = rooms.some((r) =>
      x < r.x + r.w + 2 && x + w + 2 > r.x && y < r.y + r.h + 2 && y + h + 2 > r.y);
    if (overlaps) { continue; }
    rooms.push({ x, y, w, h });
    for (let ty = y; ty < y + h; ty++) {
      for (let tx = x; tx < x + w; tx++) { carve(tx, ty); }
    }
  }
  if (rooms.length < 3) { return undefined; }

  // Two-wide L corridors: roomy enough for a co-op crowd and a sword arc.
  const corridor = (a: Point, b: Point) => {
    const horizontalFirst = rng() < 0.5;
    const hx = (y: number, x0: number, x1: number) => {
      for (let x = Math.min(x0, x1); x <= Math.max(x0, x1) + 1; x++) { carve(x, y); carve(x, y + 1); }
    };
    const vy = (x: number, y0: number, y1: number) => {
      for (let y = Math.min(y0, y1); y <= Math.max(y0, y1) + 1; y++) { carve(x, y); carve(x + 1, y); }
    };
    if (horizontalFirst) { hx(a.y, a.x, b.x); vy(b.x, a.y, b.y); }
    else { vy(a.x, a.y, b.y); hx(b.y, a.x, b.x); }
  };

  // Spanning tree (nearest connected room), plus a few loops so slimes can't
  // corner the whole party in a single dead end.
  const connected = [rooms[0]];
  for (let i = 1; i < rooms.length; i++) {
    const c = roomCenter(rooms[i]);
    let best = connected[0], bestDist = Infinity;
    for (const other of connected) {
      const o = roomCenter(other);
      const dist = Math.abs(o.x - c.x) + Math.abs(o.y - c.y);
      if (dist < bestDist) { best = other; bestDist = dist; }
    }
    corridor(roomCenter(best), c);
    connected.push(rooms[i]);
  }
  for (let i = 0; i < rooms.length >> 2; i++) {
    corridor(roomCenter(rooms[randInt(rng, 0, rooms.length - 1)]), roomCenter(rooms[randInt(rng, 0, rooms.length - 1)]));
  }

  const dungeon: Dungeon = {
    seed, floor, width, height, tiles, rooms,
    spawn: { x: 0, y: 0 }, stairs: { x: 0, y: 0 }, key: { x: 0, y: 0 },
  };

  // Stairs go in the room farthest (by walking distance) from the spawn.
  const spawnTile = roomCenter(rooms[0]);
  const dist = bfsDistances(dungeon, [spawnTile.y * width + spawnTile.x]);
  const byDistance = rooms.slice(1)
    .map((room) => { const c = roomCenter(room); return { room, d: dist[c.y * width + c.x] }; })
    .sort((a, b) => b.d - a.d);
  const stairsRoom = byDistance[0].room;

  // Key: somewhere in the farther half of the remaining rooms.
  const keyCandidates = byDistance.slice(1, Math.max(2, Math.ceil(byDistance.length / 2)));
  const keyRoom = keyCandidates[randInt(rng, 0, keyCandidates.length - 1)].room;

  const center = (r: RoomRect): Point => { const c = roomCenter(r); return { x: c.x + 0.5, y: c.y + 0.5 }; };
  dungeon.spawn = center(rooms[0]);
  dungeon.stairs = center(stairsRoom);
  dungeon.key = center(keyRoom);
  return dungeon;
}

/**
 * Where this floor's slimes start. Separate RNG stream from the layout, so the
 * party size changes how many slimes spawn without changing the map.
 */
export function slimeSpawns(d: Dungeon, heroCount: number): SlimeSpawn[] {
  const rng = createRng(hashSeed(d.seed, d.floor, 0x51173, heroCount));
  const spawns: SlimeSpawn[] = [];
  const rooms = d.rooms.slice(1);
  const stairsRoom = rooms.find((r) => containsPoint(r, d.stairs));
  const reserved = [d.stairs, d.key];

  const count = slimeCount(d.floor, heroCount);
  for (let i = 0, tries = 0; i < count && tries < count * 20; tries++) {
    const room = rooms[randInt(rng, 0, rooms.length - 1)];
    const x = randInt(rng, room.x, room.x + room.w - 1) + 0.5;
    const y = randInt(rng, room.y, room.y + room.h - 1) + 0.5;
    if (reserved.some((p) => Math.abs(p.x - x) < 1 && Math.abs(p.y - y) < 1)) { continue; }
    if (spawns.some((s) => s.x === x && s.y === y)) { continue; }
    spawns.push({ x, y, kind: pickSlimeKind(d.floor, rng) });
    i++;
  }

  // Every third floor a king slime guards the stairs.
  if (d.floor % 3 === 0 && stairsRoom) {
    const kx = stairsRoom.x + 1.5;
    const ky = stairsRoom.y + 1.5;
    spawns.push({ x: kx, y: ky, kind: SLIME_KING });
  }
  return spawns;
}

function containsPoint(r: RoomRect, p: Point): boolean {
  return p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h;
}

const NEIGHBORS: ReadonlyArray<readonly [number, number]> = [
  [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1],
];

/**
 * Multi-source walking distance (in tiles) over floor tiles, 8-connected with
 * no corner cutting. -1 marks walls and unreachable tiles.
 */
export function bfsDistances(d: Dungeon, sources: number[], out?: Int16Array): Int16Array {
  const { width, height, tiles } = d;
  const dist = out ?? new Int16Array(width * height);
  dist.fill(-1);
  const queue = new Int32Array(width * height);
  let head = 0, tail = 0;
  for (const s of sources) {
    if (s >= 0 && s < tiles.length && tiles[s] === FLOOR && dist[s] === -1) {
      dist[s] = 0;
      queue[tail++] = s;
    }
  }
  while (head < tail) {
    const cur = queue[head++];
    const cx = cur % width, cy = (cur - cx) / width;
    for (const [ox, oy] of NEIGHBORS) {
      const nx = cx + ox, ny = cy + oy;
      if (isWall(d, nx, ny)) { continue; }
      if (ox !== 0 && oy !== 0 && (isWall(d, cx + ox, cy) || isWall(d, cx, cy + oy))) { continue; }
      const n = ny * width + nx;
      if (dist[n] !== -1) { continue; }
      dist[n] = dist[cur] + 1;
      queue[tail++] = n;
    }
  }
  return dist;
}

/** Whether a straight walk from a to b stays clear of walls (sampled). */
export function hasLineOfSight(d: Dungeon, ax: number, ay: number, bx: number, by: number): boolean {
  const dx = bx - ax, dy = by - ay;
  const steps = Math.ceil(Math.sqrt(dx * dx + dy * dy) / 0.25);
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    if (isWallAt(d, ax + dx * t, ay + dy * t)) { return false; }
  }
  return true;
}
