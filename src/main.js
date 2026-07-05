// Spoiwo gry: symulacja ⇄ renderer ⇄ interfejs ⇄ dźwięk.
import * as THREE from 'three';
import { Game } from './sim/game.js';
import { UNITS, TILES, FACTIONS, BUILDINGS } from './sim/data.js';
import { keyOf, hexToWorld } from './sim/hex.js';
import { createScene, CameraRig } from './render/scene.js';
import { Board, HEX } from './render/board.js';
import { UnitView } from './render/units.js';
import { FxSystem } from './render/fx.js';
import { loadAllModels } from './render/assets.js';
import { UI } from './ui/ui.js';
import { audio } from './audio.js';

const canvas = document.getElementById('scena');
const { renderer, scene, camera, sun } = createScene(canvas);
const ui = new UI();

let game = null, board = null, rig = null, fx = null;
let unitViews = new Map();
let selectedUnit = null;
let reachCache = null;
let animQueue = [];      // kolejka animowanych zdarzeń
let animBusy = false;
let aiPhase = false;
let modelsReady = false;
let running = false;

// ---------------- start / menu ----------------
ui.onStart = async (faction, size) => {
  audio.start();
  ui.showLoading('Wczytywanie prawdziwych modeli 3D…');
  if (!modelsReady) {
    await loadAllModels((d, n) => ui.setLoading(`Wczytywanie modeli… ${d}/${n}`));
    modelsReady = true;
  }
  ui.setLoading('Tkanie mapy świata…');
  await new Promise(r => setTimeout(r, 30));
  startGame(faction, size);
};

ui.onToMenu = () => {
  running = false;
  teardown();
  ui.showMenu();
};

ui.onKeepPlaying = () => {
  game.sandbox = true;
  ui.notify('Tryb wolnej gry: świat toczy się dalej. Rządź, póki grzybnia pozwala.', 'wonder');
};

ui.onSoundToggle = () => audio.toggleMute();

function teardown() {
  if (board) { scene.remove(board.group); }
  for (const v of unitViews.values()) scene.remove(v.group);
  unitViews.clear();
  document.querySelectorAll('.city-label, .float-text').forEach(e => e.remove());
  board = null; game = null; selectedUnit = null; animQueue = []; animBusy = false;
}

function startGame(faction, size) {
  teardown();
  game = new Game({ mapSize: size, humanFaction: faction });
  ui.attachGame(game);
  board = new Board(scene, game.map);
  fx = new FxSystem(scene);
  const [maxX, maxZ] = hexToWorld(game.map.width - 1, game.map.height - 1, HEX);
  rig = new CameraRig(camera, canvas, { minX: 2, maxX: maxX - 2, minZ: 2, maxZ: maxZ - 2 });

  // jednostki startowe
  for (const u of game.units.values()) ensureUnitView(u);
  drainEvents(true); // zdarzenia początkowe bez animacji

  const start = game.map.starts[0];
  const [sx, sz] = hexToWorld(start[0], start[1], HEX);
  rig.centerOn(sx, sz, 18);

  refreshFog();
  ui.hideLoading();
  ui.updateHud(game);
  ui.notify('Zaznacz Osadnika i załóż pierwszy gród! (📜 Jak grać — w razie wątpliwości)', 'good');
  selectNextIdle();
  running = true;
  // uchwyt diagnostyczny (testy e2e / konsola)
  window.__game = game;
  window.__redraw = () => { drainEvents(); refreshFog(); ui.updateHud(game); };
}

// ---------------- widoki jednostek ----------------
function ensureUnitView(u) {
  if (unitViews.has(u.id)) return unitViews.get(u.id);
  const v = new UnitView(u, game);
  v.group.position.copy(board.worldPos(u.col, u.row));
  scene.add(v.group);
  unitViews.set(u.id, v);
  return v;
}

function removeUnitView(id) {
  const v = unitViews.get(id);
  if (v) { scene.remove(v.group); unitViews.delete(id); }
}

// ---------------- mgła i widoczność ----------------
let visibleNow = new Set();
function refreshFog() {
  const p = game.players[0];
  visibleNow = game.visibleSet(p);
  board.updateFog(p.explored, visibleNow);
  // jednostki widoczne tylko w polu widzenia
  for (const [id, v] of unitViews) {
    const u = game.units.get(id);
    if (!u) continue;
    v.group.visible = visibleNow.has(keyOf(u.col, u.row)) || u.owner === 0;
  }
  // obozy barbarzyńców
  for (const camp of game.camps) {
    if (p.explored.has(keyOf(camp.col, camp.row))) board.addCamp(camp.col, camp.row);
  }
}

