import {
  COLS, ROWS, TILE, WORLD_WIDTH, WORLD_HEIGHT, HERO_HALF, HERO_MAX_HP,
  SLIME_HALF, SLIME_HP, SWORD_REACH, TEAM_LIVES,
} from "../shared/constants.js";
import { isWall, tileCenter, type Dungeon } from "../shared/dungeon.js";
import { Fx } from "./fx.js";

export const HERO_COLORS = ["#27f3ff", "#ff3df0", "#ffe94a", "#ff8c2b"];
const SLIME_COLOR = "#5dff7a";
const WALL_GLOW = "#8a5cff";
const BG = "#05040a";
const FONT = "ui-monospace, 'SF Mono', Menlo, Consolas, monospace";

const HUD_TOP = 44;
const HUD_BOTTOM = 28;
export const VIEW_WIDTH = WORLD_WIDTH;
export const VIEW_HEIGHT = HUD_TOP + WORLD_HEIGHT + HUD_BOTTOM;

const SWING_HALF_ARC = (65 * Math.PI) / 180;

export type ConnectionStatus = "online" | "reconnecting" | "offline";

export interface HeroSprite {
  id: string;
  x: number; y: number;
  facing: number;
  color: number;
  hp: number;
  connected: boolean;
  self: boolean;
}

export interface SlimeSprite { id: string; x: number; y: number; hp: number; }

