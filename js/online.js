// Online rooms on Firebase Realtime Database.
//
// rooms/{CODE}/meta      { host, status: 'lobby'|'playing', created, settings }
// rooms/{CODE}/members   { [uid]: { name, color, joined } }      people in the room
// rooms/{CODE}/bots      { [id]:  { name, color, joined } }      computer players added by the host
// rooms/{CODE}/presence  { [uid]: { online, at } }
// rooms/{CODE}/game      { seq, state: "<json>", by }            the whole game, written with transactions
// rooms/{CODE}/chat      { [pushId]: { uid, name, text, at } }
//
// Every client runs the same rules engine; a move is applied inside a transaction so
// two people acting at once can never overwrite each other.

import { firebaseConfig } from './firebase-config.js';
import { applyAction, createGame, DEFAULT_SETTINGS } from './engine.js';
import { createBotRunner } from './bot-runner.js';
import { PLAYER_COLORS } from './board-view.js';

const SDK_VERSION = '12.19.0';
const SDK = `https://www.gstatic.com/firebasejs/${SDK_VERSION}`;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const MAX_SEATS = 6;
const BOT_NAMES = ['Ada', 'Bram', 'Cora', 'Dov', 'Esme', 'Finn', 'Gus', 'Hana', 'Ines', 'Jory'];

export function isConfigured() {
  const c = firebaseConfig || {};
  return !!(c.apiKey && c.databaseURL && !/YOUR_/.test(`${c.apiKey}${c.databaseURL}${c.projectId}`));
}

export function normalizeCode(raw) {
  return String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
}

