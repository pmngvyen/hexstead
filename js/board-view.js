// SVG board renderer. Produces markup from the game state plus a small view model
// (targets to highlight, pending selection, last roll to flash).

import { getGeometry, hexCorners } from './geometry.js';
import { PIPS, TERRAIN_RESOURCE } from './engine.js';
import { RES_GLYPH } from './icons.js';

export const S = 60; // svg units per hex radius

export const TERRAIN = {
  forest: { color: '#2F6A49', name: 'Forest', res: 'lumber' },
  pasture: { color: '#8DBF63', name: 'Pasture', res: 'wool' },
  fields: { color: '#E2B243', name: 'Fields', res: 'grain' },
  hills: { color: '#C2603C', name: 'Hills', res: 'brick' },
  mountains: { color: '#7C8496', name: 'Mountains', res: 'ore' },
  desert: { color: '#D9C894', name: 'Desert', res: null },
};
export const RES_COLOR = { brick: '#C2603C', lumber: '#2F6A49', wool: '#8DBF63', grain: '#E2B243', ore: '#7C8496' };

export const PLAYER_COLORS = [
  { id: 'red', hex: '#E0453B', name: 'Red' },
  { id: 'blue', hex: '#3C7FE0', name: 'Blue' },
  { id: 'white', hex: '#F3F1EA', name: 'White' },
  { id: 'orange', hex: '#F28A26', name: 'Orange' },
  { id: 'green', hex: '#38A85B', name: 'Green' },
  { id: 'purple', hex: '#9A5AD8', name: 'Purple' },
  { id: 'teal', hex: '#1FB3A6', name: 'Teal' },
  { id: 'pink', hex: '#E866A0', name: 'Pink' },
];
export const colorHex = id => (PLAYER_COLORS.find(c => c.id === id) || PLAYER_COLORS[0]).hex;

