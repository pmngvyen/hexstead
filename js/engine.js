// Hexstead rules engine.
// Pure functions over a plain JSON game state. Every client runs the same code;
// actions are validated here, so the online sync layer can stay thin.

import { getGeometry } from './geometry.js';

export const RESOURCES = ['brick', 'lumber', 'wool', 'grain', 'ore'];
export const TERRAIN_RESOURCE = { hills: 'brick', forest: 'lumber', pasture: 'wool', fields: 'grain', mountains: 'ore', desert: null };
export const COSTS = {
  road: { brick: 1, lumber: 1 },
  settlement: { brick: 1, lumber: 1, wool: 1, grain: 1 },
  city: { grain: 2, ore: 3 },
  dev: { wool: 1, grain: 1, ore: 1 },
};
export const DEV_TYPES = ['knight', 'vp', 'roadBuilding', 'yearOfPlenty', 'monopoly'];
export const DEV_INFO = {
  knight: { name: 'Knight', text: 'Move the robber and steal one card. Three or more knights can earn Largest Army.' },
  vp: { name: 'Victory Point', text: 'Worth 1 point. Stays hidden from other players until the game ends.' },
  roadBuilding: { name: 'Road Building', text: 'Place 2 roads for free.' },
  yearOfPlenty: { name: 'Year of Plenty', text: 'Take any 2 resources from the bank.' },
  monopoly: { name: 'Monopoly', text: 'Name a resource. Every other player hands you all of it.' },
};
export const PIPS = { 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 8: 5, 9: 4, 10: 3, 11: 2, 12: 1 };
export const PIECES = { roads: 15, settlements: 5, cities: 4 };

export const SETS = {
  base: {
    terrains: { forest: 4, pasture: 4, fields: 4, hills: 3, mountains: 3, desert: 1 },
    numbers: [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12],
    harbors: ['any', 'any', 'any', 'any', 'brick', 'lumber', 'wool', 'grain', 'ore'],
    dev: { knight: 14, vp: 5, roadBuilding: 2, yearOfPlenty: 2, monopoly: 2 },
    bank: 19,
    maxPlayers: 4,
  },
  ext: {
    terrains: { forest: 6, pasture: 6, fields: 6, hills: 5, mountains: 5, desert: 2 },
    numbers: [2, 2, 3, 3, 3, 4, 4, 4, 5, 5, 5, 6, 6, 6, 8, 8, 8, 9, 9, 9, 10, 10, 10, 11, 11, 11, 12, 12],
    harbors: ['any', 'any', 'any', 'any', 'any', 'brick', 'lumber', 'wool', 'wool', 'grain', 'ore'],
    dev: { knight: 20, vp: 5, roadBuilding: 3, yearOfPlenty: 3, monopoly: 3 },
    bank: 24,
    maxPlayers: 6,
  },
};

export class GameError extends Error {
  constructor(message) { super(message); this.name = 'GameError'; }
}
function fail(msg) { throw new GameError(msg); }
function need(cond, msg) { if (!cond) fail(msg); }

export const setOf = (s) => (s.settings.expansion ? SETS.ext : SETS.base);
export const geoOf = (s) => getGeometry(!!s.settings.expansion);
export const emptyRes = () => ({ brick: 0, lumber: 0, wool: 0, grain: 0, ore: 0 });
export const totalRes = (r) => RESOURCES.reduce((n, k) => n + (r[k] || 0), 0);
export const hasRes = (have, cost) => RESOURCES.every(k => (have[k] || 0) >= (cost[k] || 0));

function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
const expand = (counts) => Object.entries(counts).flatMap(([k, n]) => Array(n).fill(k));

// ---------------------------------------------------------------- settings

export const DEFAULT_SETTINGS = { expansion: false, vpTarget: 10, friendlyRobber: false, specialBuild: true, balancedBoard: true };

export function normalizeSettings(raw = {}, playerCount = 4) {
  const s = { ...DEFAULT_SETTINGS, ...raw };
  s.expansion = !!s.expansion || playerCount > 4;
  s.vpTarget = Math.max(5, Math.min(20, Math.round(Number(s.vpTarget) || 10)));
  s.friendlyRobber = !!s.friendlyRobber;
  s.specialBuild = !!s.specialBuild;
  s.balancedBoard = s.balancedBoard !== false;
  return s;
}

export function maxPlayers(settings) { return settings && settings.expansion ? 6 : 4; }

// ---------------------------------------------------------------- board

