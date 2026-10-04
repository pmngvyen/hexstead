// App shell: home, local setup, online lobby and the game screen.

import * as Online from './online.js';
import { startLocalGame, resumeLocalGame, savedLocalGame } from './local.js';
import { mountGame } from './game-ui.js';
import { createGame, applyAction, DEFAULT_SETTINGS } from './engine.js';
import { botAction } from './bot.js';
import { boardMarkup, viewBoxFor, PLAYER_COLORS, colorHex } from './board-view.js';
import { esc, toast, hideToast, openDialog, copyText } from './dom.js';
import { rulesHTML } from './rules.js';
import { UI } from './icons.js';

const $ = id => document.getElementById(id);
const SCREENS = ['home', 'local', 'lobby', 'game'];
const PREFS_KEY = 'hexstead.prefs.v1';
const BOT_NAMES = ['Ada', 'Bram', 'Cora', 'Dov', 'Esme', 'Finn'];

const params = new URLSearchParams(location.search);
const PACE = Math.max(0.02, Math.min(3, Number(params.get('pace')) || 1));
let prefs = loadPrefs();
let gameView = null;
let room = null;
let roomWasMember = false;
let localCtrl = null;

function loadPrefs() {
  try { return { name: '', color: 'red', ...JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') }; } catch { return { name: '', color: 'red' }; }
}
function savePrefs() { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* ignore */ } }

function show(id) {
  const changed = document.body.dataset.screen !== id;
  SCREENS.forEach(s => { $(s).hidden = s !== id; });
  document.body.dataset.screen = id;
  if (changed) window.scrollTo(0, 0);
}

function busy(btn, on, label) {
  if (!btn) return;
  if (on) { btn.dataset.label = btn.textContent; btn.textContent = label || 'Working…'; btn.disabled = true; }
  else { btn.textContent = btn.dataset.label || btn.textContent; btn.disabled = false; }
}

function openRules() { openDialog({ title: 'How to play', className: 'rules-sheet', body: rulesHTML }); }

// ------------------------------------------------------------------ home

function homeArt() {
  // a real opening position, played out by the bots, as the cover image
  const players = PLAYER_COLORS.slice(0, 4).map((c, i) => ({ id: `a${i}`, name: c.name, color: ['red', 'blue', 'white', 'orange'][i], bot: true }));
  let s = createGame({ players, settings: {} });
  let guard = 0;
  while (s.phase === 'setup' && guard++ < 40) {
    const seat = s.setup.order[s.setup.step];
    s = applyAction(s, seat, botAction(s, seat));
  }
  const svg = document.querySelector('.home-board');
  svg.setAttribute('viewBox', viewBoxFor(false));
  svg.innerHTML = boardMarkup(s, {});
}

function renderHome() {
  $('home-name').value = prefs.name || '';
  const configured = Online.isConfigured();
  $('create-room').disabled = !configured;
  $('join-room').disabled = !configured;
  $('join-code').disabled = !configured;
  const note = $('online-note');
  note.hidden = configured;
  if (!configured) note.textContent = 'Online rooms aren’t switched on for this site yet. The site owner needs to add a Firebase config (see README). You can still play on this device.';
  $('resume-local').hidden = !savedLocalGame();
}

function requireName() {
  const input = $('home-name');
  const name = Online.cleanName(input.value);
  if (!input.value.trim()) {
    input.focus();
    toast('Enter your name first', 'error');
    return null;
  }
  prefs.name = name;
  savePrefs();
  return name;
}

$('home-form').addEventListener('submit', e => { e.preventDefault(); $('join-code').value ? $('join-room').click() : $('create-room').click(); });

$('create-room').addEventListener('click', async e => {
  const name = requireName();
  if (!name) return;
  const btn = e.currentTarget;
  busy(btn, true, 'Creating room…');
  try {
    const r = await Online.createRoom({ name, color: prefs.color });
    enterRoom(r);
  } catch (err) {
    toast(err.message, 'error');
  } finally { busy(btn, false); }
});

$('join-room').addEventListener('click', async e => {
  const name = requireName();
  if (!name) return;
  const code = Online.normalizeCode($('join-code').value);
  if (code.length !== 5) { $('join-code').focus(); toast('Room codes have 5 characters', 'error'); return; }
  const btn = e.currentTarget;
  busy(btn, true, 'Joining…');
  try {
    enterRoom(await Online.joinRoom(code, { name, color: prefs.color }));
  } catch (err) {
    toast(err.message, 'error');
  } finally { busy(btn, false); }
});

$('join-code').addEventListener('input', e => { e.target.value = Online.normalizeCode(e.target.value); });
$('play-local').addEventListener('click', () => { prefs.name = Online.cleanName($('home-name').value || prefs.name || 'You'); savePrefs(); openLocalSetup(); });
$('resume-local').addEventListener('click', () => {
  const c = resumeLocalGame({ pace: PACE });
  if (c) enterLocal(c);
});
$('home-rules').addEventListener('click', openRules);
document.querySelectorAll('[data-rules]').forEach(b => b.addEventListener('click', openRules));

function goHome() {
  if (gameView) { gameView.destroy(); gameView = null; }
  if (localCtrl) { localCtrl.destroy(); localCtrl = null; }
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  renderHome();
  show('home');
}

// ------------------------------------------------------------------ settings form (shared)

function optionsMarkup(st, { editable, seatCount, prefix }) {
  const dis = editable ? '' : 'disabled';
  return `
    <div class="opt">
      <span class="opt-label">Points to win</span>
      <div class="mini-stepper">
        <button type="button" class="icon-btn small" data-opt="vp-" ${dis} aria-label="Fewer points">${UI.minus}</button>
        <b>${st.vpTarget}</b>
        <button type="button" class="icon-btn small" data-opt="vp+" ${dis} aria-label="More points">${UI.plus}</button>
      </div>
    </div>
    <label class="opt check"><input type="checkbox" id="${prefix}-friendly" ${st.friendlyRobber ? 'checked' : ''} ${dis}><span>Friendly robber<small>The robber can’t target players with 2 points or fewer.</small></span></label>
    <label class="opt check${st.expansion ? '' : ' muted-opt'}"><input type="checkbox" id="${prefix}-special" ${st.specialBuild ? 'checked' : ''} ${editable && st.expansion ? '' : 'disabled'}><span>Special build phase<small>Large island only. Between turns, everyone else may build in order.</small></span></label>
    ${seatCount > 4 ? '<p class="note">5 or more players use the large island.</p>' : ''}`;
}

function wireOptions(container, prefix, get, set) {
  container.onclick = e => {
    const b = e.target.closest('[data-opt]');
    if (!b) return;
    const st = get();
    if (b.dataset.opt === 'vp-') set({ vpTarget: Math.max(5, st.vpTarget - 1) });
    if (b.dataset.opt === 'vp+') set({ vpTarget: Math.min(20, st.vpTarget + 1) });
  };
  container.onchange = e => {
    if (e.target.id === `${prefix}-friendly`) set({ friendlyRobber: e.target.checked });
    if (e.target.id === `${prefix}-special`) set({ specialBuild: e.target.checked });
  };
}

// ------------------------------------------------------------------ local setup

const localSetup = { settings: { ...DEFAULT_SETTINGS }, seats: [] };

function openLocalSetup() {
  if (!localSetup.seats.length) {
    localSetup.seats = [
      { name: prefs.name || 'You', color: prefs.color || 'red', bot: false },
      ...BOT_NAMES.slice(0, 3).map(n => ({ name: n, color: null, bot: true })),
    ];
    fixColors(localSetup.seats);
  }
  renderLocalSetup();
  show('local');
}

function fixColors(seats) {
  const used = new Set();
  seats.forEach(s => {
    if (!s.color || used.has(s.color)) s.color = PLAYER_COLORS.find(c => !used.has(c.id)).id;
    used.add(s.color);
  });
}

function seatRow(s, i, { editableName, removable, toggleBot, isMe }) {
  return `<li class="seat" style="--pc:${colorHex(s.color)}">
    <button type="button" class="swatch" data-seat-color="${i}" aria-label="Change color (now ${esc(s.color)})" title="Change color"></button>
    ${editableName ? `<input class="seat-name" data-seat-name="${i}" value="${esc(s.name)}" maxlength="24" aria-label="Player ${i + 1} name">` : `<span class="seat-name static">${esc(s.name)}</span>`}
    ${toggleBot ? `<div class="seg small" role="group" aria-label="Who plays seat ${i + 1}">
        <button type="button" data-seat-bot="${i}" data-v="0" aria-pressed="${!s.bot}">Person</button>
        <button type="button" data-seat-bot="${i}" data-v="1" aria-pressed="${s.bot}">Bot</button></div>` : ''}
    ${isMe ? '<span class="tag">you</span>' : ''}
    ${removable ? `<button type="button" class="icon-btn small" data-seat-remove="${i}" aria-label="Remove ${esc(s.name)}">${UI.close}</button>` : ''}
  </li>`;
}

function renderLocalSetup() {
  const st = localSetup.settings;
  const n = localSetup.seats.length;
  if (n > 4) st.expansion = true;
  document.querySelectorAll('input[name="local-board"]').forEach(r => {
    r.checked = (r.value === 'ext') === !!st.expansion;
    if (r.value === 'base') r.disabled = n > 4;
  });
  const max = st.expansion ? 6 : 4;
  $('local-seats').innerHTML = localSetup.seats.map((s, i) => seatRow(s, i, { editableName: true, removable: n > 2, toggleBot: true })).join('');
  $('local-add').hidden = n >= 6;
  $('local-add').textContent = n >= max && !st.expansion ? 'Add a player (switches to the large island)' : 'Add a player';
  $('local-options').innerHTML = optionsMarkup(st, { editable: true, seatCount: n, prefix: 'lo' });
  const humans = localSetup.seats.filter(s => !s.bot).length;
  $('local-start').textContent = humans === 0 ? 'Watch the bots play' : humans > 1 ? 'Start pass-and-play game' : 'Start game';
}

document.querySelectorAll('input[name="local-board"]').forEach(r => r.addEventListener('change', () => {
  localSetup.settings.expansion = r.value === 'ext' && r.checked;
  renderLocalSetup();
}));

$('local-seats').addEventListener('click', e => {
  const t = e.target.closest('button');
  if (!t) return;
  const seats = localSetup.seats;
  if (t.dataset.seatColor !== undefined) {
    const s = seats[Number(t.dataset.seatColor)];
    const used = new Set(seats.map(x => x.color));
    const start = PLAYER_COLORS.findIndex(c => c.id === s.color);
    for (let k = 1; k <= PLAYER_COLORS.length; k++) {
      const c = PLAYER_COLORS[(start + k) % PLAYER_COLORS.length];
      if (!used.has(c.id)) { s.color = c.id; break; }
    }
    renderLocalSetup();
  }
  if (t.dataset.seatBot !== undefined) { seats[Number(t.dataset.seatBot)].bot = t.dataset.v === '1'; renderLocalSetup(); }
  if (t.dataset.seatRemove !== undefined) { seats.splice(Number(t.dataset.seatRemove), 1); renderLocalSetup(); }
});
$('local-seats').addEventListener('input', e => {
  const i = e.target.dataset.seatName;
  if (i !== undefined) localSetup.seats[Number(i)].name = e.target.value;
});
$('local-add').addEventListener('click', () => {
  const seats = localSetup.seats;
  if (seats.length >= 6) return;
  const used = new Set(seats.map(s => s.name));
  seats.push({ name: BOT_NAMES.find(n => !used.has(n)) || `Bot ${seats.length + 1}`, color: null, bot: true });
  fixColors(seats);
  if (seats.length > 4) localSetup.settings.expansion = true;
  renderLocalSetup();
});
wireOptions($('local-options'), 'lo', () => localSetup.settings, patch => { Object.assign(localSetup.settings, patch); renderLocalSetup(); });

$('local-start').addEventListener('click', () => {
  const seats = localSetup.seats.map((s, i) => ({ id: `local${i}`, name: Online.cleanName(s.name), color: s.color, bot: s.bot }));
  const me = seats.find(s => !s.bot);
  if (me) { prefs.name = me.name; prefs.color = me.color; savePrefs(); }
  enterLocal(startLocalGame({ players: seats, settings: { ...localSetup.settings } }, { pace: PACE }));
});

function enterLocal(ctrl) {
  if (gameView) gameView.destroy();
  if (localCtrl) localCtrl.destroy();
  localCtrl = ctrl;
  show('game');
  gameView = mountGame($('game'), ctrl, {
    onExit: () => goHome(),
    onNewGame: () => { goHome(); openLocalSetup(); },
  });
  ctrl.start();
}

document.querySelectorAll('[data-nav="home"]').forEach(b => b.addEventListener('click', goHome));

// ------------------------------------------------------------------ online room

function enterRoom(r) {
  hideToast();
  if (room && room !== r) room.leave();
  room = r;
  roomWasMember = r.isMember;
  if (location.hash.slice(1) !== r.code) history.replaceState(null, '', `#${r.code}`);
  r.on('change', routeRoom);
  r.on('closed', () => {
    toast('The host closed this room.');
    leaveRoom(true);
  });
  routeRoom();
}

async function leaveRoom(silent) {
  const r = room;
  room = null;
  if (gameView) { gameView.destroy(); gameView = null; }
  if (r) { try { await r.leave(); } catch (e) { if (!silent) toast(e.message, 'error'); } }
  goHome();
}

function routeRoom() {
  const r = room;
  if (!r) return;
  if (r.isMember) roomWasMember = true;
  if (r.status === 'lobby' && roomWasMember && !r.isMember && r.loaded.has('members')) {
    toast('You were removed from the room.');
    leaveRoom(true);
    return;
  }
  if (r.status === 'playing' && r.game) {
    if (!gameView || gameView.room !== r) {
      if (gameView) gameView.destroy();
      show('game');
      gameView = mountGame($('game'), r.controller(), { onExit: () => leaveRoom() });
      gameView.room = r;
    }
    return;
  }
  if (gameView) { gameView.destroy(); gameView = null; }
  show('lobby');
  renderLobby();
}

function renderLobby() {
  const r = room;
  const st = r.settings;
  const seats = r.seats;
  const n = seats.length;
  const host = r.isHost;
  $('lobby-code').textContent = r.code;
  $('lobby-share').hidden = !navigator.share;
  $('lobby-count').textContent = `Players (${n} of ${Online.MAX_SEATS})`;
  const hostSeat = r.meta && r.meta.host;
  $('lobby-seats').innerHTML = seats.map(s => {
    const isMe = s.id === r.uid;
    const away = !s.bot && !r.isOnline(s.id);
    const tags = [
      s.id === hostSeat ? '<span class="tag">host</span>' : '',
      isMe ? '<span class="tag">you</span>' : '',
      s.bot ? `<span class="tag bot">${UI.bot}bot</span>` : '',
      away ? '<span class="tag off">away</span>' : '',
    ].join('');
    return `<li class="seat" style="--pc:${colorHex(s.color)}">
      <span class="swatch" aria-hidden="true"></span>
      <span class="seat-name static">${esc(s.name)}</span>${tags}
      ${host && !isMe ? `<button type="button" class="icon-btn small" data-remove="${esc(s.id)}" aria-label="Remove ${esc(s.name)}">${UI.close}</button>` : ''}
    </li>`;
  }).join('');
  $('lobby-bot').hidden = !host || n >= Online.MAX_SEATS;

  // my name and color
  const mine = r.members[r.uid];
  if (mine) {
    const taken = new Set(seats.filter(s => s.id !== r.uid).map(s => s.color));
    const nameInput = $('lobby-name');
    const keepFocus = nameInput && document.activeElement === nameInput;
    if (!keepFocus) {
      $('lobby-me').innerHTML = `<label class="field"><span>Your name</span><input id="lobby-name" maxlength="24" value="${esc(mine.name)}"></label>
        <div class="field"><span>Your color</span><div class="swatches" role="radiogroup" aria-label="Your color">${PLAYER_COLORS.map(c => `<button type="button" class="swatch big" role="radio" aria-checked="${c.id === mine.color}" aria-label="${c.name}${taken.has(c.id) ? ' (taken)' : ''}" data-color="${c.id}" style="--pc:${c.hex}" ${taken.has(c.id) ? 'disabled' : ''}></button>`).join('')}</div></div>`;
    }
  } else {
    $('lobby-me').innerHTML = `<p class="note">You’re watching this room.</p><button type="button" class="btn" id="lobby-take" ${n >= Online.MAX_SEATS ? 'disabled' : ''}>Join the next game</button>`;
  }

  // settings
  const boardRow = `<div class="opt"><span class="opt-label">Island</span>
    <div class="seg" role="group" aria-label="Island size">
      <button type="button" data-board="base" aria-pressed="${!st.expansion}" ${host && n <= 4 ? '' : 'disabled'}>Standard</button>
      <button type="button" data-board="ext" aria-pressed="${!!st.expansion}" ${host ? '' : 'disabled'}>Large (5–6)</button>
    </div></div>`;
  const effective = { ...st, expansion: st.expansion || n > 4 };
  $('lobby-options').innerHTML = `${host ? '' : '<p class="note">Only the host can change these.</p>'}${boardRow}${optionsMarkup(effective, { editable: host, seatCount: n, prefix: 'lb' })}`;

  $('lobby-start').hidden = !host;
  $('lobby-start').disabled = n < 2;
  const hostAway = hostSeat && !r.isOnline(hostSeat) && r.presence[hostSeat] && r.presence[hostSeat].online === false;
  $('lobby-wait').innerHTML = host
    ? (n < 2 ? 'Share the code or add a bot. You need at least 2 players.' : '')
    : hostAway && r.isMember ? 'The host is away. <button type="button" class="link" id="lobby-claim">Become the host</button>' : 'Waiting for the host to start the game…';
  $('lobby-status').textContent = host ? 'Share the code with friends so they can join.' : '';
}

$('lobby-leave').addEventListener('click', () => leaveRoom());
$('lobby-copy').addEventListener('click', async () => { if (room) { await copyText(room.link); toast('Invite link copied'); } });
$('lobby-share').addEventListener('click', async () => {
  if (!room) return;
  try { await navigator.share({ title: 'Join my Hexstead game', text: `Room code ${room.code}`, url: room.link }); } catch { /* cancelled */ }
});
$('lobby-bot').addEventListener('click', async () => { try { await room.addBot(); } catch (e) { toast(e.message, 'error'); } });
$('lobby-seats').addEventListener('click', async e => {
  const b = e.target.closest('[data-remove]');
  if (!b || !room) return;
  try { await room.removeSeat(b.dataset.remove); } catch (err) { toast(err.message, 'error'); }
});
$('lobby-me').addEventListener('click', async e => {
  const c = e.target.closest('[data-color]');
  if (c && room) {
    try { await room.setProfile({ color: c.dataset.color }); prefs.color = c.dataset.color; savePrefs(); } catch (err) { toast(err.message, 'error'); }
  }
  if (e.target.id === 'lobby-take' && room) {
    try { await room.takeSeat(); } catch (err) { toast(err.message, 'error'); }
  }
});
$('lobby-me').addEventListener('change', async e => {
  if (e.target.id !== 'lobby-name' || !room) return;
  const name = Online.cleanName(e.target.value);
  prefs.name = name; savePrefs();
  try { await room.setProfile({ name }); } catch (err) { toast(err.message, 'error'); }
});
$('lobby-options').addEventListener('click', async e => {
  const b = e.target.closest('[data-board]');
  if (!b || !room) return;
  try { await room.updateSettings({ expansion: b.dataset.board === 'ext' }); } catch (err) { toast(err.message, 'error'); }
});
wireOptions($('lobby-options'), 'lb', () => room.settings, async patch => {
  try { await room.updateSettings(patch); } catch (err) { toast(err.message, 'error'); }
});
$('lobby-wait').addEventListener('click', async e => {
  if (e.target.id !== 'lobby-claim' || !room) return;
  try { await room.claimHost(); } catch (err) { toast(err.message, 'error'); }
});
$('lobby-start').addEventListener('click', async e => {
  const btn = e.currentTarget;
  busy(btn, true, 'Starting…');
  try { await room.start(); } catch (err) { toast(err.message, 'error'); } finally { busy(btn, false); }
});

// ------------------------------------------------------------------ boot

async function boot() {
  homeArt();
  renderHome();
  const code = Online.normalizeCode(location.hash.slice(1));
  $('boot').remove();
  if (code.length === 5 && Online.isConfigured()) {
    $('join-code').value = code;
    if (prefs.name) {
      show('home');
      const btn = $('join-room');
      busy(btn, true, 'Joining…');
      try { enterRoom(await Online.joinRoom(code, { name: prefs.name, color: prefs.color })); }
      catch (err) { toast(err.message, 'error'); }
      finally { busy(btn, false); }
      return;
    }
    show('home');
    $('home-name').focus();
    toast('Enter your name to join the room');
    return;
  }
  show('home');
}

window.addEventListener('hashchange', () => {
  const code = Online.normalizeCode(location.hash.slice(1));
  if (code.length === 5 && (!room || room.code !== code) && Online.isConfigured()) {
    $('join-code').value = code;
    if (prefs.name) $('join-room').click();
  }
});

if (params.has('debug')) {
  window.hexstead = { get game() { return (localCtrl && localCtrl.state) || (room && room.game) || null; }, get room() { return room; }, get local() { return localCtrl; } };
}

boot();
