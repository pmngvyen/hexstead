// Heuristic computer players. botAction(state, seat) returns the next action
// for that seat, or null when the bot is waiting on someone else.

import * as E from './engine.js';

const { RESOURCES, COSTS, PIPS, TERRAIN_RESOURCE } = E;
const WEIGHT = { brick: 1.05, lumber: 1.05, wool: 0.85, grain: 1.0, ore: 1.0 };

function production(s, seat) {
  const geo = E.geoOf(s);
  const out = E.emptyRes();
  for (const [v, b] of Object.entries(s.buildings)) {
    if (b.p !== seat) continue;
    for (const h of geo.vertices[v].hexes) {
      const r = TERRAIN_RESOURCE[s.hexes[h].terrain];
      if (r) out[r] += (PIPS[s.hexes[h].number] || 0) * (b.city ? 2 : 1);
    }
  }
  return out;
}

function vertexValue(s, seat, v, prod = production(s, seat)) {
  const geo = E.geoOf(s);
  let score = 0;
  const kinds = new Set();
  for (const h of geo.vertices[v].hexes) {
    const hx = s.hexes[h];
    const r = TERRAIN_RESOURCE[hx.terrain];
    if (!r) continue;
    let w = WEIGHT[r];
    if (prod[r] === 0) w *= 1.35;
    score += (PIPS[hx.number] || 0) * w * (s.robber === h ? 0.6 : 1);
    kinds.add(r);
  }
  score += kinds.size * 0.9;
  for (const hb of s.harbors) {
    if (!geo.edges[hb.edge].v.includes(v)) continue;
    if (hb.type === 'any') score += 1.2;
    else score += (prod[hb.type] + (kinds.has(hb.type) ? 4 : 0)) >= 5 ? 2.2 : 0.5;
  }
  return score;
}

function settleOk(s, v) {
  const geo = E.geoOf(s);
  return !s.buildings[v] && !geo.vertices[v].adj.some(a => s.buildings[a]);
}

/** First road of the best short path toward a future settlement spot. */
export function roadTarget(s, seat) {
  const geo = E.geoOf(s);
  const prod = production(s, seat);
  const blocked = v => s.buildings[v] && s.buildings[v].p !== seat;
  // frontier: vertices on my network
  const start = new Set();
  for (const [e, p] of Object.entries(s.roads)) if (p === seat) geo.edges[e].v.forEach(v => { if (!blocked(v)) start.add(v); });
  for (const [v, b] of Object.entries(s.buildings)) if (b.p === seat) start.add(Number(v));
  const dist = new Map();
  const firstEdge = new Map();
  const queue = [];
  start.forEach(v => { dist.set(v, 0); queue.push(v); });
  let best = null;
  while (queue.length) {
    const v = queue.shift();
    const d = dist.get(v);
    if (d > 0 && settleOk(s, v)) {
      const score = vertexValue(s, seat, v, prod) / (1 + 0.7 * d);
      if (!best || score > best.score) best = { score, edge: firstEdge.get(v), vertex: v, d };
    }
    if (d >= 3 || (d > 0 && blocked(v))) continue;
    for (const e of geo.vertices[v].edges) {
      if (s.roads[e] !== undefined) continue;
      const [a, b] = geo.edges[e].v;
      const w = a === v ? b : a;
      if (dist.has(w)) continue;
      dist.set(w, d + 1);
      firstEdge.set(w, d === 0 ? e : firstEdge.get(v));
      queue.push(w);
    }
  }
  if (best && E.canPlaceRoad(s, seat, best.edge)) return best;
  return null;
}

function missing(res, cost) {
  const m = E.emptyRes();
  RESOURCES.forEach(k => (m[k] = Math.max(0, (cost[k] || 0) - (res[k] || 0))));
  return m;
}

function goal(s, seat) {
  const p = s.players[seat];
  const cands = [];
  const spots = p.settlements > 0 ? E.legalSettlements(s, seat) : [];
  if (p.cities > 0 && E.legalCities(s, seat).length) cands.push({ kind: 'city', cost: COSTS.city, pri: 0 });
  if (spots.length) cands.push({ kind: 'settlement', cost: COSTS.settlement, pri: 0.3 });
  else if (p.settlements > 0 && p.roads > 0 && roadTarget(s, seat)) cands.push({ kind: 'road', cost: COSTS.road, pri: 0.6 });
  if (s.deck.length) cands.push({ kind: 'dev', cost: COSTS.dev, pri: 1.6 });
  if (!cands.length) return null;
  cands.forEach(c => (c.miss = E.totalRes(missing(p.res, c.cost)) + c.pri));
  cands.sort((a, b) => a.miss - b.miss);
  return cands[0];
}

