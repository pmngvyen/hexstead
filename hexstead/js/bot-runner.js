// Drives computer players: watches the state and plays bot moves at a human-friendly pace.
// Used by local games and by whichever online client is the "bot driver".

import { botAction, botsToAct } from './bot.js';

const FALLBACKS = {
  main: [{ type: 'cancelOffer' }, { type: 'endTurn' }],
  special: [{ type: 'passSpecial' }],
  roadBuilding: [{ type: 'finishRoads' }],
};

export function createBotRunner({ getState, act, enabled = () => true, pace = 1 }) {
  let timer = null;
  let busy = false;
  let stopped = false;
  let offerWait = { id: null, since: 0 };
  let turnKey = '';
  let turnActions = 0;
  let failures = { seq: -1, n: 0 };

  const delayFor = (s, seat) => {
    if (s.phase === 'discard' || (s.offer && seat !== s.current)) return 450 * pace;
    if (s.phase === 'setup') return 650 * pace;
    if (s.phase === 'roll') return 700 * pace;
    return 850 * pace;
  };

  function schedule(ms) {
    clearTimeout(timer);
    if (!stopped) timer = setTimeout(step, ms);
  }

  function poke() {
    if (stopped || busy) return;
    const s = getState();
    if (!s || !enabled()) { clearTimeout(timer); return; }
    const seats = botsToAct(s);
    if (!seats.length) { clearTimeout(timer); return; }
    schedule(delayFor(s, seats[0]));
  }

  function choose(s) {
    const seats = botsToAct(s);
    if (!seats.length) return null;
    for (const seat of seats) {
      const a = botAction(s, seat);
      if (a) return { seat, a };
    }
    // the bot whose turn it is is waiting on answers to its trade offer
    const id = s.offer ? s.offer.id : null;
    if (offerWait.id !== id) offerWait = { id, since: Date.now() };
    if (id !== null && Date.now() - offerWait.since > 9000 && s.players[s.current].bot) {
      const a = botAction(s, s.current, { impatient: true });
      if (a) return { seat: s.current, a };
    }
    return 'wait';
  }

  async function step() {
    if (stopped || busy) return;
    const s = getState();
    if (!s || !enabled()) return;
    let pick = choose(s);
    if (pick === null) return;
    if (pick === 'wait') { schedule(1000); return; }

    const tk = `${s.turn}:${s.current}:${s.phase === 'special' ? 'sp' : ''}`;
    if (tk !== turnKey) { turnKey = tk; turnActions = 0; }
    if (++turnActions > 60 && pick.seat === s.current && s.phase === 'main') pick = { seat: s.current, a: { type: 'endTurn' } };

    // if the same move keeps failing on this exact state, fall back to something safe
    if (failures.seq === s.seq && failures.n >= 2) {
      const fb = (FALLBACKS[s.phase] || [])[Math.min(failures.n - 2, 1)];
      if (fb) pick = { seat: s.phase === 'special' ? pick.seat : s.current, a: fb };
    }

    busy = true;
    try {
      await act(pick.seat, pick.a, s.seq);
      failures = { seq: -1, n: 0 };
    } catch (err) {
      failures = failures.seq === s.seq ? { seq: s.seq, n: failures.n + 1 } : { seq: s.seq, n: 1 };
      console.warn('Bot move was rejected:', pick.a, err && err.message);
    } finally {
      busy = false;
    }
    poke();
  }

  return {
    poke,
    stop() { stopped = true; clearTimeout(timer); },
    start() { stopped = false; poke(); },
  };
}
