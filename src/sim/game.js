// Rdzeń symulacji — czysta logika, zero renderowania.
// Frontend czyta stan i konsumuje kolejkę zdarzeń (game.events).

import { makeRng } from './rng.js';
import { neighbors, hexDistance, keyOf, tilesInRange } from './hex.js';
import { TILES, UNITS, BUILDINGS, TECHS, TECH_ORDER, FACTIONS, MAP_SIZES } from './data.js';
import { generateMap } from './mapgen.js';
import { runAiTurn } from './ai.js';

const CITY_NAMES = {
  polanie: ['Gniezdno', 'Poznania', 'Ostrów', 'Kruszwica', 'Lednica', 'Giecz', 'Kalisia', 'Śrem'],
  wislanie: ['Wiślica', 'Kraków', 'Sandomir', 'Tyniec', 'Stradów', 'Naszacowice', 'Demblin', 'Zawichost'],
  goci: ['Gothiscandza', 'Arheimar', 'Oium', 'Dancheim', 'Rugiland', 'Vistulaheim', 'Amalborg', 'Terwingia'],
  wandalowie: ['Vandalgard', 'Silingia', 'Hasdingborg', 'Lugiheim', 'Odraborg', 'Raubstad', 'Plundria', 'Genzeryk'],
  barb: ['Obóz dziczy'],
};

let nextId = 1;
const uid = () => nextId++;
export function getUid() { return nextId; }
export function setUid(v) { nextId = Math.max(nextId, v | 0); }

export class Game {
  constructor({ mapSize = 'srednia', humanFaction = 'polanie', seed = (Date.now() % 2147483647) } = {}) {
    const { w, h } = MAP_SIZES[mapSize];
    this.rng = makeRng(seed ^ 0x9e3779b9);
    this.map = generateMap(w, h, seed, 4);
    this.mapSize = mapSize;
    this.turn = 1;
    this.events = [];
    this.units = new Map();
    this.cities = new Map();
    this.camps = [];
    this.winner = null;      // id gracza-zwycięzcy
    this.sandbox = false;    // "Graj dalej" po zwycięstwie
    this.wonderBuiltBy = null; // sanktuarium jest jedno na grę
    this.humanDefeated = false;

    const order = ['polanie', 'wislanie', 'goci', 'wandalowie'].sort(() =>
      this.rng.next() - 0.5);
    if (order.includes(humanFaction)) {
      order.splice(order.indexOf(humanFaction), 1);
      order.unshift(humanFaction);
    }
    this.players = order.map((fid, i) => ({
      id: i, faction: fid, isHuman: i === 0, alive: true,
      aiStyle: this.rng.pick(['obronny', 'ekspansywny', 'zbalansowany']),
      gold: 20, poparcie: 55, laska: 30,
      techs: new Set(), researching: null, sciBox: 0,
      explored: new Set(), namePool: [...CITY_NAMES[fid]],
      stats: { kills: 0, losses: 0, pillages: 0 },
    }));
    this.currentIdx = 0;

    // Jednostki startowe: Osadnik + Wojownik
    this.players.forEach((p, i) => {
      const [c, r] = this.map.starts[i];
      this.spawnUnit(p.id, 'osadnik', c, r);
      const spot = this.freeNeighbor(c, r) || [c, r];
      this.spawnUnit(p.id, 'wojownik', spot[0], spot[1]);
      this.revealAround(p, c, r, 3);
    });
    this.beginTurn(this.players[0]);
  }

  // ---------- pomocnicze ----------
  tile(c, r) { return this.map.tiles[r * this.map.width + c]; }
  inBounds(c, r) { return c >= 0 && r >= 0 && c < this.map.width && r < this.map.height; }
  emit(ev) { this.events.push(ev); }
  player(id) { return this.players[id]; }
  currentPlayer() { return this.players[this.currentIdx]; }
  factionOf(p) { return FACTIONS[p.faction]; }

  unitsAt(c, r) {
    const out = [];
    for (const u of this.units.values()) if (u.col === c && u.row === r && u.hp > 0) out.push(u);
    return out;
  }
  cityAt(c, r) {
    for (const ct of this.cities.values()) if (ct.col === c && ct.row === r) return ct;
    return null;
  }
  campAt(c, r) { return this.camps.find(k => k.col === c && k.row === r) || null; }

  freeNeighbor(c, r) {
    for (const [nc, nr] of neighbors(c, r)) {
      if (!this.inBounds(nc, nr)) continue;
      const t = this.tile(nc, nr);
      if (t.type !== 'woda' && !this.unitsAt(nc, nr).length) return [nc, nr];
    }
    return null;
  }

  revealAround(p, c, r, radius = 2) {
    for (const [tc, tr] of tilesInRange(c, r, radius, this.map.width, this.map.height)) {
      p.explored.add(keyOf(tc, tr));
    }
  }

  visibleSet(p) {
    const vis = new Set();
    for (const u of this.units.values()) {
      if (u.owner !== p.id || u.hp <= 0) continue;
      const sight = this.tile(u.col, u.row).type === 'gory' ? 3 : 2;
      for (const [c, r] of tilesInRange(u.col, u.row, sight, this.map.width, this.map.height)) vis.add(keyOf(c, r));
    }
    for (const ct of this.cities.values()) {
      if (ct.owner !== p.id) continue;
      for (const [c, r] of tilesInRange(ct.col, ct.row, 2, this.map.width, this.map.height)) vis.add(keyOf(c, r));
    }
    return vis;
  }