// ---------------- pompa zdarzeń → animacje ----------------
function drainEvents(instant = false) {
  const evs = game.events.splice(0, game.events.length);
  for (const e of evs) {
    if (instant) { applyInstant(e); continue; }
    animQueue.push(e);
  }
  pumpAnim();
}

function eventVisible(e) {
  const at = e.at || (e.unit ? [e.unit.col, e.unit.row] : null) ||
    (e.city ? [e.city.col, e.city.row] : null) ||
    (e.col !== undefined ? [e.col, e.row] : null);
  if (!at) return true;
  if (e.path) return e.path.some(([c, r]) => visibleNow.has(keyOf(c, r))) || visibleNow.has(keyOf(at[0], at[1]));
  return visibleNow.has(keyOf(at[0], at[1]));
}

function pumpAnim() {
  if (animBusy) return;
  const e = animQueue.shift();
  if (!e) {
    if (aiPhase) finishAiPhase();
    return;
  }
  const vis = eventVisible(e) || e.t === 'notify' || e.t === 'techDone' || e.t === 'victory' || e.t === 'defeat';
  if (!vis) { applyInstant(e); pumpAnim(); return; }
  const dur = animate(e);
  if (dur > 0) {
    animBusy = true;
    setTimeout(() => { animBusy = false; pumpAnim(); }, dur * 1000);
  } else {
    pumpAnim();
  }
}

function applyInstant(e) {
  switch (e.t) {
    case 'unitCreated': { const u = game.units.get(e.unit.id); if (u) ensureUnitView(u); break; }
    case 'unitMoved': { const v = unitViews.get(e.unit.id); if (v) v.group.position.copy(board.worldPos(e.unit.col, e.unit.row)); break; }
    case 'unitDied': removeUnitView(e.unit.id); break;
    case 'cityFounded': case 'cityGrew': case 'cityBuilt': case 'cityCaptured': case 'cityRaided':
      { const ct = game.cities.get(e.city.id); if (ct) board.addOrUpdateCity(game, ct); break; }
    case 'cityRazed': board.removeCity(e.city.id); break;
    case 'campSpawned': break; // pojawi się przy odświeżeniu mgły
    case 'campDestroyed': board.removeCamp(e.col, e.row); break;
    case 'tileChanged': retile(e); break;
    case 'victory': onVictory(e); break;
    case 'defeat': onDefeat(); break;
    case 'notify': if (e.for === undefined || e.for === 0) ui.notify(e.msg, e.kind); break;
  }
}

function retile(e) {
  // Zmiana typu pola (zaorane/grabież): najprościej — przebuduj dekoracje i kolory od nowa
  board.hideDecorAt(e.col, e.row);
  // kolor heksa zostaje z poprzedniego typu; subtelne — pomijamy pełną przebudowę dla wydajności
}

