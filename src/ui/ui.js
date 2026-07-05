// Interfejs (całość po polsku): menu, HUD, panele, przewodnik, ekran końca gry.
import { FACTIONS, MAP_SIZES, TECHS, TECH_ORDER, TILES, UNITS, BUILDINGS, PASSPHRASE } from '../sim/data.js';

const $ = (id) => document.getElementById(id);
const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
};
const colHex = (c) => '#' + c.toString(16).padStart(6, '0');

export class UI {
  constructor() {
    this.onStart = null;
    this.onEndTurn = null;
    this.onSetResearch = null;
    this.onSetBuild = null;
    this.onBuyBuild = null;
    this.onUnitAction = null;
    this.onCityClick = null;
    this.onKeepPlaying = null;
    this.onToMenu = null;
    this.onSoundToggle = null;
    this.selFaction = 'polanie';
    this.selSize = 'srednia';
    this._buildMenu();
    this._bindGlobal();
  }

  _buildMenu() {
    const cards = $('faction-cards');
    cards.innerHTML = '';
    for (const [fid, f] of Object.entries(FACTIONS)) {
      const c = el('div', 'faction-card' + (fid === this.selFaction ? ' sel' : ''));
      c.style.setProperty('--fc', colHex(f.color));
      c.innerHTML = `<div class="fc-banner">${f.banner}</div>
        <div class="fc-name">${f.name}</div>
        <div class="fc-group">${f.group}</div>
        <div class="fc-desc">${f.desc}</div>
        <div class="fc-bonus">★ ${f.bonus}</div>`;
      c.addEventListener('click', () => {
        this.selFaction = fid;
        cards.querySelectorAll('.faction-card').forEach(x => x.classList.remove('sel'));
        c.classList.add('sel');
      });
      cards.appendChild(c);
    }
    const sizes = $('map-sizes');
    sizes.innerHTML = '';
    for (const [sid, s] of Object.entries(MAP_SIZES)) {
      const b = el('div', 'map-size' + (sid === this.selSize ? ' sel' : ''),
        `${s.name}<small>${s.w}×${s.h} (~${s.w * s.h} pól)</small>`);
      b.addEventListener('click', () => {
        this.selSize = sid;
        sizes.querySelectorAll('.map-size').forEach(x => x.classList.remove('sel'));
        b.classList.add('sel');
      });
      sizes.appendChild(b);
    }
    $('btn-start').addEventListener('click', () => this.onStart && this.onStart(this.selFaction, this.selSize));
    $('btn-guide-menu').addEventListener('click', () => this.showGuide());
  }

