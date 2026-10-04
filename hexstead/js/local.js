// Games played on one device: you against bots, or pass-and-play with friends.

import { applyAction, createGame, waitingOn } from './engine.js';
import { createBotRunner } from './bot-runner.js';

const KEY = 'hexstead.local.v1';

export function savedLocalGame() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    return s && s.phase !== 'over' ? s : null;
  } catch { return null; }
}

export function clearLocalGame() {
  try { localStorage.removeItem(KEY); } catch { /* storage unavailable */ }
}

export function startLocalGame(setup, opts = {}) {
  return localController(createGame(setup), opts);
}

export function resumeLocalGame(opts = {}) {
  const s = savedLocalGame();
  return s ? localController(s, opts) : null;
}

function localController(initial, { pace = 1 } = {}) {
  let state = initial;
  const listeners = new Set();
  const humans = () => state.players.map((p, i) => (p.bot ? -1 : i)).filter(i => i >= 0);
  let lastHuman = humans()[0] ?? null;

  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* quota or private mode */ } };

  function perspective() {
    const hs = humans();
    if (!hs.length) return null;
    const waiting = waitingOn(state).filter(i => hs.includes(i));
    if (waiting.length) {
      if (!waiting.includes(lastHuman)) lastHuman = waiting[0];
    } else if (state.phase === 'main' && state.offer && hs.includes(state.current) === false) {
      // a bot offered a trade: the human seats can answer it
      const open = hs.find(i => state.offer.responses[i] === undefined);
      if (open !== undefined && !hs.includes(lastHuman)) lastHuman = open;
    }
    if (!hs.includes(lastHuman)) lastHuman = hs[0];
    return lastHuman;
  }

  function set(next) {
    state = next;
    save();
    listeners.forEach(fn => fn(state));
    runner.poke();
  }

  const runner = createBotRunner({
    getState: () => state,
    act: async (seat, action) => set(applyAction(state, seat, action)),
    pace,
  });

  const ctrl = {
    kind: 'local',
    get state() { return state; },
    get seat() { return perspective(); },
    get humanSeats() { return humans(); },
    canActFor: seat => humans().includes(seat),
    setPerspective(seat) { if (humans().includes(seat)) { lastHuman = seat; listeners.forEach(fn => fn(state)); } },
    async act(action, seat = perspective()) {
      if (seat === null || seat === undefined) throw new Error('You aren’t seated in this game.');
      set(applyAction(state, seat, action));
    },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    start() { runner.start(); },
    destroy() { runner.stop(); listeners.clear(); },
    finish() { clearLocalGame(); },
  };
  return ctrl;
}
