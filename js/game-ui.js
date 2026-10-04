// The game screen: board, players, hand, actions, trading, log and chat.
// Works with any controller exposing { kind, state, seat, act(), onChange() }.

import * as E from './engine.js';
import { boardMarkup, viewBoxFor, colorHex, RES_COLOR } from './board-view.js';
import { RES_GLYPH, DEV_GLYPH, PIECE_GLYPH, UI } from './icons.js';
import { esc, toast, openDialog, refreshDialogs, closeAllDialogs, copyText } from './dom.js';
import { rulesHTML } from './rules.js';

const RES = E.RESOURCES;
export const RES_LABEL = { brick: 'Brick', lumber: 'Lumber', wool: 'Wool', grain: 'Grain', ore: 'Ore' };
const COARSE = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
const REDUCED = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

const PIP_POS = {
  1: [[2, 2]], 2: [[1, 1], [3, 3]], 3: [[1, 1], [2, 2], [3, 3]], 4: [[1, 1], [3, 1], [1, 3], [3, 3]],
  5: [[1, 1], [3, 1], [2, 2], [1, 3], [3, 3]], 6: [[1, 1], [3, 1], [1, 2], [3, 2], [1, 3], [3, 3]],
};
const dieSVG = n => `<svg viewBox="0 0 40 40" class="die" aria-hidden="true"><rect x="2" y="2" width="36" height="36" rx="8" class="die-face"/>${PIP_POS[n].map(([x, y]) => `<circle cx="${x * 9 + 2}" cy="${y * 9 + 2}" r="3.6" class="die-pip"/>`).join('')}</svg>`;

export function resChip(r, n = 1, opts = {}) {
  return `<span class="chip" style="--c:${RES_COLOR[r]}" title="${RES_LABEL[r]}">${RES_GLYPH[r]}${n > 1 || opts.always ? `<b>${n}</b>` : ''}</span>`;
}
export function resList(res) {
  const parts = RES.filter(r => res[r] > 0).map(r => resChip(r, res[r], { always: true }));
  return parts.length ? `<span class="chips">${parts.join('')}</span>` : '<span class="muted">nothing</span>';
}
const costChips = cost => `<span class="cost">${RES.flatMap(r => Array(cost[r] || 0).fill(r)).map(r => `<i style="--c:${RES_COLOR[r]}" title="${RES_LABEL[r]}"></i>`).join('')}</span>`;

const TEMPLATE = `
<header class="g-top">
  <button type="button" class="g-brand" data-act="menu" aria-label="Open menu">Hexstead</button>
  <div class="g-room" hidden><span class="lbl">Room</span> <b data-code></b><button type="button" class="icon-btn small" data-act="copy-link" aria-label="Copy invite link">${UI.copy}</button></div>
  <div class="g-turn" data-turn></div>
  <button type="button" class="icon-btn" data-act="menu" aria-label="Menu">${UI.menu}</button>
</header>
<div class="g-body">
  <section class="g-players" aria-label="Players"></section>
  <section class="g-board" aria-label="Board">
    <div class="board-scroll"><svg class="board" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Island board"></svg></div>
    <div class="dice-tray" aria-live="polite"></div>
    <div class="zoom" role="group" aria-label="Zoom">
      <button type="button" class="icon-btn small" data-zoom="in" aria-label="Zoom in">${UI.plus}</button>
      <button type="button" class="icon-btn small" data-zoom="out" aria-label="Zoom out">${UI.minus}</button>
      <button type="button" class="icon-btn small" data-zoom="fit" aria-label="Fit board">${UI.fit}</button>
    </div>
  </section>
  <section class="g-console" aria-label="Your turn">
    <div class="prompt" aria-live="polite"></div>
    <div class="offers"></div>
    <div class="hand"></div>
    <div class="actions"></div>
  </section>
  <aside class="g-side">
    <div class="tabs" role="tablist">
      <button type="button" role="tab" data-tab="log" aria-selected="true">Game log</button>
      <button type="button" role="tab" data-tab="chat" aria-selected="false" hidden>Chat <span class="unread" hidden></span></button>
    </div>
    <ol class="log" data-pane="log"></ol>
    <div class="chat" data-pane="chat" hidden>
      <ol class="chat-list"></ol>
      <form class="chat-form" autocomplete="off">
        <input type="text" name="msg" maxlength="200" placeholder="Message the table" aria-label="Chat message">
        <button type="submit" class="btn small">Send</button>
      </form>
    </div>
    <div class="bank"></div>
  </aside>
</div>
<div class="cover" hidden></div>`;

// Only replace a region's markup when it actually changed, so taps aren't lost mid-update.
function setHTML(el, html) {
  if (el.__html === html) return false;
  el.__html = html;
  el.innerHTML = html;
  return true;
}