export function generateBoard(expansion, rng = Math.random, balanced = true) {
  const geo = getGeometry(expansion);
  const set = expansion ? SETS.ext : SETS.base;
  let hexes = null;
  let cand = null;
  for (let attempt = 0; attempt < 4000 && !hexes; attempt++) {
    const terrains = shuffle(expand(set.terrains), rng);
    const nums = shuffle(set.numbers.slice(), rng);
    let k = 0;
    cand = terrains.map(t => ({ terrain: t, number: t === 'desert' ? null : nums[k++] }));
    if (!balanced || boardIsBalanced(cand, geo, attempt)) hexes = cand;
  }
  if (!hexes) hexes = cand; // never fail: fall back to the last shuffle
  const harborTypes = shuffle(set.harbors.slice(), rng);
  const harbors = geo.harborSlots.map((edge, i) => ({ edge, type: harborTypes[i] }));
  const robber = hexes.findIndex(h => h.terrain === 'desert');
  return { hexes, harbors, robber };
}

function boardIsBalanced(hexes, geo, attempt) {
  const red = n => n === 6 || n === 8;
  for (const h of geo.hexes) {
    const a = hexes[h.id];
    for (const nb of h.neighbors) {
      const b = hexes[nb];
      if (a.number == null || b.number == null) continue;
      if (red(a.number) && red(b.number)) return false;
      if (attempt < 3000 && a.number === b.number) return false; // relax late if unlucky
    }
  }
  // avoid three of one terrain touching each other in a tight cluster (soft, early attempts only)
  if (attempt < 1500) {
    for (const h of geo.hexes) {
      const t = hexes[h.id].terrain;
      if (t === 'desert') continue;
      const same = h.neighbors.filter(n => hexes[n].terrain === t).length;
      if (same >= 2) return false;
    }
  }
  return true;
}

// ---------------------------------------------------------------- game creation

/**
 * players: [{ id, name, color, bot }]
 */
export function createGame({ players, settings }, rng = Math.random) {
  need(Array.isArray(players) && players.length >= 2, 'At least 2 players are needed.');
  const st = normalizeSettings(settings, players.length);
  need(players.length <= maxPlayers(st), 'Too many players for this board.');
  const set = st.expansion ? SETS.ext : SETS.base;
  const board = generateBoard(st.expansion, rng, st.balancedBoard);
  const n = players.length;
  const first = Math.floor(rng() * n);
  const order = [];
  for (let i = 0; i < n; i++) order.push((first + i) % n);
  for (let i = n - 1; i >= 0; i--) order.push((first + i) % n);
  const bank = {};
  RESOURCES.forEach(r => (bank[r] = set.bank));
  const state = {
    v: 1,
    seq: 0,
    settings: st,
    hexes: board.hexes,
    harbors: board.harbors,
    robber: board.robber,
    players: players.map((p, i) => ({
      id: String(p.id ?? `p${i}`),
      name: String(p.name || `Player ${i + 1}`).slice(0, 24),
      color: p.color || 'red',
      bot: !!p.bot,
      res: emptyRes(),
      dev: [],
      knights: 0,
      roads: PIECES.roads,
      settlements: PIECES.settlements,
      cities: PIECES.cities,
    })),
    buildings: {},
    roads: {},
    bank,
    deck: shuffle(expand(set.dev), rng),
    first,
    current: first,
    turn: 0,
    phase: 'setup',
    setup: { order, step: 0, stage: 'settlement', vertex: null },
    dice: null,
    devPlayed: false,
    discards: {},
    robberReturn: null,
    freeRoads: 0,
    roadReturn: null,
    special: null,
    offer: null,
    counters: {},
    offersThisTurn: 0,
    nextId: 1,
    longestRoad: null,
    largestArmy: null,
    roadLengths: players.map(() => 0),
    winner: null,
    production: null,
    stats: { rolls: { 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0, 9: 0, 10: 0, 11: 0, 12: 0 }, played: { knight: 0, roadBuilding: 0, yearOfPlenty: 0, monopoly: 0 } },
    log: [],
  };
  log(state, { m: 'The island is ready. Place your first settlement and road.' });
  return state;
}

// ---------------------------------------------------------------- queries

export function victoryPoints(s, seat, includeHidden = false) {
  let vp = 0;
  for (const b of Object.values(s.buildings)) if (b.p === seat) vp += b.city ? 2 : 1;
  if (s.longestRoad === seat) vp += 2;
  if (s.largestArmy === seat) vp += 2;
  if (includeHidden) vp += s.players[seat].dev.filter(c => c.type === 'vp').length;
  return vp;
}

export function specialSeat(s) {
  return s.phase === 'special' && s.special ? s.special.queue[s.special.idx] : null;
}

