import * as THREE from "three";
import { SLIME_KINDS, SLIME_KING } from "../../shared/slimes.js";
import { angleDelta } from "./heroView.js";

export const SLIME_COLORS = ["#7ee38f", "#72b8ff", "#ff8fbd", "#b98cff"];

const DEATH_SECONDS = 0.45;
const SQUASH = 0.78;

const eyeMaterial = new THREE.MeshStandardMaterial({ color: "#241a33", roughness: 0.2 });
const highlightMaterial = new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.85 });
const crownMaterial = new THREE.MeshStandardMaterial({ color: "#ffcf4a", metalness: 0.6, roughness: 0.3, side: THREE.DoubleSide });
const white = new THREE.Color("#ffffff");

/** A wobbly jelly blob with a face. Local +x is the way it's looking. */
export class SlimeView {
  readonly root = new THREE.Group();

  private readonly blob = new THREE.Group();
  private readonly material: THREE.MeshPhysicalMaterial;
  private readonly baseEmissive: THREE.Color;
  private readonly radius: number;
  private readonly hpCanvas = document.createElement("canvas");
  private readonly hpBar: THREE.Sprite;
  private shownHp = -1;

  private flash = 0;
  private punch = 0;
  private dyingAge = -1;
  private hop = Math.random() * 10;
  private yaw = Math.random() * Math.PI * 2;
  private lastX = NaN;
  private lastZ = NaN;