function animate(e) {
  switch (e.t) {
    case 'unitCreated': {
      const u = game.units.get(e.unit.id);
      if (u) {
        const v = ensureUnitView(u);
        v.group.scale.setScalar(0.01);
        tween(v.group.scale, { x: 1, y: 1, z: 1 }, 0.3);
        if (u.owner === 0) audio.play('unit_ready', { vol: 0.5 });
      }
      return 0.15;
    }
    case 'unitMoved': {
      const v = unitViews.get(e.unit.id);
      if (!v) return 0;
      v.group.visible = true;
      const pts = [v.group.position.clone(), ...e.path.map(([c, r]) => board.worldPos(c, r))];
      const speed = e.unit.owner === 0 ? 3.4 : 5.2;
      v.startMove(pts, speed);
      let dist = 0;
      for (let i = 1; i < pts.length; i++) dist += pts[i - 1].distanceTo(pts[i]);
      return Math.min(1.6, dist / speed + 0.08);
    }
    case 'combat': {
      const va = unitViews.get(e.attacker.id), vd = unitViews.get(e.defender.id);
      const target = board.worldPos(e.at[0], e.at[1]);
      if (va) { va.faceTowards(target); va.play('attack', { once: true }); }
      if (vd) vd.faceTowards(va ? va.group.position : target);
      audio.attack();
      if (e.attacker.type === 'bartnik') { audio.play('bees', { vol: 0.9 }); if (va) fx.beeSwarm(va.group.position, target); }
      if (e.attacker.type === 'barbarzynca' || e.attacker.type === 'barbarzynca_elit') audio.barb();
      setTimeout(() => {
        fx.burst(target, { color: 0xffd23b, n: 20 });
        fx.flash(target, { color: 0xffaa55, intensity: 2.5 });
        const loser = e.attackerWon ? vd : va;
        if (loser) loser.play('death', { once: true });
        audio.play('unit_death', { vol: 0.55, delay: 0.15 });
        floatText(target, e.attackerWon ? '⚔' : '🛡', e.attackerWon ? '#ffd23b' : '#9adfff');
      }, 420);
      return 1.25;
    }
    case 'unitDied': {
      const v = unitViews.get(e.unit.id);
      if (v && !e.silent) {
        setTimeout(() => removeUnitView(e.unit.id), 700);
        return 0.05;
      }
      removeUnitView(e.unit.id);
      return 0;
    }
    case 'cityFounded': {
      const ct = game.cities.get(e.city.id);
      if (ct) board.addOrUpdateCity(game, ct);
      const p = board.worldPos(e.city.col, e.city.row);
      fx.burst(p, { color: 0xd8c98a, n: 40, up: 2.2 });
      fx.ring(p, { color: 0xd8c98a });
      audio.play('city', { vol: 0.9 });
      audio.build();
      return 0.7;
    }
    case 'cityGrew': case 'cityRaided': {
      const ct = game.cities.get(e.city.id);
      if (ct) board.addOrUpdateCity(game, ct);
      return 0.1;
    }
    case 'cityBuilt': {
      const ct = game.cities.get(e.city.id);
      if (ct) board.addOrUpdateCity(game, ct);
      const p = board.worldPos(e.city.col, e.city.row);
      if (e.wonder) {
        fx.burst(p, { color: 0xffe28a, n: 80, up: 3.4, life: 1.6 });
        fx.flash(p, { color: 0xffe28a, intensity: 6, life: 1.4, dist: 12 });
        fx.ring(p, { color: 0xffe28a, maxR: 4, life: 1.4 });
        audio.play('wonder', { vol: 1 });
        audio.play('fanfare', { vol: 0.7, delay: 0.4 });
        return 2.2;
      }
      if (e.kind === 'building' && e.city.owner === 0) audio.build();
      return 0.25;
    }
    case 'cityCaptured': {
      const ct = game.cities.get(e.city.id);
      if (ct) board.addOrUpdateCity(game, ct);
      const p = board.worldPos(e.city.col, e.city.row);
      fx.burst(p, { color: 0xd24b3b, n: 40 });
      audio.play('drums', { vol: 0.7 });
      return 0.8;
    }
    case 'cityRazed': {
      const p = board.worldPos(e.city.col, e.city.row);
      fx.burst(p, { color: 0xd24b3b, n: 60, up: 3 });
      fx.flash(p, { color: 0xff5522, intensity: 4 });
      board.removeCity(e.city.id);
      audio.play('drums', { vol: 0.8 });
      return 0.9;
    }
    case 'campSpawned': {
      if (game.players[0].explored.has(keyOf(e.col, e.row))) board.addCamp(e.col, e.row);
      return 0;
    }
    case 'campDestroyed': {
      const p = board.worldPos(e.col, e.row);
      fx.burst(p, { color: 0xff8844, n: 40 });
      board.removeCamp(e.col, e.row);
      if (e.player === 0) { audio.gold(); floatText(p, '+25 🪙', '#ffd23b'); }
      return 0.6;
    }
    case 'pillage': {
      const p = board.worldPos(e.col, e.row);
      fx.burst(p, { color: 0xff6633, n: 30 });
      board.hideDecorAt(e.col, e.row);
      if (e.unit.owner === 0) { audio.gold(); floatText(p, `+${e.gold} 🪙`, '#ffd23b'); }
      return 0.5;
    }
    case 'spores': {
      const p = board.worldPos(e.col, e.row);
      const v = unitViews.get(e.unit.id);
      if (v) v.play('attack', { once: true });
      fx.spores(p);
      audio.play('spores', { vol: 0.9 });
      audio.play('mycelium', { vol: 0.8, delay: 0.3 });
      return 1.1;
    }
    case 'tileChanged': {
      retile(e);
      const p = board.worldPos(e.col, e.row);
      fx.burst(p, { color: 0xc9a83c, n: 24 });
      if (visibleNow.has(keyOf(e.col, e.row))) audio.build();
      return 0.4;
    }
    case 'techDone': {
      if (e.player === 0) {
        audio.play('tech', { vol: 0.9 });
        if (e.tech === 'elektrycznosc') audio.play('zap', { vol: 0.7, delay: 0.4 });
        ui.renderTech(game);
      }
      return e.player === 0 ? 0.3 : 0;
    }
    case 'wonderBuilt': return 0;
    case 'barbAlert': { audio.play('alert', { vol: 0.7 }); return 0; }
    case 'playerEliminated': return 0;
    case 'victory': { onVictory(e); return 0; }
    case 'defeat': { onDefeat(); return 0; }
    case 'notify': {
      if (e.for === undefined || e.for === 0) ui.notify(e.msg, e.kind);
      return 0;
    }
    default: return 0;
  }
}