/** Seats whose input the game is currently waiting on. */
export function waitingOn(s) {
  switch (s.phase) {
    case 'setup': return [s.setup.order[s.setup.step]];
    case 'discard': return Object.keys(s.discards).map(Number);
    case 'special': return [specialSeat(s)];
    case 'over': return [];
    default: return [s.current];
  }
}

const buildingAt = (s, v) => s.buildings[v];

export function canPlaceSettlement(s, seat, v, setup = false) {
  const geo = geoOf(s);
  const vert = geo.vertices[v];
  if (!vert || buildingAt(s, v)) return false;
  if (s.players[seat].settlements <= 0) return false;
  if (vert.adj.some(a => buildingAt(s, a))) return false;
  if (setup) return true;
  return vert.edges.some(e => s.roads[e] === seat);
}

export function canPlaceRoad(s, seat, e, setupVertex = null) {
  const geo = geoOf(s);
  const edge = geo.edges[e];
  if (!edge || s.roads[e] !== undefined) return false;
  if (s.players[seat].roads <= 0) return false;
  if (setupVertex !== null && setupVertex !== undefined) return edge.v.includes(setupVertex);
  return edge.v.some(v => {
    const b = buildingAt(s, v);
    if (b) return b.p === seat;
    return geo.vertices[v].edges.some(x => x !== e && s.roads[x] === seat);
  });
}

export function canPlaceCity(s, seat, v) {
  const b = buildingAt(s, v);
  return !!b && b.p === seat && !b.city && s.players[seat].cities > 0;
}

export function legalSettlements(s, seat, setup = false) {
  const out = [];
  geoOf(s).vertices.forEach(v => { if (canPlaceSettlement(s, seat, v.id, setup)) out.push(v.id); });
  return out;
}
export function legalRoads(s, seat, setupVertex = null) {
  const out = [];
  geoOf(s).edges.forEach(e => { if (canPlaceRoad(s, seat, e.id, setupVertex)) out.push(e.id); });
  return out;
}
export function legalCities(s, seat) {
  return Object.keys(s.buildings).map(Number).filter(v => canPlaceCity(s, seat, v));
}

export function tradeRatios(s, seat) {
  const geo = geoOf(s);
  const r = { brick: 4, lumber: 4, wool: 4, grain: 4, ore: 4 };
  for (const h of s.harbors) {
    const owns = geo.edges[h.edge].v.some(v => buildingAt(s, v) && buildingAt(s, v).p === seat);
    if (!owns) continue;
    if (h.type === 'any') RESOURCES.forEach(k => (r[k] = Math.min(r[k], 3)));
    else r[h.type] = 2;
  }
  return r;
}

export function robberTargets(s, seat) {
  const geo = geoOf(s);
  const all = geo.hexes.map(h => h.id).filter(i => i !== s.robber);
  if (!s.settings.friendlyRobber) return all;
  const shielded = new Set(s.players.map((_, i) => i).filter(i => i !== seat && victoryPoints(s, i) <= 2));
  const ok = all.filter(i => s.hexes[i].terrain === 'desert' ||
    !geo.hexes[i].vertices.some(v => buildingAt(s, v) && shielded.has(buildingAt(s, v).p)));
  return ok.length ? ok : all;
}

export function stealCandidates(s, seat, hex) {
  const geo = geoOf(s);
  const out = new Set();
  for (const v of geo.hexes[hex].vertices) {
    const b = buildingAt(s, v);
    if (!b || b.p === seat) continue;
    if (totalRes(s.players[b.p].res) === 0) continue;
    if (s.settings.friendlyRobber && victoryPoints(s, b.p) <= 2) continue;
    out.add(b.p);
  }
  return [...out].sort((a, b) => a - b);
}

export function playableDev(s, seat) {
  const p = s.players[seat];
  return p.dev.filter(c => c.type !== 'vp' && c.turn < s.turn).map(c => c.type);
}

export function canBuildAnything(s, seat) {
  const p = s.players[seat];
  if (hasRes(p.res, COSTS.city) && p.cities > 0 && legalCities(s, seat).length) return true;
  if (hasRes(p.res, COSTS.settlement) && p.settlements > 0 && legalSettlements(s, seat).length) return true;
  if (hasRes(p.res, COSTS.road) && p.roads > 0 && legalRoads(s, seat).length) return true;
  if (hasRes(p.res, COSTS.dev) && s.deck.length > 0) return true;
  return false;
}

