import * as THREE from "three";
import { SWING_TICKS, SWORD_HALF_ARC, SWORD_REACH, TICK_RATE } from "../../shared/constants.js";

export const SEAT_COLORS = ["#ff9ec4", "#86e3bf", "#8cc8ff", "#ffd36a"];

const SWING_SECONDS = SWING_TICKS / TICK_RATE;
const steel = new THREE.MeshStandardMaterial({ color: "#eef3ff", metalness: 0.8, roughness: 0.2 });
const hilt = new THREE.MeshStandardMaterial({ color: "#8a5a3c", roughness: 0.7 });
const guard = new THREE.MeshStandardMaterial({ color: "#ffcc4d", metalness: 0.6, roughness: 0.3 });
const eyeWhite = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.3 });
const eyeDark = new THREE.MeshStandardMaterial({ color: "#2a1d3a", roughness: 0.2 });
const blush = new THREE.MeshBasicMaterial({ color: "#ff8fb0", transparent: true, opacity: 0.6 });

/** Shortest signed difference between two angles. */
export function angleDelta(from: number, to: number): number {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

function nameTag(text: string, color: string): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 72;
  const g = canvas.getContext("2d")!;
  g.font = "bold 40px ui-rounded, 'Nunito', system-ui, sans-serif";
  const w = Math.min(240, g.measureText(text).width + 36);
  g.fillStyle = "rgba(42, 30, 66, 0.72)";
  g.beginPath();
  g.roundRect((256 - w) / 2, 8, w, 56, 28);
  g.fill();
  g.fillStyle = color;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text, 128, 38);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true }));
  sprite.scale.set(1.1, 0.31, 1);
  sprite.renderOrder = 10;
  return sprite;
}

/** One hat per seat, so the party is easy to tell apart. */
function hat(seat: number, color: THREE.Color): THREE.Object3D {
  const g = new THREE.Group();
  const mat = (c: THREE.ColorRepresentation, extra: THREE.MeshStandardMaterialParameters = {}) =>
    new THREE.MeshStandardMaterial({ color: c, roughness: 0.6, ...extra });
  switch (seat % 4) {
    case 0: { // bunny ears
      for (const side of [-1, 1]) {
        const ear = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.2, 6, 12), mat(color));
        ear.position.set(-0.02, 0.2, side * 0.1);
        ear.rotation.x = side * 0.25;
        const inner = new THREE.Mesh(new THREE.CapsuleGeometry(0.03, 0.14, 4, 8), mat("#ffd1e3"));
        inner.position.set(0.035, 0, 0);
        ear.add(inner);
        g.add(ear);
      }
      break;
    }
    case 1: { // leaf sprout
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.02, 0.14, 6), mat("#4c9a5a"));
      stem.position.y = 0.07;
      g.add(stem);
      for (const side of [-1, 1]) {
        const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 8), mat("#5ccf7a"));
        leaf.scale.set(1.6, 0.35, 0.8);
        leaf.position.set(0, 0.15, side * 0.08);
        leaf.rotation.x = side * -0.5;
        g.add(leaf);
      }
      break;
    }
    case 2: { // wizard hat
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.03, 24), mat("#4b3f9e"));
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.36, 20), mat("#4b3f9e"));
      cone.position.set(-0.03, 0.19, 0);
      cone.rotation.z = 0.25;
      const star = new THREE.Mesh(new THREE.OctahedronGeometry(0.045), mat("#ffe27a", { emissive: "#ffd34d", emissiveIntensity: 0.6 }));
      star.position.set(0.12, 0.12, 0);
      g.add(brim, cone, star);
      break;
    }
    default: { // crown
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.09, 20, 1, true),
        mat("#ffc93c", { metalness: 0.6, roughness: 0.3, side: THREE.DoubleSide }));
      band.position.y = 0.04;
      g.add(band);
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        const point = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.08, 6), mat("#ffc93c", { metalness: 0.6, roughness: 0.3 }));
        point.position.set(Math.cos(a) * 0.14, 0.12, Math.sin(a) * 0.14);
        g.add(point);
      }
      const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.03), mat("#ff5f8f", { emissive: "#ff5f8f", emissiveIntensity: 0.4 }));
      gem.position.set(0.15, 0.05, 0);
      g.add(gem);
    }
  }
  return g;
}

