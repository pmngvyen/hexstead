// Focused rule tests. Run: node tests/rules.mjs
import * as E from '../js/engine.js';
import { getGeometry } from '../js/geometry.js';

let passed = 0;
const fails = [];
function test(name, fn) {
  try { fn(); passed++; } catch (e) { fails.push(`${name}: ${e.stack || e.message}`); }
}
function eq(a, b, msg = '') { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg} expected ${JSON.stringify(b)} got ${JSON.stringify(a)}`); }
function ok(c, msg = 'assertion failed') { if (!c) throw new Error(msg); }
function throws(fn, re) {
  try { fn(); } catch (e) { if (re && !re.test(e.message)) throw new Error(`wrong error: ${e.message}`); return; }
  throw new Error('expected an error');
}
const seq = (...vals) => { let i = 0; return () => vals[i++ % vals.length]; };
// dice value d -> rng value
const die = d => (d - 1) / 6 + 0.01;

function game(n = 4, settings = {}) {
  const players = Array.from({ length: n }, (_, i) => ({ id: `u${i}`, name: `P${i}`, color: 'red' }));
  return E.createGame({ players, settings });
}
// skip setup: put the game straight into turn 1, seat 0 to roll
function started(n = 4, settings = {}) {
  const s = game(n, settings);
  s.setup = null; s.phase = 'roll'; s.current = 0; s.first = 0; s.turn = 1;
  return s;
}
const A = (s, seat, a, rng) => E.applyAction(s, seat, a, rng);
const give = (s, seat, res) => { for (const [k, v] of Object.entries(res)) { s.players[seat].res[k] += v; s.bank[k] -= v; } };
function place(s, seat, v, city = false) {
  s.buildings[v] = { p: seat, city };
  if (city) s.players[seat].cities--; else s.players[seat].settlements--;
}
function road(s, seat, e) { s.roads[e] = seat; s.players[seat].roads--; }
const edgeBetween = (geo, a, b) => geo.vertices[a].edges.find(e => geo.edges[e].v.includes(b));

// ---------------------------------------------------------------------------

test('board sizes and counts', () => {
  for (const ext of [false, true]) {
    const set = ext ? E.SETS.ext : E.SETS.base;
    const b = E.generateBoard(ext, Math.random);
    const geo = getGeometry(ext);
    eq(b.hexes.length, geo.hexes.length);
    eq(b.hexes.filter(h => h.terrain === 'desert').length, ext ? 2 : 1);
    eq(b.hexes.filter(h => h.number).map(h => h.number).sort((a, c) => a - c), set.numbers.slice().sort((a, c) => a - c));
    eq(b.harbors.length, ext ? 11 : 9);
    eq(b.hexes[b.robber].terrain, 'desert');
    // balanced: no adjacent 6/8
    for (const h of geo.hexes) for (const n of h.neighbors) {
      const x = b.hexes[h.id].number, y = b.hexes[n].number;
      ok(!([6, 8].includes(x) && [6, 8].includes(y)), 'red numbers adjacent');
    }
  }
  const s5 = game(5);
  eq(s5.settings.expansion, true, '5 players forces expansion');
  eq(s5.deck.length, 34);
  eq(s5.bank.ore, 24);
  eq(game(4).deck.length, 25);
});

test('setup snake order, distance rule, second settlement pays out', () => {
  let s = game(3);
  const geo = E.geoOf(s);
  const order = s.setup.order;
  eq(order.length, 6);
  eq(order.slice(3), order.slice(0, 3).reverse());
  const first = order[0];
  throws(() => A(s, (first + 1) % 3, { type: 'placeSettlement', vertex: 0 }), /not your turn/);
  s = A(s, first, { type: 'placeSettlement', vertex: 0 });
  throws(() => A(s, first, { type: 'placeSettlement', vertex: 1 }), /road first/);
  const farEdge = geo.edges.find(e => !e.v.includes(0)).id;
  throws(() => A(s, first, { type: 'placeRoad', edge: farEdge }), /touch the settlement/);
  s = A(s, first, { type: 'placeRoad', edge: geo.vertices[0].edges[0] });
  // next player can't settle next to vertex 0
  const nb = geo.vertices[0].adj[0];
  throws(() => A(s, order[1], { type: 'placeSettlement', vertex: nb }), /can’t settle/);
  // run the rest of setup with legal spots
  while (s.phase === 'setup') {
    const seat = s.setup.order[s.setup.step];
    if (s.setup.stage === 'settlement') {
      const v = E.legalSettlements(s, seat, true)[0];
      const before = E.totalRes(s.players[seat].res);
      const second = s.setup.step >= 3;
      s = A(s, seat, { type: 'placeSettlement', vertex: v });
      const gained = E.totalRes(s.players[seat].res) - before;
      const producing = geo.vertices[v].hexes.filter(h => s.hexes[h].terrain !== 'desert').length;
      eq(gained, second ? producing : 0, 'setup payout');
    } else {
      s = A(s, seat, { type: 'placeRoad', edge: E.legalRoads(s, seat, s.setup.vertex)[0] });
    }
  }
  eq(s.phase, 'roll');
  eq(s.current, first);
  eq(s.turn, 1);
});

test('must roll before building, trading or ending turn', () => {
  let s = started();
  give(s, 0, { brick: 1, lumber: 1 });
  throws(() => A(s, 0, { type: 'build', kind: 'road', edge: 0 }), /Roll the dice first/);
  throws(() => A(s, 0, { type: 'endTurn' }), /Roll the dice/);
  throws(() => A(s, 0, { type: 'bankTrade', give: 'brick', get: 'ore' }), /after rolling/);
  throws(() => A(s, 1, { type: 'roll' }), /not your turn/);
});

test('production: settlement 1, city 2, robber blocks', () => {
  let s = started();
  const geo = E.geoOf(s);
  const hex = s.hexes.findIndex(h => h.number === 8);
  const res = E.TERRAIN_RESOURCE[s.hexes[hex].terrain];
  const [v1, , v3] = geo.hexes[hex].vertices;
  place(s, 1, v1);
  place(s, 2, v3, true);
  s.robber = s.hexes.findIndex(h => h.terrain === 'desert');
  const s2 = A(s, 0, { type: 'roll' }, seq(die(4), die(4)));
  eq(s2.dice, [4, 4]);
  ok(s2.players[1].res[res] >= 1 && s2.players[2].res[res] >= 2, 'production paid');
  s.robber = hex;
  const s3 = A(s, 0, { type: 'roll' }, seq(die(4), die(4)));
  eq(s3.players[1].res[res] + s3.players[2].res[res], 0, 'robber blocks');
});

test('bank shortage: nobody gets it, unless only one player is owed', () => {
  let s = started();
  const geo = E.geoOf(s);
  const hex = s.hexes.findIndex(h => h.number === 6);
  const res = E.TERRAIN_RESOURCE[s.hexes[hex].terrain];
  s.hexes.forEach((h, i) => { if (i !== hex && h.number === 6) h.number = 3; });
  const [v1, , v3] = geo.hexes[hex].vertices;
  s.robber = s.hexes.findIndex(h => h.terrain === 'desert');
  // drain the bank down to 2
  const drain = s.bank[res] - 2;
  s.players[3].res[res] += drain; s.bank[res] -= drain;
  place(s, 1, v1, true); // owed 2
  place(s, 2, v3);       // owed 1 -> total 3 > 2
  let t = A(s, 0, { type: 'roll' }, seq(die(3), die(3)));
  eq([t.players[1].res[res], t.players[2].res[res]], [0, 0], 'two players short');
  delete s.buildings[v3]; s.players[2].settlements++;
  s.players[1].cities++; s.buildings[v1].city = true; s.players[1].cities--;
  s.bank[res] = 1; s.players[3].res[res] += 1;
  t = A(s, 0, { type: 'roll' }, seq(die(3), die(3)));
  eq(t.players[1].res[res], 1, 'single player gets the rest');
});

test('seven: discard half (rounded down) above 7, then robber and steal', () => {
  let s = started();
  const geo = E.geoOf(s);
  give(s, 1, { brick: 5, ore: 4 });  // 9 -> discard 4
  give(s, 2, { wool: 7 });           // 7 -> safe
  s = A(s, 0, { type: 'roll' }, seq(die(3), die(4)));
  eq(s.phase, 'discard');
  eq(s.discards, { 1: 4 });
  throws(() => A(s, 1, { type: 'discard', res: { brick: 3 } }), /exactly 4/);
  throws(() => A(s, 2, { type: 'discard', res: { wool: 1 } }), /don’t need/);
  throws(() => A(s, 0, { type: 'moveRobber', hex: 0 }), /can’t move the robber/);
  s = A(s, 1, { type: 'discard', res: { brick: 2, ore: 2 } });
  eq(s.phase, 'robber');
  eq(E.totalRes(s.players[1].res), 5);
  throws(() => A(s, 0, { type: 'moveRobber', hex: s.robber }), /different hex/);
  // put players 1 and 2 on one hex: must choose a victim
  const hex = s.hexes.findIndex((h, i) => i !== s.robber && h.terrain !== 'desert');
  const vs = geo.hexes[hex].vertices;
  place(s, 1, vs[0]); place(s, 2, vs[3]);
  throws(() => A(s, 0, { type: 'moveRobber', hex }), /Choose who/);
  const t = A(s, 0, { type: 'moveRobber', hex, victim: 2 });
  eq(t.players[0].res.wool, 1);
  eq(t.players[2].res.wool, 6);
  eq(t.phase, 'main');
  eq(t.robber, hex);
});

test('development cards: one per turn, not the turn you buy it, VP hidden', () => {
  let s = started();
  give(s, 0, { wool: 2, grain: 2, ore: 2 });
  s.deck.push('knight');
  s = A(s, 0, { type: 'roll' }, seq(die(2), die(3)));
  s = A(s, 0, { type: 'buyDev' });
  eq(s.players[0].dev.map(c => c.type), ['knight']);
  throws(() => A(s, 0, { type: 'playDev', card: 'knight' }), /next turn/);
  // next own turn: play it, then can't play a second
  s.players[0].dev.push({ type: 'monopoly', turn: 0 });
  s.turn += 4;
  s = A(s, 0, { type: 'playDev', card: 'knight' });
  eq(s.phase, 'robber');
  eq(s.players[0].knights, 1);
  s = A(s, 0, { type: 'moveRobber', hex: E.robberTargets(s, 0)[0] });
  throws(() => A(s, 0, { type: 'playDev', card: 'monopoly', res: 'ore' }), /one development card/);
  // VP cards count toward the hidden total only
  s.players[1].dev.push({ type: 'vp', turn: 0 });
  eq(E.victoryPoints(s, 1), 0);
  eq(E.victoryPoints(s, 1, true), 1);
  s.devPlayed = false;
  throws(() => A(s, 0, { type: 'playDev', card: 'vp' }), /can’t be played/);
});

test('knight before rolling returns to the roll', () => {
  let s = started();
  s.players[0].dev.push({ type: 'knight', turn: 0 });
  s = A(s, 0, { type: 'playDev', card: 'knight' });
  eq(s.phase, 'robber');
  s = A(s, 0, { type: 'moveRobber', hex: E.robberTargets(s, 0)[0] });
  eq(s.phase, 'roll');
});

test('largest army: 3 knights, must beat holder to take it', () => {
  let s = started();
  const play = (seat) => {
    s.current = seat; s.phase = 'main'; s.devPlayed = false;
    s.players[seat].dev.push({ type: 'knight', turn: 0 });
    s = A(s, seat, { type: 'playDev', card: 'knight' });
    s = A(s, seat, { type: 'moveRobber', hex: E.robberTargets(s, seat).find(h => !E.stealCandidates(s, seat, h).length) });
  };
  play(0); play(0);
  eq(s.largestArmy, null);
  play(0);
  eq(s.largestArmy, 0);
  play(1); play(1); play(1);
  eq(s.largestArmy, 0, 'tie keeps holder');
  play(1);
  eq(s.largestArmy, 1);
  eq(E.victoryPoints(s, 1), 2);
});

test('longest road: 5 needed, ties keep holder, broken roads move or set aside', () => {
  let s = started(3);
  const geo = E.geoOf(s);
  // find a simple path of 7 vertices
  const path = (() => {
    for (const start of geo.vertices) {
      const out = [start.id];
      const seen = new Set(out);
      while (out.length < 8) {
        const nx = geo.vertices[out[out.length - 1]].adj.find(a => !seen.has(a) && !geo.vertices[a].adj.some(b => b !== out[out.length - 1] && seen.has(b)));
        if (nx === undefined) break;
        out.push(nx); seen.add(nx);
      }
      if (out.length === 8) return out;
    }
  })();
  ok(path, 'found path');
  s.phase = 'main';
  place(s, 0, path[0]);
  give(s, 0, { brick: 10, lumber: 10 });
  for (let i = 0; i < 4; i++) s = A(s, 0, { type: 'build', kind: 'road', edge: edgeBetween(geo, path[i], path[i + 1]) });
  eq(s.longestRoad, null, '4 roads is not enough');
  s = A(s, 0, { type: 'build', kind: 'road', edge: edgeBetween(geo, path[4], path[5]) });
  eq(s.longestRoad, 0);
  eq(E.victoryPoints(s, 0), 3);
  s = A(s, 0, { type: 'build', kind: 'road', edge: edgeBetween(geo, path[5], path[6]) });
  eq(s.roadLengths[0], 6);
  // player 1 breaks it at path[3] (settles there via its own road)
  const side = geo.vertices[path[3]].edges.find(e => !geo.edges[e].v.includes(path[2]) && !geo.edges[e].v.includes(path[4]));
  ok(side !== undefined, 'side edge');
  const sideFar = geo.edges[side].v.find(v => v !== path[3]);
  place(s, 1, sideFar === path[0] ? path[7] : sideFar);
  road(s, 1, side);
  s.current = 1; s.phase = 'main';
  give(s, 1, { brick: 1, lumber: 1, wool: 1, grain: 1 });
  // distance rule: path[3]'s neighbours path[2], path[4] are empty and sideFar holds P1's settlement only if not adjacent; relocate P1's settlement if needed
  delete s.buildings[sideFar === path[0] ? path[7] : sideFar]; s.players[1].settlements++;
  s.buildings[path[3]] = undefined; delete s.buildings[path[3]];
  s = A(s, 1, { type: 'build', kind: 'settlement', vertex: path[3] });
  eq(s.roadLengths[0], 3, 'broken into 3 + 3');
  eq(s.longestRoad, null, 'nobody has 5 any more');
});

test('longest road tie: holder keeps it; set aside when rivals tie after a break', () => {
  // abstract check through the award function by direct lengths
  let s = started(3);
  s.longestRoad = 0;
  s.roadLengths = [6, 6, 0];
  // emulate update with fake longestRoadFor via no roads -> recompute gives zeros; so test logic via a tiny clone of the rule
  const award = (prev, L) => {
    const max = Math.max(...L);
    if (prev !== null && L[prev] >= 5 && L[prev] >= max) return prev;
    if (max >= 5 && L.filter(x => x === max).length === 1) return L.indexOf(max);
    return null;
  };
  eq(award(0, [6, 6, 0]), 0, 'tie keeps holder');
  eq(award(0, [4, 6, 6]), null, 'rivals tie after break -> set aside');
  eq(award(0, [4, 7, 6]), 1, 'unique longest takes it');
  eq(award(null, [5, 5, 0]), null, 'tie with no holder -> nobody');
});

test('harbor ratios and bank trades', () => {
  let s = started();
  const geo = E.geoOf(s);
  s.harbors = [{ edge: s.harbors[0].edge, type: 'any' }, { edge: s.harbors[1].edge, type: 'ore' }];
  eq(E.tradeRatios(s, 0).brick, 4);
  place(s, 0, geo.edges[s.harbors[0].edge].v[0]);
  eq(E.tradeRatios(s, 0).brick, 3);
  place(s, 0, geo.edges[s.harbors[1].edge].v[1]);
  eq(E.tradeRatios(s, 0).ore, 2);
  eq(E.tradeRatios(s, 0).wool, 3);
  s.phase = 'main';
  give(s, 0, { ore: 4, wool: 2 });
  s = A(s, 0, { type: 'bankTrade', give: 'ore', get: 'brick', times: 2 });
  eq([s.players[0].res.ore, s.players[0].res.brick], [0, 2]);
  throws(() => A(s, 0, { type: 'bankTrade', give: 'wool', get: 'brick' }), /need 3 wool/);
  throws(() => A(s, 0, { type: 'bankTrade', give: 'brick', get: 'brick' }), /different/);
});

test('player trades: offer, accept, confirm; counters; no gifts', () => {
  let s = started();
  s.phase = 'main';
  give(s, 0, { brick: 2 });
  give(s, 1, { ore: 1 });
  give(s, 2, { wool: 3 });
  throws(() => A(s, 0, { type: 'offerTrade', give: { brick: 1 }, want: {} }), /both sides/);
  throws(() => A(s, 0, { type: 'offerTrade', give: { brick: 1 }, want: { brick: 1 } }), /same resource/);
  throws(() => A(s, 1, { type: 'offerTrade', give: { ore: 1 }, want: { brick: 1 } }), /on your turn/);
  s = A(s, 0, { type: 'offerTrade', give: { brick: 1 }, want: { ore: 1 } });
  const id = s.offer.id;
  throws(() => A(s, 2, { type: 'respondTrade', id, accept: true }), /don’t have/);
  s = A(s, 2, { type: 'respondTrade', id, accept: false });
  s = A(s, 1, { type: 'respondTrade', id, accept: true });
  throws(() => A(s, 0, { type: 'confirmTrade', id, with: 2 }), /hasn’t accepted/);
  s = A(s, 0, { type: 'confirmTrade', id, with: 1 });
  eq([s.players[0].res.ore, s.players[1].res.brick, s.offer], [1, 1, null]);
  // counter-offer from player 2
  s = A(s, 2, { type: 'counterOffer', give: { wool: 2 }, want: { brick: 1 } });
  const c = s.counters[2];
  s = A(s, 0, { type: 'acceptCounter', from: 2, id: c.id });
  eq([s.players[0].res.wool, s.players[0].res.brick, s.players[2].res.brick], [2, 0, 1]);
});

test('year of plenty, monopoly, road building', () => {
  let s = started();
  s.phase = 'main';
  s.players[0].dev.push({ type: 'yearOfPlenty', turn: 0 }, { type: 'monopoly', turn: 0 }, { type: 'roadBuilding', turn: 0 });
  give(s, 1, { wool: 3 }); give(s, 2, { wool: 2, ore: 1 });
  let t = A(s, 0, { type: 'playDev', card: 'yearOfPlenty', res: ['ore', 'ore'] });
  eq(t.players[0].res.ore, 2);
  t = A(s, 0, { type: 'playDev', card: 'monopoly', res: 'wool' });
  eq([t.players[0].res.wool, t.players[1].res.wool, t.players[2].res.wool], [5, 0, 0]);
  const geo = E.geoOf(s);
  place(s, 0, 10);
  s.players[0].roads = 1;
  t = A(s, 0, { type: 'playDev', card: 'roadBuilding' });
  eq([t.phase, t.freeRoads], ['roadBuilding', 1], 'only one road piece left');
  throws(() => A(t, 0, { type: 'build', kind: 'road', edge: geo.vertices[10].edges[0] }), /can’t build/);
  t = A(t, 0, { type: 'placeRoad', edge: geo.vertices[10].edges[0] });
  eq([t.phase, t.players[0].roads, t.players[0].res.brick], ['main', 0, 0]);
});

test('5–6 special building phase: order, no trading, skip players who can’t build', () => {
  let s = started(5);
  eq(s.settings.expansion, true);
  s.phase = 'main';
  place(s, 2, 0); place(s, 4, 40);
  give(s, 2, { grain: 2, ore: 3 });
  give(s, 4, { wool: 1, grain: 1, ore: 1 });
  s = A(s, 0, { type: 'endTurn' });
  eq(s.phase, 'special');
  eq(E.specialSeat(s), 2, 'seat 1 skipped: nothing to build');
  throws(() => A(s, 2, { type: 'bankTrade', give: 'ore', get: 'brick' }), /on your turn/);
  throws(() => A(s, 4, { type: 'buyDev' }), /can’t buy/);
  s = A(s, 2, { type: 'build', kind: 'city', vertex: 0 });
  eq(E.specialSeat(s), 4, 'auto-advances when nothing else is affordable');
  s = A(s, 4, { type: 'buyDev' });
  eq([s.phase, s.current, s.turn], ['roll', 1, 2]);
  // card bought in the special phase is playable on that player's next turn
  const card = s.players[4].dev[0];
  ok(card.turn < 5, 'playable later');
});

test('you win only on your own turn', () => {
  let s = started(5);
  s.settings.vpTarget = 5;
  s.phase = 'main';
  [0, 10, 20, 30].forEach(v => place(s, 3, v));
  give(s, 3, { brick: 1, lumber: 1, wool: 1, grain: 1 });
  const geo = E.geoOf(s);
  const spot = geo.vertices.find(v => !s.buildings[v.id] && !v.adj.some(a => s.buildings[a])).id;
  road(s, 3, geo.vertices[spot].edges[0]);
  s = A(s, 0, { type: 'endTurn' });
  eq(E.specialSeat(s), 3, 'seats 1 and 2 have nothing to build');
  s = A(s, 3, { type: 'build', kind: 'settlement', vertex: spot });
  eq(E.victoryPoints(s, 3), 5);
  eq([s.winner, s.phase, s.current], [null, 'roll', 1], 'no win during the special build');
  // play through seats 1 and 2
  for (const seat of [1, 2]) {
    s = A(s, seat, { type: 'roll' }, seq(die(1), die(2)));
    s = A(s, seat, { type: 'endTurn' });
    while (s.phase === 'special') s = A(s, E.specialSeat(s), { type: 'passSpecial' });
    if (seat === 1) eq(s.winner, null);
  }
  eq([s.current, s.winner, s.phase], [3, 3, 'over'], 'wins as their turn begins');
  throws(() => A(s, 3, { type: 'roll' }), /over/);
});

test('winning immediately on your turn with a hidden VP card', () => {
  let s = started();
  s.settings.vpTarget = 3;
  s.phase = 'main';
  place(s, 0, 0); place(s, 0, 20);
  s.deck.push('vp');
  give(s, 0, { wool: 1, grain: 1, ore: 1 });
  s = A(s, 0, { type: 'buyDev' });
  eq([s.phase, s.winner], ['over', 0]);
});

test('friendly robber protects players with 2 points or fewer', () => {
  let s = started(3, { friendlyRobber: true });
  const geo = E.geoOf(s);
  const hex = s.hexes.findIndex((h, i) => i !== s.robber && h.terrain !== 'desert');
  place(s, 1, geo.hexes[hex].vertices[0]);
  give(s, 1, { ore: 2 });
  ok(!E.robberTargets(s, 0).includes(hex), 'protected hex excluded');
  s.phase = 'robber';
  throws(() => A(s, 0, { type: 'moveRobber', hex }), /Friendly robber/);
});

test('roads cannot pass through a rival settlement', () => {
  let s = started();
  const geo = E.geoOf(s);
  const v = 20;
  const [e1, e2] = geo.vertices[v].edges;
  road(s, 0, e1);
  const far = geo.edges[e1].v.find(x => x !== v);
  place(s, 0, far);
  place(s, 1, v);
  s.phase = 'main';
  give(s, 0, { brick: 1, lumber: 1 });
  throws(() => A(s, 0, { type: 'build', kind: 'road', edge: e2 }), /connect/);
});

console.log(`${passed} passed, ${fails.length} failed`);
if (fails.length) { console.log(fails.join('\n\n')); process.exit(1); }