function surplus(s, seat, g) {
  const p = s.players[seat];
  const keep = g ? g.cost : {};
  const out = E.emptyRes();
  RESOURCES.forEach(k => (out[k] = Math.max(0, p.res[k] - (keep[k] || 0))));
  return out;
}

function cardValue(s, seat, g, r) {
  const p = s.players[seat];
  const need = g ? Math.max(0, (g.cost[r] || 0) - p.res[r]) : 0;
  const prod = production(s, seat);
  return 1 + (need > 0 ? 1.6 : 0) + (prod[r] === 0 ? 0.4 : 0) - (p.res[r] >= 4 ? 0.5 : 0);
}

function tradeGain(s, seat, receive, give) {
  const g = goal(s, seat);
  let v = 0;
  RESOURCES.forEach(r => { v += (receive[r] || 0) * cardValue(s, seat, g, r) - (give[r] || 0) * cardValue(s, seat, g, r); });
  return v;
}

function bestRobberMove(s, seat) {
  const geo = E.geoOf(s);
  const targets = E.robberTargets(s, seat);
  const vps = s.players.map((_, i) => E.victoryPoints(s, i));
  const lead = Math.max(...vps.filter((_, i) => i !== seat), 0);
  let best = null;
  for (const h of targets) {
    const hx = s.hexes[h];
    let score = 0;
    let mine = false;
    for (const v of geo.hexes[h].vertices) {
      const b = s.buildings[v];
      if (!b) continue;
      if (b.p === seat) { mine = true; continue; }
      const w = (b.city ? 2 : 1) * (1 + (vps[b.p] === lead ? 0.5 : 0));
      score += (PIPS[hx.number] || 0) * w;
    }
    if (mine) score -= 20;
    const cands = E.stealCandidates(s, seat, h);
    if (cands.length) score += 1.5;
    score += Math.random() * 0.2;
    if (!best || score > best.score) best = { score, hex: h, cands };
  }
  let victim = null;
  if (best.cands.length) {
    victim = best.cands.slice().sort((a, b) => (vps[b] - vps[a]) || (E.totalRes(s.players[b].res) - E.totalRes(s.players[a].res)))[0];
  }
  return { type: 'moveRobber', hex: best.hex, victim };
}

function robberHurtsMe(s, seat) {
  const geo = E.geoOf(s);
  const hx = s.hexes[s.robber];
  if (!hx.number) return false;
  return geo.hexes[s.robber].vertices.some(v => s.buildings[v] && s.buildings[v].p === seat) && (PIPS[hx.number] || 0) >= 3;
}

function chooseDiscard(s, seat, n) {
  const p = s.players[seat];
  const g = goal(s, seat);
  const hand = { ...p.res };
  const out = E.emptyRes();
  for (let i = 0; i < n; i++) {
    let pick = null, bestScore = -Infinity;
    for (const r of RESOURCES) {
      if (hand[r] <= 0) continue;
      const keep = g ? g.cost[r] || 0 : 0;
      const score = hand[r] - keep * 1.5 + Math.random() * 0.1;
      if (score > bestScore) { bestScore = score; pick = r; }
    }
    hand[pick] -= 1;
    out[pick] += 1;
  }
  return { type: 'discard', res: out };
}

function bestSettlement(s, seat, setup = false) {
  const prod = production(s, seat);
  const spots = E.legalSettlements(s, seat, setup);
  let best = null;
  for (const v of spots) {
    const score = vertexValue(s, seat, v, prod) + Math.random() * 0.3;
    if (!best || score > best.score) best = { v, score };
  }
  return best && best.v;
}

function bestCity(s, seat) {
  const geo = E.geoOf(s);
  let best = null;
  for (const v of E.legalCities(s, seat)) {
    const score = geo.vertices[v].hexes.reduce((n, h) => n + (PIPS[s.hexes[h].number] || 0), 0);
    if (!best || score > best.score) best = { v, score };
  }
  return best && best.v;
}

