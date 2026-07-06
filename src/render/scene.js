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

// Kamera "z lotu ptaka" — sterowanie pod gładzik i ekran dotykowy:
//  * przewijanie dwoma palcami / przeciąganie palcem = przesuwanie mapy
//  * pinch (dwa palce lub ctrl+wheel) albo +/- = przybliżanie
//  * przeciąganie myszą (Shift+LPM / środkowy) = przesuwanie
export class CameraRig {
  constructor(camera, dom, bounds, maxZoom = 60) {
    this.camera = camera;
    this.dom = dom;
    this.bounds = bounds; // {minX,maxX,minZ,maxZ}
    this.target = new THREE.Vector3(
      (bounds.minX + bounds.maxX) / 2, 0, (bounds.minZ + bounds.maxZ) / 2);
    this.zoom = 26;        // odległość
    this.minZoom = 9; this.maxZoom = maxZoom;
    this.tilt = 0.95;      // rad od pionu
    this.dragging = false;
    this.last = [0, 0];
    this.pointers = new Map(); // aktywne dotknięcia (pointerId -> pozycja)
    this.touchMoved = 0;       // suma ruchu palca (próg: stuknięcie vs przesunięcie)
    this.pinchDist = 0;
    this.suppressClick = false; // po przeciągnięciu palcem nie traktuj puszczenia jak kliknięcia
    this._bind();
    this.update(0);
  }

  // Zjada jedno "kliknięcie" po zakończonym przesuwaniu palcem.
  consumeSuppressedClick() {
    if (this.suppressClick) { this.suppressClick = false; return true; }
    return false;
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
      if (e.pointerType === 'touch') {
        this.pointers.set(e.pointerId, [e.clientX, e.clientY]);
        try { el.setPointerCapture(e.pointerId); } catch { /* syntetyczne zdarzenia */ }
        if (this.pointers.size === 1) {
          this.touchMoved = 0;
          this.last = [e.clientX, e.clientY];
        } else if (this.pointers.size === 2) {
          const [a, b] = [...this.pointers.values()];
          this.pinchDist = Math.hypot(a[0] - b[0], a[1] - b[1]);
        }
        return;
      }
      if (e.button === 1 || e.button === 2 || (e.button === 0 && e.shiftKey)) {
        this.dragging = true;
        this.last = [e.clientX, e.clientY];
        try { el.setPointerCapture(e.pointerId); } catch { /* syntetyczne zdarzenia */ }
      }
    });
    el.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch' && this.pointers.has(e.pointerId)) {
        this.pointers.set(e.pointerId, [e.clientX, e.clientY]);
        if (this.pointers.size === 2) {
          // pinch: zbliżanie/oddalanie + przesuwanie środkiem gestu
          const [a, b] = [...this.pointers.values()];
          const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
          if (this.pinchDist > 0 && d > 0) this.zoom *= this.pinchDist / d;
          this.pinchDist = d;
          this.suppressClick = true;
          this.clamp();
          return;
        }
        // jeden palec: przesuwanie mapy (po przekroczeniu progu stuknięcia)
        const dx = e.clientX - this.last[0], dy = e.clientY - this.last[1];
        this.touchMoved += Math.abs(dx) + Math.abs(dy);
        if (this.touchMoved > 12) {
          const k = this.zoom / 620;
          this.pan(-dx * k, -dy * k);
          this.suppressClick = true;
          this.clamp();
        }
        this.last = [e.clientX, e.clientY];
        return;
      }
      if (!this.dragging) return;
      const k = this.zoom / 620;
      this.pan(-(e.clientX - this.last[0]) * k, -(e.clientY - this.last[1]) * k);
      this.last = [e.clientX, e.clientY];
      this.clamp();
    });
    const endPointer = (e) => {
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) this.pinchDist = 0;
      if (this.pointers.size === 1) this.last = [...this.pointers.values()][0];
      this.dragging = false;
    };
    el.addEventListener('pointerup', endPointer);
    el.addEventListener('pointercancel', endPointer);
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
