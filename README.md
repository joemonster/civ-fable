# Plemiona: Przebudzenie Grzybni

Turowa strategia 4X w przeglądarce — uproszczony klon Civilization 1 na siatce heksagonalnej,
w całości **po polsku**. Cztery plemiona (Polanie, Wiślanie, Goci, Wandalowie) ścigają się od
epoki żelaza, przez ule bojowe, kosynierów i tabory, po **Przebudzenie Grzybni** — nadinteligencję,
która budzi się w sieci prastarej grzybni. Kto pierwszy ukończy projekt — wygrywa.

![Trzy rozmiary mapy, mgła wojny, barbarzyńcy, cud „Sanktuarium Ojca Rydzyka”, tryb „Graj dalej” po zwycięstwie.]

## Uruchomienie

Gra to czyste moduły ES + Three.js — bez bundlera. Wystarczy dowolny statyczny serwer HTTP:

```bash
cd civ-fable
python3 -m http.server 8000
# albo: npx serve .
```

…i otwórz **http://localhost:8000** w przeglądarce (Chrome/Firefox/Safari).
Sterowanie zaprojektowano pod gładzik: przewijanie dwoma palcami przesuwa mapę,
pinch przybliża. Pełna instrukcja w grze: przycisk **„📜 Jak grać”**.

## Architektura

- `src/sim/` — czysta symulacja bez żadnych zależności od renderowania:
  - `hex.js` siatka heksagonalna (odd-r offset), `mapgen.js` generator kontynentu,
  - `data.js` definicje pól/jednostek/budowli/technologii/plemion (wszystkie teksty PL),
  - `game.js` silnik tur: ekonomia, walka, mgła wojny, barbarzyńcy, mierniki
    (Poparcie ludu, Łaska), zwycięstwo,
  - `ai.js` uczciwa SI trzech przeciwników (bez oszukiwania — widzi tylko to, co odkryła).
- `src/render/` — Three.js: instancjonowana plansza, sklonowane modele ze szkieletami
  (animacje: postój/marsz/atak/śmierć), efekty cząsteczkowe, kamera pod gładzik.
- `src/ui/` — HUD, menu, panele (gród, drzewko technologii, przewodnik), ekrany końca gry.
- `src/audio.js` — WebAudio: efekty + muzyka w tle.
- `assets/` — wyłącznie prawdziwe, pobrane zasoby (CC0/CC-BY, nic generowanego przez AI);
  szczegóły i autorzy w [assets/CREDITS.md](assets/CREDITS.md).

Symulację można uruchomić bezgłowo w Node (testy równowagi):
moduły `src/sim/**` nie importują niczego z warstwy renderowania.

## Testy

```bash
node --input-type=module -e "
import { Game } from './src/sim/game.js';
import { runAiTurn } from './src/sim/ai.js';
const g = new Game({ mapSize: 'srednia', humanFaction: 'polanie', seed: 42 });
while (g.winner === null && g.turn < 250) { runAiTurn(g, g.players[0]); g.events.length = 0; g.endTurn(); }
console.log('tura', g.turn, 'zwycięzca', g.winner === null ? '—' : g.players[g.winner].faction);
"
```