function onVictory(e) {
  audio.play('fanfare', { vol: 1 });
  ui.showEndgame({ victory: true, faction: e.faction, isHuman: e.isHuman });
}

function onDefeat() {
  ui.showEndgame({ victory: false, faction: game.players[0].faction, isHuman: true, sandboxAvailable: false });
}

// ---------------- tekst unoszący się ----------------
function floatText(worldPos, text, color = '#fff') {
  const el = document.createElement('div');
  el.className = 'float-text';
  el.style.color = color;
  el.textContent = text;
  document.getElementById('app').appendChild(el);
  const update = () => {
    const sp = worldPos.clone().project(camera);
    el.style.left = (sp.x * 0.5 + 0.5) * window.innerWidth + 'px';
    el.style.top = (-sp.y * 0.5 + 0.5) * window.innerHeight + 'px';
  };
  update();
  setTimeout(() => el.remove(), 1400);
}

// prosty tween skali
const tweens = [];
function tween(obj, to, dur) {
  tweens.push({ obj, from: { ...obj }, to, t: 0, dur });
}

// ---------------- wybór i rozkazy ----------------
const raycaster = new THREE.Raycaster();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.3);

function pickHex(ev) {
  const ndc = new THREE.Vector2(
    (ev.clientX / window.innerWidth) * 2 - 1,
    -(ev.clientY / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const pt = new THREE.Vector3();
  if (!raycaster.ray.intersectPlane(groundPlane, pt)) return null;
  // odwrotność hexToWorld (przybliżona przez najbliższy środek)
  const row = Math.round(pt.z / (HEX * 1.5));
  const col = Math.round(pt.x / (HEX * Math.sqrt(3)) - 0.5 * (row & 1));
  let best = null, bestD = 1e9;
  for (let r = row - 1; r <= row + 1; r++) {
    for (let c = col - 1; c <= col + 1; c++) {
      if (!game.inBounds(c, r)) continue;
      const [x, z] = hexToWorld(c, r, HEX);
      const d = (x - pt.x) ** 2 + (z - pt.z) ** 2;
      if (d < bestD) { bestD = d; best = [c, r]; }
    }
  }
  return best;
}

function selectUnit(u) {
  selectedUnit = u;
  if (!u) {
    board.setSelection(null);
    board.clearReachable();
    ui.showUnit(game, null);
    return;
  }
  board.setSelection(u.col, u.row);
  ui.showUnit(game, u);
  if (u.moves > 0) {
    reachCache = game.reachableTiles(u);
    const list = [...reachCache.dist.keys()]
      .filter(k => k !== keyOf(u.col, u.row))
      .filter(k => game.players[0].explored.has(k))
      .map(k => [k % 4096, Math.floor(k / 4096)]);
    board.showReachable(list);
  } else {
    reachCache = null;
    board.clearReachable();
  }
}

function selectNextIdle() {
  for (const u of game.units.values()) {
    if (u.owner === 0 && u.moves > 0 && !u.fortified && u.working === 0) {
      selectUnit(u);
      const [x, z] = hexToWorld(u.col, u.row, HEX);
      // delikatne dosunięcie kamery tylko gdy daleko
      const dx = rig.target.x - x, dz = rig.target.z - z;
      if (dx * dx + dz * dz > 140) rig.centerOn(x, z);
      return true;
    }
  }
  selectUnit(null);
  document.getElementById('btn-end-turn').classList.add('attention');
  return false;
}

canvas.addEventListener('click', (ev) => {
  if (!running || aiPhase || animBusy) return;
  if (rig.dragging) return;
  audio.start();
  const hex = pickHex(ev);
  if (!hex) return;
  const [c, r] = hex;
  const p = game.players[0];
  if (!p.explored.has(keyOf(c, r))) { selectUnit(null); return; }

  // rozkaz ruchu dla zaznaczonej jednostki
  if (selectedUnit && reachCache && reachCache.dist.has(keyOf(c, r)) &&
      !(selectedUnit.col === c && selectedUnit.row === r)) {
    const u = selectedUnit;
    audio.play('ui_click', { vol: 0.4 });
    game.moveUnit(u, c, r);
    drainEvents();
    refreshFog();
    ui.updateHud(game);
    if (game.units.has(u.id) && u.moves > 0) selectUnit(u);
    else { selectUnit(null); setTimeout(selectNextIdle, 350); }
    return;
  }

  // zaznaczenie: jednostka gracza > gród > pole
  const mine = game.unitsAt(c, r).filter(u => u.owner === 0);
  if (mine.length) {
    // cykliczne przełączanie w stosie
    const idx = selectedUnit ? mine.indexOf(selectedUnit) : -1;
    selectUnit(mine[(idx + 1) % mine.length]);
    audio.play('ui_click', { vol: 0.35 });
    return;
  }
  const ct = game.cityAt(c, r);
  if (ct && ct.owner === 0) {
    ui.showCity(game, ct);
    audio.play('ui_open', { vol: 0.5 });
    selectUnit(null);
    return;
  }
  selectUnit(null);
});

// najechanie: podpowiedź pola
const tooltip = document.getElementById('tooltip');
canvas.addEventListener('pointermove', (ev) => {
  if (!running) return;
  const hex = pickHex(ev);
  if (!hex) { tooltip.classList.add('hidden'); board.setHover(null); return; }
  const [c, r] = hex;
  const p = game.players[0];
  if (!p.explored.has(keyOf(c, r))) {
    tooltip.classList.remove('hidden');
    tooltip.style.left = (ev.clientX + 16) + 'px';
    tooltip.style.top = (ev.clientY + 12) + 'px';
    tooltip.innerHTML = '<b>Nieznane ziemie</b><br>Wyślij zwiadowców.';
    board.setHover(null);
    return;
  }
  board.setHover(c, r);
  const t = game.tile(c, r);
  const y = TILES[t.type];
  let html = `<b>${y.name}</b><br><span class="tt-yield">🍞${y.food} ⚒${y.prod} 🪙${y.gold} 🔬${y.sci}</span>`;
  if (t.type === 'bursztyn') html += '<br>⚡ Zasila Elektryczność bursztynową';
  if (t.type === 'grzybnia') html += '<br>🍄 Substrat Przebudzenia Grzybni';
  const ct = game.cityAt(c, r);
  if (ct) html += `<br>🏰 ${ct.name} (${FACTIONS[game.players[ct.owner].faction].name})`;
  const camp = game.campAt(c, r);
  if (camp && p.explored.has(keyOf(c, r))) html += '<br>💀 Obóz barbarzyńców';
  if (visibleNow.has(keyOf(c, r))) {
    for (const u of game.unitsAt(c, r)) {
      const f = u.owner >= 0 ? FACTIONS[game.players[u.owner].faction].name : 'Barbarzyńcy';
      html += `<br>${UNITS[u.type].name} (${f}) ❤️${u.hp}`;
    }
  }
  tooltip.innerHTML = html;
  tooltip.classList.remove('hidden');
  tooltip.style.left = (ev.clientX + 16) + 'px';
  tooltip.style.top = (ev.clientY + 12) + 'px';
});
canvas.addEventListener('pointerleave', () => tooltip.classList.add('hidden'));

// ---------------- akcje z paneli ----------------
ui.onUnitAction = (action, unit) => {
  audio.play('ui_click', { vol: 0.4 });
  const u = game.units.get(unit.id);
  if (!u) return;
  switch (action) {
    case 'found': game.foundCity(u); break;
    case 'improve': game.improveTile(u); break;
    case 'fortify': game.fortify(u); break;
    case 'pillage': game.pillage(u); break;
    case 'spores': game.sporeBurst(u); break;
    case 'skip': u.moves = 0; break;
  }
  drainEvents();
  refreshFog();
  ui.updateHud(game);
  if (game.units.has(u.id) && u.moves > 0) selectUnit(u);
  else { selectUnit(null); setTimeout(selectNextIdle, 400); }
};

ui.onSetResearch = (techId) => {
  game.setResearch(game.players[0], techId);
  audio.play('ui_click', { vol: 0.4 });
  ui.updateHud(game);
};

ui.onSetBuild = (city, kind, id) => {
  game.setBuild(city, kind, id);
  audio.play('ui_click', { vol: 0.4 });
  ui.updateHud(game);
};

ui.onBuyBuild = (city) => {
  if (game.buyBuild(city)) audio.gold();
  ui.updateHud(game);
};

ui.onCityClick = (cityId) => {
  const ct = game.cities.get(cityId);
  if (ct && ct.owner === 0) { ui.showCity(game, ct); audio.play('ui_open', { vol: 0.5 }); }
};

// ---------------- koniec tury ----------------
ui.onEndTurn = () => {
  if (!running || aiPhase || animBusy) return;
  if (game.winner !== null && !game.sandbox) return;
  audio.play('turn_end', { vol: 0.7 });
  document.getElementById('btn-end-turn').classList.remove('attention');
  selectUnit(null);
  ui.hideCity();
  aiPhase = true;
  ui.setEndTurnState('busy');
  // symulacja tur przeciwników jest natychmiastowa; animujemy tylko to, co widać
  game.endTurn();
  drainEvents();
};

function finishAiPhase() {
  aiPhase = false;
  ui.setEndTurnState('ready');
  refreshFog();
  ui.updateHud(game);
  // przypomnienie o wyborze badania
  const p = game.players[0];
  if (!p.researching) {
    const av = game.availableTechs(p).filter(t => !t.blocked);
    if (av.length) ui.notify('🔬 Uczeni czekają — wybierz nowe badanie (🧪 na pasku).', 'tech');
  }
  selectNextIdle();
}

// ---------------- etykiety grodów ----------------
const labelPool = new Map();
function updateLabels() {
  if (!game || !board) return;
  const p = game.players[0];
  const seen = new Set();
  for (const ct of game.cities.values()) {
    if (!p.explored.has(keyOf(ct.col, ct.row))) continue;
    seen.add(ct.id);
    let el = labelPool.get(ct.id);
    if (!el) {
      el = document.createElement('div');
      el.className = 'city-label';
      el.addEventListener('click', () => ui.onCityClick && ui.onCityClick(ct.id));
      document.getElementById('app').appendChild(el);
      labelPool.set(ct.id, el);
    }
    const f = FACTIONS[game.players[ct.owner].faction];
    el.style.setProperty('--fc', '#' + f.color.toString(16).padStart(6, '0'));
    let prodTxt = '';
    if (ct.owner === 0 && ct.buildQueue) {
      const item = ct.buildQueue;
      const nm = item.id === 'przebudzenie' ? '🍄 PRZEBUDZENIE'
        : item.kind === 'unit' ? UNITS[item.id].name : BUILDINGS_NAME(item.id);
      prodTxt = ` <span class="cl-prod">⚒ ${nm}</span>`;
    }
    el.innerHTML = `<span class="cl-pop">${ct.pop}</span>${ct.name}${prodTxt}`;
    const wp = board.worldPos(ct.col, ct.row);
    wp.y += 1.3;
    const sp = wp.project(camera);
    if (sp.z > 1) { el.style.display = 'none'; continue; }
    el.style.display = '';
    el.style.left = (sp.x * 0.5 + 0.5) * window.innerWidth + 'px';
    el.style.top = (-sp.y * 0.5 + 0.5) * window.innerHeight + 'px';
  }
  for (const [id, el] of labelPool) {
    if (!seen.has(id)) { el.remove(); labelPool.delete(id); }
  }
}

function BUILDINGS_NAME(id) { return BUILDINGS[id]?.name ?? id; }

// ---------------- pętla renderowania ----------------
const clock = new THREE.Clock();
function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, clock.getDelta());
  if (running && rig) {
    rig.update(dt);
    // słońce podąża za kamerą (cienie zawsze w kadrze)
    sun.position.set(rig.target.x + 24, 38, rig.target.z + 14);
    sun.target.position.set(rig.target.x, 0, rig.target.z);
    for (const [id, v] of unitViews) {
      v.update(dt, game.units.get(id));
    }
    fx && fx.update(dt);
    for (let i = tweens.length - 1; i >= 0; i--) {
      const tw = tweens[i];
      tw.t += dt;
      const k = Math.min(1, tw.t / tw.dur);
      for (const key of Object.keys(tw.to)) {
        tw.obj[key] = tw.from[key] + (tw.to[key] - tw.from[key]) * (k * (2 - k));
      }
      if (k >= 1) tweens.splice(i, 1);
    }
    updateLabels();
  }
  renderer.render(scene, camera);
}
loop();

// menu na start
ui.showMenu();
