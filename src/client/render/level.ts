import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { FLOOR, isWall, type Dungeon } from "../../shared/dungeon.js";
import { createRng, hashSeed } from "../../shared/rng.js";
import type { Particles } from "./particles.js";

const WALL_HEIGHT = 0.7;

const FLOOR_TONES = ["#f6e6d6", "#eedac8"];
const WALL_TONES = ["#8f78cf", "#8670c8", "#9881d4"];
const CAP_TONES = ["#c8b2fb", "#bea6f6"];
const MUSHROOM_TONES = ["#ff7c9c", "#ff9f6e", "#f46d8a"];
const CRYSTAL_TONES = ["#7fe3ff", "#ff9be4", "#b9a2ff"];

const floorGeometry = new RoundedBoxGeometry(1, 0.2, 1, 2, 0.045);
const wallGeometry = new RoundedBoxGeometry(1, WALL_HEIGHT, 1, 2, 0.08);
const capGeometry = new RoundedBoxGeometry(1.04, 0.14, 1.04, 2, 0.06);
const stemGeometry = new THREE.CylinderGeometry(0.035, 0.05, 0.14, 8);
const capShroomGeometry = new THREE.SphereGeometry(0.11, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2);
const crystalGeometry = new THREE.OctahedronGeometry(0.1);
const candleGeometry = new THREE.CylinderGeometry(0.045, 0.05, 0.2, 10);
const flameGeometry = new THREE.SphereGeometry(0.035, 8, 6);

const floorMaterial = new THREE.MeshStandardMaterial({ roughness: 0.92 });
const wallMaterial = new THREE.MeshStandardMaterial({ roughness: 0.85 });
const capMaterial = new THREE.MeshStandardMaterial({ roughness: 0.6 });
const stemMaterial = new THREE.MeshStandardMaterial({ color: "#fff6e8", roughness: 0.8 });
const shroomMaterial = new THREE.MeshStandardMaterial({ roughness: 0.5 });
const crystalMaterial = new THREE.MeshStandardMaterial({ roughness: 0.15, emissive: "#ffffff", emissiveIntensity: 0.3 });
const candleMaterial = new THREE.MeshStandardMaterial({ color: "#fff3df", roughness: 0.7 });
const flameMaterial = new THREE.MeshBasicMaterial({ color: "#ffc35c", toneMapped: false });

const gold = new THREE.MeshStandardMaterial({
  color: "#ffcc4d", metalness: 0.65, roughness: 0.25, emissive: "#b07a12", emissiveIntensity: 0.45,
});
const iron = new THREE.MeshStandardMaterial({ color: "#5a4d73", metalness: 0.4, roughness: 0.5 });
const pitMaterial = new THREE.MeshStandardMaterial({ color: "#2d2140", roughness: 1 });
const stepMaterial = new THREE.MeshStandardMaterial({ color: "#6f5d93", roughness: 0.9 });
const rimMaterial = new THREE.MeshStandardMaterial({ color: "#d8c4ff", roughness: 0.5 });

/** Instanced mesh helper: one draw call per kind of thing in the level. */
function instanced(geometry: THREE.BufferGeometry, material: THREE.Material, transforms: THREE.Matrix4[], colors?: THREE.Color[]) {
  const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, transforms.length));
  mesh.count = transforms.length;
  transforms.forEach((m, i) => mesh.setMatrixAt(i, m));
  colors?.forEach((c, i) => mesh.setColorAt(i, c));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** The current floor: tiles, walls, props, the stairwell and the key. */
export class LevelView {
  readonly group = new THREE.Group();

  private floorGroup = new THREE.Group();
  private readonly key = new THREE.Group();
  private readonly keyLight = new THREE.PointLight("#ffd36b", 0, 4, 1.5);
  private readonly keyGlow: THREE.Mesh;
  private readonly stairs = new THREE.Group();
  private readonly gate = new THREE.Group();
  private readonly beam: THREE.Mesh;
  private readonly stairsLight = new THREE.PointLight("#fff1b8", 0, 5, 1.5);
  private sparkleTimer = 0;

