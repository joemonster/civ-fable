// Ładowanie modeli GLB (prawdziwe assety) + normalizacja skali.
import * as THREE from 'three';
import { GLTFLoader } from '../../lib/GLTFLoader.js';

const loader = new GLTFLoader();
export const models = new Map(); // name -> { scene, animations, size }

const WANTED = [
  'unit_wojownik', 'unit_osadnik', 'unit_kosynier', 'unit_bartnik',
  'unit_grzybiarz', 'unit_barbarzynca', 'unit_orc', 'prop_cart',
  'bld_house', 'bld_houses', 'bld_inn', 'bld_church', 'bld_tower',
  'bld_windmill', 'bld_tent',
  'ter_pines', 'ter_pine', 'ter_deadtree', 'ter_rock', 'ter_rocks',
  'ter_mineral', 'ter_crops', 'ter_mushroom',
];

export async function loadAllModels(onProgress) {
  let done = 0;
  await Promise.all(WANTED.map(name =>
    new Promise((resolve) => {
      loader.load(`assets/models/${name}.glb`, (gltf) => {
        prep(name, gltf);
        done++; onProgress && onProgress(done, WANTED.length);
        resolve();
      }, undefined, (err) => {
        console.warn('Nie wczytano modelu', name, err);
        done++; onProgress && onProgress(done, WANTED.length);
        resolve();
      });
    })));
}

function prep(name, gltf) {
  const root = gltf.scene;
  root.traverse(o => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = false;
      if (o.material) {
        o.material.metalness = Math.min(0.35, o.material.metalness ?? 0);
        o.material.roughness = Math.max(0.6, o.material.roughness ?? 1);
      }
    }
  });
  const box = new THREE.Box3().setFromObject(root);
  let size = box.getSize(new THREE.Vector3());
  // Modele ze szkieletem: Box3 kłamie (liczy geometrię bez skinningu) —
  // mierzymy rozpiętość kości w pozie spoczynkowej.
  root.updateMatrixWorld(true);
  const boneBox = new THREE.Box3();
  const v = new THREE.Vector3();
  let bones = 0;
  root.traverse(o => {
    if (o.isBone) { bones++; boneBox.expandByPoint(o.getWorldPosition(v.clone())); }
  });
  if (bones > 2 && !boneBox.isEmpty()) {
    size = boneBox.getSize(new THREE.Vector3());
    size.multiplyScalar(1.15); // zapas na czubek głowy / broń
    if (size.y < 0.2) size.setScalar(1);
  }
  models.set(name, { scene: root, animations: gltf.animations, size, box });
}

// Zwraca skalę normalizującą wysokość modelu do `targetH`,
// ograniczoną tak, by obrys nie przekraczał `maxW` (szerokość heksa).
export function scaleFor(name, targetH, maxW = 1.15) {
  const m = models.get(name);
  if (!m || m.size.y === 0) return 1;
  const byH = targetH / m.size.y;
  const w = Math.max(m.size.x, m.size.z) || 1;
  return Math.min(byH, maxW / w);
}

// Zbiera pary [geometria, materiał] z wypieczonymi transformacjami (do instancingu).
export function bakedParts(name) {
  const m = models.get(name);
  if (!m) return [];
  m.scene.updateMatrixWorld(true);
  const parts = [];
  m.scene.traverse(o => {
    if (o.isMesh) {
      const g = o.geometry.clone();
      g.applyMatrix4(o.matrixWorld);
      g.morphAttributes = {};        // instancje nie obsługują morphów
      g.morphTargetsRelative = false;
      parts.push({ geometry: g, material: o.material });
    }
  });
  return parts;
}
