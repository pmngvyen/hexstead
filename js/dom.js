// Tiny DOM helpers: escaping, toasts, modal sheets.

import { UI } from './icons.js';

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

let toastTimer = null;
export function toast(msg, kind = 'info') {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.dataset.kind = kind;
  el.classList.remove('show');
  void el.offsetWidth;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), kind === 'error' ? 4200 : 2800);
}

export function hideToast() {
  const el = document.getElementById('toast');
  if (el) el.classList.remove('show');
  clearTimeout(toastTimer);
}

const open = new Set();

/**
 * Modal sheet built on <dialog>. Returns { el, body, close, setTitle }.
 * refresh (optional) is called by refreshDialogs() whenever game state changes.
 */
export function openDialog({ title = '', body = '', className = '', dismissible = true, onClose, refresh } = {}) {
  const dlg = document.createElement('dialog');
  dlg.className = `sheet ${className}`;
  dlg.innerHTML = `<div class="sheet-inner">
    <div class="sheet-head"><h2 class="sheet-title"></h2>${dismissible ? `<button type="button" class="icon-btn" data-close aria-label="Close">${UI.close}</button>` : ''}</div>
    <div class="sheet-body"></div>
  </div>`;
  const bodyEl = dlg.querySelector('.sheet-body');
  const titleEl = dlg.querySelector('.sheet-title');
  titleEl.textContent = title;
  if (typeof body === 'string') bodyEl.innerHTML = body; else if (body) bodyEl.append(body);
  document.body.append(dlg);
  const handle = {
    el: dlg,
    body: bodyEl,
    refresh,
    setTitle: t => { titleEl.textContent = t; },
    close: () => { if (dlg.open) dlg.close(); else cleanup(); },
  };
  function cleanup() {
    if (!open.has(handle)) return;
    open.delete(handle);
    dlg.remove();
    if (onClose) onClose();
  }
  dlg.addEventListener('close', cleanup);
  dlg.addEventListener('cancel', e => { if (!dismissible) e.preventDefault(); });
  dlg.addEventListener('click', e => {
    if (e.target.closest('[data-close]')) handle.close();
    else if (dismissible && e.target === dlg) handle.close();
  });
  open.add(handle);
  try { dlg.showModal(); } catch { dlg.setAttribute('open', ''); }
  return handle;
}

export function refreshDialogs(state) {
  for (const d of [...open]) if (d.refresh) d.refresh(state);
}

export function closeAllDialogs() {
  for (const d of [...open]) d.close();
}

export function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.append(ta);
  ta.select();
  try { document.execCommand('copy'); } finally { ta.remove(); }
  return Promise.resolve();
}