  // Granice: pole należy do gracza, jeśli jest w promieniu 2 jego grodu
  // (najbliższy gród rozstrzyga remisy).
  tileOwner(c, r) {
    let best = null, bestD = 99;
    for (const ct of this.cities.values()) {
      const d = hexDistance(c, r, ct.col, ct.row);
      if (d <= 2 && (d < bestD || (d === bestD && best && ct.foundedTurn < best.foundedTurn))) {
        best = ct; bestD = d;
      }
    }
    return best;
  }

  playerHasTileType(p, type) {
    for (const ct of this.cities.values()) {
      if (ct.owner !== p.id) continue;
      for (const [c, r] of tilesInRange(ct.col, ct.row, 2, this.map.width, this.map.height)) {
        if (this.tile(c, r).type === type) {
          const own = this.tileOwner(c, r);
          if (own && own.owner === p.id) return true;
        }
      }
    }
    return false;
  }

  // ---------- jednostki ----------
  spawnUnit(owner, type, c, r) {
    const def = UNITS[type];
    const u = {
      id: uid(), owner, type, col: c, row: r, hp: 100,
      moves: this.maxMoves(owner, type), fortified: false,
      garrison: false, disoriented: 0, cooldown: 0, working: 0,
    };
    this.units.set(u.id, u);
    this.emit({ t: 'unitCreated', unit: this.unitView(u) });
    if (owner >= 0) this.revealAround(this.players[owner], c, r, 2);
    return u;
  }

  maxMoves(owner, type) {
    const def = UNITS[type];
    let m = def.moves;
    if (owner >= 0 && def.military && this.players[owner].faction === 'wandalowie') m += 1;
    return m;
  }

  unitView(u) {
    return { id: u.id, owner: u.owner, type: u.type, col: u.col, row: u.row, hp: u.hp };
  }

  attackOf(u) {
    const def = UNITS[u.type];
    let a = def.atk;
    const p = u.owner >= 0 ? this.players[u.owner] : null;
    if (p) {
      if (u.type === 'wojownik' && p.techs.has('obrobka_zelaza')) a += 1;
      if (u.type === 'tabor' && p.techs.has('mechanika')) a += 2;
    }
    if (u.disoriented > 0) a *= 0.5;
    return Math.max(0.5, a);
  }

  defenseOf(u, ignoreTerrainHalf = false) {
    const def = UNITS[u.type];
    let d = def.def;
    const p = u.owner >= 0 ? this.players[u.owner] : null;
    if (p && u.type === 'wojownik' && p.techs.has('obrobka_zelaza')) d += 1;
    const t = this.tile(u.col, u.row);
    let bonus = TILES[t.type].defense;
    if (u.fortified) bonus += 0.25;
    const city = this.cityAt(u.col, u.row);
    if (city) {
      bonus += 0.5;
      if (city.buildings.has('palisada')) bonus += 0.5;
      if (p && p.techs.has('elektrycznosc')) bonus += 0.5;
      if (city.sporesTurns > 0) bonus *= 0.7;
    }
    if (!city && this.unitsAt(u.col, u.row).some(x => x.type === 'tabor' && x.id !== u.id)) bonus += 0.5;
    if (ignoreTerrainHalf) bonus *= 0.5;
    if (u.disoriented > 0) d *= 0.75;
    return Math.max(0.5, d * (1 + Math.max(-0.5, bonus)));
  }

  moveCost(c, r) { return TILES[this.tile(c, r).type].move || 99; }

  // Pola osiągalne w tej turze (Dijkstra po koszcie ruchu).
  reachableTiles(u) {
    const dist = new Map([[keyOf(u.col, u.row), 0]]);
    const prev = new Map();
    const queue = [[0, u.col, u.row]];
    while (queue.length) {
      queue.sort((a, b) => a[0] - b[0]);
      const [d, c, r] = queue.shift();
      if (d > dist.get(keyOf(c, r))) continue;
      for (const [nc, nr] of neighbors(c, r)) {
        if (!this.inBounds(nc, nr)) continue;
        const t = this.tile(nc, nr);
        if (t.type === 'woda') continue;
        const occ = this.unitsAt(nc, nr);
        const enemy = occ.some(x => x.owner !== u.owner);
        const cityHere = this.cityAt(nc, nr);
        const enemyCity = cityHere && cityHere.owner !== u.owner;
        const campHere = this.campAt(nc, nr);
        const nd = d + this.moveCost(nc, nr);
        if (nd > u.moves) continue;
        const k = keyOf(nc, nr);
        // Na pole wroga można tylko WEJŚĆ jako cel (atak/zdobycie) — nie przechodzić.
        if (dist.get(k) === undefined || nd < dist.get(k)) {
          dist.set(k, nd); prev.set(k, keyOf(c, r));
          if (!(enemy || enemyCity || campHere)) queue.push([nd, nc, nr]);
        }
      }
    }
    return { dist, prev };
  }

  pathFromPrev(prev, fromC, fromR, toC, toR) {
    const path = [];
    let k = keyOf(toC, toR);
    const start = keyOf(fromC, fromR);
    while (k !== undefined && k !== start) {
      path.unshift([k % 4096, Math.floor(k / 4096)]);
      k = prev.get(k);
    }
    return path;
  }