export function longestRoadFor(s, seat) {
  const geo = geoOf(s);
  const mine = Object.keys(s.roads).map(Number).filter(e => s.roads[e] === seat);
  if (!mine.length) return 0;
  const used = new Set();
  let best = 0;
  const blocked = v => { const b = buildingAt(s, v); return !!b && b.p !== seat; };
  const dfs = (v, len) => {
    if (len > best) best = len;
    if (len > 0 && blocked(v)) return;
    for (const e of geo.vertices[v].edges) {
      if (s.roads[e] !== seat || used.has(e)) continue;
      used.add(e);
      const [a, b] = geo.edges[e].v;
      dfs(a === v ? b : a, len + 1);
      used.delete(e);
    }
  };
  const starts = new Set();
  mine.forEach(e => geo.edges[e].v.forEach(v => starts.add(v)));
  starts.forEach(v => dfs(v, 0));
  return best;
}

// ---------------------------------------------------------------- mutation helpers

// The synced log only keeps recent entries (it is most of the state's size); screens keep a longer local history.
export const LOG_KEEP = 50;
export function log(s, entry) {
  s.log.push({ i: (s.log.length ? s.log[s.log.length - 1].i + 1 : 0), t: s.turn, ...entry });
  if (s.log.length > LOG_KEEP) s.log.splice(0, s.log.length - LOG_KEEP);
}

function cleanRes(obj) {
  const out = emptyRes();
  if (!obj || typeof obj !== 'object') return out;
  for (const k of RESOURCES) {
    const n = Math.floor(Number(obj[k]) || 0);
    need(n >= 0 && n <= 99, 'Invalid amount.');
    out[k] = n;
  }
  return out;
}
const isRes = (r) => RESOURCES.includes(r);
function pay(s, seat, cost) {
  const p = s.players[seat];
  need(hasRes(p.res, cost), 'You don’t have enough resources.');
  for (const k of RESOURCES) {
    const n = cost[k] || 0;
    p.res[k] -= n;
    s.bank[k] += n;
  }
}
function transfer(from, to, res) {
  for (const k of RESOURCES) {
    from[k] -= res[k] || 0;
    to[k] += res[k] || 0;
  }
}
export function resText(res) {
  const parts = RESOURCES.filter(k => res[k] > 0).map(k => `${res[k]} ${k}`);
  return parts.length ? parts.join(', ') : 'nothing';
}

function updateLongestRoad(s) {
  const L = s.players.map((_, i) => longestRoadFor(s, i));
  s.roadLengths = L;
  const prev = s.longestRoad;
  const max = Math.max(...L);
  if (prev !== null && L[prev] >= 5 && L[prev] >= max) return;
  if (max >= 5 && L.filter(x => x === max).length === 1) s.longestRoad = L.indexOf(max);
  else s.longestRoad = null;
  if (s.longestRoad !== prev) {
    if (s.longestRoad !== null) log(s, { p: s.longestRoad, m: `took Longest Road (${max})`, k: 'award' });
    else log(s, { m: 'Longest Road is unclaimed for now.', k: 'award' });
  }
}

function updateLargestArmy(s, seat) {
  const k = s.players[seat].knights;
  const h = s.largestArmy;
  if (k >= 3 && h !== seat && (h === null || k > s.players[h].knights)) {
    s.largestArmy = seat;
    log(s, { p: seat, m: `took Largest Army (${k} knights)`, k: 'award' });
  }
}

function clearTrades(s) {
  s.offer = null;
  s.counters = {};
}

function nextTurn(s) {
  s.current = (s.current + 1) % s.players.length;
  s.turn += 1;
  s.phase = 'roll';
  s.dice = null;
  s.devPlayed = false;
  s.special = null;
  s.offersThisTurn = 0;
  s.production = null;
  clearTrades(s);
}

function settleSpecial(s) {
  const sp = s.special;
  while (sp.idx < sp.queue.length && !canBuildAnything(s, sp.queue[sp.idx])) sp.idx++;
  if (sp.idx >= sp.queue.length) nextTurn(s);
}

function checkWin(s) {
  if (s.phase === 'over' || s.phase === 'setup' || s.phase === 'special') return;
  const seat = s.current;
  if (victoryPoints(s, seat, true) >= s.settings.vpTarget) {
    s.phase = 'over';
    s.winner = seat;
    clearTrades(s);
    log(s, { p: seat, m: `wins with ${victoryPoints(s, seat, true)} points!`, k: 'win' });
  }
}