const randomCode = () => Array.from({ length: 5 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');

let fbPromise = null;

/** Load the SDK, sign in anonymously. Resolves to { D, db, uid, ... }. */
export function connect() {
  if (!fbPromise) {
    fbPromise = (async () => {
      if (!isConfigured()) throw new Error('Online play isn’t set up on this site yet.');
      const [A, U, D] = await Promise.all([
        import(`${SDK}/firebase-app.js`),
        import(`${SDK}/firebase-auth.js`),
        import(`${SDK}/firebase-database.js`),
      ]);
      const app = A.initializeApp(firebaseConfig);
      const auth = U.getAuth(app);
      const db = D.getDatabase(app);
      const emu = firebaseConfig.emulators;
      if (emu && emu.auth) U.connectAuthEmulator(auth, emu.auth, { disableWarnings: true });
      if (emu && emu.database) D.connectDatabaseEmulator(db, emu.database.host, emu.database.port);
      await auth.authStateReady();
      if (!auth.currentUser) await withTimeout(U.signInAnonymously(auth), 15000, 'Signing in to Firebase timed out. Check your connection and the apiKey in js/firebase-config.js.');
      return { A, U, D, app, auth, db, uid: auth.currentUser.uid };
    })().catch(err => {
      fbPromise = null;
      throw friendly(err);
    });
  }
  return fbPromise;
}

function friendly(err) {
  const msg = String((err && (err.code || err.message)) || err);
  if (/admin-restricted-operation|operation-not-allowed/i.test(msg)) return new Error('Anonymous sign-in is turned off in this Firebase project. Turn it on under Security → Authentication → Sign-in method.');
  if (/permission[_ -]denied/i.test(msg)) return new Error('The database refused the request. Check that the rules from database.rules.json are published.');
  if (/network|failed to fetch|importing a module/i.test(msg)) return new Error('Couldn’t reach Firebase. Check your connection and try again.');
  if (/unauthorized-domain|requests-from-referer/i.test(msg)) return new Error('This website isn’t on the Firebase project’s authorized domains list.');
  return err instanceof Error ? err : new Error(msg);
}

const once = (D, r) => new Promise((resolve, reject) => D.onValue(r, resolve, reject, { onlyOnce: true }));

function withTimeout(promise, ms, message) {
  let t;
  return Promise.race([
    promise.finally(() => clearTimeout(t)),
    new Promise((_, reject) => { t = setTimeout(() => reject(new Error(message)), ms); }),
  ]);
}
const NO_DB = 'Couldn’t reach the Realtime Database. Check the databaseURL in js/firebase-config.js and that the database exists.';

export async function createRoom(profile) {
  const fb = await connect();
  const { D, db, uid } = fb;
  let code = null;
  let lastError = null;
  for (let i = 0; i < 6 && !code; i++) {
    const c = randomCode();
    try {
      const r = await withTimeout(D.runTransaction(D.ref(db, `rooms/${c}/meta`), cur => {
        if (cur !== null) return undefined; // code taken: abort and try another
        return { host: uid, status: 'lobby', created: Date.now(), settings: { ...DEFAULT_SETTINGS } };
      }), 15000, NO_DB);
      if (r.committed) code = c;
    } catch (e) {
      if (e && e.message === NO_DB) throw e;
      lastError = e; // a taken code can surface as permission_denied; try another
    }
  }
  if (!code) throw lastError ? friendly(lastError) : new Error('Couldn’t create a room. Try again.');
  const room = new Room(fb, code);
  await room.join(profile);
  return room;
}

export async function joinRoom(rawCode, profile) {
  const code = normalizeCode(rawCode);
  if (code.length !== 5) throw new Error('Room codes have 5 characters.');
  const fb = await connect();
  const room = new Room(fb, code);
  await room.join(profile);
  return room;
}

export class Room {
  constructor(fb, code) {
    this.fb = fb;
    this.code = code;
    this.uid = fb.uid;
    this.meta = null;
    this.members = {};
    this.bots = {};
    this.presence = {};
    this.game = null;
    this.chat = [];
    this.listeners = { change: new Set(), chat: new Set(), closed: new Set() };
    this.unsubs = [];
    this.loaded = new Set();
    this.left = false;
    this.profile = null;
    this.runner = createBotRunner({
      getState: () => this.game,
      enabled: () => this.isBotDriver(),
      act: (seat, action, seq) => this.act(action, seat, seq, true),
    });
  }

  ref(path = '') { return this.fb.D.ref(this.fb.db, `rooms/${this.code}${path ? `/${path}` : ''}`); }
  on(evt, fn) { this.listeners[evt].add(fn); return () => this.listeners[evt].delete(fn); }
  emit(evt = 'change') { this.listeners[evt].forEach(fn => { try { fn(this); } catch (e) { console.error(e); } }); }

  get link() {
    const u = new URL(location.href);
    u.hash = this.code;
    u.search = '';
    return u.toString();
  }
  get isHost() { return !!this.meta && this.meta.host === this.uid; }
  get isMember() { return !!this.members[this.uid]; }
  get status() { return this.meta ? this.meta.status : null; }
  get settings() { return { ...DEFAULT_SETTINGS, ...(this.meta && this.meta.settings) }; }
  get mySeat() {
    if (!this.game) return null;
    const i = this.game.players.findIndex(p => p.id === this.uid);
    return i >= 0 ? i : null;
  }
  isOnline(uid) { return uid === this.uid ? !this.left : !!(this.presence[uid] && this.presence[uid].online); }

  /** People and bots in the lobby, in seating order. */
  get seats() {
    const people = Object.entries(this.members).map(([id, m]) => ({ id, name: m.name, color: m.color, joined: m.joined || 0, bot: false }));
    const bots = Object.entries(this.bots).map(([id, b]) => ({ id, name: b.name, color: b.color, joined: b.joined || 0, bot: true }));
    return [...people, ...bots].sort((a, b) => a.joined - b.joined || (a.id < b.id ? -1 : 1));
  }

  async join(profile) {
    const { D } = this.fb;
    this.profile = profile;
    const metaSnap = await withTimeout(once(D, this.ref('meta')), 15000, NO_DB).catch(e => { throw friendly(e); });
    if (!metaSnap.exists()) throw new Error('There’s no room with that code. Check it and try again.');
    if (metaSnap.val().status === 'lobby') await this.takeSeat();
    this.subscribe();
    this.watchPresence();
    await this.ready();
  }

  /** Add yourself to the room's player list (only possible while it's in the lobby). */
  async takeSeat() {
    const { D } = this.fb;
    const profile = this.profile || {};
    const [mine, members, bots] = await Promise.all([
      once(D, this.ref(`members/${this.uid}`)), once(D, this.ref('members')), once(D, this.ref('bots')),
    ]).catch(e => { throw friendly(e); });
    if (mine.exists()) return;
    if (members.size + bots.size >= MAX_SEATS) throw new Error('That room is full (6 players).');
    const taken = new Set([...Object.values(members.val() || {}), ...Object.values(bots.val() || {})].map(m => m.color));
    const color = !taken.has(profile.color) && PLAYER_COLORS.some(c => c.id === profile.color)
      ? profile.color : (PLAYER_COLORS.find(c => !taken.has(c.id)) || PLAYER_COLORS[0]).id;
    await D.set(this.ref(`members/${this.uid}`), { name: cleanName(profile.name), color, joined: D.serverTimestamp() })
      .catch(e => { throw /permission/i.test(String(e && (e.code || e.message))) ? new Error('This game has already started. You can watch, and join the next one.') : friendly(e); });
  }

  /** Take over as host when the current host has left the lobby. */
  async claimHost() {
    if (!this.isMember) throw new Error('Join the room first.');
    await this.fb.D.update(this.ref('meta'), { host: this.uid }).catch(e => { throw friendly(e); });
  }

  ready() {
    return new Promise(resolve => {
      const check = () => {
        if (['meta', 'members', 'bots', 'game'].every(k => this.loaded.has(k))) { off(); resolve(); }
      };
      const off = this.on('change', check);
      check();
    });
  }

  subscribe() {
    const { D } = this.fb;
    const listen = (path, fn) => this.unsubs.push(D.onValue(this.ref(path), snap => { this.loaded.add(path); fn(snap.val()); this.afterChange(path); }, err => console.warn('listen failed', path, err)));
    listen('meta', v => { this.meta = v; });
    listen('members', v => { this.members = v || {}; });
    listen('bots', v => { this.bots = v || {}; });
    listen('presence', v => { this.presence = v || {}; });
    listen('game', v => {
      try { this.game = v && typeof v.state === 'string' ? JSON.parse(v.state) : null; } catch { this.game = null; }
    });
    const chatQ = D.query(this.ref('chat'), D.limitToLast(80));
    this.unsubs.push(D.onChildAdded(chatQ, snap => {
      const m = snap.val();
      if (m && typeof m.text === 'string') { this.chat.push(m); if (this.chat.length > 120) this.chat.shift(); this.emit('chat'); }
    }));
  }

  afterChange(path) {
    if (this.left) return;
    if (path === 'meta' && this.loaded.has('meta') && !this.meta) { this.emit('closed'); return; }
    this.emit('change');
    if (path === 'game' || path === 'presence') this.runner.poke();
  }

  watchPresence() {
    const { D, db } = this.fb;
    const me = this.ref(`presence/${this.uid}`);
    this.unsubs.push(D.onValue(D.ref(db, '.info/connected'), snap => {
      if (snap.val() !== true || this.left) return;
      D.onDisconnect(me).set({ online: false, at: D.serverTimestamp() }).catch(() => {});
      D.set(me, { online: true, at: D.serverTimestamp() }).catch(() => {});
    }));
  }

  /** The first connected human (by seat) runs the bots so they only move once. */
  isBotDriver() {
    const g = this.game;
    if (!g || g.phase === 'over' || !this.isMember || this.left) return false;
    if (!g.players.some(p => p.bot)) return false;
    const driver = g.players.find(p => !p.bot && this.members[p.id] && this.isOnline(p.id));
    return !!driver && driver.id === this.uid;
  }

  // ---------------------------------------------------------------- lobby

  async updateSettings(patch) {
    if (!this.isHost) throw new Error('Only the host can change settings.');
    await this.fb.D.update(this.ref('meta/settings'), patch);
  }

  async setProfile({ name, color }) {
    if (!this.isMember) return;
    const patch = {};
    if (name !== undefined) patch.name = cleanName(name);
    if (color !== undefined) {
      const taken = this.seats.filter(s => s.id !== this.uid).map(s => s.color);
      if (taken.includes(color)) throw new Error('Someone already picked that color.');
      patch.color = color;
    }
    await this.fb.D.update(this.ref(`members/${this.uid}`), patch);
  }

  async addBot() {
    if (!this.isHost) return;
    const seats = this.seats;
    if (seats.length >= MAX_SEATS) throw new Error('The room is full.');
    const usedNames = new Set(seats.map(s => s.name));
    const name = BOT_NAMES.find(n => !usedNames.has(n)) || `Bot ${seats.length + 1}`;
    const color = (PLAYER_COLORS.find(c => !seats.some(s => s.color === c.id)) || PLAYER_COLORS[0]).id;
    const { D } = this.fb;
    await D.set(D.push(this.ref('bots')), { name, color, joined: D.serverTimestamp() });
  }

  async removeSeat(id) {
    if (!this.isHost) return;
    const path = this.bots[id] ? `bots/${id}` : `members/${id}`;
    await this.fb.D.remove(this.ref(path));
  }

  async start() {
    if (!this.isHost) throw new Error('Only the host can start the game.');
    const seats = this.seats;
    if (seats.length < 2) throw new Error('You need at least 2 players. Invite a friend or add a bot.');
    const used = new Set();
    const players = seats.map(s => {
      let color = s.color;
      if (!PLAYER_COLORS.some(c => c.id === color) || used.has(color)) color = PLAYER_COLORS.find(c => !used.has(c.id)).id;
      used.add(color);
      return { id: s.id, name: s.name, color, bot: s.bot };
    });
    const settings = { ...this.settings, expansion: this.settings.expansion || players.length > 4 };
    const game = createGame({ players, settings });
    const { D } = this.fb;
    await D.update(this.ref(), {
      game: { seq: game.seq, state: JSON.stringify(game), by: this.uid },
      'meta/status': 'playing',
      'meta/settings': settings,
    });
  }

  async backToLobby() {
    if (!this.isHost) throw new Error('Only the host can do that.');
    await this.fb.D.update(this.ref(), { game: null, 'meta/status': 'lobby' });
  }

  // ---------------------------------------------------------------- game

  async act(action, seat = this.mySeat, expectSeq, asBot = false) {
    if (seat === null || seat === undefined) throw new Error('You’re watching this game.');
    return this.transact(s => {
      const p = s.players[seat];
      if (!p) throw new Error('That seat doesn’t exist.');
      if (asBot) {
        if (!p.bot || !this.isBotDriver()) throw new Error('Not driving that bot.');
      } else {
        if (p.id !== this.uid) throw new Error('You can’t move for another player.');
        if (p.bot) throw new Error('A bot is playing your seat. Take it back first.');
      }
      return applyAction(s, seat, action);
    }, expectSeq);
  }

  async transact(mutate, expectSeq) {
    const { D } = this.fb;
    let error = null;
    const res = await D.runTransaction(this.ref('game'), cur => {
      error = null;
      if (cur === null) return null; // not cached yet: the server will hand us the real value
      if (expectSeq !== undefined && cur.seq !== expectSeq) { error = new Error('The game moved on. Try again.'); return undefined; }
      try {
        const next = mutate(JSON.parse(cur.state));
        return { seq: next.seq, state: JSON.stringify(next), by: this.uid };
      } catch (e) {
        error = e;
        return undefined;
      }
    }).catch(e => { throw friendly(e); });
    if (!res.committed) throw error || new Error('That move didn’t go through. Try again.');
    if (res.snapshot.val() === null) throw new Error('There’s no game running in this room.');
  }

  async replaceWithBot(seat) {
    if (!this.isHost) throw new Error('Only the host can do that.');
    await this.transact(s => { s.players[seat].bot = true; s.seq += 1; return s; });
  }

  async reclaim() {
    await this.transact(s => {
      const i = s.players.findIndex(p => p.id === this.uid);
      if (i < 0) throw new Error('You don’t have a seat in this game.');
      s.players[i].bot = false;
      s.seq += 1;
      return s;
    });
  }

  async sendChat(text) {
    const t = String(text || '').trim().slice(0, 200);
    if (!t) return;
    const { D } = this.fb;
    const name = (this.members[this.uid] && this.members[this.uid].name) || cleanName(this.profile && this.profile.name) || 'Guest';
    await D.push(this.ref('chat'), { uid: this.uid, name, text: t, at: D.serverTimestamp() });
  }

  async leave() {
    if (this.left) return;
    const { D } = this.fb;
    this.runner.stop();
    try {
      if (this.status === 'lobby' && this.isMember) {
        const others = Object.keys(this.members).filter(id => id !== this.uid);
        if (this.isHost && !others.length) {
          await D.remove(this.ref());
        } else {
          if (this.isHost) await D.update(this.ref('meta'), { host: others[0] });
          await D.remove(this.ref(`members/${this.uid}`));
        }
      }
      const me = this.ref(`presence/${this.uid}`);
      await D.onDisconnect(me).cancel().catch(() => {});
      await D.set(me, { online: false, at: D.serverTimestamp() }).catch(() => {});
    } finally {
      this.left = true;
      this.unsubs.forEach(u => u());
      this.unsubs = [];
    }
  }

  /** Controller used by the game screen. */
  controller() {
    const room = this;
    return {
      kind: 'online',
      uid: room.uid,
      get state() { return room.game; },
      get seat() { return room.mySeat; },
      room: { code: room.code, get isHost() { return room.isHost; }, get link() { return room.link; } },
      act: action => room.act(action),
      onChange: fn => room.on('change', fn),
      isConnected: seat => { const p = room.game && room.game.players[seat]; return !!p && (p.bot || room.isOnline(p.id)); },
      chat: {
        get messages() { return room.chat; },
        send: text => room.sendChat(text),
        onChange: fn => room.on('chat', fn),
      },
      replaceWithBot: seat => room.replaceWithBot(seat),
      reclaim: () => room.reclaim(),
      backToLobby: () => room.backToLobby(),
    };
  }
}

export function cleanName(n) {
  const s = String(n || '').replace(/\s+/g, ' ').trim().slice(0, 24);
  return s || 'Player';
}