  // Rozkaz ruchu (i ewentualny atak na końcu ścieżki).
  moveUnit(u, toC, toR) {
    if (u.hp <= 0 || u.moves <= 0) return false;
    const { dist, prev } = this.reachableTiles(u);
    const k = keyOf(toC, toR);
    if (!dist.has(k) || (toC === u.col && toR === u.row)) return false;
    const path = this.pathFromPrev(prev, u.col, u.row, toC, toR);
    if (!path.length) return false;

    const [lc, lr] = path[path.length - 1];
    const enemies = this.unitsAt(lc, lr).filter(x => this.areEnemies(u.owner, x.owner));
    const city = this.cityAt(lc, lr);
    const camp = this.campAt(lc, lr);
    const walkPath = (enemies.length || (city && city.owner !== u.owner) || camp) ? path.slice(0, -1) : path;

    if (walkPath.length) {
      const [wc, wr] = walkPath[walkPath.length - 1];
      u.col = wc; u.row = wr;
      u.fortified = false;
      u.garrison = false;
      this.emit({ t: 'unitMoved', unit: this.unitView(u), path: walkPath });
      if (u.owner >= 0) {
        for (const [pc, pr] of walkPath) this.revealAround(this.players[u.owner], pc, pr, 2);
      }
    }
    u.moves -= Math.min(u.moves, dist.get(k));

    if (enemies.length) {
      if (!UNITS[u.type].military) return true; // osadnik nie atakuje
      this.resolveCombat(u, lc, lr);
    } else if (camp && UNITS[u.type].military) {
      this.destroyCamp(camp, u);
      u.col = lc; u.row = lr;
      this.emit({ t: 'unitMoved', unit: this.unitView(u), path: [[lc, lr]] });
    } else if (city && city.owner !== u.owner) {
      if (UNITS[u.type].military) this.captureCity(city, u, lc, lr);
    }
    return true;
  }

  areEnemies(a, b) {
    if (a === b) return false;
    return true; // wszyscy przeciw wszystkim (plus barbarzyńcy = -1)
  }

  resolveCombat(attacker, tc, tr) {
    const defenders = this.unitsAt(tc, tr).filter(x => this.areEnemies(attacker.owner, x.owner));
    if (!defenders.length) return;
    // Broni najsilniejszy w obronie
    let best = defenders[0], bestD = -1;
    for (const d of defenders) {
      const dv = this.defenseOf(d, attacker.type === 'bartnik');
      if (dv > bestD) { bestD = dv; best = d; }
    }
    const A = this.attackOf(attacker);
    const D = bestD;
    const rounds = [];
    let ahp = attacker.hp, dhp = best.hp;
    while (ahp > 0 && dhp > 0) {
      if (this.rng.next() < A / (A + D)) { dhp -= 35; rounds.push('a'); }
      else { ahp -= 35; rounds.push('d'); }
    }
    attacker.hp = Math.max(0, ahp);
    best.hp = Math.max(0, dhp);
    const attackerWon = best.hp <= 0;
    this.emit({
      t: 'combat', at: [tc, tr], from: [attacker.col, attacker.row],
      attacker: this.unitView(attacker), defender: this.unitView(best),
      attackerWon, rounds: rounds.length,
    });
    if (attackerWon) {
      this.killUnit(best, attacker.owner);
      if (attacker.owner >= 0) this.bumpPoparcie(this.players[attacker.owner], +2);
      if (best.owner >= 0) this.bumpPoparcie(this.players[best.owner], -2);
      // Zwycięzca wchodzi, jeśli pole opustoszało i nie ma tam wrogiego grodu
      const cityThere = this.cityAt(tc, tr);
      if (!this.unitsAt(tc, tr).length) {
        if (cityThere && cityThere.owner !== attacker.owner) {
          this.captureCity(cityThere, attacker, tc, tr);
        } else if (!cityThere) {
          attacker.col = tc; attacker.row = tr;
          this.emit({ t: 'unitMoved', unit: this.unitView(attacker), path: [[tc, tr]] });
          if (attacker.owner >= 0) this.revealAround(this.players[attacker.owner], tc, tr, 2);
        }
      }
    } else {
      this.killUnit(attacker, best.owner);
      if (best.owner >= 0) this.bumpPoparcie(this.players[best.owner], +2);
      if (attacker.owner >= 0) this.bumpPoparcie(this.players[attacker.owner], -2);
    }
  }

  killUnit(u, killerOwner) {
    u.hp = 0;
    this.units.delete(u.id);
    this.emit({ t: 'unitDied', unit: this.unitView(u) });
    if (u.owner >= 0) this.players[u.owner].stats.losses++;
    if (killerOwner >= 0) this.players[killerOwner].stats.kills++;
  }

