// SI przeciwników — uczciwa: widzi tylko to, co odkryła, gra tymi samymi regułami.
// Priorytety (czytelne): 1) przetrwać, 2) rosnąć, 3) badać, 4) wyścig do Przebudzenia.

import { neighbors, hexDistance, keyOf, tilesInRange } from './hex.js';
import { TILES, UNITS, TECHS, TECH_ORDER } from './data.js';

export function runAiTurn(game, p) {
  chooseResearch(game, p);
  for (const ct of [...game.cities.values()]) {
    if (ct.owner === p.id) chooseBuild(game, p, ct);
  }
  const myUnits = [...game.units.values()].filter(u => u.owner === p.id && u.hp > 0);
  const myCities = [...game.cities.values()].filter(c => c.owner === p.id);

  // Przydział garnizonów: po 1 jednostce wojskowej na gród
  const garrisons = new Set();
  for (const ct of myCities) {
    const def = myUnits.find(u => UNITS[u.type].military && u.col === ct.col && u.row === ct.row);
    if (def) garrisons.add(def.id);
  }

  for (const u of myUnits) {
    if (u.hp <= 0 || !game.units.has(u.id)) continue;
    let guard = 0;
    while (u.moves > 0 && game.units.has(u.id) && guard++ < 6) {
      const acted = actUnit(game, p, u, garrisons, myCities);
      if (!acted) break;
    }
  }
}

function chooseResearch(game, p) {
  if (p.researching) return;
  const av = game.availableTechs(p).filter(t => !t.blocked);
  if (!av.length) return;
  // Idź prosto ścieżką do przebudzenia; bartnictwo bierz, gdy Łaska niska
  const order = [...TECH_ORDER];
  if (p.laska < 35) {
    const i = order.indexOf('bartnictwo');
    order.splice(i, 1); order.splice(1, 0, 'bartnictwo');
  }
  for (const id of order) {
    const t = av.find(x => x.id === id);
    if (t) { p.researching = t.id; return; }
  }
  p.researching = av[0].id;
}

function threatsNear(game, ct, radius = 4) {
  let n = 0;
  for (const u of game.units.values()) {
    if (u.hp <= 0 || u.owner === ct.owner || !UNITS[u.type].military) continue;
    if (hexDistance(u.col, u.row, ct.col, ct.row) <= radius) n++;
  }
  return n;
}

function bestMilitary(builds) {
  const pri = ['tabor', 'kosynier', 'bartnik', 'wojownik'];
  for (const id of pri) {
    const b = builds.find(x => x.kind === 'unit' && x.id === id);
    if (b) return b;
  }
  return null;
}

function chooseBuild(game, p, ct) {
  if (ct.buildQueue && game.availableBuilds(ct).some(b => b.kind === ct.buildQueue.kind && b.id === ct.buildQueue.id)) {
    // projekt/cud w toku — nie przerywaj
    if (ct.buildQueue.id === 'przebudzenie' || ct.buildQueue.id === 'sanktuarium') return;
  }
  const builds = game.availableBuilds(ct);
  const myCities = [...game.cities.values()].filter(c => c.owner === p.id);
  const myUnits = [...game.units.values()].filter(u => u.owner === p.id && u.hp > 0);
  const settlers = myUnits.filter(u => u.type === 'osadnik').length;
  const army = myUnits.filter(u => UNITS[u.type].military).length;
  const defHere = myUnits.filter(u => UNITS[u.type].military && u.col === ct.col && u.row === ct.row).length;

  // 1) PROJEKT KOŃCOWY
  const proj = builds.find(b => b.id === 'przebudzenie');
  if (proj) { game.setBuild(ct, 'building', 'przebudzenie'); return; }

  // 2) Obrona w potrzebie
  if ((threatsNear(game, ct) > 0 && defHere === 0) || (army < myCities.length)) {
    const m = bestMilitary(builds);
    if (m) { game.setBuild(ct, m.kind, m.id); return; }
  }

  // 3) Ekspansja (do 4-5 grodów), tylko z większych grodów
  let targetCities = 4 + (p.faction === 'polanie' ? 1 : 0);
  // brakuje bursztynu/grzybni do badań lub projektu? poślij osadników po nie
  const nextBlocked = game.availableTechs(p).some(t => t.blocked);
  const needMycCity = p.techs.has('siec_grzybni') &&
    ![...game.cities.values()].some(c => c.owner === p.id && game.cityHasTileType(c, 'grzybnia'));
  if (nextBlocked || needMycCity) targetCities += 2;
  if (myCities.length + settlers < targetCities && ct.pop >= 2 &&
      builds.some(b => b.id === 'osadnik')) {
    game.setBuild(ct, 'unit', 'osadnik'); return;
  }

  // 4) Cud, gdy stać i Łaska pozwala
  const wonder = builds.find(b => b.id === 'sanktuarium');
  if (wonder && ct.pop >= 3) { game.setBuild(ct, 'building', 'sanktuarium'); return; }

  // 5) Budynki w kolejności
  for (const id of ['spichlerz', 'palisada', 'kapliczka', 'targ']) {
    const b = builds.find(x => x.id === id);
    if (b) { game.setBuild(ct, 'building', id); return; }
  }

  // 6) Wojsko do limitu, potem grzybiarz dla dywersji
  if (army < myCities.length * 2 + 1) {
    const g = builds.find(x => x.id === 'grzybiarz');
    const m = (game.rng.chance(0.3) && g) ? g : bestMilitary(builds);
    if (m) { game.setBuild(ct, m.kind, m.id); return; }
  }
  const m = bestMilitary(builds);
  if (m) game.setBuild(ct, m.kind, m.id);
}

