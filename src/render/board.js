// Plansza: heksy (InstancedMesh na typ), dekoracje z prawdziwych modeli,
// mgła wojny, podświetlenia, grody i obozy.
import * as THREE from 'three';
import { hexToWorld, keyOf } from '../sim/hex.js';
import { TILES, FACTIONS } from '../sim/data.js';
import { models, scaleFor, bakedParts } from './assets.js';

export const HEX = 1;
const TILE_H = {
  woda: 0.14, rownina: 0.30, las: 0.34, bagno: 0.22, rzeka: 0.18,
  gory: 0.85, pole: 0.30, bursztyn: 0.32, grzybnia: 0.36,
};

function hash2(c, r, s = 0) {
  let h = (c * 374761393 + r * 668265263 + s * 1274126177) | 0;
  h = ((h ^ (h >>> 13)) * 1103515245) | 0;
  return ((h >>> 16) & 0xffff) / 0xffff;
}

export class Board {
  constructor(scene, map) {
    this.scene = scene;
    this.map = map;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.tileTop = new Map();   // key -> y wierzchu heksa
    this.cityGroups = new Map();
    this.campGroups = new Map();
    this.labels = new Map();    // cityId -> HTMLElement
    this._buildTerrain();
    this._buildDecor();
    this._buildFog();
    this._buildHighlights();
  }

  worldPos(c, r) {
    const [x, z] = hexToWorld(c, r, HEX);
    return new THREE.Vector3(x, this.tileTop.get(keyOf(c, r)) ?? 0.3, z);
  }