  captureCity(city, unit, tc, tr) {
    const oldOwner = city.owner;
    if (unit.owner < 0) {
      // Barbarzyńcy łupią: -1 populacji, kradną złoto; przy 1 pop — palą gród
      const p = this.players[oldOwner];
      p.gold = Math.max(0, p.gold - 15);
      this.bumpPoparcie(p, -8);
      if (city.pop <= 1 && unit.type === 'barbarzynca_elit') {
        this.razeCity(city);
        this.emit({ t: 'notify', msg: `Barbarzyńcy spalili gród ${city.name}!`, kind: 'bad', for: oldOwner });
      } else {
        city.pop = Math.max(1, city.pop - 1);
        this.emit({ t: 'cityRaided', city: this.cityView(city), by: this.unitView(unit) });
        this.emit({ t: 'notify', msg: `Barbarzyńcy złupili gród ${city.name}!`, kind: 'bad', for: oldOwner });
        // pospolite ruszenie broni grodu — najeźdźca krwawi przy każdym najeździe
        unit.hp -= 35;
        if (unit.hp <= 0) {
          this.killUnit(unit, oldOwner);
          this.emit({ t: 'notify', msg: `Lud grodu ${city.name} zatłukł napastnika!`, kind: 'good', for: oldOwner });
        }
      }
      return;
    }
    city.owner = unit.owner;
    city.pop = Math.max(1, city.pop - 1);
    city.buildQueue = null;
    if (city.buildings.has('sanktuarium')) this.wonderBuiltBy = unit.owner;
    const loot = 20;
    this.players[unit.owner].gold += loot;
    this.bumpPoparcie(this.players[unit.owner], +5);
    if (oldOwner >= 0) this.bumpPoparcie(this.players[oldOwner], -10);
    unit.col = tc; unit.row = tr;
    this.emit({ t: 'unitMoved', unit: this.unitView(unit), path: [[tc, tr]] });
    this.emit({ t: 'cityCaptured', city: this.cityView(city), from: oldOwner });
    this.emit({ t: 'notify', msg: `${FACTIONS[this.players[unit.owner].faction].name} zdobyli gród ${city.name}! (+${loot} złota)`, kind: 'war' });
    this.revealAround(this.players[unit.owner], tc, tr, 2);
    this.checkElimination(oldOwner);
  }

  razeCity(city) {
    this.cities.delete(city.id);
    this.emit({ t: 'cityRazed', city: this.cityView(city) });
    this.checkElimination(city.owner);
  }

  checkElimination(pid) {
    if (pid < 0) return;
    const p = this.players[pid];
    if (!p.alive) return;
    const hasCity = [...this.cities.values()].some(c => c.owner === pid);
    const hasSettler = [...this.units.values()].some(u => u.owner === pid && u.type === 'osadnik');
    if (!hasCity && !hasSettler) {
      p.alive = false;
      for (const u of [...this.units.values()]) if (u.owner === pid) this.killUnit(u, -2);
      this.emit({ t: 'playerEliminated', player: pid, faction: p.faction });
      this.emit({ t: 'notify', msg: `Plemię ${FACTIONS[p.faction].name} zostało starte z kart dziejów!`, kind: 'war' });
      if (p.isHuman) { this.humanDefeated = true; this.emit({ t: 'defeat' }); }
    }
  }

  // ---------- akcje jednostek ----------
  canFoundCity(u) {
    if (u.type !== 'osadnik' || u.moves <= 0) return false;
    const t = this.tile(u.col, u.row);
    if (t.type === 'woda' || t.type === 'gory' || this.cityAt(u.col, u.row)) return false;
    for (const ct of this.cities.values()) {
      if (hexDistance(u.col, u.row, ct.col, ct.row) < 3) return false;
    }
    return true;
  }

  foundCity(u) {
    if (!this.canFoundCity(u)) return null;
    const p = this.players[u.owner];
    const name = p.namePool.shift() || `Gród ${this.cities.size + 1}`;
    const city = {
      id: uid(), owner: u.owner, name, col: u.col, row: u.row,
      pop: p.faction === 'polanie' ? 2 : 1,
      food: 0, prodBox: 0, buildQueue: { kind: 'unit', id: 'wojownik' },
      buildings: new Set(), sporesTurns: 0, foundedTurn: this.turn,
    };
    this.cities.set(city.id, city);
    this.units.delete(u.id);
    this.emit({ t: 'unitDied', unit: this.unitView(u), silent: true });
    this.bumpPoparcie(p, +5);
    p.laska = clamp(p.laska + 3);
    this.revealAround(p, u.col, u.row, 3);
    this.emit({ t: 'cityFounded', city: this.cityView(city) });
    this.emit({ t: 'notify', msg: `Założono gród ${name}!`, kind: 'good', for: u.owner });
    return city;
  }

  canImprove(u) {
    return u.type === 'osadnik' && u.moves > 0 && this.players[u.owner].techs.has('osadnictwo') &&
      this.tile(u.col, u.row).type === 'rownina';
  }

  improveTile(u) {
    if (!this.canImprove(u)) return false;
    u.working += 1;
    u.moves = 0;
    if (u.working >= 2) {
      u.working = 0;
      this.tile(u.col, u.row).type = 'pole';
      this.emit({ t: 'tileChanged', col: u.col, row: u.row, type: 'pole' });
      this.emit({ t: 'notify', msg: 'Zaorano pole uprawne.', kind: 'good', for: u.owner });
    }
    return true;
  }

  canPillage(u) {
    if (!UNITS[u.type].military || u.moves <= 0) return false;
    const t = this.tile(u.col, u.row);
    if (t.type !== 'pole') return false;
    const own = this.tileOwner(u.col, u.row);
    return own && own.owner !== u.owner;
  }

  pillage(u) {
    if (!this.canPillage(u)) return false;
    const t = this.tile(u.col, u.row);
    t.type = 'rownina';
    const p = u.owner >= 0 ? this.players[u.owner] : null;
    let gold = 10;
    if (p && p.faction === 'wandalowie') gold = 20;
    if (p) {
      p.gold += gold;
      if (p.faction !== 'wandalowie') p.laska = clamp(p.laska - 3);
      p.stats.pillages++;
    }
    const victim = this.tileOwner(u.col, u.row);
    if (victim) this.bumpPoparcie(this.players[victim.owner], -3);
    u.moves = 0;
    this.emit({ t: 'tileChanged', col: u.col, row: u.row, type: 'rownina' });
    this.emit({ t: 'pillage', col: u.col, row: u.row, unit: this.unitView(u), gold });
    return true;
  }