function actUnit(game, p, u, garrisons, myCities) {
  if (u.type === 'osadnik') return actSettler(game, p, u);

  // Grzybiarz: podejdź pod wrogów i pryskaj zarodnikami
  if (u.type === 'grzybiarz') {
    const enemiesNear = countEnemiesInR1(game, u);
    if (enemiesNear > 0 && game.canSpore(u)) { game.sporeBurst(u); return false; }
  }

  // Garnizon: stój i umacniaj się
  if (garrisons.has(u.id)) {
    if (threatsNear(game, game.cityAt(u.col, u.row) || { col: u.col, row: u.row, owner: p.id }, 2) === 0 || u.moves <= 0) {
      game.fortify(u); return false;
    }
  }

  // Grabież okazyjna (zwłaszcza Wandalowie)
  if (game.canPillage(u) && (p.faction === 'wandalowie' || game.rng.chance(0.3))) {
    game.pillage(u); return false;
  }

  // Cel: zagrożony gród → broń; obóz barbarzyńców → niszcz; słaby wróg → atakuj; inaczej eksploruj
  const explored = p.explored;

  // a) obrona najbliższego zagrożonego grodu
  let target = null, mode = null, bestScore = -1e9;
  for (const ct of myCities) {
    const th = threatsNear(game, ct, 3);
    if (th > 0) {
      const d = hexDistance(u.col, u.row, ct.col, ct.row);
      const s = 100 - d * 5 + th * 10;
      if (s > bestScore) { bestScore = s; target = [ct.col, ct.row]; mode = 'defend'; }
    }
  }
  // a2) gród bez załogi przyciąga wojsko
  for (const ct of myCities) {
    const hasGar = game.unitsAt(ct.col, ct.row).some(x => x.owner === p.id && UNITS[x.type].military && x.id !== u.id);
    if (!hasGar) {
      const d = hexDistance(u.col, u.row, ct.col, ct.row);
      if (d <= 5) {
        const s = 22 - d * 3;
        if (s > bestScore) { bestScore = s; target = [ct.col, ct.row]; mode = 'defend'; }
      }
    }
  }
  // b) wrogowie i obozy w zasięgu wiedzy
  for (const e of game.units.values()) {
    if (e.hp <= 0 || e.owner === p.id) continue;
    if (!explored.has(keyOf(e.col, e.row))) continue;
    const d = hexDistance(u.col, u.row, e.col, e.row);
    if (d > 6) continue;
    if (e.owner !== -1 && game.turn < 25 && d > 2) continue; // wczesny pokój między plemionami
    const myA = game.attackOf(u), theirD = game.defenseOf(e);
    const s = (myA - theirD) * 8 - d * 4 + (e.owner === -1 ? 12 : 0);
    if (s > bestScore) { bestScore = s; target = [e.col, e.row]; mode = 'attack'; }
  }
  for (const camp of game.camps) {
    if (!explored.has(keyOf(camp.col, camp.row))) continue;
    const d = hexDistance(u.col, u.row, camp.col, camp.row);
    if (d > 7) continue;
    const s = 40 - d * 4;
    if (s > bestScore) { bestScore = s; target = [camp.col, camp.row]; mode = 'attack'; }
  }
  // c) późna gra: szturm na wrogie grody, gdy mamy przewagę
  const myArmy = [...game.units.values()].filter(x => x.owner === p.id && UNITS[x.type].military).length;
  if (myArmy >= myCities.length * 2 + 2 && game.turn > 30) {
    for (const ct of game.cities.values()) {
      if (ct.owner === p.id || !explored.has(keyOf(ct.col, ct.row))) continue;
      const d = hexDistance(u.col, u.row, ct.col, ct.row);
      if (d > 8) continue;
      const defs = game.unitsAt(ct.col, ct.row).length;
      const s = 30 - d * 3 - defs * 8;
      if (s > bestScore) { bestScore = s; target = [ct.col, ct.row]; mode = 'attack'; }
    }
  }

  if (target) {
    const before = [u.col, u.row, u.moves];
    game.stepToward(u, target[0], target[1]);
    return game.units.has(u.id) && (u.col !== before[0] || u.row !== before[1]) && u.moves > 0;
  }

  // d) eksploracja: idź ku granicy mgły
  const frontier = findFrontier(game, p, u);
  if (frontier) {
    const before = [u.col, u.row];
    game.stepToward(u, frontier[0], frontier[1]);
    return game.units.has(u.id) && (u.col !== before[0] || u.row !== before[1]) && u.moves > 0;
  }
  game.fortify(u);
  return false;
}

