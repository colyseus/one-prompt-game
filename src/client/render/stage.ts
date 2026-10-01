import * as THREE from "three";

const BACKGROUND = new THREE.Color("#2b2142");
const CAMERA_OFFSET = new THREE.Vector3(0, 8.4, 5.9);

/**
 * Renderer, camera and lights. World axes: x = tile x, z = tile y, y is up,
 * one world unit per tile.
 */
export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(40, 1, 0.1, 120);

  private readonly sun: THREE.DirectionalLight;
  private readonly focus = new THREE.Vector3();
  private hasFocus = false;
  private shake = 0;

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    container.appendChild(this.renderer.domElement);

    this.scene.background = BACKGROUND;
    this.scene.fog = new THREE.Fog(BACKGROUND, 13, 26);

    this.scene.add(new THREE.HemisphereLight("#fff6ea", "#7d6aa8", 1.6));

    this.sun = new THREE.DirectionalLight("#fff0da", 1.9);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.02;
    this.sun.shadow.radius = 4;
    const cam = this.sun.shadow.camera;
    cam.left = -14; cam.right = 14; cam.top = 14; cam.bottom = -14; cam.near = 1; cam.far = 50;
    this.scene.add(this.sun, this.sun.target);

    const resize = () => {
      const { clientWidth: w, clientHeight: h } = container;
      this.renderer.setSize(w, h);
      this.camera.aspect = w / Math.max(1, h);
      this.camera.updateProjectionMatrix();
    };
    new ResizeObserver(resize).observe(container);
    resize();
  }

  /** Jolt the camera; decays on its own. */
  addShake(amount: number) {
    this.shake = Math.min(0.6, this.shake + amount);
  }

  /** Ease the camera towards the hero at (x, z); `snap` jumps straight there. */
  follow(x: number, z: number, dt: number, snap = false) {
    if (!this.hasFocus || snap) {
      this.focus.set(x, 0, z);
      this.hasFocus = true;
    } else {
      const k = 1 - Math.exp(-dt * 7);
      this.focus.x += (x - this.focus.x) * k;
      this.focus.z += (z - this.focus.z) * k;
    }

    this.shake *= Math.exp(-dt * 9);
    const jx = (Math.random() - 0.5) * this.shake;
    const jz = (Math.random() - 0.5) * this.shake;

    this.camera.position.copy(this.focus).add(CAMERA_OFFSET);
    this.camera.position.x += jx;
    this.camera.position.z += jz;
    this.camera.lookAt(this.focus.x + jx * 0.5, 0.4, this.focus.z + jz * 0.5);

    // Keep the shadow frustum centred on the action.
    this.sun.position.set(this.focus.x - 6, 14, this.focus.z + 4);
    this.sun.target.position.copy(this.focus);
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}