  fortify(u) {
    if (!UNITS[u.type].military) return false;
    u.fortified = true; u.moves = 0;
    return true;
  }

  canGarrison(u) {
    if (!UNITS[u.type].military || u.garrison) return false;
    const ct = this.cityAt(u.col, u.row);
    return !!ct && ct.owner === u.owner;
  }

  setGarrison(u) {
    if (!this.canGarrison(u)) return false;
    u.garrison = true; u.fortified = true; u.moves = 0;
    const ct = this.cityAt(u.col, u.row);
    this.emit({ t: 'garrisonChanged', city: this.cityView(ct), unit: this.unitView(u), on: true });
    return true;
  }

  // Wyprowadzenie załogi z grodu — specjalna komenda z panelu grodu.
  unsetGarrison(u) {
    if (!u.garrison) return false;
    u.garrison = false; u.fortified = false;
    const ct = this.cityAt(u.col, u.row);
    if (ct) this.emit({ t: 'garrisonChanged', city: this.cityView(ct), unit: this.unitView(u), on: false });
    return true;
  }

  canSpore(u) { return u.type === 'grzybiarz' && u.cooldown <= 0 && u.moves > 0; }

  sporeBurst(u) {
    if (!this.canSpore(u)) return false;
    let hit = 0;
    for (const [c, r] of tilesInRange(u.col, u.row, 1, this.map.width, this.map.height)) {
      for (const e of this.unitsAt(c, r)) {
        if (this.areEnemies(u.owner, e.owner)) { e.disoriented = 2; hit++; }
      }
      const ct = this.cityAt(c, r);
      if (ct && ct.owner !== u.owner) { ct.sporesTurns = 2; hit++; }
    }
    u.cooldown = 3; u.moves = 0;
    this.emit({ t: 'spores', col: u.col, row: u.row, unit: this.unitView(u), hit });
    return true;
  }

  // ---------- grody i ekonomia ----------
  cityView(ct) {
    return { id: ct.id, owner: ct.owner, name: ct.name, col: ct.col, row: ct.row, pop: ct.pop };
  }

  workedTiles(ct) {
    // Gród pracuje na (pop) polach w promieniu 2 (najlepsze wg sumy plonów), plus centrum.
    const cand = [];
    for (const [c, r] of tilesInRange(ct.col, ct.row, 2, this.map.width, this.map.height)) {
      if (c === ct.col && r === ct.row) continue;
      const own = this.tileOwner(c, r);
      if (!own || own.id !== ct.id) continue;
      const t = this.tile(c, r);
      if (t.type === 'woda') continue;
      const y = TILES[t.type];
      const bigBuild = ct.buildQueue && (ct.buildQueue.id === 'przebudzenie' || ct.buildQueue.id === 'sanktuarium');
      cand.push({ c, r, t, score: y.food * 1.3 + y.prod * (bigBuild ? 2.5 : 1) + y.gold * 0.7 + y.sci });
    }
    cand.sort((a, b) => b.score - a.score);
    return cand.slice(0, ct.pop);
  }

  cityYields(ct) {
    const p = this.players[ct.owner];
    const fac = p.faction;
    let food = 2, prod = 1, gold = 1, sci = 1 + Math.floor(ct.pop / 2);
    for (const w of this.workedTiles(ct)) {
      const y = TILES[w.t.type];
      food += y.food; prod += y.prod; gold += y.gold; sci += y.sci;
      if (fac === 'wislanie' && (w.t.type === 'rzeka' || w.t.type === 'bursztyn')) gold += 1;
      if (p.techs.has('elektrycznosc') && w.t.type === 'bursztyn') gold += 2;
      if (p.techs.has('siec_grzybni') && w.t.type === 'grzybnia') sci += 2;
    }
    if (ct.buildings.has('spichlerz')) food += 2;
    if (ct.buildings.has('targ')) { gold = Math.floor(gold * 1.5); sci += 1; }
    if (ct.buildings.has('sanktuarium')) gold += 8;
    if (p.poparcie >= 70) { prod = Math.ceil(prod * 1.1); sci = Math.ceil(sci * 1.1); }
    if (p.poparcie <= 30) prod = Math.floor(prod * 0.75);
    food -= ct.pop * 2; // konsumpcja
    return { food, prod, gold, sci };
  }

  availableBuilds(ct) {
    const p = this.players[ct.owner];
    const out = [];
    for (const [id, u] of Object.entries(UNITS)) {
      if (u.neutral) continue;
      if (u.tech && !p.techs.has(u.tech)) continue;
      if (id === 'osadnik' && !p.techs.has('osadnictwo')) continue;
      let cost = u.cost;
      if (u.military && p.faction === 'goci') cost = Math.ceil(cost * 0.75);
      if (id === 'osadnik' && p.faction === 'polanie') cost = Math.ceil(cost * 0.75);
      out.push({ kind: 'unit', id, name: u.name, cost, desc: u.desc });
    }
    for (const [id, b] of Object.entries(BUILDINGS)) {
      if (ct.buildings.has(id)) continue;
      if (b.tech && !p.techs.has(id === 'przebudzenie' ? 'siec_grzybni' : b.tech)) continue;
      if (b.wonder && this.wonderBuiltBy !== null) continue;
      if (b.laska && p.laska < b.laska) continue;
      if (id === 'przebudzenie' && !this.cityHasTileType(ct, 'grzybnia')) continue;
      out.push({ kind: 'building', id, name: b.name, cost: b.cost, desc: b.desc, wonder: !!b.wonder, project: !!b.project });
    }
    return out;
  }

