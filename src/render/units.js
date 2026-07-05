// Jednostki 3D: sklonowane modele ze szkieletami (SkeletonUtils),
// animacje: postój / marsz / walka / praca / śmierć.
import * as THREE from 'three';
import * as SkeletonUtils from '../../lib/SkeletonUtils.js';
import { models, scaleFor } from './assets.js';
import { UNITS, FACTIONS } from '../sim/data.js';

const UNIT_H = {
  osadnik: 0.82, wojownik: 0.9, kosynier: 0.85, bartnik: 0.85,
  grzybiarz: 0.75, tabor: 0.62, barbarzynca: 0.85, barbarzynca_elit: 0.8,
};

// Mapowanie klipów wg końcówki nazwy (rigi Quaternius różnią się nazwami).
const CLIPS = {
  idle: ['Idle', 'Idle_Neutral'],
  walk: ['Walk', 'Run'],
  attack: ['Sword_Slash', 'Slash', 'Stab', 'Punch', 'Punch_Left', 'Attack', 'Bite_Front', 'Weapon'],
  death: ['Death'],
  work: ['Interact', 'Wave', 'Yes'],
};

function findClip(anims, names) {
  for (const n of names) {
    const c = anims.find(a => a.name === n || a.name.endsWith('|' + n));
    if (c) return c;
  }
  return null;
}

export class UnitView {
  constructor(unit, game) {
    this.id = unit.id;
    this.type = unit.type;
    this.owner = unit.owner;
    this.group = new THREE.Group();
    this.mixer = null;
    this.actions = {};
    this.current = null;
    this.moving = null; // {path:[Vector3], t, speed, done}
    this.dying = false;

    const modelName = UNITS[unit.type].model;
    const asset = models.get(modelName);
    const color = unit.owner >= 0
      ? new THREE.Color(FACTIONS[game.players[unit.owner].faction].color)
      : new THREE.Color(0x77716a);

    if (asset) {
      const inst = SkeletonUtils.clone(asset.scene);
      const s = scaleFor(modelName, UNIT_H[unit.type] ?? 0.85);
      inst.scale.setScalar(s);
      inst.traverse(o => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
      this.group.add(inst);
      if (asset.animations?.length) {
        this.mixer = new THREE.AnimationMixer(inst);
        for (const [key, names] of Object.entries(CLIPS)) {
          const clip = findClip(asset.animations, names);
          if (clip) this.actions[key] = this.mixer.clipAction(clip);
        }
        this.play('idle', { warp: false });
        if (this.actions.idle) {
          this.actions.idle.time = Math.random() * (this.actions.idle.getClip()?.duration || 1);
        }
      }
      // Tabor: wóz + woźnica (animowany model chłopa na wozie)
      if (unit.type === 'tabor' && models.get('unit_kosynier')) {
        const drv = SkeletonUtils.clone(models.get('unit_kosynier').scene);
        drv.scale.setScalar(scaleFor('unit_kosynier', 0.5));
        drv.position.set(0, 0.28, -0.15);
        drv.traverse(o => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
        this.group.add(drv);
        const anims = models.get('unit_kosynier').animations;
        this.driverMixer = new THREE.AnimationMixer(drv);
        const idle = findClip(anims, CLIPS.idle);
        if (idle) this.driverMixer.clipAction(idle).play();
      }
    } else {
      // awaryjna bryła
      const m = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.8, 6),
        new THREE.MeshStandardMaterial({ color }));
      m.position.y = 0.4; m.castShadow = true;
      this.group.add(m);
    }

    // pierścień przynależności
    const ringGeo = new THREE.TorusGeometry(0.42, 0.045, 8, 24);
    ringGeo.rotateX(Math.PI / 2);
    this.ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color }));
    this.ring.position.y = 0.05;
    this.group.add(this.ring);

    // znacznik dezorientacji (zarodniki)
    const dz = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xb06fd8, transparent: true, opacity: 0.85 }));
    dz.position.y = 1.15;
    dz.visible = false;
    this.dizzy = dz;
    this.group.add(dz);
  }

  play(name, { once = false, warp = true } = {}) {
    const act = this.actions[name] || this.actions.idle;
    if (!act || this.current === act && !once) return null;
    if (this.current && warp) this.current.fadeOut(0.18);
    act.reset();
    if (once) { act.setLoop(THREE.LoopOnce); act.clampWhenFinished = true; }
    else act.setLoop(THREE.LoopRepeat);
    act.fadeIn(warp ? 0.18 : 0).play();
    this.current = act;
    return act;
  }

  // Ustaw ścieżkę ruchu (lista Vector3); prędkość w heksach/sek.
  startMove(points, speed = 3.2) {
    if (!points.length) return;
    this.moving = { points, seg: 0, t: 0, speed };
    this.play('walk');
  }

  update(dt, unitData) {
    if (this.mixer) this.mixer.update(dt);
    if (this.driverMixer) this.driverMixer.update(dt);
    this.ring.rotation.y += dt * 0.6;
    if (this.dizzy.visible) {
      this.dizzy.position.x = Math.cos(performance.now() / 300) * 0.25;
      this.dizzy.position.z = Math.sin(performance.now() / 300) * 0.25;
    }
    if (unitData) this.dizzy.visible = unitData.disoriented > 0;

    if (this.moving) {
      const mv = this.moving;
      const a = mv.points[mv.seg], b = mv.points[mv.seg + 1];
      if (!b) {
        this.group.position.copy(a);
        this.moving = null;
        if (!this.dying) this.play('idle');
        return;
      }
      const dist = a.distanceTo(b);
      mv.t += dt * mv.speed / Math.max(0.001, dist);
      if (mv.t >= 1) { mv.seg++; mv.t = 0; }
      const p = new THREE.Vector3().lerpVectors(a, b, Math.min(1, mv.t));
      // podskok kroku
      p.y += Math.sin(Math.min(1, mv.t) * Math.PI) * 0.06;
      this.group.position.copy(p);
      const dir = new THREE.Vector3().subVectors(b, a);
      if (dir.lengthSq() > 0.0001) {
        this.group.rotation.y = Math.atan2(dir.x, dir.z);
      }
    }
  }

  faceTowards(target) {
    const dir = new THREE.Vector3().subVectors(target, this.group.position);
    if (dir.lengthSq() > 0.0001) this.group.rotation.y = Math.atan2(dir.x, dir.z);
  }

  isBusy() { return !!this.moving; }
}
