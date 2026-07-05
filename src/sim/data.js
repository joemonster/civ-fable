// Dane statyczne gry — wszystkie teksty widoczne dla gracza są PO POLSKU.

export const TILES = {
  woda:     { name: 'Woda',            food: 0, prod: 0, gold: 1, sci: 0, move: 0,  defense: 0,    color: 0x2a5d8f },
  rownina:  { name: 'Równina',         food: 2, prod: 1, gold: 0, sci: 0, move: 1,  defense: 0,    color: 0x7da03c },
  las:      { name: 'Las',             food: 1, prod: 2, gold: 0, sci: 0, move: 2,  defense: 0.5,  color: 0x3f6d2a },
  bagno:    { name: 'Bagno',           food: 1, prod: 0, gold: 0, sci: 0, move: 2,  defense: -0.25,color: 0x4f5f3a },
  rzeka:    { name: 'Rzeka',           food: 2, prod: 0, gold: 2, sci: 1, move: 1,  defense: 0.25, color: 0x3f7fae },
  gory:     { name: 'Góry',            food: 0, prod: 2, gold: 0, sci: 0, move: 3,  defense: 1.0,  color: 0x8a8578 },
  pole:     { name: 'Pole uprawne',    food: 3, prod: 0, gold: 1, sci: 0, move: 1,  defense: -0.1, color: 0xc9a83c },
  bursztyn: { name: 'Złoża bursztynu', food: 1, prod: 1, gold: 3, sci: 1, move: 1,  defense: 0,    color: 0xd08a2e },
  grzybnia: { name: 'Prastara grzybnia', food: 1, prod: 1, gold: 0, sci: 3, move: 2, defense: 0.5, color: 0x6b4d7a },
};

export const UNITS = {
  osadnik: {
    name: 'Osadnik', plural: 'Osadnicy', atk: 0, def: 1, moves: 2, cost: 50, upkeep: 0,
    military: false, model: 'unit_osadnik',
    desc: 'Zakłada nowy gród lub zaorywa równinę w pole uprawne.',
  },
  wojownik: {
    name: 'Wojownik', plural: 'Wojownicy', atk: 2, def: 2, moves: 2, cost: 20, upkeep: 1,
    military: true, model: 'unit_wojownik',
    desc: 'Podstawowa piechota z włócznią. Obróbka żelaza wzmacnia go o +1/+1.',
  },
  bartnik: {
    name: 'Bartnik bojowy', plural: 'Bartnicy bojowi', atk: 3, def: 1, moves: 2, cost: 30, upkeep: 1,
    military: true, model: 'unit_bartnik', tech: 'bartnictwo',
    desc: 'Ciska ule pełne rozjuszonych pszczół — atak pomija połowę premii obronnej wroga.',
  },
  kosynier: {
    name: 'Kosynier', plural: 'Kosynierzy', atk: 4, def: 2, moves: 2, cost: 30, upkeep: 1,
    military: true, model: 'unit_kosynier', tech: 'kosynierzy',
    desc: 'Piechota z osadzoną na sztorc kosą. Silny atak.',
  },
  tabor: {
    name: 'Tabor', plural: 'Tabory', atk: 3, def: 6, moves: 2, cost: 50, upkeep: 2,
    military: true, model: 'prop_cart', tech: 'tabor',
    desc: 'Wóz bojowy — ruchoma twierdza. Mechanika liczydła dodaje celownik liczydłowy (+2 do ataku).',
  },
  grzybiarz: {
    name: 'Grzybiarz bojowy', plural: 'Grzybiarze bojowi', atk: 1, def: 2, moves: 3, cost: 40, upkeep: 1,
    military: true, model: 'unit_grzybiarz', tech: 'siec_grzybni',
    desc: 'Sabotażysta rozsiewający halucynogenne zarodniki: dezorientuje wrogów wokół (-50% ataku, wolniejszy ruch) i osłabia obronę grodów. Nie walczy wręcz najlepiej — to dopiero broń, potem umysł.',
  },
  barbarzynca: {
    name: 'Barbarzyńca', plural: 'Barbarzyńcy', atk: 2, def: 1, moves: 2, cost: 0, upkeep: 0,
    military: true, model: 'unit_barbarzynca', neutral: true,
    desc: 'Dzikus z pustkowi. Łupi i niszczy.',
  },
  barbarzynca_elit: {
    name: 'Wódz barbarzyńców', plural: 'Wodzowie barbarzyńców', atk: 3, def: 2, moves: 2, cost: 0, upkeep: 0,
    military: true, model: 'unit_orc', neutral: true,
    desc: 'Groźniejszy watażka z głębi puszczy.',
  },
};

export const BUILDINGS = {
  spichlerz: {
    name: 'Spichlerz', cost: 40, tech: 'osadnictwo',
    desc: '+2 żywności w grodzie.',
  },
  palisada: {
    name: 'Palisada', cost: 40, tech: 'obrobka_zelaza',
    desc: '+50% obrony grodu.',
  },
  kapliczka: {
    name: 'Kapliczka', cost: 50, tech: 'bartnictwo',
    desc: '+1 Łaski co turę, +5 Poparcia ludu po zbudowaniu.',
  },
  targ: {
    name: 'Targ', cost: 60, tech: 'mechanika',
    desc: '+50% złota w grodzie, +1 nauki.',
  },
  sanktuarium: {
    name: 'Sanktuarium Ojca Rydzyka', cost: 220, tech: 'mechanika', wonder: true, laska: 60,
    desc: 'CUD (jeden na całą grę, wymaga 60 Łaski). Datki płyną szerokim strumieniem: +8 złota co turę, +3 Poparcia ludu co turę, a nadwyżka poparcia zamienia się w naukę. Moc truchleje.',
  },
  przebudzenie: {
    name: 'Przebudzenie Grzybni', cost: 300, tech: 'siec_grzybni', project: true, laska: 40,
    desc: 'PROJEKT KOŃCOWY: rozproszona nadinteligencja budzi się w sieci grzybni. Wymaga Prastarej grzybni w granicach grodu i 40 Łaski. Kto pierwszy ukończy — WYGRYWA.',
  },
};