function setupRoad(s, seat) {
  const geo = E.geoOf(s);
  const from = s.setup.vertex;
  const prod = production(s, seat);
  let best = null;
  for (const e of E.legalRoads(s, seat, from)) {
    const [a, b] = geo.edges[e].v;
    const far = a === from ? b : a;
    let score = 0;
    for (const w of geo.vertices[far].adj) {
      if (w !== from && settleOk(s, w)) score = Math.max(score, vertexValue(s, seat, w, prod));
    }
    score += Math.random() * 0.2;
    if (!best || score > best.score) best = { e, score };
  }
  return best.e;
}

function pickPlay(s, seat, g) {
  if (s.devPlayed) return null;
  const p = s.players[seat];
  const playable = E.playableDev(s, seat);
  if (!playable.length) return null;
  if (playable.includes('knight')) {
    const holder = s.largestArmy;
    const army = p.knights + 1 >= 3 && holder !== seat && (holder === null || p.knights + 1 > s.players[holder].knights);
    if (robberHurtsMe(s, seat) || army || Math.random() < 0.25) return { type: 'playDev', card: 'knight' };
  }
  if (s.phase !== 'main') return null;
  if (playable.includes('monopoly')) {
    let best = null;
    for (const r of RESOURCES) {
      const n = s.players.reduce((t, o, i) => t + (i === seat ? 0 : o.res[r]), 0);
      if (!best || n > best.n) best = { r, n };
    }
    if (best.n >= 4) return { type: 'playDev', card: 'monopoly', res: best.r };
  }
  if (playable.includes('yearOfPlenty') && g) {
    const m = missing(p.res, g.cost);
    const want = RESOURCES.flatMap(k => Array(m[k]).fill(k));
    if (want.length && want.length <= 2) {
      while (want.length < 2) want.push(g.kind === 'city' ? 'ore' : 'grain');
      const tally = E.emptyRes();
      want.forEach(r => tally[r]++);
      if (RESOURCES.every(k => s.bank[k] >= tally[k])) return { type: 'playDev', card: 'yearOfPlenty', res: want };
    }
  }
  if (playable.includes('roadBuilding') && p.roads > 0 && roadTarget(s, seat)) return { type: 'playDev', card: 'roadBuilding' };
  return null;
}

function buildStep(s, seat, g, special) {
  const p = s.players[seat];
  if (E.hasRes(p.res, COSTS.city) && p.cities > 0) {
    const v = bestCity(s, seat);
    if (v !== null && v !== undefined) return { type: 'build', kind: 'city', vertex: v };
  }
  if (E.hasRes(p.res, COSTS.settlement) && p.settlements > 0) {
    const v = bestSettlement(s, seat);
    if (v !== null && v !== undefined) return { type: 'build', kind: 'settlement', vertex: v };
  }
  if (E.hasRes(p.res, COSTS.road) && p.roads > 0 && g && g.kind === 'road') {
    const t = roadTarget(s, seat);
    if (t) return { type: 'build', kind: 'road', edge: t.edge };
  }
  if (E.hasRes(p.res, COSTS.dev) && s.deck.length) {
    if ((g && g.kind === 'dev') || E.totalRes(p.res) >= 8) return { type: 'buyDev' };
  }
  // dump extra brick+lumber into roads when holding too many cards
  if (E.totalRes(p.res) >= 9 && E.hasRes(p.res, COSTS.road) && p.roads > 0) {
    const t = roadTarget(s, seat);
    const e = t ? t.edge : E.legalRoads(s, seat)[0];
    if (e !== undefined) return { type: 'build', kind: 'road', edge: e };
  }
  return null;
}

function bankStep(s, seat, g) {
  if (!g) return null;
  const p = s.players[seat];
  const m = missing(p.res, g.cost);
  const want = RESOURCES.filter(k => m[k] > 0 && s.bank[k] > 0);
  if (!want.length) return null;
  const ratios = E.tradeRatios(s, seat);
  const sur = surplus(s, seat, g);
  const gives = RESOURCES.filter(k => sur[k] >= ratios[k]).sort((a, b) => (sur[b] - ratios[b]) - (sur[a] - ratios[a]));
  if (!gives.length) return null;
  // only trade if it actually gets us to the goal soon
  const totalMissing = E.totalRes(m);
  if (totalMissing > 2 && E.totalRes(p.res) < 8) return null;
  return { type: 'bankTrade', give: gives[0], get: want[0] };
}

