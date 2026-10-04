// Board topology: hexes, corners (vertices), sides (edges), coastline and harbor slots.
// Pure data, no DOM. Hex radius is 1; pointy-top hexes laid out in horizontal rows.

const SQRT3 = Math.sqrt(3);

export const LAYOUTS = {
  base: [3, 4, 5, 4, 3],          // 19 hexes, 3–4 players
  ext: [3, 4, 5, 6, 5, 4, 3],     // 30 hexes, 5–6 player expansion
};

// Harbor counts per layout (types are assigned by the engine).
export const HARBOR_COUNT = { base: 9, ext: 11 };

const cache = new Map();

export function getGeometry(expansion) {
  const key = expansion ? 'ext' : 'base';
  if (cache.has(key)) return cache.get(key);
  const geo = build(LAYOUTS[key], HARBOR_COUNT[key]);
  cache.set(key, geo);
  return geo;
}

function build(rows, harborCount) {
  // --- hexes (axial q,r) ---
  const hexes = [];
  let qStart = 0;
  const r0 = -Math.floor(rows.length / 2);
  rows.forEach((len, i) => {
    if (i > 0 && len > rows[i - 1]) qStart -= 1;
    const r = r0 + i;
    for (let j = 0; j < len; j++) {
      const q = qStart + j;
      hexes.push({ id: hexes.length, q, r, x: SQRT3 * (q + r / 2), y: 1.5 * r, vertices: [], edges: [], neighbors: [] });
    }
  });
  // centre the board on (0,0)
  const xs = hexes.map(h => h.x), ys = hexes.map(h => h.y);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  hexes.forEach(h => { h.x -= cx; h.y -= cy; });

  const byAxial = new Map(hexes.map(h => [`${h.q},${h.r}`, h]));
  const DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
  hexes.forEach(h => {
    for (const [dq, dr] of DIRS) {
      const n = byAxial.get(`${h.q + dq},${h.r + dr}`);
      if (n) h.neighbors.push(n.id);
    }
  });

  // --- vertices & edges ---
  const vertices = [];
  const vKey = new Map();
  const edges = [];
  const eKey = new Map();
  const corner = (h, k) => {
    const a = (Math.PI / 180) * (60 * k - 90);
    return [h.x + Math.cos(a), h.y + Math.sin(a)];
  };
  const keyOf = (x, y) => `${Math.round(x * 1000)},${Math.round(y * 1000)}`;
  for (const h of hexes) {
    const ids = [];
    for (let k = 0; k < 6; k++) {
      const [x, y] = corner(h, k);
      const key = keyOf(x, y);
      let v = vKey.get(key);
      if (v === undefined) {
        v = vertices.length;
        vertices.push({ id: v, x, y, hexes: [], edges: [], adj: [] });
        vKey.set(key, v);
      }
      vertices[v].hexes.push(h.id);
      ids.push(v);
    }
    h.vertices = ids;
    for (let k = 0; k < 6; k++) {
      const a = ids[k], b = ids[(k + 1) % 6];
      const key = a < b ? `${a}-${b}` : `${b}-${a}`;
      let e = eKey.get(key);
      if (e === undefined) {
        e = edges.length;
        const va = vertices[a], vb = vertices[b];
        edges.push({ id: e, v: [a, b], hexes: [], x: (va.x + vb.x) / 2, y: (va.y + vb.y) / 2 });
        eKey.set(key, e);
        va.edges.push(e);
        vb.edges.push(e);
        va.adj.push(b);
        vb.adj.push(a);
      }
      edges[e].hexes.push(h.id);
      h.edges.push(e);
    }
  }

  // --- coastline: edges touching exactly one hex, walked in order around the island ---
  const coastal = edges.filter(e => e.hexes.length === 1).map(e => e.id);
  const coastSet = new Set(coastal);
  // start at the top-left-most coastal edge for a stable, symmetric harbor layout
  const start = coastal.slice().sort((a, b) => (edges[a].y - edges[b].y) || (edges[a].x - edges[b].x))[0];
  const cycle = [start];
  const seen = new Set([start]);
  let cur = start;
  let atVertex = edges[start].v[1];
  // walk clockwise: choose the direction whose next edge keeps going
  while (cycle.length < coastal.length) {
    const next = vertices[atVertex].edges.find(e => coastSet.has(e) && !seen.has(e));
    if (next === undefined) break;
    cycle.push(next);
    seen.add(next);
    cur = next;
    atVertex = edges[cur].v[0] === atVertex ? edges[cur].v[1] : edges[cur].v[0];
  }

  // harbor slots spread evenly round the coast
  const harborSlots = [];
  for (let i = 0; i < harborCount; i++) harborSlots.push(cycle[Math.round((i * cycle.length) / harborCount) % cycle.length]);

  // outward direction for each coastal edge (from its hex centre to the edge midpoint)
  const outward = {};
  for (const e of coastal) {
    const h = hexes[edges[e].hexes[0]];
    const dx = edges[e].x - h.x, dy = edges[e].y - h.y;
    const len = Math.hypot(dx, dy);
    outward[e] = [dx / len, dy / len];
  }

  // ring of sea hexes around the land (for drawing)
  const sea = [];
  const seaSeen = new Set();
  for (const h of hexes) {
    for (const [dq, dr] of DIRS) {
      const q = h.q + dq, r = h.r + dr, k = `${q},${r}`;
      if (byAxial.has(k) || seaSeen.has(k)) continue;
      seaSeen.add(k);
      sea.push({ q, r, x: SQRT3 * (q + r / 2) - cx, y: 1.5 * r - cy });
    }
  }

  // frame the land plus room for the harbors; the sea ring is allowed to bleed off the edges
  const M = 0.95;
  const bounds = {
    minX: Math.min(...vertices.map(v => v.x)) - M,
    maxX: Math.max(...vertices.map(v => v.x)) + M,
    minY: Math.min(...vertices.map(v => v.y)) - M,
    maxY: Math.max(...vertices.map(v => v.y)) + M,
  };

  return { rows, hexes, vertices, edges, coast: cycle, harborSlots, outward, sea, bounds };
}

export function hexCorners(x, y, r = 1) {
  const pts = [];
  for (let k = 0; k < 6; k++) {
    const a = (Math.PI / 180) * (60 * k - 90);
    pts.push([x + r * Math.cos(a), y + r * Math.sin(a)]);
  }
  return pts;
}