export interface Frame {
  now: number;
  floor: number;
  lives: number;
  mode: string;
  stairsOpen: boolean;
  heroes: HeroSprite[];
  slimes: SlimeSprite[];
  ping: number;
  status: ConnectionStatus;
}

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private map: Dungeon | null = null;
  private mapLayer: HTMLCanvasElement | null = null;
  private pixelRatio = 1;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d")!;
    this.resize();
    addEventListener("resize", () => this.resize());
  }

  setMap(map: Dungeon) {
    this.map = map;
    this.mapLayer = null;
  }

  /** Fits the fixed logical view into the window, crisp on high-DPI screens. */
  private resize() {
    const scale = Math.max(0.3, Math.min(innerWidth / VIEW_WIDTH, innerHeight / VIEW_HEIGHT));
    this.pixelRatio = scale * (devicePixelRatio || 1);
    this.canvas.style.width = `${Math.floor(VIEW_WIDTH * scale)}px`;
    this.canvas.style.height = `${Math.floor(VIEW_HEIGHT * scale)}px`;
    this.canvas.width = Math.floor(VIEW_WIDTH * this.pixelRatio);
    this.canvas.height = Math.floor(VIEW_HEIGHT * this.pixelRatio);
    this.mapLayer = null;
  }

  draw(frame: Frame, fx: Fx) {
    const { ctx } = this;
    const { now } = frame;
    ctx.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, VIEW_WIDTH, VIEW_HEIGHT);

    if (this.map) {
      const shake = fx.shakeOffset(now);
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, HUD_TOP, WORLD_WIDTH, WORLD_HEIGHT);
      ctx.clip();
      ctx.translate(shake.x, HUD_TOP + shake.y);
      this.drawWorld(frame, fx);
      ctx.restore();
      this.drawVignette(fx, now);
    }

    this.drawHud(frame);
    this.drawBanner(fx, now);
  }

  // --- world ----------------------------------------------------------------

  private drawWorld(frame: Frame, fx: Fx) {
    const { ctx } = this;
    const { now } = frame;
    if (!this.mapLayer) { this.mapLayer = this.renderMapLayer(this.map!); }
    ctx.drawImage(this.mapLayer, 0, 0, WORLD_WIDTH, WORLD_HEIGHT);

    this.drawEntrance(now);
    this.drawStairs(frame.stairsOpen, now);

    ctx.globalCompositeOperation = "lighter";
    for (const s of frame.slimes) { this.drawTrail(fx, s.id, SLIME_COLOR, 5, 0.25); }
    for (const h of frame.heroes) {
      if (h.connected) { this.drawTrail(fx, h.id, HERO_COLORS[h.color % 4], HERO_HALF * 0.9, 0.55); }
    }
    ctx.globalCompositeOperation = "source-over";

    for (const s of frame.slimes) { this.drawSlime(s, fx, now); }
    for (const h of frame.heroes) { this.drawHero(h, fx, now); }

    ctx.globalCompositeOperation = "lighter";
    for (const p of fx.particles) {
      const t = 1 - (now - p.born) / p.life;
      ctx.globalAlpha = Math.max(0, t);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }

  /** Walls, floor and neon edges never change within a floor: draw them once. */
  private renderMapLayer(map: Dungeon) {
    const layer = document.createElement("canvas");
    layer.width = Math.ceil(WORLD_WIDTH * this.pixelRatio);
    layer.height = Math.ceil(WORLD_HEIGHT * this.pixelRatio);
    const g = layer.getContext("2d")!;
    g.scale(this.pixelRatio, this.pixelRatio);

    g.fillStyle = "#07060e";
    g.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);

    for (let ty = 0; ty < ROWS; ty++) {
      for (let tx = 0; tx < COLS; tx++) {
        if (isWall(map, tx, ty)) { continue; }
        g.fillStyle = (tx + ty) % 2 === 0 ? "#0d0b1c" : "#0f0d20";
        g.fillRect(tx * TILE, ty * TILE, TILE, TILE);
        g.fillStyle = "#1d1838";
        g.fillRect(tx * TILE + TILE / 2 - 1, ty * TILE + TILE / 2 - 1, 2, 2);
      }
    }

    // Neon trim on every wall face that borders the floor.
    g.beginPath();
    for (let ty = 0; ty < ROWS; ty++) {
      for (let tx = 0; tx < COLS; tx++) {
        if (!isWall(map, tx, ty)) { continue; }
        const x = tx * TILE, y = ty * TILE;
        if (ty > 0 && !isWall(map, tx, ty - 1)) { g.moveTo(x, y); g.lineTo(x + TILE, y); }
        if (ty < ROWS - 1 && !isWall(map, tx, ty + 1)) { g.moveTo(x, y + TILE); g.lineTo(x + TILE, y + TILE); }
        if (tx > 0 && !isWall(map, tx - 1, ty)) { g.moveTo(x, y); g.lineTo(x, y + TILE); }
        if (tx < COLS - 1 && !isWall(map, tx + 1, ty)) { g.moveTo(x + TILE, y); g.lineTo(x + TILE, y + TILE); }
      }
    }
    g.lineCap = "round";
    g.strokeStyle = WALL_GLOW;
    g.shadowColor = WALL_GLOW;
    g.shadowBlur = 14;
    g.lineWidth = 2;
    g.stroke();
    g.shadowBlur = 4;
    g.strokeStyle = "#c9b5ff";
    g.lineWidth = 1;
    g.stroke();
    return layer;
  }

  private drawEntrance(now: number) {
    const { ctx } = this;
    const x = tileCenter(this.map!.entrance.tx), y = tileCenter(this.map!.entrance.ty);
    ctx.strokeStyle = "rgba(39, 243, 255, 0.25)";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 6]);
    ctx.lineDashOffset = -now / 60;
    ctx.beginPath();
    ctx.arc(x, y, TILE * 0.9, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  private drawStairs(open: boolean, now: number) {
    const { ctx } = this;
    const cx = tileCenter(this.map!.stairs.tx), cy = tileCenter(this.map!.stairs.ty);
    const pulse = 0.5 + 0.5 * Math.sin(now / 180);
    const color = open ? "#fff3a0" : "#3b3452";

    ctx.save();
    if (open) {
      ctx.shadowColor = "#ffd84a";
      ctx.shadowBlur = 18 + pulse * 18;
    }
    ctx.fillStyle = open ? "rgba(255, 216, 74, 0.12)" : "rgba(59, 52, 82, 0.35)";
    ctx.fillRect(cx - TILE / 2 + 2, cy - TILE / 2 + 2, TILE - 4, TILE - 4);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.strokeRect(cx - TILE / 2 + 2, cy - TILE / 2 + 2, TILE - 4, TILE - 4);
    // Descending steps.
    for (let i = 0; i < 3; i++) {
      const w = TILE - 10 - i * 6;
      ctx.fillStyle = color;
      ctx.globalAlpha = open ? 0.9 - i * 0.25 : 0.6;
      ctx.fillRect(cx - w / 2, cy - 7 + i * 6, w, 3);
    }
    ctx.restore();

    if (open) {
      ctx.strokeStyle = `rgba(255, 243, 160, ${0.5 * (1 - pulse)})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, TILE * (0.6 + pulse * 0.6), 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  private drawTrail(fx: Fx, id: string, color: string, width: number, alpha: number) {
    const points = fx.trails.get(id);
    if (!points || points.length < 2) { return; }
    const { ctx } = this;
    ctx.strokeStyle = color;
    ctx.lineCap = "round";
    for (let i = 1; i < points.length; i++) {
      const t = i / points.length;
      ctx.globalAlpha = alpha * t;
      ctx.lineWidth = width * t * 2;
      ctx.beginPath();
      ctx.moveTo(points[i - 1].x, points[i - 1].y);
      ctx.lineTo(points[i].x, points[i].y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  private drawSlime(s: SlimeSprite, fx: Fx, now: number) {
    const { ctx } = this;
    const phase = hash(s.id);
    const wobble = Math.sin(now / 130 + phase);
    const rx = SLIME_HALF * (1.1 + wobble * 0.12);
    const ry = SLIME_HALF * (0.95 - wobble * 0.12);
    const flashing = fx.isFlashing(s.id, now);

    ctx.save();
    ctx.shadowColor = SLIME_COLOR;
    ctx.shadowBlur = 16;
    ctx.fillStyle = flashing ? "#ffffff" : "rgba(93, 255, 122, 0.78)";
    ctx.beginPath();
    ctx.ellipse(s.x, s.y + (SLIME_HALF - ry), rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    if (!flashing) {
      ctx.fillStyle = "rgba(220, 255, 225, 0.55)";
      ctx.beginPath();
      ctx.ellipse(s.x - rx * 0.35, s.y - ry * 0.25, rx * 0.25, ry * 0.18, -0.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#06240c";
      ctx.fillRect(s.x - 5, s.y - 1, 3, 4);
      ctx.fillRect(s.x + 2, s.y - 1, 3, 4);
    }

    if (s.hp < SLIME_HP) {
      ctx.fillStyle = "#1a3a20";
      ctx.fillRect(s.x - 9, s.y + SLIME_HALF + 4, 18, 3);
      ctx.fillStyle = SLIME_COLOR;
      ctx.fillRect(s.x - 9, s.y + SLIME_HALF + 4, 18 * (s.hp / SLIME_HP), 3);
    }
  }

  private drawHero(h: HeroSprite, fx: Fx, now: number) {
    const { ctx } = this;
    const color = HERO_COLORS[h.color % 4];
    const angle = (h.facing * Math.PI) / 4;

    // Sword arc first, so the body sits on top of it.
    const swing = fx.swingProgress(h.id, now);
    if (swing >= 0) {
      const sweep = -SWING_HALF_ARC + swing * SWING_HALF_ARC * 2;
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.shadowColor = color;
      ctx.shadowBlur = 20;
      ctx.globalAlpha = 1 - swing * 0.6;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(h.x, h.y, SWORD_REACH, angle - SWING_HALF_ARC, angle + sweep);
      ctx.arc(h.x, h.y, SWORD_REACH * 0.55, angle + sweep, angle - SWING_HALF_ARC, true);
      ctx.closePath();
      ctx.globalAlpha *= 0.35;
      ctx.fill();
      ctx.globalAlpha = 1 - swing * 0.4;
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(h.x + Math.cos(angle + sweep) * HERO_HALF, h.y + Math.sin(angle + sweep) * HERO_HALF);
      ctx.lineTo(h.x + Math.cos(angle + sweep) * SWORD_REACH, h.y + Math.sin(angle + sweep) * SWORD_REACH);
      ctx.stroke();
      ctx.restore();
    }

    if (fx.isBlinking(h.id, now)) { return; }

    ctx.save();
    ctx.globalAlpha = h.connected ? 1 : 0.35;
    ctx.shadowColor = color;
    ctx.shadowBlur = h.connected ? 22 : 4;
    ctx.fillStyle = fx.isFlashing(h.id, now) ? "#ffffff" : color;
    roundRect(ctx, h.x - HERO_HALF, h.y - HERO_HALF, HERO_HALF * 2, HERO_HALF * 2, 5);
    ctx.fill();
    ctx.shadowBlur = 0;

    // Visor: a dark slit on the side the hero faces.
    ctx.translate(h.x + Math.cos(angle) * 4, h.y + Math.sin(angle) * 4);
    ctx.rotate(angle);
    ctx.fillStyle = "rgba(5, 4, 10, 0.85)";
    ctx.fillRect(-2, -6, 4, 12);
    ctx.restore();

    // Facing pip just outside the body.
    ctx.fillStyle = color;
    ctx.globalAlpha = h.connected ? 0.9 : 0.3;
    ctx.beginPath();
    ctx.arc(h.x + Math.cos(angle) * (HERO_HALF + 5), h.y + Math.sin(angle) * (HERO_HALF + 5), 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    ctx.font = `600 9px ${FONT}`;
    ctx.textAlign = "center";
    ctx.fillStyle = h.connected ? color : "#8a8699";
    const label = h.connected ? (h.self ? "YOU" : `P${h.color + 1}`) : `P${h.color + 1} · OFFLINE`;
    ctx.fillText(label, h.x, h.y - HERO_HALF - 6);
  }

  private drawVignette(fx: Fx, now: number) {
    const t = (now - fx.damageAt) / 450;
    if (t < 0 || t > 1) { return; }
    const { ctx } = this;
    const g = ctx.createRadialGradient(
      WORLD_WIDTH / 2, HUD_TOP + WORLD_HEIGHT / 2, WORLD_HEIGHT * 0.35,
      WORLD_WIDTH / 2, HUD_TOP + WORLD_HEIGHT / 2, WORLD_WIDTH * 0.65,
    );
    g.addColorStop(0, "rgba(255, 30, 60, 0)");
    g.addColorStop(1, `rgba(255, 30, 60, ${0.45 * (1 - t)})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, HUD_TOP, WORLD_WIDTH, WORLD_HEIGHT);
  }

  // --- HUD ------------------------------------------------------------------

  private drawHud(frame: Frame) {
    const { ctx } = this;
    ctx.fillStyle = "#08071199";
    ctx.fillRect(0, 0, VIEW_WIDTH, HUD_TOP);
    ctx.fillRect(0, VIEW_HEIGHT - HUD_BOTTOM, VIEW_WIDTH, HUD_BOTTOM);
    ctx.fillStyle = "#2a2350";
    ctx.fillRect(0, HUD_TOP - 1, VIEW_WIDTH, 1);
    ctx.fillRect(0, VIEW_HEIGHT - HUD_BOTTOM, VIEW_WIDTH, 1);

    const mid = HUD_TOP / 2 + 5;
    ctx.textAlign = "left";

    ctx.font = `700 18px ${FONT}`;
    glowText(ctx, `FLOOR ${String(frame.floor).padStart(2, "0")}`, 16, mid, "#e9e4ff", "#8a5cff");

    const hard = frame.mode === "hard";
    ctx.font = `700 10px ${FONT}`;
    chip(ctx, hard ? "HARD" : "NORMAL", 128, mid - 12, hard ? "#ff4a6a" : "#27f3ff");

    ctx.font = `600 10px ${FONT}`;
    ctx.fillStyle = "#8f88b3";
    ctx.fillText("LIVES", 204, mid);
    for (let i = 0; i < TEAM_LIVES; i++) {
      heart(ctx, 250 + i * 18, mid - 5, i < frame.lives);
    }

    let x = 358;
    const heroes = [...frame.heroes].sort((a, b) => a.color - b.color);
    for (const h of heroes) {
      const color = HERO_COLORS[h.color % 4];
      ctx.globalAlpha = h.connected ? 1 : 0.4;
      ctx.fillStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = 8;
      ctx.fillRect(x, mid - 9, 10, 10);
      ctx.shadowBlur = 0;
      ctx.font = `600 11px ${FONT}`;
      ctx.fillText(h.self ? "YOU" : `P${h.color + 1}`, x + 15, mid);
      for (let i = 0; i < HERO_MAX_HP; i++) {
        ctx.fillStyle = i < h.hp ? color : "#2a2645";
        ctx.fillRect(x + 46 + i * 9, mid - 8, 6, 8);
      }
      ctx.globalAlpha = 1;
      x += 86;
    }

    // Connection: status + ping, right-aligned.
    const status = {
      online: { label: "ONLINE", color: "#5dff7a" },
      reconnecting: { label: "RECONNECTING…", color: "#ffd84a" },
      offline: { label: "OFFLINE", color: "#ff4a6a" },
    }[frame.status];
    ctx.textAlign = "right";
    ctx.font = `600 11px ${FONT}`;
    ctx.fillStyle = "#8f88b3";
    const ping = frame.status === "online" ? `${Math.round(frame.ping)} ms` : "— ms";
    ctx.fillText(`PING ${ping}`, VIEW_WIDTH - 16, mid);
    const pingWidth = ctx.measureText(`PING ${ping}`).width;
    ctx.fillStyle = status.color;
    ctx.fillText(status.label, VIEW_WIDTH - 32 - pingWidth, mid);
    const labelWidth = ctx.measureText(status.label).width;
    ctx.beginPath();
    ctx.arc(VIEW_WIDTH - 42 - pingWidth - labelWidth, mid - 4, 3.5, 0, Math.PI * 2);
    ctx.shadowColor = status.color;
    ctx.shadowBlur = 8;
    ctx.fill();
    ctx.shadowBlur = 0;

    // Bottom bar.
    const base = VIEW_HEIGHT - 10;
    ctx.textAlign = "left";
    ctx.font = `600 11px ${FONT}`;
    if (frame.stairsOpen) {
      ctx.fillStyle = "#fff3a0";
      ctx.fillText("▼ STAIRS OPEN — step on them to descend", 16, base);
    } else {
      ctx.fillStyle = SLIME_COLOR;
      ctx.fillText(`SLIMES LEFT ${frame.slimes.length}`, 16, base);
    }
    ctx.textAlign = "right";
    ctx.fillStyle = "#6f6893";
    ctx.fillText("WASD / ARROWS move · SPACE swing", VIEW_WIDTH - 16, base);
  }

  private drawBanner(fx: Fx, now: number) {
    const alpha = fx.bannerAlpha(now);
    if (!fx.banner || alpha <= 0) { return; }
    const { ctx } = this;
    const cy = HUD_TOP + WORLD_HEIGHT / 2;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = "rgba(5, 4, 10, 0.55)";
    ctx.fillRect(0, cy - 44, VIEW_WIDTH, 80);
    ctx.textAlign = "center";
    ctx.font = `800 34px ${FONT}`;
    glowText(ctx, fx.banner.text, VIEW_WIDTH / 2, cy, "#ffffff", fx.banner.color);
    if (fx.banner.sub) {
      ctx.font = `600 12px ${FONT}`;
      ctx.fillStyle = fx.banner.color;
      ctx.fillText(fx.banner.sub, VIEW_WIDTH / 2, cy + 24);
    }
    ctx.globalAlpha = 1;
  }
}

