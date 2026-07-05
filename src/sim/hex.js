// Matematyka siatki heksagonalnej.
// Mapa prostokątna w układzie "odd-r offset" (heksy pointy-top),
// z konwersją do współrzędnych axial/cube do liczenia odległości.

export const SQRT3 = Math.sqrt(3);

// Sąsiedzi dla odd-r offset (row parzysty / nieparzysty).
const NEIGHBORS_EVEN = [[+1, 0], [0, -1], [-1, -1], [-1, 0], [-1, +1], [0, +1]];
const NEIGHBORS_ODD  = [[+1, 0], [+1, -1], [0, -1], [-1, 0], [0, +1], [+1, +1]];

export function neighbors(col, row) {
  const list = (row & 1) ? NEIGHBORS_ODD : NEIGHBORS_EVEN;
  const out = [];
  for (const [dc, dr] of list) out.push([col + dc, row + dr]);
  return out;
}

export function offsetToAxial(col, row) {
  const q = col - ((row - (row & 1)) >> 1);
  return [q, row];
}

export function hexDistance(c1, r1, c2, r2) {
  const [q1, s1] = offsetToAxial(c1, r1);
  const [q2, s2] = offsetToAxial(c2, r2);
  const dq = q1 - q2, dr = s1 - s2;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

// Pozycja środka heksa w świecie 3D (x, z), rozmiar = promień heksa.
export function hexToWorld(col, row, size = 1) {
  const x = size * SQRT3 * (col + 0.5 * (row & 1));
  const z = size * 1.5 * row;
  return [x, z];
}

export function keyOf(col, row) { return row * 4096 + col; }
export function colOf(key) { return key % 4096; }
export function rowOf(key) { return Math.floor(key / 4096); }

// Wszystkie pola w promieniu r (łącznie ze środkiem).
export function tilesInRange(col, row, radius, width, height) {
  const out = [];
  const seen = new Set();
  const queue = [[col, row, 0]];
  seen.add(keyOf(col, row));
  while (queue.length) {
    const [c, r, d] = queue.shift();
    out.push([c, r, d]);
    if (d === radius) continue;
    for (const [nc, nr] of neighbors(c, r)) {
      if (nc < 0 || nr < 0 || nc >= width || nr >= height) continue;
      const k = keyOf(nc, nr);
      if (!seen.has(k)) { seen.add(k); queue.push([nc, nr, d + 1]); }
    }
  }
  return out;
}
