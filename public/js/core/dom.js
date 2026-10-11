// Tiny DOM helpers: hyperscript builder, modal, toast, formatting.

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

export function mount(el, ...children) {
  clear(el);
  append(el, children);
  return el;
}

const SVGNS = 'http://www.w3.org/2000/svg';
export function s(tag, attrs = {}, ...children) {
  const el = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else el.setAttribute(k, v);
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

let modalStack = [];
export function openModal(content, { wide = false, onClose, dismissable = true } = {}) {
  const root = document.getElementById('modal-root');
  const box = h('div', { class: `modal${wide ? ' wide' : ''}`, role: 'dialog', 'aria-modal': 'true' }, content);
  const back = h('div', { class: 'modal-back' }, box);
  const close = () => {
    back.remove();
    modalStack = modalStack.filter((m) => m !== close);
    document.removeEventListener('keydown', onKey, true);
    onClose?.();
  };
  const onKey = (e) => {
    if (e.key === 'Escape' && dismissable && modalStack[modalStack.length - 1] === close) { e.stopPropagation(); close(); }
  };
  if (dismissable) back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });
  document.addEventListener('keydown', onKey, true);
  root.appendChild(back);
  modalStack.push(close);
  const focusable = box.querySelector('button.primary, button, input, select');
  focusable?.focus();
  return close;
}

export function closeAllModals() {
  for (const c of modalStack.slice()) c();
}

export function toast(msg, kind = '') {
  const root = document.getElementById('toast-root');
  const el = h('div', { class: `toast ${kind}` }, msg);
  root.appendChild(el);
  setTimeout(() => el.remove(), 4200);
}

export function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short' }) + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

export function fmtDay(iso) {
  return new Date(iso).toLocaleDateString(undefined, { day: '2-digit', month: 'short' });
}

export function pct(v) {
  return v === null || v === undefined ? '—' : `${Math.round(v * 100)}%`;
}

export function download(name, text, type = 'application/json') {
  const blob = new Blob([text], { type });
  const a = h('a', { href: URL.createObjectURL(blob), download: name });
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

export function isTyping(e) {
  const t = e.target;
  return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
}
