// Scena Three.js: renderer, światła (cienie), kamera z obsługą gładzika.
import * as THREE from 'three';

export function createScene(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0e1620);
  scene.fog = new THREE.Fog(0x0e1620, 60, 140);

  const camera = new THREE.PerspectiveCamera(46, window.innerWidth / window.innerHeight, 0.5, 400);

  // Światła: ciepłe słońce + chłodne wypełnienie + delikatny ambient
  const sun = new THREE.DirectionalLight(0xffe8c0, 2.4);
  sun.position.set(24, 38, 14);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 5; sun.shadow.camera.far = 120;
  const sc = sun.shadow.camera;
  sc.left = -30; sc.right = 30; sc.top = 30; sc.bottom = -30;
  sun.shadow.bias = -0.0007;
  scene.add(sun);
  scene.add(sun.target);
  const fill = new THREE.DirectionalLight(0x88a8ff, 0.5);
  fill.position.set(-18, 22, -20);
  scene.add(fill);
  scene.add(new THREE.AmbientLight(0x445566, 0.9));
  const hemi = new THREE.HemisphereLight(0xbcd8ff, 0x33422a, 0.55);
  scene.add(hemi);

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  return { renderer, scene, camera, sun };
}

// Kamera "z lotu ptaka" — sterowanie pod gładzik:
//  * przewijanie dwoma palcami = przesuwanie mapy
//  * pinch (ctrl+wheel) lub +/- = przybliżanie
//  * przeciąganie myszą (LPM na pustym / środkowy) = przesuwanie
export class CameraRig {
  constructor(camera, dom, bounds) {
    this.camera = camera;
    this.dom = dom;
    this.bounds = bounds; // {minX,maxX,minZ,maxZ}
    this.target = new THREE.Vector3(
      (bounds.minX + bounds.maxX) / 2, 0, (bounds.minZ + bounds.maxZ) / 2);
    this.zoom = 26;        // odległość
    this.minZoom = 9; this.maxZoom = 60;
    this.tilt = 0.95;      // rad od pionu
    this.dragging = false;
    this.last = [0, 0];
    this._bind();
    this.update(0);
  }

  _bind() {
    const el = this.dom;
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        this.zoom *= 1 + Math.sign(e.deltaY) * 0.08 * Math.min(3, Math.abs(e.deltaY) / 18);
      } else {
        const k = this.zoom / 500;
        this.pan(e.deltaX * k, e.deltaY * k);
      }
      this.clamp();
    }, { passive: false });

    el.addEventListener('pointerdown', (e) => {
      if (e.button === 1 || e.button === 2 || (e.button === 0 && e.shiftKey)) {
        this.dragging = true;
        this.last = [e.clientX, e.clientY];
        el.setPointerCapture(e.pointerId);
      }
    });
    el.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      const k = this.zoom / 620;
      this.pan(-(e.clientX - this.last[0]) * k, -(e.clientY - this.last[1]) * k);
      this.last = [e.clientX, e.clientY];
      this.clamp();
    });
    el.addEventListener('pointerup', () => { this.dragging = false; });
    el.addEventListener('contextmenu', (e) => e.preventDefault());

    this.keys = new Set();
    window.addEventListener('keydown', (e) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        this.keys.add(e.key); e.preventDefault();
      }
      if (e.key === '+' || e.key === '=') { this.zoom *= 0.9; this.clamp(); }
      if (e.key === '-') { this.zoom *= 1.1; this.clamp(); }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key));
  }

  pan(dx, dz) {
    // przesuwanie w płaszczyźnie ekranu (kamera patrzy z góry na -Z odchylona)
    this.target.x += dx;
    this.target.z += dz;
  }

  clamp() {
    this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoom));
    this.target.x = Math.max(this.bounds.minX, Math.min(this.bounds.maxX, this.target.x));
    this.target.z = Math.max(this.bounds.minZ, Math.min(this.bounds.maxZ, this.target.z));
  }

  centerOn(x, z, zoom = null) {
    this.target.set(x, 0, z);
    if (zoom) this.zoom = zoom;
    this.clamp();
  }

  update(dt) {
    const spd = this.zoom * 0.9 * dt;
    if (this.keys.has('ArrowUp')) this.target.z -= spd;
    if (this.keys.has('ArrowDown')) this.target.z += spd;
    if (this.keys.has('ArrowLeft')) this.target.x -= spd;
    if (this.keys.has('ArrowRight')) this.target.x += spd;
    if (this.keys.size) this.clamp();
    const t = this.target;
    // im bliżej, tym bardziej płasko patrzymy (filmowo), z daleka bardziej z góry
    const tilt = 0.55 + (this.zoom - this.minZoom) / (this.maxZoom - this.minZoom) * 0.35;
    const y = Math.cos(tilt) * this.zoom;
    const back = Math.sin(tilt) * this.zoom;
    this.camera.position.set(t.x, y, t.z + back);
    this.camera.lookAt(t.x, 0, t.z);
  }
}