function offerStep(s, seat, g) {
  if (!g || s.offersThisTurn >= 1) return null;
  const p = s.players[seat];
  const m = missing(p.res, g.cost);
  const want = RESOURCES.filter(k => m[k] > 0);
  if (!want.length || E.totalRes(m) > 2) return null;
  const sur = surplus(s, seat, g);
  const give = RESOURCES.filter(k => sur[k] > 0 && !want.includes(k)).sort((a, b) => sur[b] - sur[a])[0];
  if (!give) return null;
  const others = s.players.some((o, i) => i !== seat && o.res[want[0]] > 0);
  if (!others) return null;
  return { type: 'offerTrade', give: { [give]: 1 }, want: { [want[0]]: 1 } };
}

function nearWin(s, seat) {
  return E.victoryPoints(s, seat) >= s.settings.vpTarget - 2;
}

/** Decide one action for a bot seat, or null to wait. opts.impatient forces resolution of open offers. */
export function botAction(s, seat, opts = {}) {
  const p = s.players[seat];
  if (!p || s.phase === 'over') return null;

  // discards can involve any seat
  if (s.phase === 'discard') {
    const n = s.discards[seat];
    return n ? chooseDiscard(s, seat, n) : null;
  }

  // reacting to other people's offers
  if (s.current !== seat && s.phase === 'main') {
    const o = s.offer;
    if (o && o.responses[seat] === undefined) {
      const ok = E.hasRes(p.res, o.want) && !nearWin(s, s.current) && tradeGain(s, seat, o.give, o.want) > 0.3;
      return { type: 'respondTrade', id: o.id, accept: ok };
    }
    return null;
  }

  if (s.phase === 'setup') {
    if (s.setup.order[s.setup.step] !== seat) return null;
    if (s.setup.stage === 'settlement') return { type: 'placeSettlement', vertex: bestSettlement(s, seat, true) };
    return { type: 'placeRoad', edge: setupRoad(s, seat) };
  }

  if (s.phase === 'special') {
    if (E.specialSeat(s) !== seat) return null;
    const g = goal(s, seat);
    return buildStep(s, seat, g, true) || { type: 'passSpecial' };
  }

  if (s.current !== seat) return null;

  if (s.phase === 'roll') {
    const play = robberHurtsMe(s, seat) ? pickPlay(s, seat, null) : null;
    if (play && play.card === 'knight') return play;
    return { type: 'roll' };
  }
  if (s.phase === 'robber') return bestRobberMove(s, seat);
  if (s.phase === 'roadBuilding') {
    const t = roadTarget(s, seat);
    const e = t ? t.edge : E.legalRoads(s, seat)[0];
    return e === undefined ? { type: 'finishRoads' } : { type: 'placeRoad', edge: e };
  }
  if (s.phase !== 'main') return null;

  // our own open offer
  if (s.offer) {
    const acc = Object.entries(s.offer.responses).filter(([, r]) => r === 'accept').map(([k]) => Number(k));
    const ready = acc.filter(w => E.hasRes(s.players[w].res, s.offer.want));
    if (ready.length && E.hasRes(p.res, s.offer.give)) {
      ready.sort((a, b) => E.victoryPoints(s, a) - E.victoryPoints(s, b));
      return { type: 'confirmTrade', id: s.offer.id, with: ready[0] };
    }
    const responded = Object.keys(s.offer.responses).length;
    if (responded >= s.players.length - 1 || opts.impatient) return { type: 'cancelOffer' };
    return null;
  }
  // counter-offers made to us
  for (const [from, c] of Object.entries(s.counters || {})) {
    const ok = E.hasRes(p.res, c.want) && E.hasRes(s.players[from].res, c.give) && tradeGain(s, seat, c.give, c.want) > 0.3;
    return ok ? { type: 'acceptCounter', from: Number(from), id: c.id } : { type: 'rejectCounter', from: Number(from) };
  }

  const g = goal(s, seat);
  return buildStep(s, seat, g, false)
    || pickPlay(s, seat, g)
    || bankStep(s, seat, g)
    || offerStep(s, seat, g)
    || { type: 'endTurn' };
}

/** Every bot seat that has something to do right now. */
export function botsToAct(s) {
  if (s.phase === 'over') return [];
  const seats = new Set(E.waitingOn(s));
  if (s.phase === 'main' && s.offer) s.players.forEach((_, i) => { if (i !== s.current && s.offer.responses[i] === undefined) seats.add(i); });
  return [...seats].filter(i => s.players[i] && s.players[i].bot);
}
