/**
 * Presentation-only effects: particles, trails, flashes, banners and screen
 * shake. Nothing here feeds back into the simulation, so it is free to use
 * wall-clock time and Math.random.
 */

export interface Particle {
  x: number; y: number;
  vx: number; vy: number;
  born: number; life: number;
  size: number;
  color: string;
}

export interface Banner { text: string; sub: string; color: string; born: number; }

export const SWING_MS = 170;
export const FLASH_MS = 110;
export const HURT_BLINK_MS = 1000;
const TRAIL_MS = 140;
const BANNER_MS = 2000;

export class Fx {
  particles: Particle[] = [];
  trails = new Map<string, { x: number; y: number; t: number }[]>();
  /** Swing start per hero; may lie in the future for remote heroes (see scheduleSwing). */
  swings = new Map<string, number>();
  flashes = new Map<string, number>();
  hurts = new Map<string, number>();
  banner: Banner | null = null;
  /** Red vignette after your own hero is hit. */
  damageAt = -Infinity;

  private shakeMag = 0;
  private shakeAt = 0;

  swing(id: string, at: number) { this.swings.set(id, at); }
  flash(id: string, at: number) { this.flashes.set(id, at); }
  hurt(id: string, at: number) { this.hurts.set(id, at); this.flashes.set(id, at); }

  shake(magnitude: number, now: number) {
    this.shakeMag = Math.max(this.currentShake(now), magnitude);
    this.shakeAt = now;
  }

  showBanner(text: string, sub: string, color: string, now: number) {
    this.banner = { text, sub, color, born: now };
  }

  burst(x: number, y: number, color: string, count: number, speed: number, now: number) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = speed * (0.35 + Math.random() * 0.65);
      this.particles.push({
        x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
        born: now, life: 260 + Math.random() * 380,
        size: 1.5 + Math.random() * 2.5, color,
      });
    }
  }

  /** Records a rendered position; the trail is whatever of it is younger than TRAIL_MS. */
  trail(id: string, x: number, y: number, now: number) {
    let points = this.trails.get(id);
    if (!points) { this.trails.set(id, points = []); }
    const last = points[points.length - 1];
    // A jump this big is a teleport: don't streak across the map.
    if (last && Math.hypot(x - last.x, y - last.y) > 48) { points.length = 0; }
    points.push({ x, y, t: now });
    while (points.length > 0 && now - points[0].t > TRAIL_MS) { points.shift(); }
  }

  forget(id: string) {
    this.trails.delete(id);
    this.swings.delete(id);
    this.flashes.delete(id);
    this.hurts.delete(id);
  }

  /** 0..1 progress of the swing on screen, or -1 when not swinging. */
  swingProgress(id: string, now: number) {
    const at = this.swings.get(id);
    if (at === undefined || now < at) { return -1; }
    const t = (now - at) / SWING_MS;
    return t > 1 ? -1 : t;
  }

  isFlashing(id: string, now: number) {
    const at = this.flashes.get(id);
    return at !== undefined && now - at < FLASH_MS;
  }

  isBlinking(id: string, now: number) {
    const at = this.hurts.get(id);
    return at !== undefined && now - at < HURT_BLINK_MS && Math.floor((now - at) / 70) % 2 === 1;
  }

  bannerAlpha(now: number) {
    if (!this.banner) { return 0; }
    const t = (now - this.banner.born) / BANNER_MS;
    if (t >= 1) { this.banner = null; return 0; }
    return t < 0.1 ? t / 0.1 : t > 0.7 ? (1 - t) / 0.3 : 1;
  }

  shakeOffset(now: number) {
    const m = this.currentShake(now);
    if (m < 0.05) { return { x: 0, y: 0 }; }
    return { x: (Math.random() * 2 - 1) * m, y: (Math.random() * 2 - 1) * m };
  }

  update(dtMs: number, now: number) {
    const dt = dtMs / 1000;
    const drag = Math.pow(0.02, dt); // frame-rate independent
    this.particles = this.particles.filter((p) => now - p.born < p.life);
    for (const p of this.particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= drag;
      p.vy *= drag;
    }
  }

  private currentShake(now: number) {
    // Exponential decay, ~95% gone after 300ms.
    return this.shakeMag * Math.exp(-(now - this.shakeAt) / 100);
  }
}
