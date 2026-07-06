// Generator mapy: kontynent z szumem wartości + falloff radialny,
// rzeki z gór do morza, lasy, bagna, pola, bursztyn przy wybrzeżu,
// prastara grzybnia w głębi starych lasów.

import { makeRng } from './rng.js';
import { neighbors, hexDistance, keyOf } from './hex.js';

function valueNoise(rng, w, h, scale) {
  const gw = Math.ceil(w / scale) + 2, gh = Math.ceil(h / scale) + 2;
  const grid = [];
  for (let i = 0; i < gw * gh; i++) grid.push(rng.next());
  return (x, y) => {
    const gx = x / scale, gy = y / scale;
    const x0 = Math.floor(gx), y0 = Math.floor(gy);
    const fx = gx - x0, fy = gy - y0;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const v = (ix, iy) => grid[iy * gw + ix];
    return (v(x0, y0) * (1 - sx) + v(x0 + 1, y0) * sx) * (1 - sy) +
           (v(x0, y0 + 1) * (1 - sx) + v(x0 + 1, y0 + 1) * sx) * sy;
  };
}

export function generateMap(width, height, seed, numPlayers = 4) {
  const rng = makeRng(seed);
  const n1 = valueNoise(rng, width, height, 6);
  const n2 = valueNoise(rng, width, height, 3);
  const nMoist = valueNoise(rng, width, height, 5);
  const tiles = new Array(width * height);
  const idx = (c, r) => r * width + c;

  // 1. Ląd / woda
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      const nx = (c / width - 0.5) * 2, ny = (r / height - 0.5) * 2;
      const d = Math.sqrt(nx * nx + ny * ny);
      const e = n1(c, r) * 0.65 + n2(c, r) * 0.35 - d * d * 0.72;
      tiles[idx(c, r)] = { col: c, row: r, type: e > 0.18 ? 'rownina' : 'woda', elev: e };
    }
  }

  // 2. Góry (najwyższe wzniesienia) i wzgórza lasów/bagien wg wilgotności
  for (const t of tiles) {
    if (t.type === 'woda') continue;
    const m = nMoist(t.col, t.row);
    if (t.elev > 0.58) t.type = 'gory';
    else if (m > 0.50) t.type = 'las';
    else if (m < 0.36 && t.elev < 0.30) t.type = 'bagno';
  }

  // 3. Rzeki: od gór schodzimy po elewacji do wody
  const mountains = tiles.filter(t => t.type === 'gory');
  const riverCount = Math.max(3, Math.floor(width * height / 220));
  for (let i = 0; i < riverCount && mountains.length; i++) {
    let cur = rng.pick(mountains);
    let steps = 0;
    const visited = new Set();
    while (cur && steps++ < 40) {
      visited.add(keyOf(cur.col, cur.row));
      const opts = neighbors(cur.col, cur.row)
        .filter(([c, r]) => c >= 0 && r >= 0 && c < width && r < height)
        .map(([c, r]) => tiles[idx(c, r)])
        .filter(t => !visited.has(keyOf(t.col, t.row)));
      if (!opts.length) break;
      opts.sort((a, b) => a.elev - b.elev);
      const nxt = rng.chance(0.75) ? opts[0] : rng.pick(opts);
      if (nxt.type === 'woda') break;
      if (nxt.type !== 'gory') nxt.type = 'rzeka';
      cur = nxt;
    }
  }

  // 3b. Przerzedzenie rzek: nurt może sąsiadować najwyżej z DWOMA innymi
  //     polami rzeki — żadnych rozlewisk na trzy pola i szerokich delt.
  let thinned = true;
  while (thinned) {
    thinned = false;
    for (const t of tiles) {
      if (t.type !== 'rzeka') continue;
      const riverN = neighbors(t.col, t.row).filter(([c, r]) =>
        c >= 0 && r >= 0 && c < width && r < height && tiles[idx(c, r)].type === 'rzeka').length;
      if (riverN > 2) { t.type = 'rownina'; thinned = true; }
    }
  }

  // 4. Pola uprawne nie występują naturalnie — zaoruje je dopiero Osadnik
  //    (rozkaz „Zaorz pole” na równinie w granicach grodu).

  // 5. Bursztyn: przy wybrzeżu ("bałtycki brzeg"), 1 na ~140 pól, min. 4
  const coast = tiles.filter(t => (t.type === 'rownina' || t.type === 'bagno') &&
    neighbors(t.col, t.row).some(([c, r]) =>
      c >= 0 && r >= 0 && c < width && r < height && tiles[idx(c, r)].type === 'woda'));
  const amberN = Math.max(4, Math.floor(width * height / 140));
  shuffle(coast, rng);
  const ambers = [];
  for (const t of coast) {
    if (ambers.length >= amberN) break;
    if (ambers.every(a => hexDistance(a.col, a.row, t.col, t.row) >= 4)) {
      t.type = 'bursztyn'; ambers.push(t);
    }
  }

  // 6. Prastara grzybnia: w głębi lasów, z dala od siebie, 1 na ~180 pól, min. 3
  const deepForest = tiles.filter(t => t.type === 'las' &&
    neighbors(t.col, t.row).filter(([c, r]) =>
      c >= 0 && r >= 0 && c < width && r < height && tiles[idx(c, r)].type === 'las').length >= 2);
  const mycN = Math.max(3, Math.floor(width * height / 180));
  shuffle(deepForest, rng);
  const mycs = [];
  for (const t of deepForest) {
    if (mycs.length >= mycN) break;
    if (mycs.every(a => hexDistance(a.col, a.row, t.col, t.row) >= 5)) {
      t.type = 'grzybnia'; mycs.push(t);
    }
  }
  // Awaryjnie: jeśli za mało lasu, zamień zwykłe lasy
  if (mycs.length < 3) {
    const anyForest = tiles.filter(t => t.type === 'las');
    shuffle(anyForest, rng);
    for (const t of anyForest) {
      if (mycs.length >= 3) break;
      t.type = 'grzybnia'; mycs.push(t);
    }
  }

  // 7. Pozycje startowe: na równinach, maksymalnie od siebie oddalone
  const landStarts = tiles.filter(t => {
    if (t.type !== 'rownina' && t.type !== 'pole') return false;
    const ns = neighbors(t.col, t.row).filter(([c, r]) =>
      c >= 0 && r >= 0 && c < width && r < height).map(([c, r]) => tiles[idx(c, r)]);
    const open = ns.filter(n => ['rownina', 'pole', 'rzeka', 'las'].includes(n.type)).length;
    const water = ns.filter(n => n.type === 'woda').length;
    return ns.length === 6 && open >= 4 && water <= 1;
  });
  const starts = [];
  shuffle(landStarts, rng);
  // Zachłannie: pierwszy losowy, kolejne maksymalizują min. odległość
  if (landStarts.length) {
    starts.push(landStarts[0]);
    while (starts.length < numPlayers) {
      let best = null, bestD = -1;
      for (const t of landStarts) {
        const d = Math.min(...starts.map(s => hexDistance(s.col, s.row, t.col, t.row)));
        if (d > bestD) { bestD = d; best = t; }
      }
      if (!best) break;
      starts.push(best);
    }
  }

  return { width, height, tiles, starts: starts.map(t => [t.col, t.row]), seed };
}

function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}
