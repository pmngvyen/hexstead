// Bot-vs-bot simulation with invariant checks after every action.
// Run: node tests/sim.mjs [gamesPerConfig]
import * as E from '../js/engine.js';
import { botAction, botsToAct } from '../js/bot.js';

const GAMES = Number(process.argv[2] || 60);
const COLORS = ['red', 'blue', 'white', 'orange', 'green', 'purple'];

function invariants(s) {
  const set = E.setOf(s);
  const geo = E.geoOf(s);
  for (const r of E.RESOURCES) {
    const sum = s.bank[r] + s.players.reduce((n, p) => n + p.res[r], 0);
    if (sum !== set.bank) throw new Error(`resource ${r} not conserved: ${sum}`);
    if (s.bank[r] < 0) throw new Error(`bank negative ${r}`);
    s.players.forEach((p, i) => { if (p.res[r] < 0) throw new Error(`player ${i} negative ${r}`); });
  }
  const totalDev = Object.values(set.dev).reduce((a, b) => a + b, 0);
  const held = s.players.reduce((n, p) => n + p.dev.length, 0);
  const played = Object.values(s.stats.played).reduce((a, b) => a + b, 0);
  if (s.deck.length + held + played !== totalDev) throw new Error(`dev cards not conserved ${s.deck.length}+${held}+${played}`);
  const knights = s.players.reduce((n, p) => n + p.knights, 0);
  if (knights !== s.stats.played.knight) throw new Error('knight count mismatch');
  s.players.forEach((p, i) => {
    const b = Object.values(s.buildings).filter(x => x.p === i);
    const setl = b.filter(x => !x.city).length, cities = b.filter(x => x.city).length;
    const roads = Object.values(s.roads).filter(x => x === i).length;
    if (setl + p.settlements !== 5) throw new Error(`settlement pieces off for ${i}`);
    if (cities + p.cities !== 4) throw new Error(`city pieces off for ${i}`);
    if (roads + p.roads !== 15) throw new Error(`road pieces off for ${i}`);
  });
  for (const v of Object.keys(s.buildings).map(Number)) {
    if (geo.vertices[v].adj.some(a => s.buildings[a])) throw new Error(`distance rule broken at ${v}`);
  }
  if (s.longestRoad !== null) {
    const L = s.roadLengths;
    if (L[s.longestRoad] < 5) throw new Error('longest road holder under 5');
  }
  if (s.largestArmy !== null && s.players[s.largestArmy].knights < 3) throw new Error('largest army holder under 3');
}

function playGame(n, expansion, opts = {}) {
  const players = Array.from({ length: n }, (_, i) => ({ id: `b${i}`, name: `Bot ${i + 1}`, color: COLORS[i], bot: true }));
  let s = E.createGame({ players, settings: { expansion, ...opts } });
  invariants(s);
  let steps = 0;
  const counts = {};
  while (s.phase !== 'over') {
    if (++steps > 20000) throw new Error(`game did not finish (turn ${s.turn})`);
    const seats = botsToAct(s);
    if (!seats.length) throw new Error(`nobody to act in phase ${s.phase}`);
    let acted = false;
    const tries = [...seats.map(seat => [seat, {}]), [s.current, { impatient: true }]];
    for (const [seat, o] of tries) {
      if (!seats.includes(seat)) continue;
      const a = botAction(s, seat, o);
      if (!a) continue;
      try {
        s = E.applyAction(s, seat, a);
      } catch (err) {
        throw new Error(`bot ${seat} action ${JSON.stringify(a)} failed in ${s.phase}: ${err.message}`);
      }
      counts[a.type] = (counts[a.type] || 0) + 1;
      invariants(s);
      acted = true;
      break;
    }
    if (!acted) throw new Error(`stalled in ${s.phase}: seats ${seats}`);
  }
  if (E.victoryPoints(s, s.winner, true) < s.settings.vpTarget) throw new Error('winner below target');
  return { turns: s.turn, counts, winner: s.winner };
}

const configs = [
  [2, false], [3, false], [4, false], [4, true], [5, true], [6, true],
];
let total = 0;
const agg = {};
const t0 = Date.now();
for (const [n, ext] of configs) {
  let turns = 0;
  const wins = Array(n).fill(0);
  for (let g = 0; g < GAMES; g++) {
    const opts = g % 3 === 1 ? { friendlyRobber: true } : g % 3 === 2 ? { vpTarget: 12 } : {};
    const r = playGame(n, ext, opts);
    turns += r.turns;
    wins[r.winner]++;
    for (const [k, v] of Object.entries(r.counts)) agg[k] = (agg[k] || 0) + v;
    total++;
  }
  console.log(`${n} players ${ext ? '(5–6 board)' : '(base board)'}: avg ${(turns / GAMES).toFixed(1)} turns, wins by seat ${wins.join('/')}`);
}
console.log(`${total} games OK in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
console.log('action mix:', JSON.stringify(agg));
