import * as THREE from "three";

const CAPACITY = 600;
const STRIDE = 3;

/** Every puff, spark and sparkle in the game, drawn with one instanced mesh. */
export class Particles {
  readonly mesh: THREE.InstancedMesh;

  private pos = new Float32Array(CAPACITY * STRIDE);
  private vel = new Float32Array(CAPACITY * STRIDE);
  private life = new Float32Array(CAPACITY);
  private maxLife = new Float32Array(CAPACITY);
  private size = new Float32Array(CAPACITY);
  private gravity = new Float32Array(CAPACITY);
  private next = 0;

  private readonly matrix = new THREE.Matrix4();
  private readonly color = new THREE.Color();
  private readonly zero = new THREE.Matrix4().makeScale(0, 0, 0);

  constructor() {
    this.mesh = new THREE.InstancedMesh(
      new THREE.SphereGeometry(1, 10, 8),
      new THREE.MeshBasicMaterial({ toneMapped: false }),
      CAPACITY,
    );
    this.mesh.frustumCulled = false;
    for (let i = 0; i < CAPACITY; i++) {
      this.mesh.setMatrixAt(i, this.zero);
      this.mesh.setColorAt(i, this.color.set("#ffffff"));
    }
  }

  spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number,
        color: THREE.ColorRepresentation, size: number, life: number, gravity = 9) {
    const i = this.next;
    this.next = (this.next + 1) % CAPACITY;
    const o = i * STRIDE;
    this.pos[o] = x; this.pos[o + 1] = y; this.pos[o + 2] = z;
    this.vel[o] = vx; this.vel[o + 1] = vy; this.vel[o + 2] = vz;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.size[i] = size;
    this.gravity[i] = gravity;
    this.mesh.setColorAt(i, this.color.set(color));
    this.mesh.instanceColor!.needsUpdate = true;
  }

  /** A ring of blobs flung outwards, e.g. a slime popping. */
  burst(x: number, y: number, z: number, color: THREE.ColorRepresentation, count: number, speed: number, size: number) {
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + Math.random() * 0.5;
      const s = speed * (0.6 + Math.random() * 0.6);
      this.spawn(x, y, z, Math.cos(a) * s, 2 + Math.random() * 3, Math.sin(a) * s,
        color, size * (0.6 + Math.random() * 0.8), 0.45 + Math.random() * 0.35);
    }
  }

  /** Little stars drifting up. */
  sparkle(x: number, y: number, z: number, color: THREE.ColorRepresentation, spread = 0.4) {
    this.spawn(
      x + (Math.random() - 0.5) * spread, y, z + (Math.random() - 0.5) * spread,
      (Math.random() - 0.5) * 0.4, 0.8 + Math.random() * 0.8, (Math.random() - 0.5) * 0.4,
      color, 0.035 + Math.random() * 0.03, 0.8 + Math.random() * 0.6, -0.5,
    );
  }

  update(dt: number) {
    for (let i = 0; i < CAPACITY; i++) {
      if (this.life[i] <= 0) { continue; }
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.mesh.setMatrixAt(i, this.zero);
        continue;
      }
      const o = i * STRIDE;
      this.vel[o + 1] -= this.gravity[i] * dt;
      this.pos[o] += this.vel[o] * dt;
      this.pos[o + 1] += this.vel[o + 1] * dt;
      this.pos[o + 2] += this.vel[o + 2] * dt;
      if (this.pos[o + 1] < 0.03) {
        this.pos[o + 1] = 0.03;
        this.vel[o + 1] *= -0.35;
        this.vel[o] *= 0.6;
        this.vel[o + 2] *= 0.6;
      }
      const s = this.size[i] * Math.min(1, (this.life[i] / this.maxLife[i]) * 1.6);
      this.matrix.makeScale(s, s, s).setPosition(this.pos[o], this.pos[o + 1], this.pos[o + 2]);
      this.mesh.setMatrixAt(i, this.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