  _bindGlobal() {
    document.querySelectorAll('.close-x').forEach(b =>
      b.addEventListener('click', () => $(b.dataset.close).classList.add('hidden')));
    $('btn-end-turn').addEventListener('click', () => this.onEndTurn && this.onEndTurn());
    $('btn-tech').addEventListener('click', () => this.toggleTech());
    $('btn-guide').addEventListener('click', () => this.showGuide());
    $('btn-sound').addEventListener('click', () => {
      const muted = this.onSoundToggle && this.onSoundToggle();
      $('btn-sound').textContent = muted ? '🔇' : '🔊';
    });
    $('btn-menu-back').addEventListener('click', () => {
      if (confirm('Wrócić do menu głównego? Bieżąca rozgrywka przepadnie.')) {
        this.onToMenu && this.onToMenu();
      }
    });
    $('btn-keep-playing').addEventListener('click', () => {
      $('endgame').classList.add('hidden');
      this.onKeepPlaying && this.onKeepPlaying();
    });
    $('btn-to-menu').addEventListener('click', () => this.onToMenu && this.onToMenu());
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !$('hud').classList.contains('hidden') &&
          $('city-panel').classList.contains('hidden') && $('tech-panel').classList.contains('hidden')) {
        this.onEndTurn && this.onEndTurn();
      }
      if (e.key === 'Escape') {
        ['city-panel', 'tech-panel', 'guide-panel'].forEach(id => $(id).classList.add('hidden'));
      }
    });
  }

  showMenu() {
    $('menu').classList.remove('hidden');
    $('hud').classList.add('hidden');
    $('endgame').classList.add('hidden');
    ['city-panel', 'tech-panel', 'guide-panel'].forEach(id => $(id).classList.add('hidden'));
  }

  showLoading(txt) {
    $('menu').classList.add('hidden');
    $('loading').classList.remove('hidden');
    $('loading-text').textContent = txt;
  }
  setLoading(txt) { $('loading-text').textContent = txt; }
  hideLoading() {
    $('loading').classList.add('hidden');
    $('hud').classList.remove('hidden');
  }

  // ---------- HUD ----------
  updateHud(game) {
    const p = game.players[0];
    const f = FACTIONS[p.faction];
    $('res-faction').innerHTML = `<b style="color:${colHex(f.color)}">${f.banner} ${f.name}</b>`;
    $('res-gold').textContent = Math.floor(p.gold);
    let sci = 0;
    for (const ct of game.cities.values()) if (ct.owner === 0) sci += game.cityYields(ct).sci;
    $('res-sci').textContent = '+' + sci;
    $('res-pop').textContent = Math.round(p.poparcie);
    $('res-laska').textContent = Math.round(p.laska);
    $('res-turn').textContent = `Tura ${game.turn} • ${game.yearOf()}`;
    if (p.researching) {
      const t = TECHS[p.researching];
      $('tech-label').textContent = t.name;
      $('tech-progress').textContent = `${Math.floor(p.sciBox)}/${t.cost}`;
    } else {
      $('tech-label').textContent = 'Wybierz badanie';
      $('tech-progress').textContent = '';
      const has = game.availableTechs(p).some(t => !t.blocked);
      $('btn-tech').style.borderColor = has ? '#58a6d8' : '#4a442f';
    }
  }

  setEndTurnState(state) {
    // state: 'ready' | 'busy' | 'attention'
    const btn = $('btn-end-turn');
    const ai = $('ai-thinking');
    if (state === 'busy') { btn.classList.add('hidden'); ai.classList.remove('hidden'); }
    else {
      btn.classList.remove('hidden'); ai.classList.add('hidden');
      btn.classList.toggle('attention', state === 'attention');
    }
  }

  notify(msg, kind = 'info') {
    const area = $('notify-area');
    const t = el('div', `toast ${kind}`, msg);
    area.appendChild(t);
    while (area.children.length > 5) area.firstChild.remove();
    setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .5s'; }, 4200);
    setTimeout(() => t.remove(), 4800);
  }

  // ---------- panel jednostki ----------
  showUnit(game, unit) {
    const panel = $('unit-panel');
    if (!unit) { panel.classList.add('hidden'); return; }
    panel.classList.remove('hidden');
    const d = UNITS[unit.type];
    $('unit-title').textContent = d.name;
    const rows = [
      `⚔ Atak: <b>${game.attackOf(unit)}</b> &nbsp; 🛡 Obrona: <b>${d.def}</b>`,
      `👣 Ruch: <b>${unit.moves}</b> &nbsp; ❤️ Zdrowie: <b>${unit.hp}/100</b>`,
    ];
    if (unit.disoriented > 0) rows.push(`<span style="color:#b06fd8">😵 Zdezorientowany (${unit.disoriented} t.)</span>`);
    if (unit.type === 'grzybiarz' && unit.cooldown > 0) rows.push(`🍄 Zarodniki gotowe za ${unit.cooldown} t.`);
    if (unit.working > 0) rows.push(`🌾 Orka w toku…`);
    $('unit-stats').innerHTML = rows.join('<br>');
    const acts = $('unit-actions');
    acts.innerHTML = '';
    const btn = (label, action, enabled = true, primary = false, title = '') => {
      const b = el('button', primary ? 'primary' : '', label);
      b.disabled = !enabled;
      if (title) b.title = title;
      b.addEventListener('click', () => this.onUnitAction && this.onUnitAction(action, unit));
      acts.appendChild(b);
    };
    if (unit.type === 'osadnik') {
      btn('🏰 Załóż gród', 'found', game.canFoundCity(unit), true,
        'Buduje nowy gród na tym polu (min. 3 pola od innego grodu)');
      btn('🌾 Zaorz pole', 'improve', game.canImprove(unit), false,
        'Zamienia równinę w pole uprawne (2 tury)');
    }
    if (UNITS[unit.type].military) {
      btn('⛨ Umocnij', 'fortify', unit.moves > 0, false, '+25% obrony do następnego rozkazu');
      btn('🔥 Grabież', 'pillage', game.canPillage(unit), false,
        'Niszczy cudze pole uprawne, daje złoto');
    }
    if (unit.type === 'grzybiarz') {
      btn('🍄 Zarodniki', 'spores', game.canSpore(unit), true,
        'Dezorientuje wrogów wokół i osłabia obronę grodów (2 tury)');
    }
    btn('⏭ Pomiń', 'skip', true, false, 'Jednostka czeka do następnej tury');
  }

  // ---------- panel grodu ----------
  showCity(game, city) {
    const p = game.players[0];
    $('city-panel').classList.remove('hidden');
    $('city-name').textContent = `${city.name} (${city.pop} mieszk.)`;
    const y = game.cityYields(city);
    const need = city.pop * 8 + 12;
    $('city-stats').innerHTML =
      `🍞 Żywność: <b>${y.food >= 0 ? '+' : ''}${y.food}</b> (wzrost: ${Math.floor(city.food)}/${need})<br>` +
      `⚒ Produkcja: <b>${y.prod}</b> &nbsp; 🪙 Złoto: <b>${y.gold}</b> &nbsp; 🔬 Nauka: <b>${y.sci}</b>`;
    const cur = $('city-current');
    if (city.buildQueue) {
      const item = city.buildQueue;
      const name = item.kind === 'unit' ? UNITS[item.id].name : BUILDINGS[item.id].name;
      const cost = game.buildCostOf(city, item);
      const turns = y.prod > 0 ? Math.ceil((cost - city.prodBox) / y.prod) : '∞';
      cur.innerHTML = `W budowie: <b>${name}</b> — ${Math.floor(city.prodBox)}/${cost} ⚒ (${turns} tur)`;
    } else cur.innerHTML = 'Nic nie jest budowane.';

    const list = $('city-builds');
    list.innerHTML = '';
    for (const b of game.availableBuilds(city)) {
      const item = el('div', 'build-item' + (b.wonder ? ' wonder' : '') + (b.project ? ' project' : '') +
        (city.buildQueue && city.buildQueue.id === b.id ? ' sel' : ''));
      item.innerHTML = `<div><span class="bi-name">${b.wonder ? '✨ ' : b.project ? '🍄 ' : ''}${b.name}</span>
        <div class="bi-desc">${b.desc}</div></div>
        <span class="bi-cost">${b.cost} ⚒</span>`;
      item.addEventListener('click', () => {
        this.onSetBuild && this.onSetBuild(city, b.kind, b.id);
        this.showCity(game, city);
      });
      list.appendChild(item);
    }
    // przyspieszenie złotem
    const old = document.querySelector('#city-panel .buy-btn');
    if (old) old.remove();
    if (city.buildQueue && !BUILDINGS[city.buildQueue.id]?.project) {
      const cost = game.buildCostOf(city, city.buildQueue);
      const price = Math.max(0, cost - Math.floor(city.prodBox)) * 3;
      const b = el('button', 'buy-btn', `🪙 Przyśpiesz budowę (${price} złota)`);
      b.disabled = p.gold < price || price === 0;
      b.addEventListener('click', () => {
        this.onBuyBuild && this.onBuyBuild(city);
        this.showCity(game, city);
      });
      list.after(b);
    }
    const bl = [...city.buildings].map(id => BUILDINGS[id].name).join(', ');
    $('city-buildings').innerHTML = bl ? `Budowle: ${bl}` : 'Brak budowli.';
  }

  hideCity() { $('city-panel').classList.add('hidden'); }

  // ---------- drzewko ----------
  toggleTech(game) {
    const panel = $('tech-panel');
    if (!panel.classList.contains('hidden')) { panel.classList.add('hidden'); return; }
    panel.classList.remove('hidden');
    this.renderTech(this._game);
  }

  renderTech(game) {
    if (!game) return;
    const p = game.players[0];
    const tree = $('tech-tree');
    tree.innerHTML = '';
    const avail = game.availableTechs(p);
    TECH_ORDER.forEach((id, i) => {
      const t = TECHS[id];
      const done = p.techs.has(id);
      const av = avail.find(a => a.id === id);
      const current = p.researching === id;
      const node = el('div', 'tech-node' +
        (done ? ' done' : current ? ' current' : av ? (av.blocked ? ' blocked' : '') : ' locked'));
      const icons = ['🏠', '⚒', '🐝', '🌾', '🛞', '🧮', '⚡', '🍄', '🌌'];
      let extra = '';
      if (done) extra = '<div class="tn-unlocks">✔ Odkryte</div>';
      else if (current) extra = `<div class="tn-unlocks">Badanie: ${Math.floor(p.sciBox)}/${t.cost} 🔬</div>`;
      else if (av?.blocked) extra = `<div class="tn-blocked">⛔ Wymaga pola „${TILES[t.needsTile].name}” w granicach twoich grodów</div>`;
      node.innerHTML = `<div class="tn-idx">${icons[i]}</div>
        <div><span class="tn-name">${t.name}</span>${t.cost ? `<span class="tn-cost">${t.cost} 🔬</span>` : ''}
        <div class="tn-desc">${t.desc}</div>
        <div class="tn-unlocks">Odblokowuje: ${t.unlocks}</div>${extra}</div>`;
      if (av && !av.blocked && !done && !t.project) {
        node.addEventListener('click', () => {
          this.onSetResearch && this.onSetResearch(id);
          this.renderTech(game);
        });
      }
      tree.appendChild(node);
    });
  }

  // ---------- przewodnik ----------
  showGuide() {
    $('guide-panel').classList.remove('hidden');
    $('guide-content').innerHTML = GUIDE_HTML;
  }

  // ---------- koniec gry ----------
  showEndgame({ victory, faction, isHuman, sandboxAvailable = true }) {
    const f = FACTIONS[faction];
    $('endgame').classList.remove('hidden');
    $('endgame-art').textContent = victory && isHuman ? '🍄' : isHuman === false ? '🍄' : '💀';
    if (victory && isHuman) {
      $('endgame-title').textContent = 'PRZEBUDZENIE';
      $('endgame-sub').innerHTML =
        `Grzybnia otwiera miliard oczu pod ściółką. Sieć, którą hodowałeś jako broń, właśnie stała się umysłem.<br>` +
        `<b>${f.banner} ${f.name}</b> wygrywają wyścig o przyszłość!`;
      $('endgame-secret').classList.remove('hidden');
    } else if (victory && !isHuman) {
      $('endgame-title').textContent = 'PRZEGRANA';
      $('endgame-sub').innerHTML =
        `Ziemia drży, a przez las płynie obcy szept: to <b style="color:${colHex(f.color)}">${f.banner} ${f.name}</b> obudzili Grzybnię przed tobą.<br>` +
        `Nowy umysł świata nie mówi twoim językiem.`;
      $('endgame-secret').classList.add('hidden');
    } else {
      $('endgame-title').textContent = 'KLĘSKA';
      $('endgame-sub').innerHTML = 'Twoje plemię zostało starte z kart dziejów. Puszcza pochłonęła grody, a wiatr rozniósł popiół.';
      $('endgame-secret').classList.add('hidden');
    }
    $('btn-keep-playing').style.display = sandboxAvailable ? '' : 'none';
  }

  attachGame(game) { this._game = game; }
}