  constructor(kind: number) {
    const r = this.radius = SLIME_KINDS[kind].radius;
    const color = new THREE.Color(SLIME_COLORS[kind] ?? SLIME_COLORS[0]);
    this.baseEmissive = color.clone().multiplyScalar(0.25);
    this.material = new THREE.MeshPhysicalMaterial({
      color, roughness: 0.15, clearcoat: 1, clearcoatRoughness: 0.08,
      transparent: true, opacity: 0.9, emissive: this.baseEmissive.clone(),
    });

    const body = new THREE.Mesh(new THREE.SphereGeometry(r, 28, 18), this.material);
    body.scale.y = SQUASH;
    body.castShadow = true;
    this.blob.add(body);

    // Eyes and a tiny smile, sitting on the squashed sphere's surface.
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(r * 0.13, 12, 8), eyeMaterial);
      eye.scale.set(0.55, 1.25, 1);
      eye.position.set(r * 0.9, r * 0.1, side * r * 0.33);
      const glint = new THREE.Mesh(new THREE.SphereGeometry(r * 0.04, 6, 4), highlightMaterial);
      glint.position.set(r * 0.08, r * 0.05, 0);
      eye.add(glint);
      this.blob.add(eye);
    }
    const smile = new THREE.Mesh(new THREE.TorusGeometry(r * 0.09, r * 0.018, 6, 12, Math.PI), eyeMaterial);
    smile.rotation.set(0, Math.PI / 2, Math.PI);
    smile.position.set(r * 0.95, -r * 0.1, 0);
    const shine = new THREE.Mesh(new THREE.SphereGeometry(r * 0.22, 12, 8), highlightMaterial);
    shine.scale.set(1, 0.4, 0.75);
    shine.position.set(-r * 0.25, r * 0.66, -r * 0.3);
    this.blob.add(smile, shine);

    if (kind === SLIME_KING) {
      const crown = new THREE.Group();
      const band = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.38, r * 0.4, r * 0.18, 20, 1, true), crownMaterial);
      crown.add(band);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const point = new THREE.Mesh(new THREE.ConeGeometry(r * 0.07, r * 0.2, 6), crownMaterial);
        point.position.set(Math.cos(a) * r * 0.38, r * 0.18, Math.sin(a) * r * 0.38);
        crown.add(point);
      }
      crown.position.y = r * SQUASH * 0.95;
      crown.traverse((o) => { o.castShadow = true; });
      this.blob.add(crown);
    }

    this.blob.position.y = r * SQUASH;
    this.root.add(this.blob);

    this.hpCanvas.width = 64;
    this.hpCanvas.height = 12;
    const texture = new THREE.CanvasTexture(this.hpCanvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    this.hpBar = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true }));
    this.hpBar.scale.set(Math.max(0.5, r * 1.6), Math.max(0.09, r * 0.22), 1);
    this.hpBar.position.y = r * SQUASH * 2 + 0.25;
    this.hpBar.renderOrder = 9;
    this.hpBar.visible = false;
    this.root.add(this.hpBar);
  }

  /** Squish + white flash: a sword just connected. */
  hit() {
    this.flash = 1;
    this.punch = 1;
  }

  die() {
    if (this.dyingAge < 0) { this.dyingAge = 0; }
  }

  get dying(): boolean { return this.dyingAge >= 0; }
  get finished(): boolean { return this.dyingAge >= DEATH_SECONDS; }

  update(dt: number, time: number, x: number, z: number, hp: number, maxHp: number) {
    this.root.position.set(x, 0, z);

    const dx = Number.isNaN(this.lastX) ? 0 : x - this.lastX;
    const dz = Number.isNaN(this.lastZ) ? 0 : z - this.lastZ;
    this.lastX = x;
    this.lastZ = z;
    const speed = dt > 0 ? Math.hypot(dx, dz) / dt : 0;
    const moving = speed > 0.25 && speed < 25;
    if (moving) {
      this.yaw += angleDelta(this.yaw, Math.atan2(dz, dx)) * (1 - Math.exp(-dt * 10));
    }
    this.root.rotation.y = -this.yaw;

    const size = this.radius / 0.32;
    let sx = 1, sy = 1, lift = 0;
    if (moving) {
      this.hop += dt * (7 + speed * 1.5) / Math.sqrt(size);
      const s = Math.abs(Math.sin(this.hop));
      lift = s * 0.14 * size;
      sy = 0.88 + 0.22 * s;
      sx = 1.08 - 0.12 * s;
    } else {
      const breathe = Math.sin(time * 3 + this.hop);
      sy = 1 + breathe * 0.04;
      sx = 1 - breathe * 0.02;
    }

    this.punch *= Math.exp(-dt * 12);
    this.flash *= Math.exp(-dt * 14);
    sx *= 1 + this.punch * 0.25;
    sy *= 1 - this.punch * 0.2;

    if (this.dyingAge >= 0) {
      this.dyingAge += dt;
      const t = Math.min(1, this.dyingAge / DEATH_SECONDS);
      sy *= Math.max(0.05, 1 - t);
      sx *= 1 + t * 0.7;
      lift = 0;
      this.material.opacity = 0.9 * (1 - t);
    }

    this.blob.scale.set(sx, sy, sx);
    this.blob.position.y = this.radius * SQUASH * sy + lift;
    this.material.emissive.copy(this.baseEmissive).lerp(white, Math.min(1, this.flash));

    if (hp !== this.shownHp) {
      this.shownHp = hp;
      this.hpBar.visible = maxHp > 2 && hp > 0 && hp < maxHp;
      if (this.hpBar.visible) { this.drawHp(hp / maxHp); }
    }
  }

  dispose() {
    this.root.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.Sprite) { o.geometry.dispose(); }
    });
    this.material.dispose();
    this.hpBar.material.map?.dispose();
    this.hpBar.material.dispose();
  }

  private drawHp(fraction: number) {
    const g = this.hpCanvas.getContext("2d")!;
    g.clearRect(0, 0, 64, 12);
    g.fillStyle = "rgba(42, 30, 66, 0.8)";
    g.beginPath();
    g.roundRect(0, 0, 64, 12, 6);
    g.fill();
    g.fillStyle = "#ff6f9a";
    g.beginPath();
    g.roundRect(2, 2, Math.max(4, 60 * fraction), 8, 4);
    g.fill();
    this.hpBar.material.map!.needsUpdate = true;
  }
}