function glowText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, fill: string, glow: string) {
  ctx.save();
  ctx.shadowColor = glow;
  ctx.shadowBlur = 12;
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
  ctx.restore();
}

function chip(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string) {
  const w = ctx.measureText(text).width + 12;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  roundRect(ctx, x + 0.5, y + 0.5, w, 16, 3);
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.fillText(text, x + 6, y + 12);
}

function heart(ctx: CanvasRenderingContext2D, x: number, y: number, full: boolean) {
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();
  ctx.moveTo(0, 4);
  ctx.bezierCurveTo(0, 1, -6, -1, -6, -4 + 1);
  ctx.bezierCurveTo(-6, -8, 0, -8, 0, -4);
  ctx.bezierCurveTo(0, -8, 6, -8, 6, -3);
  ctx.bezierCurveTo(6, -1, 0, 1, 0, 4);
  ctx.closePath();
  if (full) {
    ctx.shadowColor = "#ff3d6e";
    ctx.shadowBlur = 10;
    ctx.fillStyle = "#ff3d6e";
    ctx.fill();
  } else {
    ctx.strokeStyle = "#4a2a3a";
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }
  ctx.restore();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Stable per-id animation phase. */
function hash(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) { h = (h * 31 + id.charCodeAt(i)) | 0; }
  return (h % 1000) / 159;
}