  cityHasTileType(ct, type) {
    for (const [c, r] of tilesInRange(ct.col, ct.row, 2, this.map.width, this.map.height)) {
      if (this.tile(c, r).type === type) {
        const own = this.tileOwner(c, r);
        if (own && own.id === ct.id) return true;
      }
    }
    return false;
  }

  buildCostOf(ct, item) {
    const p = this.players[ct.owner];
    if (item.kind === 'unit') {
      const u = UNITS[item.id];
      let cost = u.cost;
      if (u.military && p.faction === 'goci') cost = Math.ceil(cost * 0.75);
      if (item.id === 'osadnik' && p.faction === 'polanie') cost = Math.ceil(cost * 0.75);
      return cost;
    }
    return BUILDINGS[item.id].cost;
  }

  setBuild(ct, kind, id) {
    ct.buildQueue = { kind, id };
  }

  buyBuild(ct) {
    const p = this.players[ct.owner];
    if (!ct.buildQueue) return false;
    const cost = this.buildCostOf(ct, ct.buildQueue);
    if (BUILDINGS[ct.buildQueue.id]?.project) return false; // projektu nie można kupić
    const price = Math.max(0, (cost - ct.prodBox)) * 3;
    if (p.gold < price) return false;
    p.gold -= price;
    ct.prodBox = cost;
    return true;
  }

  processCity(ct) {
    const p = this.players[ct.owner];
    const y = this.cityYields(ct);
    p.gold += y.gold;
    p.sciBox += y.sci;
    ct.food += y.food;
    if (ct.sporesTurns > 0) ct.sporesTurns--;

    // Wzrost / głód
    const need = ct.pop * 8 + 12;
    if (ct.food >= need) {
      ct.food -= need; ct.pop += 1;
      this.bumpPoparcie(p, +2);
      this.emit({ t: 'cityGrew', city: this.cityView(ct) });
      if (p.isHuman) this.emit({ t: 'notify', msg: `Gród ${ct.name} rośnie (${ct.pop} mieszk.)`, kind: 'good', for: p.id });
    } else if (ct.food < 0) {
      ct.food = 0;
      if (ct.pop > 1) {
        ct.pop -= 1;
        this.bumpPoparcie(p, -3);
        if (p.isHuman) this.emit({ t: 'notify', msg: `Głód w grodzie ${ct.name}!`, kind: 'bad', for: p.id });
      }
    }

    // Produkcja
    if (ct.buildQueue) {
      ct.prodBox += y.prod;
      const cost = this.buildCostOf(ct, ct.buildQueue);
      if (ct.prodBox >= cost) {
        ct.prodBox -= cost;
        this.completeBuild(ct, ct.buildQueue);
      }
    }
    // Kapliczka → Łaska
    if (ct.buildings.has('kapliczka')) p.laska = clamp(p.laska + 1);
    if (ct.buildings.has('sanktuarium')) {
      this.bumpPoparcie(p, +3);
      p.sciBox += Math.floor(p.poparcie / 10);
    }
  }

  completeBuild(ct, item) {
    const p = this.players[ct.owner];
    if (item.kind === 'unit') {
      const spot = this.unitsAt(ct.col, ct.row).length < 3 ? [ct.col, ct.row] : (this.freeNeighbor(ct.col, ct.row) || [ct.col, ct.row]);
      this.spawnUnit(ct.owner, item.id, spot[0], spot[1]);
      this.emit({ t: 'cityBuilt', city: this.cityView(ct), what: UNITS[item.id].name, kind: 'unit', id: item.id });
      if (p.isHuman) this.emit({ t: 'notify', msg: `${ct.name}: ${UNITS[item.id].name} gotów.`, kind: 'info', for: p.id });
      // buduj dalej to samo, jeśli można
    } else {
      ct.buildings.add(item.id);
      ct.buildQueue = null;
      const b = BUILDINGS[item.id];
      this.emit({ t: 'cityBuilt', city: this.cityView(ct), what: b.name, kind: 'building', id: item.id, wonder: !!b.wonder });
      if (item.id === 'kapliczka') this.bumpPoparcie(p, +5);
      if (item.id === 'sanktuarium') {
        this.wonderBuiltBy = ct.owner;
        this.bumpPoparcie(p, +15);
        this.emit({ t: 'wonderBuilt', city: this.cityView(ct), player: ct.owner });
        this.emit({ t: 'notify', msg: `${FACTIONS[p.faction].name} wznieśli Sanktuarium Ojca Rydzyka w grodzie ${ct.name}! Datki płyną.`, kind: 'wonder' });
      }
      if (item.id === 'przebudzenie') {
        this.declareVictory(ct.owner, ct);
      }
      if (p.isHuman && !b.wonder && item.id !== 'przebudzenie') {
        this.emit({ t: 'notify', msg: `${ct.name}: ukończono ${b.name}.`, kind: 'info', for: p.id });
      }
    }
  }

