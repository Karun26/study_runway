// Small UI helpers: escaped HTML templates, icons, dialogs, toasts, file I/O.

class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = (s) => new Raw(s);
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);

function val(v) {
  if (v == null || v === false || v === true) return '';
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(val).join('');
  return esc(v);
}

/** Tagged template: every interpolation is HTML-escaped unless wrapped in raw()/html``. */
export function html(strings, ...vals) {
  let out = strings[0];
  for (let i = 0; i < vals.length; i++) out += val(vals[i]) + strings[i + 1];
  return new Raw(out);
}

export const safeUrl = (u) => (/^https:\/\/[^\s"'<>]+$/i.test(u || '') ? u : '');

const P = (d) => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
export const ICON = {
  today: P('<path d="M3 12h4l3-7 4 14 3-7h4"/>'),
  list: P('<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>'),
  calendar: P('<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>'),
  book: P('<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5"/>'),
  gear: P('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
  lock: P('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>'),
  sync: P('<path d="M20 11a8 8 0 0 0-14.3-4.9L4 8"/><path d="M4 3v5h5"/><path d="M4 13a8 8 0 0 0 14.3 4.9L20 16"/><path d="M20 21v-5h-5"/>'),
  check: P('<path d="m5 12.5 4.5 4.5L19 7.5"/>'),
  x: P('<path d="M6 6l12 12M18 6 6 18"/>'),
  ext: P('<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>'),
  warn: P('<path d="M12 3.5 2.5 20h19z"/><path d="M12 10v4.5M12 17.5v.01"/>'),
  video: P('<rect x="3" y="6" width="13" height="12" rx="2"/><path d="m16 10 5-3v10l-5-3"/>'),
  plus: P('<path d="M12 5v14M5 12h14"/>'),
  left: P('<path d="m15 5-7 7 7 7"/>'),
  right: P('<path d="m9 5 7 7-7 7"/>'),
};
export const icon = (name) => raw(ICON[name] || '');

// ---------- Toast ----------
let toastTimer;
export function toast(message, kind = 'info') {
  let el = document.getElementById('toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; el.setAttribute('role', 'status'); document.body.append(el); }
  el.className = `toast show ${kind}`;
  el.textContent = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, 3800);
}

// ---------- Dialog ----------
/**
 * openDialog({ title, body, actions:[{label,value,kind}], fields }) → Promise<{value, data}|null>
 * body is an html`` value. Inputs inside are returned in data by name.
 */
export function openDialog({ title, body = '', actions = [{ label: 'OK', value: 'ok', kind: 'primary' }], validate }) {
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.className = 'dlg';
    dlg.innerHTML = html`<form method="dialog" class="dlg-form" novalidate>
      <h2 class="dlg-title">${title}</h2>
      <div class="dlg-body">${body}</div>
      <p class="dlg-error" role="alert" hidden></p>
      <div class="dlg-actions">${actions.map((a) => html`<button type="submit" value="${a.value}" class="btn ${a.kind || ''}">${a.label}</button>`)}</div>
    </form>`.s;
    document.body.append(dlg);
    const form = dlg.querySelector('form');
    const errEl = dlg.querySelector('.dlg-error');
    let submitter = null;
    form.addEventListener('click', (e) => { const b = e.target.closest('button[type=submit]'); if (b) submitter = b; });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const value = (e.submitter || submitter)?.value || 'ok';
      const data = Object.fromEntries(new FormData(form).entries());
      if (value !== 'cancel' && validate) {
        const msg = await validate(value, data);
        if (msg) { errEl.textContent = msg; errEl.hidden = false; return; }
      }
      dlg.close();
      dlg.remove();
      resolve({ value, data });
    });
    dlg.addEventListener('cancel', () => { setTimeout(() => dlg.remove(), 0); resolve(null); });
    dlg.showModal();
    const first = dlg.querySelector('input, select, textarea');
    if (first) first.focus();
  });
}

export async function confirmDialog(title, message, confirmLabel = 'Continue', kind = 'primary') {
  const r = await openDialog({
    title, body: html`<p>${message}</p>`,
    actions: [{ label: 'Cancel', value: 'cancel' }, { label: confirmLabel, value: 'yes', kind }],
  });
  return r?.value === 'yes';
}

// ---------- Files ----------
export function pickFile(accept = '') {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    if (accept) input.accept = accept;
    input.style.display = 'none';
    input.addEventListener('change', () => { resolve(input.files[0] || null); input.remove(); }, { once: true });
    document.body.append(input);
    input.click();
  });
}

export function downloadFile(name, text, type = 'application/json') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