export function mountGame(root, ctrl, hooks = {}) {
  root.innerHTML = TEMPLATE;
  const q = sel => root.querySelector(sel);
  const el = {
    room: q('.g-room'), code: q('[data-code]'), turn: q('[data-turn]'),
    players: q('.g-players'), board: q('svg.board'), scroll: q('.board-scroll'), dice: q('.dice-tray'),
    prompt: q('.prompt'), offers: q('.offers'), hand: q('.hand'), actions: q('.actions'),
    log: q('.log'), chat: q('.chat'), chatList: q('.chat-list'), chatForm: q('.chat-form'),
    chatTab: q('[data-tab="chat"]'), unread: q('.unread'), bank: q('.bank'), cover: q('.cover'),
  };
  const ui = {
    mode: null, pending: null, zoom: 1, tab: 'log',
    lastLogI: null, flash: null, flashAt: 0, gain: null, gainAt: 0, rollAt: 0,
    wasWaiting: false, overShown: false, shownSeat: null, discardDlg: null, chatSeen: 0,
  };
  const unsubs = [];
  const S = () => ctrl.state;
  const me = () => ctrl.seat;
  const color = i => colorHex(S().players[i].color);
  const name = i => (i === null || i === undefined || !S().players[i] ? 'Someone' : S().players[i].name);
  const tag = i => (i === null || i === undefined || !S().players[i] ? '' : `<b class="ptag" style="--pc:${color(i)}">${esc(name(i))}${i === me() ? ' (you)' : ''}</b>`);
  const listNames = arr => arr.map(tag).join(arr.length === 2 ? ' and ' : ', ');
  const online = ctrl.kind === 'online';
  const multiHuman = () => ctrl.kind === 'local' && ctrl.humanSeats && ctrl.humanSeats.length > 1;

  if (online && ctrl.room) {
    el.room.hidden = false;
    el.code.textContent = ctrl.room.code;
    el.chatTab.hidden = false;
  }

  // ------------------------------------------------------------ actions
  async function act(action) {
    try {
      await ctrl.act(action);
      return true;
    } catch (err) {
      toast(err && err.message ? err.message : String(err), 'error');
      return false;
    }
  }

  // ------------------------------------------------------------ board interaction
  function interaction() {
    const s = S(), seat = me();
    if (seat === null || seat === undefined || s.phase === 'over' || coverActive()) return null;
    if (s.phase === 'setup' && s.setup.order[s.setup.step] === seat) {
      return s.setup.stage === 'settlement'
        ? { kind: 'vertex', ids: E.legalSettlements(s, seat, true), make: id => ({ type: 'placeSettlement', vertex: id }), ghost: 'settlement' }
        : { kind: 'edge', ids: E.legalRoads(s, seat, s.setup.vertex), make: id => ({ type: 'placeRoad', edge: id }), ghost: 'road' };
    }
    if (s.phase === 'robber' && s.current === seat) return { kind: 'hex', ids: E.robberTargets(s, seat), robber: true, ghost: 'robber' };
    if (s.phase === 'roadBuilding' && s.current === seat) return { kind: 'edge', ids: E.legalRoads(s, seat), make: id => ({ type: 'placeRoad', edge: id }), ghost: 'road' };
    if (ui.mode && canBuildNow()) {
      if (ui.mode === 'road') return { kind: 'edge', ids: E.legalRoads(s, seat), make: id => ({ type: 'build', kind: 'road', edge: id }), ghost: 'road' };
      if (ui.mode === 'settlement') return { kind: 'vertex', ids: E.legalSettlements(s, seat), make: id => ({ type: 'build', kind: 'settlement', vertex: id }), ghost: 'settlement' };
      if (ui.mode === 'city') return { kind: 'vertex', ids: E.legalCities(s, seat), make: id => ({ type: 'build', kind: 'city', vertex: id }), ghost: 'city' };
    }
    return null;
  }

  function canBuildNow() {
    const s = S(), seat = me();
    return (s.phase === 'main' && s.current === seat) || (s.phase === 'special' && E.specialSeat(s) === seat);
  }

  async function commit(it, id) {
    ui.pending = null;
    if (it.robber) {
      const cands = E.stealCandidates(S(), me(), id);
      if (cands.length > 1) { chooseVictim(id, cands); render(); return; }
      await act({ type: 'moveRobber', hex: id });
      return;
    }
    const ok = await act(it.make(id));
    if (ok && ui.mode) { ui.mode = null; render(); }
  }

  el.board.addEventListener('click', e => {
    const g = e.target.closest('[data-kind]');
    if (!g) {
      if (ui.pending) { ui.pending = null; render(); }
      return;
    }
    const it = interaction();
    const kind = g.dataset.kind, id = Number(g.dataset.id);
    if (!it || it.kind !== kind || !it.ids.includes(id)) return;
    const same = ui.pending && ui.pending.kind === kind && ui.pending.id === id;
    if (COARSE && !same) { ui.pending = { kind, id }; render(); return; }
    commit(it, id);
  });

  el.board.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const g = e.target.closest('[data-kind]');
    if (!g) return;
    e.preventDefault();
    const it = interaction();
    const id = Number(g.dataset.id);
    if (it && it.kind === g.dataset.kind && it.ids.includes(id)) commit(it, id);
  });

  // zoom
  root.querySelector('.zoom').addEventListener('click', e => {
    const b = e.target.closest('[data-zoom]');
    if (!b) return;
    const z = b.dataset.zoom;
    ui.zoom = z === 'fit' ? 1 : Math.max(1, Math.min(2.6, ui.zoom * (z === 'in' ? 1.3 : 1 / 1.3)));
    applyZoom();
  });
  function applyZoom() {
    el.board.style.width = `${ui.zoom * 100}%`;
    el.board.style.height = ui.zoom === 1 ? '100%' : 'auto';
    el.scroll.classList.toggle('zoomed', ui.zoom > 1);
  }

  // ------------------------------------------------------------ rendering
  function render() {
    const s = S();
    if (!s) return;
    trackEvents(s);
    updateCover(s);
    renderTop(s);
    renderPlayers(s);
    renderBoard(s);
    renderConsole(s);
    renderLog(s);
    renderBank(s);
    autoDialogs(s);
    refreshDialogs(s);
  }

  function trackEvents(s) {
    const last = s.log.length ? s.log[s.log.length - 1].i : -1;
    if (ui.lastLogI === null) { ui.lastLogI = last; return; }
    const fresh = s.log.filter(e => e.i > ui.lastLogI);
    ui.lastLogI = last;
    const roll = [...fresh].reverse().find(e => e.k === 'roll');
    if (roll) {
      ui.rollAt = Date.now();
      const sum = roll.d[0] + roll.d[1];
      if (sum !== 7) { ui.flash = sum; ui.flashAt = Date.now(); }
      const seat = me();
      if (seat !== null && s.production && s.production[seat]) { ui.gain = s.production[seat]; ui.gainAt = Date.now(); }
    }
    // turn notifications
    const waiting = me() !== null && E.waitingOn(s).includes(me()) && s.phase !== 'over';
    if (waiting && !ui.wasWaiting && online) {
      if (s.phase === 'roll') toast('Your turn');
      if (navigator.vibrate && document.visibilityState === 'visible') try { navigator.vibrate(60); } catch { /* not allowed */ }
    }
    ui.wasWaiting = waiting;
    document.title = waiting ? '● Your move · Hexstead' : 'Hexstead';
  }

  function renderTop(s) {
    let t;
    if (s.phase === 'setup') t = 'Setup';
    else if (s.phase === 'over') t = 'Game over';
    else t = `Turn ${s.turn}`;
    setHTML(el.turn, `${t}<span class="target">${s.settings.vpTarget} to win</span>`);
  }

  function renderPlayers(s) {
    const turnSeat = s.phase === 'setup' ? s.setup.order[s.setup.step] : s.phase === 'special' ? E.specialSeat(s) : s.current;
    const items = s.players.map((p, i) => {
      const vp = E.victoryPoints(s, i);
      const hidden = (i === me() || s.phase === 'over') ? p.dev.filter(c => c.type === 'vp').length : 0;
      const isOn = online && ctrl.isConnected ? ctrl.isConnected(i) : true;
      const cls = ['pl'];
      if (i === turnSeat && s.phase !== 'over') cls.push('is-turn');
      if (i === me()) cls.push('is-me');
      if (s.phase === 'over' && s.winner === i) cls.push('is-winner');
      const waiting = s.phase === 'discard' && s.discards[i] ? '<span class="pl-state">discarding</span>' : '';
      const host = online && ctrl.room && ctrl.room.isHost;
      let tools = '';
      if (online && s.phase !== 'over') {
        if (host && !p.bot && !isOn && i !== me()) tools = `<button type="button" class="link small" data-act="botify" data-seat="${i}">Let a bot play</button>`;
        if (p.bot && p.id === ctrl.uid) tools = `<button type="button" class="link small" data-act="reclaim">Take back your seat</button>`;
      }
      return `<li class="${cls.join(' ')}" style="--pc:${color(i)}">
        <span class="pl-swatch" aria-hidden="true"></span>
        <div class="pl-main">
          <div class="pl-name"><span class="pl-n">${esc(p.name)}</span>${i === me() ? '<span class="pl-tag">you</span>' : ''}${p.bot ? `<span class="pl-tag bot" title="Computer player">${UI.bot}bot</span>` : ''}${online && !p.bot && !isOn ? '<span class="pl-tag off">away</span>' : ''}${waiting}</div>
          <div class="pl-stats">
            <span title="Resource cards">${UI.cards}${E.totalRes(p.res)}</span>
            <span title="Development cards in hand">${UI.dev}${p.dev.length}</span>
            <span title="Knights played">${UI.knights}${p.knights}</span>
            <span title="Longest road length">${UI.road}${s.roadLengths[i] || 0}</span>
          </div>
          ${(s.longestRoad === i || s.largestArmy === i) ? `<div class="pl-badges">${s.longestRoad === i ? '<span class="badge">Longest Road</span>' : ''}${s.largestArmy === i ? '<span class="badge">Largest Army</span>' : ''}</div>` : ''}
          ${tools}
        </div>
        <div class="pl-vp" title="Points${hidden ? ` (+${hidden} hidden)` : ''}"><b>${vp + (s.phase === 'over' ? hidden : 0)}</b>${hidden && s.phase !== 'over' ? `<small>+${hidden}</small>` : ''}</div>
      </li>`;
    });
    setHTML(el.players, `<ul class="plist">${items.join('')}</ul>`);
  }

  function renderBoard(s) {
    const vb = viewBoxFor(!!s.settings.expansion);
    if (el.board.getAttribute('viewBox') !== vb) el.board.setAttribute('viewBox', vb);
    const it = interaction();
    if (ui.pending && (!it || it.kind !== ui.pending.kind || !it.ids.includes(ui.pending.id))) ui.pending = null;
    const since = Date.now() - ui.flashAt;
    const flash = ui.flash && since < 2600 && !REDUCED ? ui.flash : null;
    const seat = me();
    const geo = E.geoOf(s);
    const hexName = h => { const x = s.hexes[h]; return x.terrain === 'desert' ? 'desert' : `${x.number} ${x.terrain}`; };
    const labels = {
      vertex: v => `Corner touching ${geo.vertices[v].hexes.map(hexName).join(', ')}`,
      edge: e => `Side between ${geo.edges[e].v.map(v => geo.vertices[v].hexes.map(hexName).join(' and ')).join(' / ')}`,
      hex: h => `Hex: ${hexName(h)}`,
    };
    const changed = setHTML(el.board, boardMarkup(s, {
      labels,
      targets: it ? { kind: it.kind, ids: it.ids } : null,
      pending: ui.pending,
      ghost: it && it.ghost,
      ghostColor: seat !== null && seat !== undefined ? color(seat) : '#fff',
      flash,
      flashKey: ui.flashAt,
    }));
    if (flash && changed) el.board.querySelectorAll('.flash').forEach(p => (p.style.animationDelay = `-${since}ms`));
    if (flash) clearTimeout(ui.flashTimer), (ui.flashTimer = setTimeout(() => renderBoard(S()), 2700 - since));
    el.board.classList.toggle('interactive', !!it);

    // dice tray: most recent roll this turn
    const lastRoll = [...s.log].reverse().find(e => e.k === 'roll');
    if (lastRoll && s.phase !== 'setup') {
      const sum = lastRoll.d[0] + lastRoll.d[1];
      const rolling = Date.now() - ui.rollAt < 700 && !REDUCED;
      setHTML(el.dice, `<div class="dice${rolling ? ' rolling' : ''}" data-i="${lastRoll.i}" style="--pc:${color(lastRoll.p)}" title="${esc(name(lastRoll.p))} rolled ${sum}">${dieSVG(lastRoll.d[0])}${dieSVG(lastRoll.d[1])}<span class="dice-sum">${sum}</span></div>`);
      el.dice.hidden = false;
    } else {
      el.dice.hidden = true;
    }
  }

  function promptText(s) {
    const seat = me();
    if (s.phase === 'over') return `${tag(s.winner)} wins the game.`;
    if (seat === null || seat === undefined) {
      const w = E.waitingOn(s);
      return w.length ? `Watching. Waiting on ${listNames(w)}.` : 'Watching.';
    }
    if (s.phase === 'setup') {
      const who = s.setup.order[s.setup.step];
      const second = s.setup.step >= s.players.length;
      if (who === seat) {
        if (s.setup.stage === 'settlement') return second
          ? 'Place your second settlement. It collects one card from each hex it touches.'
          : 'Place your first settlement on a highlighted corner.';
        return 'Place a road touching that settlement.';
      }
      return `${tag(who)} is placing their ${second ? 'second' : 'first'} ${s.setup.stage}.`;
    }
    if (s.phase === 'discard') {
      if (s.discards[seat]) return `A 7! You hold more than 7 cards, so discard ${s.discards[seat]}.`;
      return `A 7! Waiting for ${listNames(Object.keys(s.discards).map(Number))} to discard.`;
    }
    if (s.phase === 'special') {
      const sp = E.specialSeat(s);
      if (sp === seat) return ui.mode ? modePrompt() : 'Special build phase: you may build or buy a card before the next turn starts.';
      return `Special build phase: ${tag(sp)} may build.`;
    }
    if (s.current !== seat) {
      if (s.phase === 'roll') return `${tag(s.current)} is about to roll.`;
      if (s.phase === 'robber') return `${tag(s.current)} is moving the robber.`;
      if (s.phase === 'roadBuilding') return `${tag(s.current)} is placing free roads.`;
      return `${tag(s.current)} is trading and building.`;
    }
    if (s.phase === 'roll') return E.playableDev(s, seat).includes('knight') && !s.devPlayed ? 'Your turn. Roll the dice, or play a Knight first.' : 'Your turn. Roll the dice.';
    if (s.phase === 'robber') {
      const t = E.robberTargets(s, seat);
      return t.length ? 'Move the robber: tap a highlighted hex.' : 'Move the robber.';
    }
    if (s.phase === 'roadBuilding') return `Place ${s.freeRoads} free road${s.freeRoads === 1 ? '' : 's'}.`;
    if (ui.mode) return modePrompt();
    return 'Trade and build, then end your turn.';
  }
  function modePrompt() {
    const it = interaction();
    const n = it ? it.ids.length : 0;
    const what = { road: 'road', settlement: 'settlement', city: 'city' }[ui.mode];
    if (!n) return `There’s nowhere to place a ${what} right now.`;
    return ui.mode === 'city' ? 'Tap one of your settlements to upgrade it.' : `Tap a highlighted ${ui.mode === 'road' ? 'side' : 'corner'} to place your ${what}.`;
  }

  function renderConsole(s) {
    const seat = me();
    const it = interaction();
    let extra = '';
    if (ui.pending) extra = `<div class="prompt-acts"><button type="button" class="btn small primary" data-act="confirm">Place here</button><button type="button" class="btn small ghost" data-act="unpend">Cancel</button></div>`;
    else if (ui.mode) extra = `<div class="prompt-acts"><button type="button" class="btn small ghost" data-act="cancel-mode">Cancel</button></div>`;
    else if (it && COARSE) extra = '<div class="prompt-hint">Tap once to preview, again to place.</div>';
    setHTML(el.prompt, `<p>${promptText(s)}</p>${extra}`);
    el.prompt.classList.toggle('mine', seat !== null && E.waitingOn(s).includes(seat));

    renderOffers(s);

    if (seat === null || seat === undefined || coverActive()) {
      setHTML(el.hand, '');
      setHTML(el.actions, '');
      return;
    }
    const p = s.players[seat];
    const gainSince = Date.now() - ui.gainAt;
    const gaining = ui.gain && gainSince < 1600 && !REDUCED;
    const cards = RES.map(r => {
      const g = gaining && ui.gain[r] ? ` gain" data-g="${ui.gainAt}" style="--c:${RES_COLOR[r]}` : `" style="--c:${RES_COLOR[r]}`;
      return `<div class="rcard${p.res[r] ? '' : ' zero'}${g}" title="${RES_LABEL[r]}">
        <span class="rglyph">${RES_GLYPH[r]}</span><b class="rcount">${p.res[r]}</b><span class="rname">${RES_LABEL[r]}</span>
        ${gaining && ui.gain[r] ? `<span class="rplus">+${ui.gain[r]}</span>` : ''}
      </div>`;
    }).join('');
    const groups = {};
    p.dev.forEach(c => { (groups[c.type] = groups[c.type] || { n: 0, ready: 0 }); groups[c.type].n++; if (c.turn < s.turn) groups[c.type].ready++; });
    const devs = E.DEV_TYPES.filter(t => groups[t]).map(t => {
      const g = groups[t];
      const live = t !== 'vp' && devPlayable(s, seat, t) === null;
      return `<button type="button" class="dcard${live ? ' live' : ''}" data-act="dev" data-card="${t}" title="${E.DEV_INFO[t].name}">
        ${DEV_GLYPH[t]}<span>${E.DEV_INFO[t].name}</span>${g.n > 1 ? `<b>×${g.n}</b>` : ''}
      </button>`;
    }).join('');
    setHTML(el.hand, `<div class="hand-res">${cards}</div>${devs ? `<div class="hand-dev">${devs}</div>` : ''}`);

    setHTML(el.actions, actionButtons(s, seat));
  }

  function devPlayable(s, seat, t) {
    const p = s.players[seat];
    if (t === 'vp') return 'Victory point cards count automatically and are revealed when the game ends.';
    if (s.current !== seat) return 'Play it on your turn.';
    if (s.phase !== 'roll' && s.phase !== 'main') return 'Finish what you’re doing first.';
    if (s.devPlayed) return 'You’ve already played a development card this turn.';
    if (!p.dev.some(c => c.type === t && c.turn < s.turn)) return 'Cards bought this turn can be played from your next turn.';
    if (t === 'roadBuilding' && (p.roads <= 0 || !E.legalRoads(s, seat).length)) return 'There’s nowhere to place a road.';
    return null;
  }

  function buildBtn(s, seat, kind) {
    const p = s.players[seat];
    const cost = E.COSTS[kind];
    const can = canBuildNow();
    let left = '', reason = null;
    if (kind === 'road') { left = p.roads; if (!p.roads) reason = 'No roads left'; else if (!E.legalRoads(s, seat).length) reason = 'Nowhere to build'; }
    if (kind === 'settlement') { left = p.settlements; if (!p.settlements) reason = 'No settlements left'; else if (!E.legalSettlements(s, seat).length) reason = 'No open spot on your roads'; }
    if (kind === 'city') { left = p.cities; if (!p.cities) reason = 'No cities left'; else if (!E.legalCities(s, seat).length) reason = 'Needs a settlement'; }
    if (kind === 'dev') { left = s.deck.length; if (!s.deck.length) reason = 'Deck is empty'; }
    const afford = E.hasRes(p.res, cost);
    const enabled = can && afford && !reason;
    const label = { road: 'Road', settlement: 'Settlement', city: 'City', dev: 'Dev card' }[kind];
    const title = !can ? 'Not now' : reason || (afford ? `Build a ${label.toLowerCase()}` : 'Not enough resources');
    const active = ui.mode === kind ? ' active' : '';
    return `<button type="button" class="build${active}" data-act="build" data-kind="${kind}" ${enabled ? '' : 'disabled'} title="${esc(title)}">
      <span class="b-glyph">${PIECE_GLYPH[kind]}</span>
      <span class="b-label">${label}<small>${left} left</small></span>
      ${costChips(cost)}
    </button>`;
  }

  function actionButtons(s, seat) {
    const parts = [];
    const myTurn = s.current === seat;
    if (s.phase === 'over') {
      return `<div class="acts-row">${online
        ? (ctrl.room && ctrl.room.isHost ? '<button type="button" class="btn primary" data-act="lobby">Back to lobby</button>' : '')
        : '<button type="button" class="btn primary" data-act="new-game">New game</button>'}
        <button type="button" class="btn" data-act="results">Results</button></div>`;
    }
    if (s.phase === 'discard' && s.discards[seat]) parts.push('<button type="button" class="btn primary" data-act="discard">Choose cards to discard</button>');
    if (s.phase === 'roll' && myTurn) parts.push('<button type="button" class="btn primary big" data-act="roll">Roll dice</button>');
    if (s.phase === 'roadBuilding' && myTurn) parts.push('<button type="button" class="btn" data-act="finish-roads">Stop placing roads</button>');
    const showBuild = (s.phase === 'main' && myTurn) || (s.phase === 'special' && E.specialSeat(s) === seat);
    let builds = '';
    if (showBuild) builds = `<div class="builds">${['road', 'settlement', 'city', 'dev'].map(k => buildBtn(s, seat, k)).join('')}</div>`;
    const row = [];
    if (s.phase === 'main' && myTurn) {
      row.push(`<button type="button" class="btn" data-act="trade">${UI.trade}Trade</button>`);
      row.push('<button type="button" class="btn primary" data-act="end">End turn</button>');
    } else if (s.phase === 'main' && !myTurn && !s.players[s.current].bot) {
      row.push(`<button type="button" class="btn" data-act="trade">${UI.trade}Propose a trade</button>`);
    } else if (s.phase === 'main' && !myTurn) {
      row.push(`<button type="button" class="btn" data-act="trade">${UI.trade}Propose a trade</button>`);
    }
    if (s.phase === 'special' && E.specialSeat(s) === seat) row.push('<button type="button" class="btn primary" data-act="pass-special">Done building</button>');
    return `${parts.length ? `<div class="acts-row">${parts.join('')}</div>` : ''}${builds}${row.length ? `<div class="acts-row">${row.join('')}</div>` : ''}`;
  }

  function renderOffers(s) {
    const seat = me();
    const out = [];
    if (s.phase === 'main' && seat !== null && seat !== undefined && !coverActive()) {
      const o = s.offer;
      if (o && s.current === seat) {
        const rows = s.players.map((p, i) => {
          if (i === seat) return '';
          const r = o.responses[i];
          // pass-and-play: people sharing this device answer right here
          const local = ctrl.kind === 'local' && ctrl.canActFor && ctrl.canActFor(i);
          const has = E.hasRes(p.res, o.want);
          const st = r === 'accept'
            ? `<button type="button" class="btn small primary" data-act="confirm-trade" data-with="${i}">Trade with ${esc(p.name)}</button>`
            : r === 'decline' ? '<span class="muted">declined</span>'
            : local ? `<span class="offer-acts"><button type="button" class="btn small" data-act="respond-for" data-seat="${i}" data-accept="1" ${has ? '' : `disabled title="${esc(p.name)} doesn’t have those cards"`}>${esc(p.name)} accepts</button><button type="button" class="btn small ghost" data-act="respond-for" data-seat="${i}" data-accept="0">Declines</button></span>`
            : '<span class="muted">thinking…</span>';
          return `<li><span class="ptag" style="--pc:${color(i)}">${esc(p.name)}</span>${st}</li>`;
        }).join('');
        out.push(`<div class="offer mine"><div class="offer-line">You offer ${resList(o.give)} for ${resList(o.want)}</div><ul class="responses">${rows}</ul><button type="button" class="link small" data-act="cancel-offer">Cancel offer</button></div>`);
      } else if (o && s.current !== seat) {
        const r = o.responses[seat];
        const can = E.hasRes(s.players[seat].res, o.want);
        out.push(`<div class="offer incoming"><div class="offer-line">${tag(s.current)} offers ${resList(o.give)} for your ${resList(o.want)}</div>
          <div class="offer-acts">
            <button type="button" class="btn small ${r === 'accept' ? 'primary' : ''}" data-act="respond" data-accept="1" ${can ? '' : 'disabled title="You don’t have those cards"'}>${r === 'accept' ? 'Accepted' : 'Accept'}</button>
            <button type="button" class="btn small ${r === 'decline' ? 'primary' : 'ghost'}" data-act="respond" data-accept="0">${r === 'decline' ? 'Declined' : 'Decline'}</button>
            ${r === 'accept' ? `<span class="muted">Waiting for ${esc(name(s.current))}…</span>` : ''}
          </div></div>`);
      }
      for (const [from, c] of Object.entries(s.counters || {})) {
        const f = Number(from);
        if (s.current === seat) {
          const can = E.hasRes(s.players[seat].res, c.want);
          out.push(`<div class="offer incoming"><div class="offer-line">${tag(f)} offers ${resList(c.give)} for your ${resList(c.want)}</div>
            <div class="offer-acts"><button type="button" class="btn small" data-act="accept-counter" data-from="${f}" ${can ? '' : 'disabled'}>Accept</button>
            <button type="button" class="btn small ghost" data-act="reject-counter" data-from="${f}">Decline</button></div></div>`);
        } else if (f === seat) {
          out.push(`<div class="offer mine"><div class="offer-line">You offered ${tag(s.current)} ${resList(c.give)} for ${resList(c.want)}</div>
            <button type="button" class="link small" data-act="withdraw-counter">Withdraw</button></div>`);
        }
      }
    }
    setHTML(el.offers, out.join(''));
    el.offers.hidden = !out.length;
  }

  function renderLog(s) {
    const seat = me();
    // merge the synced tail into a longer local history
    const cache = ui.logCache || (ui.logCache = new Map());
    const lastI = s.log.length ? s.log[s.log.length - 1].i : -1;
    if (lastI < (ui.logMax ?? -1)) cache.clear(); // a new game started
    ui.logMax = lastI;
    for (const e of s.log) cache.set(e.i, e);
    if (cache.size > 300) [...cache.keys()].slice(0, cache.size - 300).forEach(k => cache.delete(k));
    const items = [...cache.values()].slice(-150).map(e => {
      let m = esc(e.m);
      if (e.secret && seat !== null && e.secret.to.includes(seat)) {
        if (e.secret.res) m = m.replace('a card', `1 ${e.secret.res}`);
        if (e.secret.dev) m += ` <span class="muted">(${esc(E.DEV_INFO[e.secret.dev].name)})</span>`;
      }
      if (e.k === 'roll' && e.d) m = m.replace(/rolled (\d+)/, (x, n) => `rolled <b class="num${n === '7' ? ' seven' : ''}">${n}</b>`);
      m = m.replace('{o}', tag(e.o));
      const who = e.p !== undefined && e.p !== null ? `${tag(e.p)} ` : '';
      return `<li class="lk-${e.k || 'info'}">${who}${m}</li>`;
    });
    const atBottom = el.log.scrollHeight - el.log.scrollTop - el.log.clientHeight < 40;
    if (!setHTML(el.log, items.join(''))) return;
    if (atBottom || !el.log.dataset.init) { el.log.scrollTop = el.log.scrollHeight; el.log.dataset.init = '1'; }
  }

  function renderBank(s) {
    setHTML(el.bank, `<span class="bank-label">Bank</span>${RES.map(r => `<span class="bank-item" title="${RES_LABEL[r]} left in the bank">${resChip(r, s.bank[r], { always: true })}</span>`).join('')}<span class="bank-item" title="Development cards left">${UI.dev}<b>${s.deck.length}</b></span>`);
  }

  // ------------------------------------------------------------ pass-and-play cover
  function coverActive() { return !el.cover.hidden; }
  function updateCover(s) {
    if (!multiHuman() || s.phase === 'over') { el.cover.hidden = true; ui.shownSeat = me(); return; }
    const seat = me();
    if (ui.shownSeat === null) ui.shownSeat = seat;
    if (seat !== ui.shownSeat) {
      el.cover.hidden = false;
      el.cover.innerHTML = `<div class="cover-card" style="--pc:${color(seat)}"><p>Pass the device to</p><h2>${esc(name(seat))}</h2><button type="button" class="btn primary" data-act="uncover">I’m ${esc(name(seat))} — show my cards</button></div>`;
    }
  }
  el.cover.addEventListener('click', e => {
    if (!e.target.closest('[data-act="uncover"]')) return;
    ui.shownSeat = me();
    el.cover.hidden = true;
    render();
  });

  // ------------------------------------------------------------ auto dialogs
  function autoDialogs(s) {
    const seat = me();
    if (s.phase === 'discard' && seat !== null && s.discards[seat] && !ui.discardDlg && !coverActive()) openDiscard();
    if (s.phase === 'over' && !ui.overShown) { ui.overShown = true; setTimeout(openResults, 600); }
  }

  // ------------------------------------------------------------ dialogs
  function stepperRows(state, opts) {
    // state: { [res]: n }, opts: { max(r), label }
    return RES.map(r => {
      const max = opts.max(r);
      return `<div class="stepper" style="--c:${RES_COLOR[r]}">
        <span class="st-res">${RES_GLYPH[r]}<span>${RES_LABEL[r]}</span>${opts.note ? `<small>${opts.note(r)}</small>` : ''}</span>
        <button type="button" class="icon-btn small" data-step="-1" data-res="${r}" data-group="${opts.group}" ${state[r] <= 0 ? 'disabled' : ''} aria-label="Less ${r}">${UI.minus}</button>
        <b class="st-n">${state[r]}</b>
        <button type="button" class="icon-btn small" data-step="1" data-res="${r}" data-group="${opts.group}" ${state[r] >= max ? 'disabled' : ''} aria-label="More ${r}">${UI.plus}</button>
      </div>`;
    }).join('');
  }

  function openDiscard() {
    const pick = E.emptyRes();
    const dlg = openDialog({
      title: 'Discard cards',
      dismissible: false,
      className: 'discard',
      onClose: () => { ui.discardDlg = null; },
      refresh: s => {
        if (s.phase !== 'discard' || !s.discards[me()]) { dlg.close(); return; }
        draw();
      },
    });
    ui.discardDlg = dlg;
    function draw() {
      const s = S(), seat = me();
      const need = s.discards[seat];
      if (!need) return;
      const p = s.players[seat];
      const n = E.totalRes(pick);
      setHTML(dlg.body, `<p>You have ${E.totalRes(p.res)} cards. Choose ${need} to give back to the bank.</p>
        <div class="steppers">${stepperRows(pick, { group: 'd', max: r => Math.min(p.res[r], pick[r] + (need - n)) , note: r => `of ${p.res[r]}` })}</div>
        <div class="sheet-foot"><span class="muted">${n} of ${need} chosen</span><button type="button" class="btn primary" data-act="do-discard" ${n === need ? '' : 'disabled'}>Discard ${need}</button></div>`);
    }
    dlg.body.addEventListener('click', async e => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.step) { pick[b.dataset.res] += Number(b.dataset.step); draw(); }
      if (b.dataset.act === 'do-discard') {
        b.disabled = true;
        if (await act({ type: 'discard', res: { ...pick } })) dlg.close(); else b.disabled = false;
      }
    });
    draw();
  }

  function chooseVictim(hex, cands) {
    const s = S();
    const dlg = openDialog({
      title: 'Steal from whom?',
      body: `<p>Pick a player to steal one random card from.</p><div class="choices">${cands.map(i => `<button type="button" class="choice" data-v="${i}" style="--pc:${color(i)}"><span class="ptag" style="--pc:${color(i)}">${esc(name(i))}</span><small>${E.totalRes(s.players[i].res)} cards</small></button>`).join('')}</div>`,
      refresh: st => { if (st.phase !== 'robber' || st.current !== me()) dlg.close(); },
    });
    dlg.body.addEventListener('click', async e => {
      const b = e.target.closest('[data-v]');
      if (!b) return;
      dlg.close();
      await act({ type: 'moveRobber', hex, victim: Number(b.dataset.v) });
    });
  }

  function openDev(type) {
    const dlg = openDialog({ title: E.DEV_INFO[type].name, className: 'dev', refresh: () => draw() });
    const yop = E.emptyRes();
    let mono = null;
    function draw() {
      const s = S(), seat = me();
      const p = s.players[seat];
      const count = p.dev.filter(c => c.type === type).length;
      if (!count) { dlg.close(); return; }
      const reason = devPlayable(s, seat, type);
      let controls = '';
      if (!reason && type === 'yearOfPlenty') {
        const n = E.totalRes(yop);
        controls = `<div class="steppers">${stepperRows(yop, { group: 'y', max: r => Math.min(s.bank[r], yop[r] + (2 - n)), note: r => `${s.bank[r]} in bank` })}</div>`;
      }
      if (!reason && type === 'monopoly') {
        controls = `<div class="choices res">${RES.map(r => `<button type="button" class="choice${mono === r ? ' on' : ''}" data-mono="${r}" style="--c:${RES_COLOR[r]}">${RES_GLYPH[r]}<span>${RES_LABEL[r]}</span></button>`).join('')}</div>`;
      }
      const ready = type === 'yearOfPlenty' ? E.totalRes(yop) === 2 : type === 'monopoly' ? !!mono : true;
      setHTML(dlg.body, `<div class="dev-hero">${DEV_GLYPH[type]}<p>${esc(E.DEV_INFO[type].text)}</p></div>
        <p class="muted">You hold ${count}.</p>
        ${controls}
        <div class="sheet-foot">${reason ? `<span class="muted">${esc(reason)}</span>` : ''}
        ${type === 'vp' ? '' : `<button type="button" class="btn primary" data-act="play" ${!reason && ready ? '' : 'disabled'}>Play ${esc(E.DEV_INFO[type].name)}</button>`}</div>`);
    }
    dlg.body.addEventListener('click', async e => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.step) { yop[b.dataset.res] += Number(b.dataset.step); draw(); return; }
      if (b.dataset.mono) { mono = b.dataset.mono; draw(); return; }
      if (b.dataset.act === 'play') {
        const a = { type: 'playDev', card: type };
        if (type === 'yearOfPlenty') a.res = RES.flatMap(r => Array(yop[r]).fill(r));
        if (type === 'monopoly') a.res = mono;
        dlg.close();
        await act(a);
      }
    });
    draw();
  }

  function openTrade(startTab) {
    const t = { tab: startTab, give: E.emptyRes(), get: E.emptyRes(), bGive: null, bGet: null };
    const dlg = openDialog({ title: 'Trade', className: 'trade', refresh: () => draw() });
    function draw() {
      const s = S(), seat = me();
      const myTurn = s.current === seat && s.phase === 'main';
      if (s.phase !== 'main' || seat === null) { dlg.close(); return; }
      if (!myTurn) t.tab = 'players';
      const p = s.players[seat];
      const tabs = myTurn ? `<div class="seg" role="tablist">
          <button type="button" role="tab" data-ttab="players" aria-selected="${t.tab === 'players'}">Players</button>
          <button type="button" role="tab" data-ttab="bank" aria-selected="${t.tab === 'bank'}">Bank &amp; harbors</button></div>` : '';
      let body = '';
      if (t.tab === 'players') {
        RES.forEach(r => { if (t.give[r] > p.res[r]) t.give[r] = p.res[r]; });
        const valid = E.totalRes(t.give) > 0 && E.totalRes(t.get) > 0 && RES.every(r => !(t.give[r] && t.get[r]));
        body = `<div class="trade-cols">
          <div><h3>You give</h3><div class="steppers">${stepperRows(t.give, { group: 'g', max: r => p.res[r], note: r => `of ${p.res[r]}` })}</div></div>
          <div><h3>You get</h3><div class="steppers">${stepperRows(t.get, { group: 't', max: () => 9 })}</div></div>
        </div>
        <div class="sheet-foot">${valid ? '' : '<span class="muted">Pick cards on both sides, different resources.</span>'}
          <button type="button" class="btn primary" data-act="send-offer" ${valid ? '' : 'disabled'}>${myTurn ? 'Offer to everyone' : `Propose to ${esc(name(s.current))}`}</button></div>`;
      } else {
        const ratios = E.tradeRatios(s, seat);
        if (t.bGive && p.res[t.bGive] < ratios[t.bGive]) t.bGive = null;
        const giveRow = RES.map(r => {
          const ok = p.res[r] >= ratios[r];
          return `<button type="button" class="choice${t.bGive === r ? ' on' : ''}" data-bgive="${r}" style="--c:${RES_COLOR[r]}" ${ok ? '' : 'disabled'}>${RES_GLYPH[r]}<span>${ratios[r]}:1</span><small>have ${p.res[r]}</small></button>`;
        }).join('');
        const getRow = RES.map(r => {
          const ok = s.bank[r] > 0 && r !== t.bGive;
          return `<button type="button" class="choice${t.bGet === r ? ' on' : ''}" data-bget="${r}" style="--c:${RES_COLOR[r]}" ${ok ? '' : 'disabled'}>${RES_GLYPH[r]}<span>${RES_LABEL[r]}</span><small>${s.bank[r]} left</small></button>`;
        }).join('');
        const ready = t.bGive && t.bGet && t.bGive !== t.bGet;
        body = `<h3>Give</h3><div class="choices res">${giveRow}</div>
          <h3>Get 1</h3><div class="choices res">${getRow}</div>
          <div class="sheet-foot"><button type="button" class="btn primary" data-act="bank-trade" ${ready ? '' : 'disabled'}>${ready ? `Trade ${ratios[t.bGive]} ${t.bGive} for 1 ${t.bGet}` : 'Pick what to give and get'}</button></div>`;
      }
      setHTML(dlg.body, tabs + body);
    }
    dlg.body.addEventListener('click', async e => {
      const b = e.target.closest('button');
      if (!b || b.disabled) return;
      const s = S();
      if (b.dataset.ttab) { t.tab = b.dataset.ttab; draw(); return; }
      if (b.dataset.step) {
        const tgt = b.dataset.group === 'g' ? t.give : t.get;
        tgt[b.dataset.res] = Math.max(0, tgt[b.dataset.res] + Number(b.dataset.step));
        const other = b.dataset.group === 'g' ? t.get : t.give;
        if (tgt[b.dataset.res] > 0) other[b.dataset.res] = 0;
        draw(); return;
      }
      if (b.dataset.bgive) { t.bGive = b.dataset.bgive; if (t.bGet === t.bGive) t.bGet = null; draw(); return; }
      if (b.dataset.bget) { t.bGet = b.dataset.bget; draw(); return; }
      if (b.dataset.act === 'send-offer') {
        const myTurn = s.current === me();
        const a = { type: myTurn ? 'offerTrade' : 'counterOffer', give: { ...t.give }, want: { ...t.get } };
        if (await act(a)) dlg.close();
      }
      if (b.dataset.act === 'bank-trade') {
        if (await act({ type: 'bankTrade', give: t.bGive, get: t.bGet })) { t.bGet = null; draw(); toast('Traded with the bank'); }
      }
    });
    draw();
  }

  function openResults() {
    const s = S();
    if (s.phase !== 'over') return;
    const rows = s.players.map((p, i) => {
      const b = Object.values(s.buildings).filter(x => x.p === i);
      return {
        i, p, total: E.victoryPoints(s, i, true),
        setl: b.filter(x => !x.city).length, cities: b.filter(x => x.city).length,
        vpc: p.dev.filter(c => c.type === 'vp').length,
      };
    }).sort((a, b) => b.total - a.total || (a.i === s.winner ? -1 : 1));
    const max = Math.max(1, ...Object.values(s.stats.rolls));
    const bars = Object.entries(s.stats.rolls).map(([n, c]) => `<div class="bar"><span style="height:${(c / max) * 100}%"></span><b>${c}</b><i>${n}</i></div>`).join('');
    const host = online && ctrl.room && ctrl.room.isHost;
    const dlg = openDialog({
      title: `${name(s.winner)} wins`,
      className: 'results',
      body: `<ol class="ranking">${rows.map(r => `<li style="--pc:${color(r.i)}"><span class="ptag" style="--pc:${color(r.i)}">${esc(r.p.name)}</span>
        <span class="muted">${[r.setl && `${r.setl} settlement${r.setl > 1 ? 's' : ''}`, r.cities && `${r.cities} cit${r.cities > 1 ? 'ies' : 'y'}`, s.longestRoad === r.i && 'Longest Road', s.largestArmy === r.i && 'Largest Army', r.vpc && `${r.vpc} point card${r.vpc > 1 ? 's' : ''}`].filter(Boolean).join(', ')}</span>
        <b>${r.total}</b></li>`).join('')}</ol>
        <h3>Dice rolls</h3><div class="histo">${bars}</div>
        <div class="sheet-foot">${online ? (host ? '<button type="button" class="btn primary" data-act="lobby">Back to lobby</button>' : '<span class="muted">The host can start a rematch.</span>') : '<button type="button" class="btn primary" data-act="new-game">New game</button>'}
        <button type="button" class="btn" data-act="home">${online ? 'Leave room' : 'Home'}</button></div>`,
    });
    dlg.body.addEventListener('click', e => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      dlg.close();
      handleAct(b.dataset.act, b);
    });
  }

  function openMenu() {
    const dlg = openDialog({
      title: 'Menu',
      className: 'menu',
      body: `<div class="menu-list">
        <button type="button" class="btn" data-act="rules">How to play</button>
        ${online ? '<button type="button" class="btn" data-act="copy-link">Copy invite link</button>' : ''}
        ${online ? '<button type="button" class="btn" data-act="home">Leave room</button>' : '<button type="button" class="btn" data-act="home">Save and go home</button>'}
        ${!online ? '<button type="button" class="btn danger" data-act="abandon">End this game</button>' : ''}
      </div>`,
    });
    dlg.body.addEventListener('click', e => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      dlg.close();
      handleAct(b.dataset.act, b);
    });
  }

  function openRules() {
    openDialog({ title: 'How to play', className: 'rules-sheet', body: rulesHTML });
  }

  // ------------------------------------------------------------ click routing
  async function handleAct(a, b) {
    const s = S();
    switch (a) {
      case 'menu': openMenu(); break;
      case 'rules': openRules(); break;
      case 'copy-link': if (ctrl.room) { await copyText(ctrl.room.link); toast('Invite link copied'); } break;
      case 'home': if (hooks.onExit) hooks.onExit(); break;
      case 'abandon': if (confirm('End this game? It can’t be resumed.')) { if (ctrl.finish) ctrl.finish(); if (hooks.onExit) hooks.onExit(); } break;
      case 'new-game': if (ctrl.finish) ctrl.finish(); if (hooks.onNewGame) hooks.onNewGame(); break;
      case 'lobby': if (ctrl.backToLobby) await ctrl.backToLobby(); break;
      case 'results': openResults(); break;
      case 'roll': await act({ type: 'roll' }); break;
      case 'end': ui.mode = null; await act({ type: 'endTurn' }); break;
      case 'pass-special': ui.mode = null; await act({ type: 'passSpecial' }); break;
      case 'finish-roads': await act({ type: 'finishRoads' }); break;
      case 'discard': if (!ui.discardDlg) openDiscard(); break;
      case 'trade': openTrade(s.current === me() ? 'players' : 'players'); break;
      case 'build': {
        const kind = b.dataset.kind;
        if (kind === 'dev') { await act({ type: 'buyDev' }); break; }
        ui.mode = ui.mode === kind ? null : kind;
        ui.pending = null;
        render();
        break;
      }
      case 'cancel-mode': ui.mode = null; ui.pending = null; render(); break;
      case 'unpend': ui.pending = null; render(); break;
      case 'confirm': {
        const it = interaction();
        if (it && ui.pending) commit(it, ui.pending.id);
        break;
      }
      case 'dev': openDev(b.dataset.card); break;
      case 'respond': await act({ type: 'respondTrade', id: s.offer && s.offer.id, accept: b.dataset.accept === '1' }); break;
      case 'respond-for':
        try { await ctrl.act({ type: 'respondTrade', id: s.offer && s.offer.id, accept: b.dataset.accept === '1' }, Number(b.dataset.seat)); }
        catch (err) { toast(err.message, 'error'); }
        break;
      case 'confirm-trade': await act({ type: 'confirmTrade', id: s.offer && s.offer.id, with: Number(b.dataset.with) }); break;
      case 'cancel-offer': await act({ type: 'cancelOffer' }); break;
      case 'accept-counter': { const f = Number(b.dataset.from); await act({ type: 'acceptCounter', from: f, id: s.counters[f] && s.counters[f].id }); break; }
      case 'reject-counter': await act({ type: 'rejectCounter', from: Number(b.dataset.from) }); break;
      case 'withdraw-counter': await act({ type: 'withdrawCounter' }); break;
      case 'botify': if (ctrl.replaceWithBot && confirm(`Let a bot play for ${name(Number(b.dataset.seat))}? They can take their seat back when they return.`)) await ctrl.replaceWithBot(Number(b.dataset.seat)); break;
      case 'reclaim': if (ctrl.reclaim) await ctrl.reclaim(); break;
      default: break;
    }
  }

  root.addEventListener('click', e => {
    const b = e.target.closest('[data-act]');
    if (!b || b.disabled || !root.contains(b) || b.closest('.cover')) return;
    handleAct(b.dataset.act, b);
  });

  // tabs
  root.querySelector('.tabs').addEventListener('click', e => {
    const b = e.target.closest('[data-tab]');
    if (!b) return;
    ui.tab = b.dataset.tab;
    root.querySelectorAll('[data-tab]').forEach(x => x.setAttribute('aria-selected', String(x === b)));
    root.querySelectorAll('[data-pane]').forEach(p => (p.hidden = p.dataset.pane !== ui.tab));
    if (ui.tab === 'chat') { ui.chatSeen = ctrl.chat ? ctrl.chat.messages.length : 0; el.unread.hidden = true; el.chatList.scrollTop = el.chatList.scrollHeight; }
  });

  // chat
  function renderChat() {
    if (!ctrl.chat) return;
    const msgs = ctrl.chat.messages;
    el.chatList.innerHTML = msgs.map(m => {
      const seat = S().players.findIndex(p => p.id === m.uid);
      const who = seat >= 0 ? tag(seat) : `<b class="ptag">${esc(m.name)}</b>`;
      return `<li>${who} ${esc(m.text)}</li>`;
    }).join('') || '<li class="muted">No messages yet.</li>';
    el.chatList.scrollTop = el.chatList.scrollHeight;
    if (ui.tab !== 'chat' && msgs.length > ui.chatSeen) { el.unread.hidden = false; el.unread.textContent = String(msgs.length - ui.chatSeen); }
  }
  el.chatForm.addEventListener('submit', async e => {
    e.preventDefault();
    const input = el.chatForm.elements.msg;
    const text = input.value.trim();
    if (!text || !ctrl.chat) return;
    input.value = '';
    try { await ctrl.chat.send(text); } catch (err) { toast(err.message || 'Message not sent', 'error'); }
  });
  if (ctrl.chat) { ui.chatSeen = ctrl.chat.messages.length; unsubs.push(ctrl.chat.onChange(renderChat)); renderChat(); }

  // keyboard: Escape cancels build mode
  const onKey = e => {
    if (e.key === 'Escape' && (ui.mode || ui.pending) && !document.querySelector('dialog[open]')) { ui.mode = null; ui.pending = null; render(); }
  };
  document.addEventListener('keydown', onKey);

  unsubs.push(ctrl.onChange(() => render()));
  applyZoom();
  render();

  return {
    render,
    destroy() {
      unsubs.forEach(u => u && u());
      document.removeEventListener('keydown', onKey);
      closeAllDialogs();
      document.title = 'Hexstead';
      root.innerHTML = '';
    },
  };
}