  declareVictory(pid, city) {
    if (this.winner !== null) return;
    this.winner = pid;
    const p = this.players[pid];
    this.emit({ t: 'victory', player: pid, faction: p.faction, isHuman: p.isHuman, city: city ? this.cityView(city) : null });
  }

  bumpPoparcie(p, d) { p.poparcie = clamp(p.poparcie + d); }

  // ---------- technologie ----------
  availableTechs(p) {
    const out = [];
    for (const id of TECH_ORDER) {
      const t = TECHS[id];
      if (t.project) continue;
      if (p.techs.has(id)) continue;
      if (!t.req.every(r => p.techs.has(r))) continue;
      out.push({ id, ...t, blocked: t.needsTile && !this.playerHasTileType(p, t.needsTile) });
    }
    return out;
  }

  setResearch(p, techId) {
    const av = this.availableTechs(p).find(t => t.id === techId);
    if (!av || av.blocked) return false;
    p.researching = techId;
    return true;
  }

  processResearch(p) {
    if (!p.researching) return;
    const t = TECHS[p.researching];
    if (p.sciBox >= t.cost) {
      p.sciBox -= t.cost;
      p.techs.add(p.researching);
      const done = p.researching;
      p.researching = null;
      this.emit({ t: 'techDone', player: p.id, tech: done, name: TECHS[done].name });
      if (p.isHuman) this.emit({ t: 'notify', msg: `Odkryto: ${TECHS[done].name}!`, kind: 'tech', for: p.id });
    }
  }

  // ---------- barbarzyńcy ----------
  maxCamps() { return Math.min(5, 1 + Math.floor(this.turn / 15)); }

  barbarianPhase() {
    // Nowe obozy z dala od grodów
    if (this.camps.length < this.maxCamps() && this.turn > 8 && this.rng.chance(0.25)) {
      const spots = this.map.tiles.filter(t =>
        t.type !== 'woda' && t.type !== 'gory' &&
        !this.cityAt(t.col, t.row) && !this.unitsAt(t.col, t.row).length &&
        ![...this.cities.values()].some(c => hexDistance(t.col, t.row, c.col, c.row) < 5));
      if (spots.length) {
        const t = spots[this.rng.int(spots.length)];
        this.camps.push({ col: t.col, row: t.row, timer: 3 });
        this.emit({ t: 'campSpawned', col: t.col, row: t.row });
      }
    }
    // Obozy wypuszczają wojowników
    for (const camp of this.camps) {
      camp.timer -= 1;
      const near = [...this.units.values()].filter(u => u.owner === -1 &&
        hexDistance(u.col, u.row, camp.col, camp.row) <= 5).length;
      if (camp.timer <= 0 && near < 2) {
        camp.timer = 5 + this.rng.int(3);
        const type = this.turn > 40 && this.rng.chance(0.4) ? 'barbarzynca_elit' : 'barbarzynca';
        const spot = this.freeNeighbor(camp.col, camp.row);
        if (spot) {
          this.spawnUnit(-1, type, spot[0], spot[1]);
          // ostrzeż graczy, którzy to widzą
          for (const p of this.players) {
            if (p.isHuman && this.visibleSet(p).has(keyOf(spot[0], spot[1]))) {
              this.emit({ t: 'notify', msg: 'Barbarzyńcy ruszają z pustkowi!', kind: 'bad', for: p.id });
              this.emit({ t: 'barbAlert' });
            }
          }
        }
      }
    }
    // Ruch barbarzyńców: do najbliższego celu (gród/jednostka) w promieniu 8
    for (const u of [...this.units.values()]) {
      if (u.owner !== -1 || u.hp <= 0) continue;
      u.moves = this.maxMoves(-1, u.type);
      let target = null, bestD = 9;
      for (const ct of this.cities.values()) {
        const d = hexDistance(u.col, u.row, ct.col, ct.row);
        if (d < bestD) { bestD = d; target = [ct.col, ct.row]; }
      }
      for (const e of this.units.values()) {
        if (e.owner < 0 || e.hp <= 0) continue;
        const d = hexDistance(u.col, u.row, e.col, e.row);
        if (d < bestD) { bestD = d; target = [e.col, e.row]; }
      }
      if (this.canPillage(u) && this.rng.chance(0.5)) { this.pillage(u); continue; }
      if (!target) {
        // wędrówka
        const opts = neighbors(u.col, u.row).filter(([c, r]) =>
          this.inBounds(c, r) && this.tile(c, r).type !== 'woda' && !this.unitsAt(c, r).length);
        if (opts.length) {
          const [c, r] = opts[this.rng.int(opts.length)];
          this.moveUnit(u, c, r);
        }
        continue;
      }
      this.stepToward(u, target[0], target[1]);
    }
  }

  stepToward(u, tc, tr) {
    const { dist } = this.reachableTiles(u);
    // najpierw: czy cel osiągalny w tej turze?
    if (dist.has(keyOf(tc, tr))) { this.moveUnit(u, tc, tr); return; }
    // inaczej: najbliższe osiągalne pole do celu
    let best = null, bestD = 1e9;
    for (const k of dist.keys()) {
      const c = k % 4096, r = Math.floor(k / 4096);
      if (this.unitsAt(c, r).some(x => x.owner !== u.owner)) continue;
      const cityT = this.cityAt(c, r);
      if (cityT && cityT.owner !== u.owner) continue;
      const d = hexDistance(c, r, tc, tr) * 10 + dist.get(k);
      if (d < bestD) { bestD = d; best = [c, r]; }
    }
    if (best && (best[0] !== u.col || best[1] !== u.row)) this.moveUnit(u, best[0], best[1]);
  }