function countEnemiesInR1(game, u) {
  let n = 0;
  for (const [c, r] of tilesInRange(u.col, u.row, 1, game.map.width, game.map.height)) {
    n += game.unitsAt(c, r).filter(e => e.owner !== u.owner).length;
    const ct = game.cityAt(c, r);
    if (ct && ct.owner !== u.owner) n++;
  }
  return n;
}

function findFrontier(game, p, u) {
  let best = null, bestD = 1e9;
  // szukaj odkrytych pól graniczących z nieodkrytymi
  for (const k of p.explored) {
    const c = k % 4096, r = Math.floor(k / 4096);
    if (game.tile(c, r).type === 'woda') continue;
    let edge = false;
    for (const [nc, nr] of neighbors(c, r)) {
      if (game.inBounds(nc, nr) && !p.explored.has(keyOf(nc, nr))) { edge = true; break; }
    }
    if (!edge) continue;
    const d = hexDistance(u.col, u.row, c, r);
    if (d < bestD && d > 0) { bestD = d; best = [c, r]; }
  }
  return best;
}

function actSettler(game, p, u) {
  // Znajdź najlepsze miejsce na gród w znanym świecie
  const spot = bestCitySpot(game, p, u);
  if (spot && spot[0] === u.col && spot[1] === u.row && game.canFoundCity(u)) {
    game.foundCity(u); return false;
  }
  if (game.canFoundCity(u) && (!spot || hexDistance(u.col, u.row, spot[0], spot[1]) > 6)) {
    // nie ma nic lepszego w zasięgu — osiedl się tutaj
    if (scoreSite(game, p, u.col, u.row) > 6) { game.foundCity(u); return false; }
  }
  if (spot) {
    const before = [u.col, u.row];
    game.stepToward(u, spot[0], spot[1]);
    const moved = (u.col !== before[0] || u.row !== before[1]);
    if (!moved && game.canFoundCity(u)) { game.foundCity(u); return false; }
    return moved && u.moves > 0;
  }
  // brak pomysłu: zaorz pole albo czekaj
  if (game.canImprove(u)) { game.improveTile(u); return false; }
  return false;
}

function scoreSite(game, p, c, r) {
  const t = game.tile(c, r);
  if (t.type === 'woda' || t.type === 'gory') return -1;
  if (game.cityAt(c, r)) return -1;
  for (const ct of game.cities.values()) {
    if (hexDistance(c, r, ct.col, ct.row) < 3) return -1;
  }
  let s = 0;
  const needAmber = !p.techs.has('elektrycznosc') && !game.playerHasTileType(p, 'bursztyn');
  const needMyc = !game.playerHasTileType(p, 'grzybnia');
  for (const [tc, tr, d] of tilesInRange(c, r, 2, game.map.width, game.map.height)) {
    if (!p.explored.has(keyOf(tc, tr))) continue;
    const y = TILES[game.tile(tc, tr).type];
    s += (y.food * 1.2 + y.prod + y.gold * 0.6) * (d === 0 ? 1.5 : 1);
    const type = game.tile(tc, tr).type;
    if (type === 'bursztyn') s += needAmber ? 14 : 5;
    if (type === 'grzybnia') s += needMyc ? 16 : 5;
    if (type === 'rzeka') s += 1.5;
  }
  return s;
}

function bestCitySpot(game, p, u) {
  let best = null, bestS = 8; // minimalny sensowny wynik
  for (const k of p.explored) {
    const c = k % 4096, r = Math.floor(k / 4096);
    if (hexDistance(u.col, u.row, c, r) > 10) continue;
    const s = scoreSite(game, p, c, r) - hexDistance(u.col, u.row, c, r) * 0.4;
    if (s > bestS) { bestS = s; best = [c, r]; }
  }
  return best;
}