function produce(s, roll) {
  const geo = geoOf(s);
  const owed = s.players.map(() => emptyRes());
  geo.hexes.forEach(h => {
    const hx = s.hexes[h.id];
    if (hx.number !== roll || s.robber === h.id) return;
    const res = TERRAIN_RESOURCE[hx.terrain];
    if (!res) return;
    for (const v of h.vertices) {
      const b = buildingAt(s, v);
      if (b) owed[b.p][res] += b.city ? 2 : 1;
    }
  });
  const got = s.players.map(() => emptyRes());
  const short = [];
  for (const k of RESOURCES) {
    const total = owed.reduce((n, o) => n + o[k], 0);
    if (!total) continue;
    const owers = owed.map((o, i) => (o[k] ? i : -1)).filter(i => i >= 0);
    if (total <= s.bank[k]) owers.forEach(i => (got[i][k] = owed[i][k]));
    else if (owers.length === 1) got[owers[0]][k] = s.bank[k];
    if (total > s.bank[k]) short.push(k);
  }
  got.forEach((g, i) => {
    transfer(s.bank, s.players[i].res, g);
    if (totalRes(g)) log(s, { p: i, m: `got ${resText(g)}`, k: 'prod' });
  });
  short.forEach(k => log(s, { m: `The bank ran short of ${k}.`, k: 'prod' }));
  s.production = got.map(g => (totalRes(g) ? g : null));
}

// ---------------------------------------------------------------- actions

const H = {};

H.placeSettlement = (s, seat, a) => {
  need(s.phase === 'setup', 'Use Build to place settlements.');
  const st = s.setup;
  need(st.order[st.step] === seat, 'It’s not your turn to place.');
  need(st.stage === 'settlement', 'Place your road first.');
  const v = Number(a.vertex);
  need(canPlaceSettlement(s, seat, v, true), 'You can’t settle there. Settlements need an empty corner with no neighbors.');
  s.buildings[v] = { p: seat, city: false };
  s.players[seat].settlements -= 1;
  const second = st.step >= s.players.length;
  if (second) {
    const geo = geoOf(s);
    const g = emptyRes();
    for (const h of geo.vertices[v].hexes) {
      const r = TERRAIN_RESOURCE[s.hexes[h].terrain];
      if (r && s.bank[r] > 0) { g[r] += 1; s.bank[r] -= 1; }
    }
    transfer(emptyRes(), s.players[seat].res, g); // add
    log(s, { p: seat, m: `placed a settlement and collected ${resText(g)}`, k: 'build' });
  } else {
    log(s, { p: seat, m: 'placed a settlement', k: 'build' });
  }
  st.stage = 'road';
  st.vertex = v;
  updateLongestRoad(s);
};

H.placeRoad = (s, seat, a) => {
  const e = Number(a.edge);
  if (s.phase === 'setup') {
    const st = s.setup;
    need(st.order[st.step] === seat, 'It’s not your turn to place.');
    need(st.stage === 'road', 'Place your settlement first.');
    need(canPlaceRoad(s, seat, e, st.vertex), 'Your road must touch the settlement you just placed.');
    s.roads[e] = seat;
    s.players[seat].roads -= 1;
    st.step += 1;
    st.stage = 'settlement';
    st.vertex = null;
    updateLongestRoad(s);
    if (st.step >= st.order.length) {
      s.setup = null;
      s.phase = 'roll';
      s.current = s.first;
      s.turn = 1;
      log(s, { m: 'Setup is done. Let the rolling begin.' });
    }
    return;
  }
  need(s.phase === 'roadBuilding' && s.current === seat, 'Use Build to place roads.');
  need(canPlaceRoad(s, seat, e), 'Roads must connect to your own road, settlement or city.');
  s.roads[e] = seat;
  s.players[seat].roads -= 1;
  s.freeRoads -= 1;
  log(s, { p: seat, m: 'placed a free road', k: 'build' });
  updateLongestRoad(s);
  if (s.freeRoads <= 0 || !legalRoads(s, seat).length) {
    s.freeRoads = 0;
    s.phase = s.roadReturn || 'main';
    s.roadReturn = null;
  }
};

H.finishRoads = (s, seat) => {
  need(s.phase === 'roadBuilding' && s.current === seat, 'You aren’t placing free roads.');
  s.freeRoads = 0;
  s.phase = s.roadReturn || 'main';
  s.roadReturn = null;
};

H.roll = (s, seat, a, rng) => {
  need(s.current === seat, 'It’s not your turn.');
  need(s.phase === 'roll', 'You’ve already rolled this turn.');
  const d = [1 + Math.floor(rng() * 6), 1 + Math.floor(rng() * 6)];
  const sum = d[0] + d[1];
  s.dice = d;
  s.stats.rolls[sum] += 1;
  log(s, { p: seat, m: `rolled ${sum}`, k: 'roll', d });
  s.production = null;
  if (sum === 7) {
    s.discards = {};
    s.players.forEach((p, i) => {
      const n = totalRes(p.res);
      if (n > 7) s.discards[i] = Math.floor(n / 2);
    });
    s.robberReturn = 'main';
    s.phase = Object.keys(s.discards).length ? 'discard' : 'robber';
  } else {
    produce(s, sum);
    s.phase = 'main';
  }
};