  destroyCamp(camp, byUnit) {
    this.camps = this.camps.filter(c => c !== camp);
    if (byUnit.owner >= 0) {
      const p = this.players[byUnit.owner];
      p.gold += 25;
      this.bumpPoparcie(p, +3);
      this.emit({ t: 'campDestroyed', col: camp.col, row: camp.row, player: byUnit.owner });
      if (p.isHuman) this.emit({ t: 'notify', msg: 'Zniszczono obóz barbarzyńców! (+25 złota)', kind: 'good', for: p.id });
    }
  }

  // ---------- tury ----------
  beginTurn(p) {
    for (const u of this.units.values()) {
      if (u.owner !== p.id) continue;
      u.moves = this.maxMoves(p.id, u.type);
      if (u.disoriented > 0) { u.moves = Math.max(1, u.moves - 1); u.disoriented--; }
      if (u.cooldown > 0) u.cooldown--;
    }
    // utrzymanie
    let upkeep = 0;
    for (const u of this.units.values()) if (u.owner === p.id) upkeep += UNITS[u.type].upkeep;
    p.gold -= upkeep;
    if (p.faction === 'wislanie') p.gold += Math.ceil(upkeep * 0.25); // taniej dzięki handlowi
    while (p.gold < 0) {
      const mine = [...this.units.values()].filter(u => u.owner === p.id && UNITS[u.type].upkeep > 0);
      if (!mine.length) { p.gold = 0; break; }
      const u = mine[mine.length - 1];
      this.killUnit(u, -2);
      p.gold += 5;
      if (p.isHuman) this.emit({ t: 'notify', msg: `Skarbiec pusty — rozwiązano oddział: ${UNITS[u.type].name}.`, kind: 'bad', for: p.id });
    }
    // grody
    for (const ct of this.cities.values()) if (ct.owner === p.id) this.processCity(ct);
    this.processResearch(p);
    // dryf poparcia ku 50
    if (p.poparcie > 50) p.poparcie -= 0.5; else if (p.poparcie < 50) p.poparcie += 0.5;
    // auto-badanie dla AI oraz brak wyboru
    if (!p.researching) {
      const av = this.availableTechs(p).filter(t => !t.blocked);
      if (av.length && !p.isHuman) p.researching = av[0].id;
    }
  }

  // Kończy turę bieżącego gracza; przetwarza AI i barbarzyńców,
  // wraca gdy znów kolej człowieka (albo koniec gry).
  endTurn() {
    let guard = 0;
    do {
      this.currentIdx = (this.currentIdx + 1) % this.players.length;
      if (this.currentIdx === 0) {
        this.barbarianPhase();
        this.turn += 1;
      }
      const p = this.players[this.currentIdx];
      if (!p.alive) continue;
      this.beginTurn(p);
      if (!p.isHuman) {
        runAiTurn(this, p);
      }
    } while (!this.players[this.currentIdx].isHuman && guard++ < 10);
    return this.players[this.currentIdx];
  }

  // ---------- zapis / odczyt ----------
  serialize() {
    return {
      v: 1,
      mapSize: this.mapSize, turn: this.turn, currentIdx: this.currentIdx,
      winner: this.winner, sandbox: this.sandbox, wonderBuiltBy: this.wonderBuiltBy,
      humanDefeated: this.humanDefeated, uid: getUid(),
      map: {
        width: this.map.width, height: this.map.height,
        seed: this.map.seed, starts: this.map.starts,
        tiles: this.map.tiles.map(t => t.type),
      },
      players: this.players.map(p => ({
        ...p, techs: [...p.techs], explored: [...p.explored],
      })),
      units: [...this.units.values()],
      cities: [...this.cities.values()].map(c => ({ ...c, buildings: [...c.buildings] })),
      camps: this.camps,
    };
  }

  static fromSave(d) {
    const g = Object.create(Game.prototype);
    g.rng = makeRng((Date.now() % 2147483647) ^ 0x51ed270b);
    g.mapSize = d.mapSize; g.turn = d.turn; g.currentIdx = d.currentIdx ?? 0;
    g.winner = d.winner; g.sandbox = d.sandbox; g.wonderBuiltBy = d.wonderBuiltBy;
    g.humanDefeated = d.humanDefeated;
    g.events = [];
    g.map = {
      width: d.map.width, height: d.map.height, seed: d.map.seed, starts: d.map.starts,
      tiles: d.map.tiles.map((type, i) => ({
        col: i % d.map.width, row: Math.floor(i / d.map.width), type,
      })),
    };
    g.players = d.players.map(p => ({ ...p, techs: new Set(p.techs), explored: new Set(p.explored) }));
    g.units = new Map(d.units.map(u => [u.id, { garrison: false, ...u }]));
    g.cities = new Map(d.cities.map(c => [c.id, { ...c, buildings: new Set(c.buildings) }]));
    g.camps = d.camps || [];
    setUid(d.uid || 1);
    return g;
  }

  // Rok do wyświetlania (klimat wędrówki ludów)
  yearOf() {
    const y = 375 + (this.turn - 1) * 8;
    return `${y} n.e.`;
  }
}

function clamp(v) { return Math.max(0, Math.min(100, v)); }
