// Efekty: cząsteczki, błyski, rozbłyski akcji. Lekki wspólny pool.
import * as THREE from 'three';

export class FxSystem {
  constructor(scene) {
    this.scene = scene;
    this.live = [];
  }

  // rozprysk cząstek
  burst(pos, { color = 0xffffff, n = 26, size = 0.07, speed = 2.2, up = 1.6, life = 0.8, gravity = 4 } = {}) {
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(n * 3);
    const vels = [];
    for (let i = 0; i < n; i++) {
      positions[i * 3] = pos.x; positions[i * 3 + 1] = pos.y + 0.3; positions[i * 3 + 2] = pos.z;
      const a = Math.random() * Math.PI * 2;
      const r = (0.3 + Math.random() * 0.7) * speed;
      vels.push(new THREE.Vector3(Math.cos(a) * r, Math.random() * up + 0.5, Math.sin(a) * r));
    }
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({ color, size, transparent: true, opacity: 1, depthWrite: false });
    const pts = new THREE.Points(geo, mat);
    this.scene.add(pts);
    this.live.push({ obj: pts, vels, t: 0, life, gravity, kind: 'burst' });
  }

  // pierścień rozchodzący się po ziemi
  ring(pos, { color = 0xffe28a, life = 0.7, maxR = 1.6 } = {}) {
    const geo = new THREE.TorusGeometry(0.2, 0.05, 8, 32);
    geo.rotateX(Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, depthWrite: false });
    const m = new THREE.Mesh(geo, mat);
    m.position.copy(pos).y += 0.12;
    this.scene.add(m);
    this.live.push({ obj: m, t: 0, life, maxR, kind: 'ring' });
  }

  // błysk światła punktowego
  flash(pos, { color = 0xffffff, intensity = 3, life = 0.35, dist = 6 } = {}) {
    const l = new THREE.PointLight(color, intensity, dist);
    l.position.copy(pos).y += 0.8;
    this.scene.add(l);
    this.live.push({ obj: l, t: 0, life, kind: 'flash', i0: intensity });
  }

  // chmura zarodników (wolno opadająca)
  spores(pos) {
    this.burst(pos, { color: 0xc98df0, n: 60, size: 0.09, speed: 1.4, up: 1.2, life: 1.6, gravity: 0.6 });
    this.flash(pos, { color: 0xb06fd8, intensity: 2.2, life: 0.9, dist: 5 });
    this.ring(pos, { color: 0xb06fd8, life: 1.0, maxR: 2.6 });
  }

  beeSwarm(from, to) {
    const mid = new THREE.Vector3().lerpVectors(from, to, 0.5).setY(from.y + 1.1);
    this.burst(mid, { color: 0xffd23b, n: 40, size: 0.055, speed: 1.8, up: 0.4, life: 1.1, gravity: 0.3 });
  }

  zap(pos) {
    this.flash(pos, { color: 0x9adfff, intensity: 5, life: 0.3, dist: 7 });
    this.burst(pos, { color: 0xbfeaff, n: 30, size: 0.06, speed: 3.2, up: 2.4, life: 0.5, gravity: 6 });
  }

  update(dt) {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const e = this.live[i];
      e.t += dt;
      const k = e.t / e.life;
      if (k >= 1) {
        this.scene.remove(e.obj);
        if (e.obj.geometry) e.obj.geometry.dispose();
        if (e.obj.material) e.obj.material.dispose();
        this.live.splice(i, 1);
        continue;
      }
      if (e.kind === 'burst') {
        const attr = e.obj.geometry.getAttribute('position');
        for (let j = 0; j < e.vels.length; j++) {
          const v = e.vels[j];
          attr.array[j * 3] += v.x * dt;
          attr.array[j * 3 + 1] += v.y * dt;
          attr.array[j * 3 + 2] += v.z * dt;
          v.y -= e.gravity * dt;
        }
        attr.needsUpdate = true;
        e.obj.material.opacity = 1 - k;
      } else if (e.kind === 'ring') {
        const s = 0.2 + (e.maxR - 0.2) * k;
        e.obj.scale.setScalar(s / 0.2);
        e.obj.material.opacity = 0.95 * (1 - k);
      } else if (e.kind === 'flash') {
        e.obj.intensity = e.i0 * (1 - k);
      }
    }
  }
}