  constructor() {
    this.group.add(this.floorGroup, this.key, this.keyLight, this.stairs, this.stairsLight);

    // Key: a floating, spinning golden key with a soft glow under it.
    const bow = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.035, 10, 24), gold);
    bow.position.y = 0.17;
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.36, 10), gold);
    shaft.position.y = -0.06;
    const tooth1 = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.05, 0.05), gold);
    tooth1.position.set(0.06, -0.2, 0);
    const tooth2 = tooth1.clone();
    tooth2.position.y = -0.11;
    const keyBody = new THREE.Group();
    keyBody.add(bow, shaft, tooth1, tooth2);
    keyBody.traverse((o) => { o.castShadow = true; });
    this.key.add(keyBody);
    this.keyGlow = new THREE.Mesh(
      new THREE.CircleGeometry(0.42, 24),
      new THREE.MeshBasicMaterial({ color: "#ffd36b", transparent: true, opacity: 0.35, depthWrite: false, toneMapped: false }),
    );
    this.keyGlow.rotation.x = -Math.PI / 2;
    this.group.add(this.keyGlow);

    // Stairwell: a pit with steps going down, a rim, an iron gate and a light beam.
    const pit = new THREE.Mesh(new THREE.BoxGeometry(0.96, 0.05, 0.96), pitMaterial);
    pit.position.y = -0.9;
    this.stairs.add(pit);
    for (const [x, z, w, d] of [[0, -0.47, 0.96, 0.04], [0, 0.47, 0.96, 0.04], [-0.47, 0, 0.04, 0.96], [0.47, 0, 0.04, 0.96]]) {
      const side = new THREE.Mesh(new THREE.BoxGeometry(w, 0.9, d), pitMaterial);
      side.position.set(x, -0.45, z);
      this.stairs.add(side);
    }
    for (let i = 0; i < 4; i++) {
      const step = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.2 * (4 - i), 0.22), stepMaterial);
      step.position.set(0, -0.9 + 0.1 * (4 - i), -0.36 + i * 0.22);
      step.receiveShadow = true;
      this.stairs.add(step);
    }
    for (const [x, z, w, d] of [[0, -0.52, 1.12, 0.1], [0, 0.52, 1.12, 0.1], [-0.52, 0, 0.1, 1.12], [0.52, 0, 0.1, 1.12]]) {
      const rim = new THREE.Mesh(new RoundedBoxGeometry(w, 0.1, d, 2, 0.04), rimMaterial);
      rim.position.set(x, 0.05, z);
      rim.castShadow = true;
      this.stairs.add(rim);
    }
    for (let i = -1; i <= 1; i++) {
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.98, 8), iron);
      bar.rotation.x = Math.PI / 2;
      bar.position.set(i * 0.28, 0.08, 0);
      const cross = bar.clone();
      cross.rotation.set(0, 0, Math.PI / 2);
      cross.position.set(0, 0.1, i * 0.28);
      this.gate.add(bar, cross);
    }
    this.gate.traverse((o) => { o.castShadow = true; });
    this.stairs.add(this.gate);
    this.beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.42, 0.5, 2.6, 24, 1, true),
      new THREE.MeshBasicMaterial({
        color: "#fff1a8", transparent: true, opacity: 0.22, side: THREE.DoubleSide,
        depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
      }),
    );
    this.beam.position.y = 1.2;
    this.stairs.add(this.beam);
  }

  build(d: Dungeon) {
    this.group.remove(this.floorGroup);
    this.floorGroup.traverse((o) => { if (o instanceof THREE.InstancedMesh) { o.dispose(); } });
    this.floorGroup = new THREE.Group();
    this.group.add(this.floorGroup);

    const rng = createRng(hashSeed(d.seed, d.floor, 0xdec0));
    const pick = <T>(arr: readonly T[]) => arr[Math.floor(rng() * arr.length)];
    const m = () => new THREE.Matrix4();
    const tint = (hex: string, jitter: number) =>
      new THREE.Color(hex).offsetHSL(0, 0, (rng() - 0.5) * jitter);

    const stairsTx = Math.floor(d.stairs.x), stairsTy = Math.floor(d.stairs.y);
    const floors: THREE.Matrix4[] = [], floorColors: THREE.Color[] = [];
    const walls: THREE.Matrix4[] = [], wallColors: THREE.Color[] = [];
    const caps: THREE.Matrix4[] = [], capColors: THREE.Color[] = [];
    const stems: THREE.Matrix4[] = [], shrooms: THREE.Matrix4[] = [], shroomColors: THREE.Color[] = [];
    const crystals: THREE.Matrix4[] = [], crystalColors: THREE.Color[] = [];
    const candles: THREE.Matrix4[] = [], flames: THREE.Matrix4[] = [];

    const reserved = [d.spawn, d.stairs, d.key].map((p) => `${Math.floor(p.x)},${Math.floor(p.y)}`);

    for (let ty = 0; ty < d.height; ty++) {
      for (let tx = 0; tx < d.width; tx++) {
        const floor = d.tiles[ty * d.width + tx] === FLOOR;
        if (floor) {
          if (tx === stairsTx && ty === stairsTy) { continue; }
          floors.push(m().makeTranslation(tx + 0.5, -0.1, ty + 0.5));
          floorColors.push(tint(FLOOR_TONES[(tx + ty) & 1], 0.03));

          // Decorations hug the walls, away from anything you need to see.
          const wallSides = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([ox, oy]) => isWall(d, tx + ox, ty + oy));
          if (wallSides.length > 0 && rng() < 0.09 && !reserved.includes(`${tx},${ty}`)) {
            const [ox, oy] = pick(wallSides);
            const px = tx + 0.5 + ox * 0.3 + (rng() - 0.5) * 0.2 * (1 - Math.abs(ox));
            const pz = ty + 0.5 + oy * 0.3 + (rng() - 0.5) * 0.2 * (1 - Math.abs(oy));
            const roll = rng();
            if (roll < 0.4) {
              const s = 0.8 + rng() * 0.6;
              stems.push(m().compose(new THREE.Vector3(px, 0.07 * s, pz), new THREE.Quaternion(), new THREE.Vector3(s, s, s)));
              shrooms.push(m().compose(new THREE.Vector3(px, 0.13 * s, pz), new THREE.Quaternion(), new THREE.Vector3(s, s, s)));
              shroomColors.push(tint(pick(MUSHROOM_TONES), 0.06));
            } else if (roll < 0.7) {
              for (let k = 0; k < 3; k++) {
                const s = 0.6 + rng() * 0.7;
                const q = new THREE.Quaternion().setFromEuler(new THREE.Euler((rng() - 0.5) * 0.6, rng() * 3, (rng() - 0.5) * 0.6));
                crystals.push(m().compose(
                  new THREE.Vector3(px + (rng() - 0.5) * 0.18, 0.12 * s, pz + (rng() - 0.5) * 0.18), q, new THREE.Vector3(s, s * 2, s)));
                crystalColors.push(tint(pick(CRYSTAL_TONES), 0.05));
              }
            } else {
              candles.push(m().makeTranslation(px, 0.1, pz));
              flames.push(m().compose(new THREE.Vector3(px, 0.25, pz), new THREE.Quaternion(), new THREE.Vector3(1, 1.7, 1)));
            }
          }
        } else if (this.bordersFloor(d, tx, ty)) {
          walls.push(m().makeTranslation(tx + 0.5, WALL_HEIGHT / 2, ty + 0.5));
          wallColors.push(tint(pick(WALL_TONES), 0.04));
          caps.push(m().makeTranslation(tx + 0.5, WALL_HEIGHT + 0.04, ty + 0.5));
          capColors.push(tint(pick(CAP_TONES), 0.02));
        }
      }
    }

    const floorMesh = instanced(floorGeometry, floorMaterial, floors, floorColors);
    floorMesh.castShadow = false;
    const flameMesh = instanced(flameGeometry, flameMaterial, flames);
    flameMesh.castShadow = false;
    this.floorGroup.add(
      floorMesh,
      instanced(wallGeometry, wallMaterial, walls, wallColors),
      instanced(capGeometry, capMaterial, caps, capColors),
      instanced(stemGeometry, stemMaterial, stems),
      instanced(capShroomGeometry, shroomMaterial, shrooms, shroomColors),
      instanced(crystalGeometry, crystalMaterial, crystals, crystalColors),
      instanced(candleGeometry, candleMaterial, candles),
      flameMesh,
    );

    this.key.position.set(d.key.x, 0.55, d.key.y);
    this.keyGlow.position.set(d.key.x, 0.012, d.key.y);
    this.keyLight.position.set(d.key.x, 0.9, d.key.y);
    this.stairs.position.set(d.stairs.x, 0, d.stairs.y);
    this.stairsLight.position.set(d.stairs.x, 1.2, d.stairs.y);
  }

  update(dt: number, time: number, keyTaken: boolean, stairsOpen: boolean, particles: Particles) {
    this.key.visible = !keyTaken;
    this.keyGlow.visible = !keyTaken;
    this.key.position.y = 0.55 + Math.sin(time * 2.2) * 0.08;
    this.key.rotation.y += dt * 1.8;
    // Lights stay in the scene at 0 intensity: toggling their visibility
    // would change the light count and recompile every material.
    this.keyLight.intensity = keyTaken ? 0 : 2.2 + Math.sin(time * 3) * 0.4;

    this.gate.visible = !stairsOpen;
    this.beam.visible = stairsOpen;
    this.stairsLight.intensity = stairsOpen ? 3 + Math.sin(time * 4) * 0.8 : 0;
    (this.beam.material as THREE.MeshBasicMaterial).opacity = 0.18 + Math.sin(time * 3) * 0.06;
    flameMaterial.color.setHSL(0.1, 1, 0.62 + Math.sin(time * 17) * 0.04 + Math.sin(time * 7) * 0.03);

    this.sparkleTimer -= dt;
    if (this.sparkleTimer <= 0) {
      this.sparkleTimer = 0.08;
      if (!keyTaken) { particles.sparkle(this.key.position.x, 0.3, this.key.position.z, "#ffe07a", 0.5); }
      if (stairsOpen) { particles.sparkle(this.stairs.position.x, 0.1, this.stairs.position.z, "#fff6c9", 0.8); }
    }
  }

  private bordersFloor(d: Dungeon, tx: number, ty: number): boolean {
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        if (!isWall(d, tx + ox, ty + oy)) { return true; }
      }
    }
    return false;
  }
}
