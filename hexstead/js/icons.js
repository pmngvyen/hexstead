// Small original glyph set, drawn on a 24×24 grid. All use currentColor.

const svg = (body, extra = '') => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true" ${extra}>${body}</svg>`;

export const RES_GLYPH = {
  brick: svg('<path fill="currentColor" d="M2 5h9v5H2zM13 5h9v5h-9zM2 12h4v5H2zM8 12h9v5H8zM19 12h3v5h-3zM5 19h9v2H5z"/>'),
  lumber: svg('<path fill="currentColor" d="M5 7.5C5 5.6 6.6 4 8.5 4H19a3.5 3.5 0 1 1 0 7H8.5A3.5 3.5 0 0 1 5 7.5zm3 9C8 14.6 9.6 13 11.5 13H19a3.5 3.5 0 1 1 0 7h-7.5A3.5 3.5 0 0 1 8 16.5z"/><circle cx="19" cy="7.5" r="1.6" fill="var(--glyph-cut, #fff)" opacity=".55"/><circle cx="19" cy="16.5" r="1.6" fill="var(--glyph-cut, #fff)" opacity=".55"/>'),
  wool: svg('<path fill="currentColor" d="M7 9.5a3 3 0 0 1 5.2-2 3 3 0 0 1 5 .9A3 3 0 0 1 18 14a3 3 0 0 1-3.6 2.9A3 3 0 0 1 9.5 17 3 3 0 0 1 5 14.6 2.6 2.6 0 0 1 7 9.5z"/><path fill="currentColor" d="M17.5 9.5 21 8l-.6 3.4zM8 17.5h1.6V21H8zm5 0h1.6V21H13z"/>'),
  grain: svg('<path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" d="M12 22V6"/><path fill="currentColor" d="M12 3.2c1.4 1 1.4 3 0 4-1.4-1-1.4-3 0-4zM8.6 7.2c1.7.2 2.8 1.7 2.6 3.3-1.7-.2-2.8-1.7-2.6-3.3zm6.8 0c.2 1.6-.9 3.1-2.6 3.3-.2-1.6.9-3.1 2.6-3.3zM8.6 11.6c1.7.2 2.8 1.7 2.6 3.3-1.7-.2-2.8-1.7-2.6-3.3zm6.8 0c.2 1.6-.9 3.1-2.6 3.3-.2-1.6.9-3.1 2.6-3.3z"/>'),
  ore: svg('<path fill="currentColor" d="M3 18 8.5 6l4 3.5L15.5 5 21 18z"/><path fill="none" stroke="var(--glyph-cut, #fff)" stroke-opacity=".5" stroke-width="1.3" d="M8.5 6 10 18m2.5-8.5L15.5 18m0-13L17 11"/>'),
};

export const DEV_GLYPH = {
  knight: svg('<path fill="currentColor" d="M12 2.5 20 5.5v6c0 5-3.4 8.6-8 10-4.6-1.4-8-5-8-10v-6z"/><path fill="var(--glyph-cut, #fff)" opacity=".6" d="M11 7h2v3h3v2h-3v6h-2v-6H8v-2h3z"/>'),
  vp: svg('<path fill="currentColor" d="M6 2.5h2V22H6z"/><path fill="currentColor" d="M8 3.5h11l-3 4.2 3 4.3H8z"/>'),
  roadBuilding: svg('<path fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" d="M3.5 19.5 10 13m4-2 6.5-6.5"/><circle cx="12" cy="12" r="2" fill="currentColor"/>'),
  yearOfPlenty: svg('<path fill="currentColor" d="M4 10h16l-1.6 9.2A2 2 0 0 1 16.4 21H7.6a2 2 0 0 1-2-1.8z"/><path fill="none" stroke="currentColor" stroke-width="1.8" d="M8 10a4 4 0 0 1 8 0"/><circle cx="9" cy="6.5" r="1.6" fill="currentColor"/><circle cx="14.5" cy="5" r="1.6" fill="currentColor"/>'),
  monopoly: svg('<path fill="none" stroke="currentColor" stroke-width="3.4" d="M6 3v8a6 6 0 0 0 12 0V3"/><path fill="var(--glyph-cut, #fff)" opacity=".75" d="M4.3 3h3.4v3H4.3zm12 0h3.4v3h-3.4z"/>'),
};

export const PIECE_GLYPH = {
  road: svg('<path fill="currentColor" d="M3.6 17.3 17.3 3.6l3.1 3.1L6.7 20.4z"/>'),
  settlement: svg('<path fill="currentColor" d="M12 3.5 20 10v10.5H4V10z"/>'),
  city: svg('<path fill="currentColor" d="M2.5 11 8 6.5l5.5 4.5v1H21v8.5H2.5z"/>'),
  dev: svg('<rect x="5" y="2.5" width="14" height="19" rx="2.5" fill="currentColor"/><path fill="var(--glyph-cut, #fff)" opacity=".7" d="m12 7 1.4 2.9 3.1.4-2.3 2.2.6 3.1L12 14.1l-2.8 1.5.6-3.1-2.3-2.2 3.1-.4z"/>'),
};

export const UI = {
  points: DEV_GLYPH.vp,
  cards: svg('<rect x="3" y="5" width="11" height="15" rx="2" fill="currentColor" opacity=".55"/><rect x="9" y="3" width="11" height="15" rx="2" fill="currentColor"/>'),
  dev: PIECE_GLYPH.dev,
  knights: DEV_GLYPH.knight,
  road: PIECE_GLYPH.road,
  close: svg('<path fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" d="m6 6 12 12M18 6 6 18"/>'),
  plus: svg('<path fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" d="M12 5v14M5 12h14"/>'),
  minus: svg('<path fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" d="M5 12h14"/>'),
  fit: svg('<path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'),
  copy: svg('<rect x="8" y="8" width="12" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path fill="none" stroke="currentColor" stroke-width="2" d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>'),
  trade: svg('<path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M4 8h14l-4-4M20 16H6l4 4"/>'),
  menu: svg('<path fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" d="M4 7h16M4 12h16M4 17h16"/>'),
  bot: svg('<rect x="4" y="7" width="16" height="12" rx="3" fill="currentColor"/><circle cx="9" cy="13" r="1.6" fill="var(--glyph-cut,#fff)"/><circle cx="15" cy="13" r="1.6" fill="var(--glyph-cut,#fff)"/><path fill="none" stroke="currentColor" stroke-width="2" d="M12 7V3.5"/>'),
  harbor: svg('<path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M12 4v16M7 9h10M5 14a7 7 0 0 0 14 0"/><circle cx="12" cy="4" r="1.8" fill="currentColor"/>'),
};