H.discard = (s, seat, a) => {
  need(s.phase === 'discard', 'Nobody needs to discard right now.');
  const n = s.discards[seat];
  need(n > 0, 'You don’t need to discard.');
  const r = cleanRes(a.res);
  need(totalRes(r) === n, `Choose exactly ${n} card${n === 1 ? '' : 's'} to discard.`);
  pay(s, seat, r);
  delete s.discards[seat];
  log(s, { p: seat, m: `discarded ${resText(r)}`, k: 'discard' });
  if (!Object.keys(s.discards).length) s.phase = 'robber';
};

H.moveRobber = (s, seat, a, rng) => {
  need(s.phase === 'robber' && s.current === seat, 'You can’t move the robber now.');
  const hex = Number(a.hex);
  need(Number.isInteger(hex) && hex >= 0 && hex < s.hexes.length, 'Pick a hex for the robber.');
  need(hex !== s.robber, 'The robber has to move to a different hex.');
  need(robberTargets(s, seat).includes(hex), 'Friendly robber: that hex touches a player with 2 points or fewer.');
  s.robber = hex;
  const cands = stealCandidates(s, seat, hex);
  let victim = a.victim === undefined || a.victim === null ? null : Number(a.victim);
  if (!cands.length) victim = null;
  else if (cands.length === 1) victim = cands[0];
  else need(cands.includes(victim), 'Choose who to steal from.');
  const t = s.hexes[hex];
  log(s, { p: seat, m: `moved the robber to ${t.terrain === 'desert' ? 'the desert' : `a ${t.number} ${t.terrain}`}`, k: 'robber' });
  if (victim !== null) {
    const vp = s.players[victim];
    const pool = RESOURCES.flatMap(k => Array(vp.res[k]).fill(k));
    const card = pool[Math.floor(rng() * pool.length)];
    vp.res[card] -= 1;
    s.players[seat].res[card] += 1;
    log(s, { p: seat, o: victim, m: 'stole a card from {o}', k: 'steal', secret: { res: card, to: [seat, victim] } });
  }
  s.phase = s.robberReturn || 'main';
  s.robberReturn = null;
};

function canBuildNow(s, seat) {
  return (s.phase === 'main' && s.current === seat) || (s.phase === 'special' && specialSeat(s) === seat);
}

H.build = (s, seat, a) => {
  need(canBuildNow(s, seat), s.phase === 'roll' && s.current === seat ? 'Roll the dice first.' : 'You can’t build right now.');
  const p = s.players[seat];
  if (a.kind === 'road') {
    const e = Number(a.edge);
    need(p.roads > 0, 'You have no roads left.');
    need(canPlaceRoad(s, seat, e), 'Roads must connect to your own road, settlement or city.');
    pay(s, seat, COSTS.road);
    s.roads[e] = seat;
    p.roads -= 1;
    log(s, { p: seat, m: 'built a road', k: 'build' });
    updateLongestRoad(s);
  } else if (a.kind === 'settlement') {
    const v = Number(a.vertex);
    need(p.settlements > 0, 'You have no settlements left. Upgrade one to a city.');
    need(canPlaceSettlement(s, seat, v), 'Settlements need your road and no neighbors on adjacent corners.');
    pay(s, seat, COSTS.settlement);
    s.buildings[v] = { p: seat, city: false };
    p.settlements -= 1;
    log(s, { p: seat, m: 'built a settlement', k: 'build' });
    updateLongestRoad(s);
  } else if (a.kind === 'city') {
    const v = Number(a.vertex);
    need(p.cities > 0, 'You have no cities left.');
    need(canPlaceCity(s, seat, v), 'Cities replace one of your settlements.');
    pay(s, seat, COSTS.city);
    s.buildings[v].city = true;
    p.cities -= 1;
    p.settlements += 1;
    log(s, { p: seat, m: 'built a city', k: 'build' });
  } else {
    fail('Unknown building.');
  }
  if (s.phase === 'special') settleSpecial(s);
};