export const TECHS = {
  osadnictwo: {
    name: 'Osadnictwo', cost: 20, req: [],
    desc: 'Nowi Osadnicy i Spichlerz. Osadnik może też zaorać równinę w pole uprawne.',
    unlocks: 'Osadnik (budowa), Spichlerz, zaorywanie pól',
  },
  obrobka_zelaza: {
    name: 'Obróbka żelaza', cost: 35, req: ['osadnictwo'],
    desc: 'Żelazne groty: Wojownik +1 do ataku i obrony. Palisada chroni grody.',
    unlocks: 'Wojownik +1/+1, Palisada',
  },
  bartnictwo: {
    name: 'Bartnictwo bojowe', cost: 60, req: ['obrobka_zelaza'],
    desc: 'Ule bojowe ciskane we wrogów — historycznie prawdziwe! Bartnicy niosą też Łaskę: odblokowuje Kapliczkę.',
    unlocks: 'Bartnik bojowy, Kapliczka',
  },
  kosynierzy: {
    name: 'Kosynierzy', cost: 85, req: ['obrobka_zelaza'],
    desc: 'Kosy przekute na sztorc. Piechota o morderczym zamachu.',
    unlocks: 'Kosynier',
  },
  tabor: {
    name: 'Tabor bojowy', cost: 120, req: ['kosynierzy'],
    desc: 'Husycki wóz bojowy — ruchoma forteca spinana łańcuchami.',
    unlocks: 'Tabor',
  },
  mechanika: {
    name: 'Mechanika liczydła', cost: 160, req: ['tabor'],
    desc: 'Proto-obliczenia na liczydłach. Celownik liczydłowy dla Taborów (+2 ataku). Tu zaczyna się nić obliczeń.',
    unlocks: 'Tabor +2 ataku, Targ, Sanktuarium',
  },
  elektrycznosc: {
    name: 'Elektryczność bursztynowa', cost: 210, req: ['mechanika'], needsTile: 'bursztyn',
    desc: 'Elektron znaczy bursztyn. Butelki lejdejskie i trzask iskier: grody z bursztynem w granicach rażą napastników (+50% obrony wszystkich grodów). Wymaga złóż bursztynu w granicach.',
    unlocks: 'Obrona grodów +50%, +2 złota na bursztynie',
  },
  siec_grzybni: {
    name: 'Sieć grzybni obliczeniowej', cost: 270, req: ['elektrycznosc'], needsTile: 'grzybnia',
    desc: 'Śluzowce rozwiązują labirynty — prastara grzybnia liczy lepiej niż liczydło. Wymaga Prastarej grzybni w granicach.',
    unlocks: 'Grzybiarz bojowy, projekt Przebudzenie Grzybni, +2 nauki na grzybni',
  },
  przebudzenie: {
    name: 'Przebudzenie Grzybni', cost: 0, req: ['siec_grzybni'], project: true,
    desc: 'Zbuduj projekt końcowy w grodzie z Prastarą grzybnią w granicach. Pierwszy zwycięża.',
    unlocks: 'ZWYCIĘSTWO',
  },
};

// Kolejność w drzewku (do rysowania panelu).
export const TECH_ORDER = ['osadnictwo', 'obrobka_zelaza', 'bartnictwo', 'kosynierzy', 'tabor', 'mechanika', 'elektrycznosc', 'siec_grzybni', 'przebudzenie'];

export const FACTIONS = {
  polanie: {
    name: 'Polanie', adj: 'polański', group: 'Słowianie zachodni', color: 0xd23b3b, banner: '🦅',
    desc: 'Zbieracze plemion znad Warty. Ich gródki wyrastają jak grzyby po deszczu.',
    bonus: 'Nowe grody zaczynają z 2 mieszkańcami, Osadnicy o 25% tańsi.',
  },
  wislanie: {
    name: 'Wiślanie', adj: 'wiślański', group: 'Słowianie zachodni', color: 0x3b6fd2, banner: '🌊',
    desc: 'Kupcy znad Wisły, panowie bursztynowego szlaku.',
    bonus: '+1 złota z pól rzeki i bursztynu, +25% złota w skarbcu.',
  },
  goci: {
    name: 'Goci', adj: 'gocki', group: 'Germanie', color: 0x2f9e44, banner: '⚔️',
    desc: 'Twardzi wędrowcy ze Skandzy. Kuźnie huczą dniem i nocą.',
    bonus: 'Jednostki bojowe o 25% tańsze w produkcji.',
  },
  wandalowie: {
    name: 'Wandalowie', adj: 'wandalski', group: 'Germanie', color: 0xb04dd2, banner: '🔥',
    desc: 'Szybcy jak wiatr, łupieżcy znad Odry.',
    bonus: 'Jednostki bojowe +1 ruchu, grabież daje podwójne złoto i nie gniewa Łaski.',
  },
};

export const MAP_SIZES = {
  mala:    { name: 'Mała',    w: 28, h: 22 },
  srednia: { name: 'Średnia', w: 36, h: 28 },
  duza:    { name: 'Duża',    w: 44, h: 34 },
};

export const PASSPHRASE = 'Mycelium to przyszłość';