/**
 * A round little adventurer. Local +x is the facing direction and +z its right
 * hand, so `root.rotation.y = -facingAngle` turns it towards (cos, sin) in x/z.
 */
export class HeroView {
  readonly root = new THREE.Group();

  private readonly body = new THREE.Group();
  private readonly feet: THREE.Mesh[] = [];
  private readonly swordPivot = new THREE.Group();
  private readonly arc: THREE.Mesh;
  private readonly materials: THREE.Material[] = [];
  private readonly selfRing?: THREE.Mesh;

  private yaw = 0;
  private swingAge = Infinity;
  private pendingSwing = -1;
  private walkPhase = 0;
  private lastX = NaN;
  private lastZ = NaN;
  private ghost = false;

  constructor(seat: number, name: string, isSelf: boolean) {
    const color = new THREE.Color(SEAT_COLORS[seat % SEAT_COLORS.length]);
    const skin = new THREE.MeshStandardMaterial({ color, roughness: 0.55 });
    const belly = new THREE.MeshStandardMaterial({ color: color.clone().lerp(new THREE.Color("#ffffff"), 0.55), roughness: 0.6 });
    this.materials.push(skin, belly);

    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.27, 0.2, 8, 20), skin);
    torso.position.y = 0.4;
    torso.castShadow = true;
    const tummy = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 12), belly);
    tummy.scale.set(0.5, 0.9, 0.9);
    tummy.position.set(0.19, 0.33, 0);

    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.075, 14, 10), eyeWhite);
      eye.position.set(0.235, 0.52, side * 0.1);
      eye.scale.set(0.6, 1.1, 1);
      const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 8), eyeDark);
      pupil.position.set(0.04, -0.005, 0);
      const shine = new THREE.Mesh(new THREE.SphereGeometry(0.016, 6, 4), eyeWhite);
      shine.position.set(0.075, 0.02, side * -0.015);
      eye.add(pupil, shine);
      const cheek = new THREE.Mesh(new THREE.CircleGeometry(0.045, 16), blush);
      cheek.position.set(0.222, 0.43, side * 0.17);
      cheek.rotation.y = Math.PI / 2 - side * 0.68;
      this.body.add(eye, cheek);
    }

    const head = hat(seat, color);
    head.position.y = 0.68;
    head.traverse((o) => { if (o instanceof THREE.Mesh) { o.castShadow = true; this.materials.push(o.material); } });
    this.body.add(torso, tummy, head);

    for (const side of [-1, 1]) {
      const foot = new THREE.Mesh(new THREE.SphereGeometry(0.085, 12, 8), skin);
      foot.scale.set(1.3, 0.6, 1);
      foot.position.set(0.02, 0.05, side * 0.13);
      foot.castShadow = true;
      this.feet.push(foot);
      this.root.add(foot);
    }

    // Sword: built along +x from the pivot, so pivot yaw = blade direction.
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.035, 0.07), steel);
    blade.position.x = 0.4;
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.09, 4), steel);
    tip.rotation.z = -Math.PI / 2;
    tip.position.x = 0.67;
    const crossguard = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.05, 0.2), guard);
    crossguard.position.x = 0.16;
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.14, 8), hilt);
    handle.rotation.z = Math.PI / 2;
    handle.position.x = 0.08;
    this.swordPivot.add(blade, tip, crossguard, handle);
    this.swordPivot.traverse((o) => { o.castShadow = true; });
    this.swordPivot.position.y = 0.38;

    // Swoosh: a flat ring sector matching the server's hit arc.
    this.arc = new THREE.Mesh(
      new THREE.RingGeometry(0.35, SWORD_REACH, 28, 1, -SWORD_HALF_ARC, SWORD_HALF_ARC * 2),
      new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }),
    );
    this.arc.rotation.x = -Math.PI / 2;
    this.arc.position.y = 0.3;
    this.arc.visible = false;

    if (isSelf) {
      this.selfRing = new THREE.Mesh(
        new THREE.RingGeometry(0.36, 0.44, 32),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7, depthWrite: false, toneMapped: false }),
      );
      this.selfRing.rotation.x = -Math.PI / 2;
      this.selfRing.position.y = 0.015;
      this.root.add(this.selfRing);
    }

    const tag = nameTag(isSelf ? `${name} (you)` : name, SEAT_COLORS[seat % SEAT_COLORS.length]);
    tag.position.y = 1.28;

    this.root.add(this.body, this.swordPivot, this.arc, tag);
  }

  /** Play a swing, optionally after `delay` seconds (to line up with interpolated remotes). */
  startSwing(delay = 0) {
    if (delay > 0) { this.pendingSwing = delay; } else { this.swingAge = 0; }
  }

  get swinging(): boolean {
    return this.swingAge < SWING_SECONDS;
  }

  update(dt: number, time: number, x: number, z: number, facing: number, invuln: number, connected: boolean) {
    this.root.position.set(x, 0, z);

    // Walk cycle from how far the rendered position actually moved.
    const moved = Number.isNaN(this.lastX) ? 0 : Math.hypot(x - this.lastX, z - this.lastZ);
    this.lastX = x;
    this.lastZ = z;
    const speed = dt > 0 ? moved / dt : 0;
    const walking = speed > 0.6 && speed < 20;
    this.walkPhase += dt * (walking ? 15 : 0);
    if (!walking) { this.walkPhase *= Math.exp(-dt * 10); }
    const bob = walking ? Math.abs(Math.sin(this.walkPhase)) : 0;
    this.body.position.y = bob * 0.06 + Math.sin(time * 2.5) * 0.008;
    this.body.scale.set(1 + bob * 0.03, 1 - bob * 0.04, 1 + bob * 0.03);
    this.feet[0].position.x = 0.02 + Math.sin(this.walkPhase) * 0.09;
    this.feet[1].position.x = 0.02 - Math.sin(this.walkPhase) * 0.09;

    const target = (facing * Math.PI) / 4;
    this.yaw += angleDelta(this.yaw, target) * (1 - Math.exp(-dt * 20));
    this.root.rotation.y = -this.yaw;

    if (this.pendingSwing >= 0) {
      this.pendingSwing -= dt;
      if (this.pendingSwing < 0) { this.swingAge = 0; }
    }

    // Blade sweeps right → left across the arc; at rest it rides on the right hip.
    const arcMat = this.arc.material as THREE.MeshBasicMaterial;
    if (this.swinging) {
      const t = this.swingAge / SWING_SECONDS;
      const eased = 1 - (1 - Math.min(1, t * 1.6)) ** 3;
      this.swordPivot.rotation.set(0, -SWORD_HALF_ARC + eased * SWORD_HALF_ARC * 2, 0);
      this.swordPivot.position.set(0, 0.36, 0);
      this.arc.visible = true;
      arcMat.opacity = 0.55 * (1 - t) ** 2;
      this.arc.scale.setScalar(0.85 + eased * 0.15);
      this.swingAge += dt;
    } else {
      this.swordPivot.rotation.set(0.3, -1.3, 1.1);
      this.swordPivot.position.set(-0.02, 0.32, 0.27);
      this.arc.visible = false;
    }

    // Blink while invulnerable.
    this.body.visible = invuln === 0 || Math.floor(time * 14) % 2 === 0;

    if (this.ghost === connected) {
      this.ghost = !connected;
      for (const m of this.materials) {
        m.transparent = this.ghost;
        m.opacity = this.ghost ? 0.35 : 1;
      }
    }

    if (this.selfRing) {
      this.selfRing.scale.setScalar(1 + Math.sin(time * 3) * 0.05);
    }
  }

  dispose() {
    this.root.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.Sprite) {
        o.geometry.dispose();
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
          if (m === steel || m === hilt || m === guard || m === eyeWhite || m === eyeDark || m === blush) { continue; }
          (m as THREE.SpriteMaterial).map?.dispose();
          m.dispose();
        }
      }
    });
  }
}