H.buyDev = (s, seat) => {
  need(canBuildNow(s, seat), s.phase === 'roll' && s.current === seat ? 'Roll the dice first.' : 'You can’t buy cards right now.');
  need(s.deck.length > 0, 'The development deck is empty.');
  pay(s, seat, COSTS.dev);
  const type = s.deck.pop();
  s.players[seat].dev.push({ type, turn: s.turn });
  log(s, { p: seat, m: 'bought a development card', k: 'dev', secret: { dev: type, to: [seat] } });
  if (s.phase === 'special') settleSpecial(s);
};

H.playDev = (s, seat, a) => {
  need(s.current === seat && (s.phase === 'roll' || s.phase === 'main'), 'Development cards can be played on your own turn.');
  need(!s.devPlayed, 'You can play only one development card per turn.');
  const type = a.card;
  need(DEV_TYPES.includes(type) && type !== 'vp', 'That card can’t be played.');
  const p = s.players[seat];
  const idx = p.dev.findIndex(c => c.type === type && c.turn < s.turn);
  if (idx < 0) {
    need(p.dev.some(c => c.type === type), `You don’t have a ${DEV_INFO[type].name} card.`);
    fail('Cards bought this turn can be played from your next turn.');
  }
  const take = () => { p.dev.splice(idx, 1); s.devPlayed = true; s.stats.played[type] += 1; };
  if (type === 'knight') {
    take();
    p.knights += 1;
    log(s, { p: seat, m: 'played a Knight', k: 'dev' });
    updateLargestArmy(s, seat);
    clearTrades(s);
    s.robberReturn = s.phase;
    s.phase = 'robber';
  } else if (type === 'roadBuilding') {
    need(p.roads > 0 && legalRoads(s, seat).length > 0, 'You have nowhere to place a road.');
    take();
    log(s, { p: seat, m: 'played Road Building', k: 'dev' });
    clearTrades(s);
    s.freeRoads = Math.min(2, p.roads);
    s.roadReturn = s.phase;
    s.phase = 'roadBuilding';
  } else if (type === 'yearOfPlenty') {
    const pick = Array.isArray(a.res) ? a.res : [];
    need(pick.length === 2 && pick.every(isRes), 'Pick 2 resources.');
    const want = emptyRes();
    pick.forEach(r => (want[r] += 1));
    need(RESOURCES.every(k => s.bank[k] >= want[k]), 'The bank doesn’t have those resources.');
    take();
    transfer(s.bank, p.res, want);
    log(s, { p: seat, m: `played Year of Plenty for ${resText(want)}`, k: 'dev' });
  } else if (type === 'monopoly') {
    need(isRes(a.res), 'Pick a resource.');
    take();
    let total = 0;
    s.players.forEach((o, i) => {
      if (i === seat) return;
      total += o.res[a.res];
      p.res[a.res] += o.res[a.res];
      o.res[a.res] = 0;
    });
    log(s, { p: seat, m: `played Monopoly and collected ${total} ${a.res}`, k: 'dev' });
  }
};

H.bankTrade = (s, seat, a) => {
  need(s.phase === 'main' && s.current === seat, 'You can trade on your turn after rolling.');
  need(isRes(a.give) && isRes(a.get) && a.give !== a.get, 'Pick two different resources.');
  const times = Math.max(1, Math.floor(Number(a.times) || 1));
  const ratio = tradeRatios(s, seat)[a.give];
  const p = s.players[seat];
  need(p.res[a.give] >= ratio * times, `You need ${ratio * times} ${a.give}.`);
  need(s.bank[a.get] >= times, `The bank is out of ${a.get}.`);
  p.res[a.give] -= ratio * times;
  s.bank[a.give] += ratio * times;
  p.res[a.get] += times;
  s.bank[a.get] -= times;
  log(s, { p: seat, m: `traded ${ratio * times} ${a.give} with the bank for ${times} ${a.get}`, k: 'trade' });
};

function checkOffer(give, want) {
  need(totalRes(give) > 0 && totalRes(want) > 0, 'A trade needs cards on both sides.');
  need(RESOURCES.every(k => !(give[k] > 0 && want[k] > 0)), 'You can’t trade a resource for the same resource.');
}

H.offerTrade = (s, seat, a) => {
  need(s.phase === 'main' && s.current === seat, 'You can offer trades on your turn after rolling.');
  const give = cleanRes(a.give), want = cleanRes(a.want);
  checkOffer(give, want);
  need(hasRes(s.players[seat].res, give), 'You don’t have the cards you’re offering.');
  s.offer = { id: s.nextId++, give, want, responses: {} };
  s.offersThisTurn += 1;
  log(s, { p: seat, m: `offered ${resText(give)} for ${resText(want)}`, k: 'trade' });
};