  _buildTerrain() {
    const byType = {};
    for (const t of this.map.tiles) (byType[t.type] ||= []).push(t);
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    this.terrainMeshes = {};
    for (const [type, tiles] of Object.entries(byType)) {
      const h = TILE_H[type];
      const geo = new THREE.CylinderGeometry(HEX * 0.995, HEX * 0.96, h, 6);
      const mat = new THREE.MeshStandardMaterial({
        color: 0xffffff, flatShading: true,
        roughness: type === 'woda' ? 0.35 : 0.95,
        metalness: type === 'woda' ? 0.25 : 0,
      });
      const mesh = new THREE.InstancedMesh(geo, mat, tiles.length);
      mesh.receiveShadow = true;
      mesh.castShadow = type === 'gory';
      const base = new THREE.Color(TILES[type].color);
      tiles.forEach((t, i) => {
        const [x, z] = hexToWorld(t.col, t.row, HEX);
        dummy.position.set(x, h / 2, z);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        const j = (hash2(t.col, t.row) - 0.5) * 0.10;
        color.copy(base).offsetHSL(0, 0, j);
        mesh.setColorAt(i, color);
        this.tileTop.set(keyOf(t.col, t.row), h);
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      this.group.add(mesh);
      this.terrainMeshes[type] = { mesh, tiles };
    }
  }

  _decorSpec(type) {
    switch (type) {
      case 'las': return [{ model: 'ter_pines', n: 1, h: 1.5 }];
      case 'grzybnia': return [{ model: 'ter_deadtree', n: 1, h: 1.6 }, { model: 'ter_mushroom', n: 3, h: 0.42, tint: 0xb06fd8, glow: 0.55 }];
      case 'gory': return [{ model: 'ter_rock', n: 1, h: 0.85, tint: 0x9a938a }, { model: 'ter_rocks', n: 2, h: 0.4, tint: 0x8a8578 }];
      case 'bursztyn': return [{ model: 'ter_mineral', n: 2, h: 0.55, tint: 0xffb02e, glow: 0.5 }];
      case 'pole': return [{ model: 'ter_crops', n: 1, h: 0.45 }];
      case 'bagno': return [{ model: 'ter_deadtree', n: 1, h: 0.9, chance: 0.5 }];
      default: return [];
    }
  }

  _buildDecor() {
    // Dla każdego (typ, model): InstancedMesh na każdą część modelu.
    this.decorByTile = new Map(); // key -> [{mesh, indices:[i...]}]
    for (const [type, spec] of Object.entries({
      las: 1, grzybnia: 1, gory: 1, bursztyn: 1, pole: 1, bagno: 1 })) {
      const tiles = this.map.tiles.filter(t => t.type === type);
      if (!tiles.length) continue;
      for (const d of this._decorSpec(type)) {
        if (!models.has(d.model)) continue;
        const placed = [];
        for (const t of tiles) {
          if (d.chance && hash2(t.col, t.row, 7) > d.chance) continue;
          for (let k = 0; k < d.n; k++) placed.push({ t, k });
        }
        if (!placed.length) continue;
        const s = scaleFor(d.model, d.h);
        const parts = bakedParts(d.model);
        for (const part of parts) {
          let mat = part.material;
          if (d.tint) {
            mat = mat.clone();
            mat.color = new THREE.Color(d.tint);
            if (d.glow) { mat.emissive = new THREE.Color(d.tint); mat.emissiveIntensity = d.glow; }
          }
          const im = new THREE.InstancedMesh(part.geometry, mat, placed.length);
          im.castShadow = true;
          const dummy = new THREE.Object3D();
          placed.forEach((pl, i) => {
            const [x, z] = hexToWorld(pl.t.col, pl.t.row, HEX);
            const a = hash2(pl.t.col, pl.t.row, pl.k) * Math.PI * 2;
            const rad = d.n > 1 ? 0.18 + hash2(pl.t.col, pl.t.row, pl.k + 3) * 0.5 : hash2(pl.t.col, pl.t.row, 11) * 0.25;
            const jitter = 0.8 + hash2(pl.t.col, pl.t.row, pl.k + 5) * 0.45;
            dummy.position.set(x + Math.cos(a) * rad, this.tileTop.get(keyOf(pl.t.col, pl.t.row)), z + Math.sin(a) * rad);
            dummy.rotation.set(0, a * 3, 0);
            dummy.scale.setScalar(s * jitter);
            dummy.updateMatrix();
            im.setMatrixAt(i, dummy.matrix);
            const key = keyOf(pl.t.col, pl.t.row);
            if (!this.decorByTile.has(key)) this.decorByTile.set(key, []);
            this.decorByTile.get(key).push({ mesh: im, index: i, matrix: dummy.matrix.clone() });
          });
          im.instanceMatrix.needsUpdate = true;
          this.group.add(im);
        }
      }
    }
  }

  // Usuwa dekoracje pola (np. po grabieży pola / zaoraniu) — chowamy instancje.
  hideDecorAt(c, r) {
    const list = this.decorByTile.get(keyOf(c, r));
    if (!list) return;
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (const { mesh, index } of list) {
      mesh.setMatrixAt(index, zero);
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  _buildFog() {
    const n = this.map.tiles.length;
    const darkGeo = new THREE.CylinderGeometry(HEX * 1.01, HEX * 1.01, 2.6, 6);
    this.fogDark = new THREE.InstancedMesh(darkGeo,
      new THREE.MeshBasicMaterial({ color: 0x0b0e13 }), n);
    this.fogDark.castShadow = false; this.fogDark.receiveShadow = false;
    const dimGeo = new THREE.CylinderGeometry(HEX * 1.005, HEX * 1.005, 0.02, 6);
    this.fogDim = new THREE.InstancedMesh(dimGeo,
      new THREE.MeshBasicMaterial({ color: 0x06080c, transparent: true, opacity: 0.34, depthWrite: false }), n);
    this.group.add(this.fogDark, this.fogDim);
  }

  updateFog(explored, visible) {
    const dummy = new THREE.Object3D();
    let nd = 0, ni = 0;
    for (const t of this.map.tiles) {
      const k = keyOf(t.col, t.row);
      const [x, z] = hexToWorld(t.col, t.row, HEX);
      if (!explored.has(k)) {
        dummy.position.set(x, 0.9, z);
        dummy.updateMatrix();
        this.fogDark.setMatrixAt(nd++, dummy.matrix);
      } else if (!visible.has(k)) {
        dummy.position.set(x, (this.tileTop.get(k) ?? 0.3) + 0.03, z);
        dummy.updateMatrix();
        this.fogDim.setMatrixAt(ni++, dummy.matrix);
      }
    }
    this.fogDark.count = nd;
    this.fogDim.count = ni;
    this.fogDark.instanceMatrix.needsUpdate = true;
    this.fogDim.instanceMatrix.needsUpdate = true;
  }

  _buildHighlights() {
    const n = 128;
    const geo = new THREE.CylinderGeometry(HEX * 0.92, HEX * 0.92, 0.02, 6);
    this.hlReach = new THREE.InstancedMesh(geo,
      new THREE.MeshBasicMaterial({ color: 0x9de36f, transparent: true, opacity: 0.28, depthWrite: false }), n);
    this.hlReach.count = 0;
    this.group.add(this.hlReach);

    const selGeo = new THREE.TorusGeometry(HEX * 0.82, 0.055, 8, 6);
    selGeo.rotateX(Math.PI / 2);
    this.selRing = new THREE.Mesh(selGeo,
      new THREE.MeshBasicMaterial({ color: 0xf1e6bf, transparent: true, opacity: 0.95 }));
    this.selRing.visible = false;
    this.group.add(this.selRing);

    const hovGeo = new THREE.CylinderGeometry(HEX * 0.98, HEX * 0.98, 0.015, 6);
    this.hovPlate = new THREE.Mesh(hovGeo,
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.12, depthWrite: false }));
    this.hovPlate.visible = false;
    this.group.add(this.hovPlate);
  }

  showReachable(list) {
    const dummy = new THREE.Object3D();
    let i = 0;
    for (const [c, r] of list) {
      if (i >= 128) break;
      const [x, z] = hexToWorld(c, r, HEX);
      dummy.position.set(x, (this.tileTop.get(keyOf(c, r)) ?? 0.3) + 0.05, z);
      dummy.updateMatrix();
      this.hlReach.setMatrixAt(i++, dummy.matrix);
    }
    this.hlReach.count = i;
    this.hlReach.instanceMatrix.needsUpdate = true;
  }

  clearReachable() { this.hlReach.count = 0; }

  setSelection(c, r) {
    if (c === null) { this.selRing.visible = false; return; }
    const p = this.worldPos(c, r);
    this.selRing.position.set(p.x, p.y + 0.07, p.z);
    this.selRing.visible = true;
  }

  setHover(c, r) {
    if (c === null) { this.hovPlate.visible = false; return; }
    const p = this.worldPos(c, r);
    this.hovPlate.position.set(p.x, p.y + 0.04, p.z);
    this.hovPlate.visible = true;
  }

  // ---------- grody ----------
  addOrUpdateCity(game, city) {
    let g = this.cityGroups.get(city.id);
    if (g) { this.group.remove(g); disposeGroup(g); }
    g = new THREE.Group();
    const p = this.worldPos(city.col, city.row);
    g.position.copy(p);
    const color = new THREE.Color(FACTIONS[game.players[city.owner].faction].color);

    // plac
    const plaza = new THREE.Mesh(
      new THREE.CylinderGeometry(HEX * 0.88, HEX * 0.92, 0.06, 6),
      new THREE.MeshStandardMaterial({ color: 0x8a7a58, roughness: 0.9, flatShading: true }));
    plaza.receiveShadow = true;
    g.add(plaza);

    // zabudowa wg liczby mieszkańców
    const tier = city.pop >= 5 ? 3 : city.pop >= 3 ? 2 : 1;
    const put = (name, h, x, z, rot = 0) => {
      const m = models.get(name);
      if (!m) return;
      const inst = m.scene.clone(true);
      const s = scaleFor(name, h);
      inst.scale.setScalar(s);
      inst.position.set(x, 0.03, z);
      inst.rotation.y = rot;
      inst.traverse(o => { if (o.isMesh) { o.castShadow = true; } });
      g.add(inst);
    };
    if (tier === 1) {
      put('bld_house', 0.9, 0, -0.08, 0.6);
    } else if (tier === 2) {
      put('bld_house', 0.85, -0.3, -0.15, 0.6);
      put('bld_houses', 0.7, 0.32, 0.1, -0.5);
    } else {
      put('bld_inn', 1.1, -0.05, -0.2, 0.2);
      put('bld_houses', 0.55, 0.42, 0.25, -0.9);
      put('bld_house', 0.5, -0.48, 0.3, 1.7);
    }
    if (city.buildings.has('spichlerz')) put('bld_windmill', 1.05, 0.45, -0.42, 0.9);
    if (city.buildings.has('palisada')) put('bld_tower', 0.9, -0.52, -0.38, 0);
    if (city.buildings.has('sanktuarium')) {
      put('bld_church', 1.5, 0.1, 0.42, Math.PI);
      const beam = new THREE.Mesh(
        new THREE.CylinderGeometry(0.16, 0.32, 5, 12, 1, true),
        new THREE.MeshBasicMaterial({ color: 0xffe28a, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false }));
      beam.position.set(0.1, 2.6, 0.42);
      g.add(beam);
      const glow = new THREE.PointLight(0xffd76a, 1.4, 6);
      glow.position.set(0.1, 1.6, 0.42);
      g.add(glow);
    }

    // chorągiew plemienia
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.15),
      new THREE.MeshStandardMaterial({ color: 0x4a3b28 }));
    pole.position.set(0.62, 0.6, 0.55);
    const flag = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.42, 4),
      new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.35, flatShading: true }));
    flag.rotation.z = -Math.PI / 2;
    flag.position.set(0.78, 1.05, 0.55);
    g.add(pole, flag);

    this.group.add(g);
    this.cityGroups.set(city.id, g);
  }

  removeCity(cityId) {
    const g = this.cityGroups.get(cityId);
    if (g) { this.group.remove(g); disposeGroup(g); this.cityGroups.delete(cityId); }
    const l = this.labels.get(cityId);
    if (l) { l.remove(); this.labels.delete(cityId); }
  }

  addCamp(c, r) {
    const key = keyOf(c, r);
    if (this.campGroups.has(key)) return;
    const g = new THREE.Group();
    g.position.copy(this.worldPos(c, r));
    const m = models.get('bld_tent');
    if (m) {
      const inst = m.scene.clone(true);
      inst.scale.setScalar(scaleFor('bld_tent', 0.62));
      inst.traverse(o => { if (o.isMesh) o.castShadow = true; });
      g.add(inst);
    }
    const fire = new THREE.PointLight(0xff7733, 1.1, 3.2);
    fire.position.set(0.3, 0.45, 0.3);
    g.add(fire);
    this.group.add(g);
    this.campGroups.set(key, g);
  }

  removeCamp(c, r) {
    const key = keyOf(c, r);
    const g = this.campGroups.get(key);
    if (g) { this.group.remove(g); disposeGroup(g); this.campGroups.delete(key); }
  }
}

function disposeGroup(g) {
  g.traverse(o => {
    if (o.isMesh && o.geometry && !o.geometry._shared) { /* geometrie klonów są współdzielone przez modele */ }
  });
}