const f = n => (Math.round(n * 10) / 10).toString();
const esc = v => String(v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pts = arr => arr.map(([x, y]) => `${f(x * S)},${f(y * S)}`).join(' ');

export function viewBoxFor(expansion) {
  const b = getGeometry(expansion).bounds;
  const m = 0.15;
  return `${f((b.minX - m) * S)} ${f((b.minY - m) * S)} ${f((b.maxX - b.minX + 2 * m) * S)} ${f((b.maxY - b.minY + 2 * m) * S)}`;
}

const DEFS = `
<defs>
  <pattern id="pt-sea" width="44" height="22" patternUnits="userSpaceOnUse">
    <path d="M2 14c5-5 9-5 14 0M24 6c5-5 9-5 14 0" fill="none" stroke="#7FB0C9" stroke-opacity=".22" stroke-width="2" stroke-linecap="round"/>
  </pattern>
  <pattern id="pt-forest" width="20" height="18" patternUnits="userSpaceOnUse">
    <path d="M6 3 10.5 11h-9zM16 11.5l4 7h-8z" fill="#0B2A1B" fill-opacity=".38"/>
  </pattern>
  <pattern id="pt-pasture" width="18" height="14" patternUnits="userSpaceOnUse">
    <path d="M2 9q2-4 4 0q2-4 4 0M11 3q1.5-3 3 0q1.5-3 3 0" fill="none" stroke="#1F4A17" stroke-opacity=".32" stroke-width="1.5" stroke-linecap="round"/>
  </pattern>
  <pattern id="pt-fields" width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(-30)">
    <path d="M0 3h12M0 9h12" stroke="#7A4E07" stroke-opacity=".28" stroke-width="2" stroke-dasharray="4 2"/>
  </pattern>
  <pattern id="pt-hills" width="20" height="12" patternUnits="userSpaceOnUse">
    <path d="M0 0.75h20M0 6.75h20M5 0v6M15 6v6" stroke="#4A160A" stroke-opacity=".32" stroke-width="1.5"/>
  </pattern>
  <pattern id="pt-mountains" width="22" height="16" patternUnits="userSpaceOnUse">
    <path d="M1 13 6 5l5 8M12 9l4-6 5 6" fill="none" stroke="#1C2230" stroke-opacity=".4" stroke-width="1.6" stroke-linejoin="round"/>
  </pattern>
  <pattern id="pt-desert" width="14" height="14" patternUnits="userSpaceOnUse">
    <circle cx="3" cy="4" r="1.2" fill="#6B5321" fill-opacity=".35"/><circle cx="10" cy="11" r="1.2" fill="#6B5321" fill-opacity=".35"/>
  </pattern>
</defs>`;

function token(hx, x, y) {
  if (!hx.number) return '';
  const red = hx.number === 6 || hx.number === 8;
  const pips = PIPS[hx.number];
  const r = 0.33 * S;
  let dots = '';
  const gap = 0.085 * S;
  for (let i = 0; i < pips; i++) {
    dots += `<circle cx="${f(x + (i - (pips - 1) / 2) * gap)}" cy="${f(y + 0.17 * S)}" r="${f(0.032 * S)}"/>`;
  }
  return `<g class="token${red ? ' hot' : ''}">
    <circle cx="${f(x)}" cy="${f(y)}" r="${f(r)}" class="token-disc"/>
    <text x="${f(x)}" y="${f(y + 0.07 * S)}" class="token-num">${hx.number}</text>
    <g class="token-pips">${dots}</g>
  </g>`;
}

function robber(x, y) {
  const s = S / 60;
  return `<g class="robber" transform="translate(${f(x)} ${f(y)}) scale(${f(s)})">
    <ellipse cx="0" cy="19" rx="13" ry="4" class="robber-shadow"/>
    <path d="M-11 18c0-9 2-15 6-18a9 9 0 1 1 10 0c4 3 6 9 6 18z" class="robber-body"/>
  </g>`;
}

function house(x, y, city) {
  const p = city
    ? [[-0.3, 0.2], [-0.3, -0.1], [-0.15, -0.27], [0, -0.1], [0, -0.03], [0.3, -0.03], [0.3, 0.2]]
    : [[-0.19, 0.17], [-0.19, -0.05], [0, -0.23], [0.19, -0.05], [0.19, 0.17]];
  return p.map(([a, b]) => `${f(x + a * S)},${f(y + b * S)}`).join(' ');
}

function roadLine(geo, e, inset = 0.2) {
  const [a, b] = geo.edges[e].v.map(v => geo.vertices[v]);
  const dx = b.x - a.x, dy = b.y - a.y;
  return [
    (a.x + dx * inset) * S, (a.y + dy * inset) * S,
    (b.x - dx * inset) * S, (b.y - dy * inset) * S,
  ].map(f);
}

/**
 * view: { targets: {kind:'vertex'|'edge'|'hex', ids:number[]}, pending:{kind,id}, ghost, ghostColor,
 *         flash: number, colors: string[] (hex per seat), lastBuilt }
 */
export function boardMarkup(state, view = {}) {
  const geo = getGeometry(!!state.settings.expansion);
  const colors = view.colors || state.players.map(p => colorHex(p.color));
  const out = [DEFS];

  // sea frame
  out.push('<g class="sea">');
  for (const h of geo.sea) out.push(`<polygon points="${pts(hexCorners(h.x, h.y, 1.0))}" class="sea-hex"/>`);
  out.push('</g>');

  // harbors
  out.push('<g class="harbors">');
  for (const hb of state.harbors) {
    const e = geo.edges[hb.edge];
    const [ox, oy] = geo.outward[hb.edge];
    const cx = (e.x + ox * 0.62) * S, cy = (e.y + oy * 0.62) * S;
    for (const v of e.v) {
      const vx = geo.vertices[v].x * S, vy = geo.vertices[v].y * S;
      out.push(`<line x1="${f(vx + (cx - vx) * 0.18)}" y1="${f(vy + (cy - vy) * 0.18)}" x2="${f(vx + (cx - vx) * 0.78)}" y2="${f(vy + (cy - vy) * 0.78)}" class="pier"/>`);
    }
    const label = hb.type === 'any' ? '3:1' : '2:1';
    const fill = hb.type === 'any' ? '#EEF3EF' : RES_COLOR[hb.type];
    const glyph = hb.type === 'any' ? '' : `<g transform="translate(${f(cx - 0.15 * S)} ${f(cy - 0.21 * S)}) scale(${f(0.3 * S / 24)})" class="harbor-glyph">${RES_GLYPH[hb.type].replace(/<\/?svg[^>]*>/g, '')}</g>`;
    out.push(`<g class="harbor ${hb.type === 'any' ? 'any' : 'res'}" data-tip="${hb.type === 'any' ? '3:1 harbor — trade any 3 of a kind for 1' : `2:1 ${hb.type} harbor`}">
      <circle cx="${f(cx)}" cy="${f(cy)}" r="${f(0.27 * S)}" fill="${fill}" class="harbor-disc"/>
      ${glyph}
      <text x="${f(cx)}" y="${f(cy + (hb.type === 'any' ? 0.07 * S : 0.2 * S))}" class="harbor-label">${label}</text>
    </g>`);
  }
  out.push('</g>');

  // land
  out.push('<g class="land">');
  geo.hexes.forEach(h => {
    const hx = state.hexes[h.id];
    const t = TERRAIN[hx.terrain];
    const poly = pts(hexCorners(h.x, h.y, 0.985));
    out.push(`<g class="hex" data-terrain="${hx.terrain}">
      <polygon points="${poly}" fill="${t.color}" class="hex-fill"/>
      <polygon points="${poly}" fill="url(#pt-${hx.terrain})" class="hex-tex"/>
      ${token(hx, h.x * S, h.y * S)}
    </g>`);
  });
  if (view.flash) {
    geo.hexes.forEach(h => {
      if (state.hexes[h.id].number === view.flash) {
        const blocked = state.robber === h.id;
        out.push(`<polygon points="${pts(hexCorners(h.x, h.y, 0.9))}" class="flash${blocked ? ' blocked' : ''}" data-k="${view.flashKey || ''}"/>`);
      }
    });
  }
  out.push('</g>');

  // roads
  out.push('<g class="roads">');
  for (const [e, p] of Object.entries(state.roads)) {
    const [x1, y1, x2, y2] = roadLine(geo, Number(e));
    out.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="road-ink"/><line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${colors[p]}" class="road"/>`);
  }
  out.push('</g>');

  // buildings
  out.push('<g class="buildings">');
  for (const [v, b] of Object.entries(state.buildings)) {
    const vx = geo.vertices[v].x * S, vy = geo.vertices[v].y * S;
    out.push(`<polygon points="${house(vx, vy, b.city)}" fill="${colors[b.p]}" class="building${b.city ? ' city' : ''}${view.lastBuilt === Number(v) ? ' fresh' : ''}"/>`);
  }
  out.push('</g>');

  // robber
  const rh = geo.hexes[state.robber];
  out.push(robber(rh.x * S - (state.hexes[state.robber].number ? 0.5 * S : 0), rh.y * S - 0.05 * S));

  // interaction targets
  const t = view.targets;
  if (t && t.ids && t.ids.length) {
    out.push(`<g class="targets ${t.kind}">`);
    for (const id of t.ids) {
      const sel = view.pending && view.pending.kind === t.kind && view.pending.id === id;
      if (t.kind === 'vertex') {
        const v = geo.vertices[id];
        out.push(`<g class="tgt${sel ? ' sel' : ''}" data-kind="vertex" data-id="${id}" role="button" tabindex="0" aria-label="${esc(view.labels ? view.labels.vertex(id) : `Corner ${id}`)}">
          <circle cx="${f(v.x * S)}" cy="${f(v.y * S)}" r="${f(0.32 * S)}" class="hit"/>
          <circle cx="${f(v.x * S)}" cy="${f(v.y * S)}" r="${f(0.15 * S)}" class="mark"/>
        </g>`);
      } else if (t.kind === 'edge') {
        const [x1, y1, x2, y2] = roadLine(geo, id, 0.22);
        out.push(`<g class="tgt${sel ? ' sel' : ''}" data-kind="edge" data-id="${id}" role="button" tabindex="0" aria-label="${esc(view.labels ? view.labels.edge(id) : `Side ${id}`)}">
          <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="hit"/>
          <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="mark"/>
        </g>`);
      } else if (t.kind === 'hex') {
        const h = geo.hexes[id];
        out.push(`<g class="tgt${sel ? ' sel' : ''}" data-kind="hex" data-id="${id}" role="button" tabindex="0" aria-label="${esc(view.labels ? view.labels.hex(id) : `Hex ${id}`)}">
          <polygon points="${pts(hexCorners(h.x, h.y, 0.86))}" class="mark"/>
          <polygon points="${pts(hexCorners(h.x, h.y, 0.98))}" class="hit"/>
        </g>`);
      }
    }
    out.push('</g>');
  }

  // ghost preview of the pending placement
  if (view.pending && view.ghost) {
    const c = view.ghostColor || '#fff';
    const { kind, id } = view.pending;
    if (kind === 'vertex') {
      const v = geo.vertices[id];
      out.push(`<polygon points="${house(v.x * S, v.y * S, view.ghost === 'city')}" fill="${c}" class="building ghost"/>`);
    } else if (kind === 'edge') {
      const [x1, y1, x2, y2] = roadLine(geo, id);
      out.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="road-ink ghost"/><line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${c}" class="road ghost"/>`);
    } else if (kind === 'hex') {
      const h = geo.hexes[id];
      out.push(`<g class="ghost">${robber(h.x * S - (state.hexes[id].number ? 0.5 * S : 0), h.y * S - 0.05 * S)}</g>`);
    }
  }
  return out.join('');
}