H.respondTrade = (s, seat, a) => {
  need(s.phase === 'main' && s.offer && s.offer.id === Number(a.id), 'That offer is no longer open.');
  need(seat !== s.current, 'You can’t answer your own offer.');
  if (a.accept) need(hasRes(s.players[seat].res, s.offer.want), 'You don’t have the cards they want.');
  s.offer.responses[seat] = a.accept ? 'accept' : 'decline';
};

H.confirmTrade = (s, seat, a) => {
  need(s.phase === 'main' && s.current === seat, 'Only the player whose turn it is can complete a trade.');
  const o = s.offer;
  need(o && o.id === Number(a.id), 'That offer is no longer open.');
  const w = Number(a.with);
  need(o.responses[w] === 'accept', 'That player hasn’t accepted.');
  const me = s.players[seat], them = s.players[w];
  need(hasRes(me.res, o.give), 'You no longer have the cards you offered.');
  need(hasRes(them.res, o.want), 'They no longer have those cards.');
  transfer(me.res, them.res, o.give);
  transfer(them.res, me.res, o.want);
  log(s, { p: seat, o: w, m: `traded ${resText(o.give)} to {o} for ${resText(o.want)}`, k: 'trade' });
  clearTrades(s);
};

H.cancelOffer = (s, seat) => {
  need(s.current === seat, 'That isn’t your offer.');
  s.offer = null;
};

H.counterOffer = (s, seat, a) => {
  need(s.phase === 'main' && seat !== s.current, 'You can propose a trade to the player whose turn it is.');
  const give = cleanRes(a.give), want = cleanRes(a.want);
  checkOffer(give, want);
  need(hasRes(s.players[seat].res, give), 'You don’t have the cards you’re offering.');
  s.counters[seat] = { id: s.nextId++, give, want };
  log(s, { p: seat, o: s.current, m: `offered {o} ${resText(give)} for ${resText(want)}`, k: 'trade' });
};

H.acceptCounter = (s, seat, a) => {
  need(s.phase === 'main' && s.current === seat, 'Only the player whose turn it is can accept.');
  const from = Number(a.from);
  const c = s.counters[from];
  need(c && c.id === Number(a.id), 'That offer was withdrawn.');
  const me = s.players[seat], them = s.players[from];
  need(hasRes(them.res, c.give), 'They no longer have those cards.');
  need(hasRes(me.res, c.want), 'You don’t have the cards they want.');
  transfer(them.res, me.res, c.give);
  transfer(me.res, them.res, c.want);
  log(s, { p: seat, o: from, m: `traded ${resText(c.want)} to {o} for ${resText(c.give)}`, k: 'trade' });
  clearTrades(s);
};

H.rejectCounter = (s, seat, a) => {
  need(s.current === seat, 'Only the player whose turn it is can decline.');
  delete s.counters[Number(a.from)];
};

H.withdrawCounter = (s, seat) => {
  delete s.counters[seat];
};

H.endTurn = (s, seat) => {
  need(s.current === seat, 'It’s not your turn.');
  need(s.phase === 'main', s.phase === 'roll' ? 'Roll the dice before ending your turn.' : 'Finish what you’re doing first.');
  clearTrades(s);
  if (s.settings.expansion && s.settings.specialBuild) {
    const n = s.players.length;
    const queue = [];
    for (let i = 1; i < n; i++) queue.push((seat + i) % n);
    s.special = { queue, idx: 0 };
    s.phase = 'special';
    s.offer = null;
    settleSpecial(s);
  } else {
    nextTurn(s);
  }
};

H.passSpecial = (s, seat) => {
  need(s.phase === 'special' && specialSeat(s) === seat, 'It isn’t your special build.');
  s.special.idx += 1;
  settleSpecial(s);
};

export const ACTIONS = Object.keys(H);

/** Apply an action for a seat. Returns a new state; throws GameError if not allowed. */
export function applyAction(prev, seat, action, rng = Math.random) {
  need(action && typeof action.type === 'string' && H[action.type], 'Unknown action.');
  need(prev.phase !== 'over', 'The game is over.');
  need(Number.isInteger(seat) && seat >= 0 && seat < prev.players.length, 'You aren’t seated in this game.');
  const s = JSON.parse(JSON.stringify(prev));
  H[action.type](s, seat, action, rng);
  s.seq = (s.seq || 0) + 1;
  checkWin(s);
  return s;
}

/** Light validation without mutating: returns an error message or null. */
export function tryAction(state, seat, action) {
  try { applyAction(state, seat, action, () => 0.5); return null; } catch (e) { return e.message; }
}