const GUIDE_HTML = `
<h3>Cel gry</h3>
<p>Poprowadź swoje plemię od pierwszego grodu aż po <b>Przebudzenie Grzybni</b> — projekt nadinteligencji
uśpionej w prastarej sieci grzybni. <b>Kto pierwszy go ukończy, natychmiast wygrywa.</b>
Przegrywasz, gdy stracisz wszystkie grody i osadników.</p>

<h3>Sterowanie (gładzik)</h3>
<ul>
<li>Przewijanie dwoma palcami — <b>przesuwanie mapy</b>; uszczypnięcie (pinch) — <b>przybliżanie</b>.</li>
<li>Klik — zaznaczenie jednostki / grodu / pola. Klik na podświetlone pole — <b>rozkaz ruchu</b>.</li>
<li>Przeciąganie z <span class="k">Shift</span> (lub środkowym przyciskiem) — przesuwanie mapy; strzałki też działają.</li>
<li><span class="k">⏎ Enter</span> — zakończenie tury. <span class="k">Esc</span> — zamknięcie okien.</li>
</ul>

<h3>Pierwsze kroki</h3>
<ul>
<li>Zaznacz <b>Osadnika</b> i wybierz „🏰 Załóż gród” na dobrym polu (równina przy rzece to skarb).</li>
<li><b>Wojownikiem</b> zwiedzaj mapę — mgła kryje bursztyn, grzybnię i wrogów.</li>
<li>W grodzie (kliknij jego etykietę) wybierz, co budować; w pasku górnym wybierz <b>badanie</b> 🧪.</li>
<li>Wciskaj „Zakończ turę” — przeciwnicy i barbarzyńcy wykonają swoje ruchy.</li>
</ul>

<h3>Zasoby</h3>
<ul>
<li>🍞 <b>Żywność</b> — wzrost grodów (każdy mieszkaniec pracuje na jednym polu wokół grodu).</li>
<li>⚒ <b>Produkcja</b> — budowa jednostek, budowli, cudu i projektu końcowego.</li>
<li>🔬 <b>Nauka</b> — postęp badań. 🪙 <b>Złoto</b> — utrzymanie wojska i przyspieszanie budowy.</li>
<li>❤️ <b>Poparcie ludu</b> — rośnie od zwycięstw i rozwoju; ≥70 daje premię, ≤30 osłabia produkcję.</li>
<li>🕯️ <b>Łaska</b> — przychylność możnych; otwiera Kapliczki, Sanktuarium (60) i Przebudzenie (40).</li>
</ul>

<h3>Pola</h3>
<p>Równina 🌱 (żywność), Las 🌲 (produkcja, +obrona), Bagno (słabe), Rzeka 💧 (złoto i nauka),
Góry ⛰ (produkcja, trudny teren), Pole uprawne 🌾 (dużo żywności).<br>
<b>Złoża bursztynu</b> 🟠 — potrzebne do Elektryczności bursztynowej.
<b>Prastara grzybnia</b> 🍄 — potrzebna do sieci grzybni i zwycięstwa. Zabezpiecz je grodami!</p>

<h3>Wojsko (pełna lista)</h3>
<ul>
<li><b>Wojownik</b> — tania piechota. <b>Kosynier</b> — mocny atak. <b>Bartnik bojowy</b> — ule pszczół omijają umocnienia.</li>
<li><b>Tabor</b> — ruchoma twierdza (świetny w obronie). <b>Grzybiarz bojowy</b> — nie walczy wprost: zarodniki
dezorientują wrogów (-50% ataku) i osłabiają obronę grodów.</li>
<li><b>Barbarzyńcy</b> 💀 — neutralni łupieżcy z pustkowi. Niszcz ich obozy (+25 złota).</li>
</ul>

<h3>Cud: Sanktuarium Ojca Rydzyka</h3>
<p>Jedyny w swoim rodzaju: +8 złota co turę z datków, +3 poparcia co turę, a nadmiar poparcia
zamienia się w naukę. Wymaga 60 Łaski. Kto pierwszy, ten lepszy.</p>

<h3>Droga do zwycięstwa</h3>
<p>Osadnictwo → Obróbka żelaza → (Bartnictwo / Kosynierzy) → Tabor → Mechanika liczydła →
Elektryczność bursztynowa (wymaga bursztynu) → Sieć grzybni obliczeniowej (wymaga grzybni) →
<b>PRZEBUDZENIE GRZYBNI</b> — zbuduj projekt w grodzie z grzybnią w granicach. Powodzenia!</p>
`;
