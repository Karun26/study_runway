import * as V from './vault.js';
import { passwordEncrypt, passwordDecrypt } from './crypto.js';
import { normaliseCanvas, mergeCalendar, normaliseFeedUrl, SUBJECTS } from './ics.js';
import * as M from './model.js';
import * as T from './time.js';
import {
  html, raw, esc, safeUrl, icon, toast, openDialog, confirmDialog, pickFile, downloadFile,
} from './ui.js';

const APP_VERSION = '1.0.0';
const root = document.getElementById('app');

const S = {
  key: null,
  st: null,
  lastActivity: Date.now(),
  hiddenAt: null,
  saveTimer: null,
  syncing: false,
  calMonth: null, // 'YYYY-MM'
  calSelected: null, // day key
  route: '',
  shellRendered: false,
  timers: [],
};

const canEdit = () => S.st?.settings.role === 'main';
const isViewer = () => S.st?.settings.role === 'viewer';

// ======================================================================
// Persistence
// ======================================================================
function scheduleSave() {
  S.st.updatedAt = new Date().toISOString();
  clearTimeout(S.saveTimer);
  S.saveTimer = setTimeout(saveNow, 300);
}

async function saveNow() {
  clearTimeout(S.saveTimer);
  S.saveTimer = null;
  if (!S.key || !S.st) return;
  try { await V.saveState(S.key, S.st); } catch (e) { toast(`Couldn't save: ${e.message}`, 'error'); }
}

function commit({ rerender = true } = {}) {
  scheduleSave();
  if (rerender) renderView();
}

// ======================================================================
// Boot, setup, unlock
// ======================================================================
async function boot() {
  registerServiceWorker();
  if (!window.isSecureContext || !window.crypto?.subtle || !window.indexedDB) {
    root.innerHTML = html`<main class="gate"><div class="gate-card">
      <h1>This page needs a secure connection</h1>
      <p>Open the dashboard over https (your hosting address) or from localhost. Encryption and on-device storage are switched off on insecure pages.</p>
    </div></main>`.s;
    return;
  }
  try {
    if (await V.hasVault()) renderUnlock();
    else renderSetup({ step: 'role' });
  } catch (e) {
    root.innerHTML = html`<main class="gate"><div class="gate-card"><h1>Storage isn't available</h1>
      <p>${e.message || String(e)}</p><p>Private browsing can block on-device storage. Open the dashboard in a normal window.</p></div></main>`.s;
  }
}

const gate = (inner) => html`<main class="gate">
  <div class="gate-brand">${raw(BRAND_MARK)}<span>Study runway</span></div>
  <div class="gate-card">${inner}</div>
  <p class="gate-foot">Everything is encrypted and stays on this device.</p>
</main>`;

const BRAND_MARK = '<svg class="brand-mark" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="8" fill="var(--ink)"/><path d="M6 20h20" stroke="var(--bg)" stroke-width="2.4" stroke-linecap="round"/><circle cx="11" cy="20" r="3" fill="var(--u-d7)"/><circle cx="18" cy="20" r="3" fill="var(--u-d3)"/><circle cx="24.5" cy="20" r="3" fill="var(--u-overdue)"/><path d="M11 13.5v3M18 11v5.5M24.5 9v8" stroke="var(--bg)" stroke-width="2" stroke-linecap="round"/></svg>';

function renderSetup(setup) {
  S.shellRendered = false;
  if (setup.step === 'role') {
    root.innerHTML = gate(html`
      <h1>Set up this device</h1>
      <p class="lede">Your laptop is the main device. Your phone shows the same information but can't change it.</p>
      <form data-gate="role" class="stack">
        <label class="choice"><input type="radio" name="role" value="main" checked>
          <span><strong>Main device (laptop)</strong><small>Record submissions, marks and quiz results. Sends updates to your phone.</small></span></label>
        <label class="choice"><input type="radio" name="role" value="viewer">
          <span><strong>View-only device (phone)</strong><small>Syncs the Canvas calendar itself and receives updates from your laptop.</small></span></label>
        <button class="btn primary wide" type="submit">Continue</button>
      </form>
      <p class="fine">Restoring a backup instead? Set a passcode first, then use Settings › Restore backup.</p>`).s;
  } else if (setup.step === 'passcode') {
    root.innerHTML = gate(html`
      <h1>Choose a passcode</h1>
      <p class="lede">It unlocks and encrypts your data on this device. Use at least 6 characters.</p>
      <form data-gate="passcode" class="stack" data-role="${setup.role}">
        <label class="field"><span>Passcode</span><input name="p1" type="password" autocomplete="new-password" minlength="6" required autofocus></label>
        <label class="field"><span>Enter it again</span><input name="p2" type="password" autocomplete="new-password" minlength="6" required></label>
        <p class="form-error" role="alert"></p>
        <button class="btn primary wide" type="submit">Create passcode</button>
      </form>`).s;
    root.querySelector('input').focus();
  } else if (setup.step === 'recovery') {
    root.innerHTML = gate(html`
      <h1>Save your recovery code</h1>
      <p class="lede">This is the only way back in if you forget your passcode. It is shown once.</p>
      <div class="recovery" id="rc">${setup.code}</div>
      <div class="row gap"><button class="btn" type="button" data-gate-action="copy-rc">Copy code</button></div>
      <form data-gate="recovery-ack" class="stack">
        <label class="check"><input type="checkbox" name="ack" required> <span>I've written this code down somewhere safe</span></label>
        <button class="btn primary wide" type="submit">Open dashboard</button>
      </form>`).s;
  }
}

function renderUnlock(opts = {}) {
  S.shellRendered = false;
  if (opts.recovery) {
    root.innerHTML = gate(html`
      <h1>Reset passcode</h1>
      <p class="lede">Enter your recovery code and choose a new passcode.</p>
      <form data-gate="recover" class="stack">
        <label class="field"><span>Recovery code</span><input name="code" autocomplete="off" autocapitalize="characters" spellcheck="false" required placeholder="XXXXX-XXXXX-XXXXX-XXXXX-XXXXX"></label>
        <label class="field"><span>New passcode</span><input name="p1" type="password" autocomplete="new-password" minlength="6" required></label>
        <label class="field"><span>Enter it again</span><input name="p2" type="password" autocomplete="new-password" minlength="6" required></label>
        <p class="form-error" role="alert"></p>
        <button class="btn primary wide" type="submit">Reset and unlock</button>
      </form>
      <button class="link" data-gate-action="back-unlock" type="button">Back to passcode</button>`).s;
  } else {
    root.innerHTML = gate(html`
      <h1>Unlock</h1>
      <form data-gate="unlock" class="stack">
        <label class="field"><span>Passcode</span><input name="pass" type="password" autocomplete="current-password" required></label>
        <p class="form-error" role="alert">${opts.message || ''}</p>
        <button class="btn primary wide" type="submit">Unlock</button>
      </form>
      <button class="link" data-gate-action="forgot" type="button">Forgot passcode?</button>`).s;
  }
  const input = root.querySelector('input');
  if (input) input.focus();
  refreshLockoutNotice();
}

let lockoutTimer;
async function refreshLockoutNotice() {
  clearInterval(lockoutTimer);
  const { lockUntil } = await V.getLockout();
  const errEl = root.querySelector('.form-error');
  const btn = root.querySelector('form[data-gate] button[type=submit]');
  if (!errEl || !btn) return;
  const tick = () => {
    const left = lockUntil - Date.now();
    if (left > 0) {
      const s = Math.ceil(left / 1000);
      errEl.textContent = `Too many wrong attempts. Try again in ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}.`;
      btn.disabled = true;
    } else {
      btn.disabled = false;
      if (errEl.textContent.startsWith('Too many')) errEl.textContent = '';
      clearInterval(lockoutTimer);
    }
  };
  tick();
  if (lockUntil > Date.now()) lockoutTimer = setInterval(tick, 1000);
}

function busy(form, on, label) {
  const btn = form.querySelector('button[type=submit]');
  if (!btn) return;
  if (on) { btn.dataset.label = btn.textContent; btn.textContent = label || 'Working…'; btn.disabled = true; }
  else { btn.textContent = btn.dataset.label || btn.textContent; btn.disabled = false; }
}

async function onGateSubmit(form) {
  const kind = form.dataset.gate;
  const fd = Object.fromEntries(new FormData(form).entries());
  const err = form.querySelector('.form-error');
  if (kind === 'role') {
    renderSetup({ step: 'passcode', role: fd.role });
  } else if (kind === 'passcode') {
    if ((fd.p1 || '').length < 6) { err.textContent = 'Use at least 6 characters.'; return; }
    if (fd.p1 !== fd.p2) { err.textContent = "The two passcodes don't match."; return; }
    busy(form, true, 'Encrypting…');
    const state = M.defaultState(form.dataset.role);
    const { key, recoveryCode } = await V.createVault(fd.p1, state);
    S.pendingUnlock = { key, state };
    try { await navigator.storage?.persist?.(); } catch { /* optional */ }
    renderSetup({ step: 'recovery', code: recoveryCode });
  } else if (kind === 'recovery-ack') {
    const { key, state } = S.pendingUnlock;
    S.pendingUnlock = null;
    enterApp(key, state, { firstRun: true });
  } else if (kind === 'unlock') {
    busy(form, true, 'Unlocking…');
    try {
      const key = await V.unlockWithPasscode(fd.pass);
      const state = await V.loadState(key);
      enterApp(key, state);
    } catch (e) {
      busy(form, false);
      form.querySelector('input').value = '';
      if (e instanceof V.WrongSecretError || e instanceof V.LockedError) {
        const { failed } = await V.getLockout();
        err.textContent = failed >= 5 || e instanceof V.LockedError ? '' : `Wrong passcode. ${5 - failed} attempt${5 - failed === 1 ? '' : 's'} left before a delay.`;
        refreshLockoutNotice();
      } else {
        err.textContent = `Couldn't open your data: ${e.message}`;
      }
    }
  } else if (kind === 'recover') {
    if ((fd.p1 || '').length < 6) { err.textContent = 'Use at least 6 characters.'; return; }
    if (fd.p1 !== fd.p2) { err.textContent = "The two passcodes don't match."; return; }
    busy(form, true, 'Checking…');
    try {
      const key = await V.resetWithRecovery(fd.code, fd.p1);
      const state = await V.loadState(key);
      toast('Passcode reset.');
      enterApp(key, state);
    } catch (e) {
      busy(form, false);
      err.textContent = e instanceof V.WrongSecretError ? "That recovery code didn't work." : '';
      refreshLockoutNotice();
    }
  }
}

function migrate(st) {
  const d = M.defaultState(st.settings?.role || 'main');
  st.settings = { ...d.settings, ...st.settings, targets: { ...d.settings.targets, ...(st.settings?.targets || {}) } };
  st.calendar = { ...d.calendar, ...st.calendar };
  st.user = { ...d.user, ...st.user };
  st.courseData = { ...d.courseData, ...st.courseData, subjects: { ...(st.courseData?.subjects || {}) } };
  return st;
}

function enterApp(key, state, { firstRun = false } = {}) {
  S.key = key;
  S.st = migrate(state);
  S.lastActivity = Date.now();
  if (!location.hash || location.hash === '#') location.hash = '#/today';
  renderShell();
  renderView();
  startTimers();
  if (!firstRun && S.st.settings.feedUrl) syncCalendar({ reason: 'open' });
  if (firstRun) setTimeout(() => { location.hash = '#/settings'; toast('Add your Canvas calendar to get started.'); }, 50);
}

async function lock() {
  if (!S.key) return;
  await saveNow();
  S.key = null;
  S.st = null;
  stopTimers();
  document.querySelectorAll('dialog').forEach((d) => d.remove());
  renderUnlock();
}

// ======================================================================
// Timers: countdowns, auto-lock, foreground refresh
// ======================================================================
function startTimers() {
  stopTimers();
  S.timers.push(setInterval(updateCountdowns, 30000));
  S.timers.push(setInterval(() => {
    if (!S.key) return;
    const limit = (S.st.settings.autoLockMin || 15) * 60000;
    if (Date.now() - S.lastActivity > limit) lock();
  }, 10000));
}
function stopTimers() { S.timers.forEach(clearInterval); S.timers = []; }

['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach((ev) => {
  window.addEventListener(ev, () => { S.lastActivity = Date.now(); }, { passive: true });
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    S.hiddenAt = Date.now();
    if (S.key) saveNow();
    return;
  }
  if (!S.key) return;
  const away = S.hiddenAt ? Date.now() - S.hiddenAt : 0;
  if (away > (S.st.settings.autoLockMin || 15) * 60000) { lock(); return; }
  S.lastActivity = Date.now();
  const last = S.st.calendar.lastAttempt ? Date.now() - new Date(S.st.calendar.lastAttempt) : Infinity;
  if (S.st.settings.feedUrl && last > 30 * 60000) syncCalendar({ reason: 'resume' });
  else renderView();
});

function updateCountdowns() {
  const now = new Date();
  document.querySelectorAll('[data-due]').forEach((el) => {
    if (el.dataset.submitted === '1') return;
    const cd = T.countdown(new Date(el.dataset.due), now);
    el.textContent = cd.text;
    el.className = el.className.replace(/\blvl-\w+/, `lvl-${cd.level}`);
  });
}

// ======================================================================
// Calendar sync
// ======================================================================
class SyncError extends Error {}

async function syncCalendar({ reason = 'manual' } = {}) {
  if (!S.st || S.syncing) return;
  const url = normaliseFeedUrl(S.st.settings.feedUrl);
  if (!url) { if (reason === 'manual') location.hash = '#/settings'; return; }
  S.syncing = true;
  renderStatus();
  S.st.calendar.lastAttempt = new Date().toISOString();
  try {
    if (!/^https:\/\//i.test(url)) throw new SyncError('The feed link must start with https:// (or webcal://).');
    if (navigator.onLine === false) throw new SyncError("You're offline.");
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    let res;
    try {
      res = await fetch(url, { cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', signal: ctrl.signal });
    } catch (e) {
      if (e.name === 'AbortError') throw new SyncError("Canvas didn't respond within 20 seconds.");
      throw new SyncError('The browser couldn\'t read the feed. Either you\'re offline, or Canvas doesn\'t allow websites to read the calendar directly. You can import the .ics file instead.');
    } finally { clearTimeout(timer); }
    if (!res.ok) throw new SyncError(`Canvas returned an error (HTTP ${res.status}). Check the feed link in Settings.`);
    const text = await res.text();
    applyCalendarText(text, 'feed');
    S.syncing = false;
    commit();
    if (reason === 'manual') toast('Calendar updated.');
  } catch (e) {
    S.syncing = false;
    S.st.calendar.lastError = e instanceof SyncError ? e.message : `Couldn't update: ${e.message}`;
    commit();
    showSyncFailure();
  }
}

function applyCalendarText(text, source) {
  let parsed;
  try { parsed = normaliseCanvas(text); } catch (e) { throw new SyncError(`The response wasn't a calendar file. ${e.message}`); }
  const count = Object.keys(parsed.items).length;
  if (!count) throw new SyncError('The calendar file has no events in it.');
  const now = new Date().toISOString();
  const { items, changes } = mergeCalendar(S.st.calendar.items, parsed.items, now);
  const cal = S.st.calendar;
  cal.items = items;
  cal.calName = parsed.calName;
  cal.changes = [...changes, ...(cal.changes || [])].slice(0, 30);
  cal.lastSuccess = now;
  cal.lastAttempt = now;
  cal.lastError = null;
  cal.source = source;
  return { count, changes: changes.length };
}

async function showSyncFailure() {
  const cal = S.st.calendar;
  const since = cal.lastSuccess ? T.fmtRelativeStamp(new Date(cal.lastSuccess)) : null;
  const r = await openDialog({
    title: 'Calendar not updated',
    body: html`<p>${cal.lastError}</p>
      <p class="muted">${since ? `You're seeing your last saved calendar, from ${since}.` : 'No calendar has been saved on this device yet.'}</p>`,
    actions: [
      { label: 'Import .ics file', value: 'file' },
      { label: 'Try again', value: 'retry' },
      { label: 'OK', value: 'ok', kind: 'primary' },
    ],
  });
  if (r?.value === 'retry') syncCalendar({ reason: 'manual' });
  if (r?.value === 'file') importIcsFile();
}

async function importIcsFile() {
  const file = await pickFile('.ics,text/calendar');
  if (!file) return;
  try {
    const { count, changes } = applyCalendarText(await file.text(), 'file');
    commit();
    toast(`Imported ${count} calendar events${changes ? `, ${changes} due date${changes > 1 ? 's' : ''} changed` : ''}.`);
  } catch (e) {
    toast(e.message, 'error');
  }
}

// ======================================================================
// Shell
// ======================================================================
const NAV = [
  { id: 'today', label: 'Today', icon: 'today' },
  { id: 'deadlines', label: 'Deadlines', icon: 'list' },
  { id: 'calendar', label: 'Calendar', icon: 'calendar' },
  { id: 'subjects', label: 'Subjects', icon: 'book' },
  { id: 'settings', label: 'Settings', icon: 'gear' },
];

function renderShell() {
  root.innerHTML = html`<div class="shell">
    <nav class="nav" aria-label="Main">
      <a class="brand" href="#/today">${raw(BRAND_MARK)}<span>Study runway</span></a>
      <ul>${NAV.map((n) => html`<li><a href="#/${n.id}" data-nav="${n.id}">${icon(n.icon)}<span>${n.label}</span></a></li>`)}</ul>
      <p class="nav-foot" id="role-note"></p>
    </nav>
    <div class="main-col">
      <header class="topbar">
        <div class="status" id="status"></div>
        <div class="top-actions">
          <button class="btn ghost" data-action="sync" title="Update calendar">${icon('sync')}<span class="hide-sm">Update</span></button>
          <button class="btn ghost" data-action="lock" title="Lock">${icon('lock')}<span class="hide-sm">Lock</span></button>
        </div>
      </header>
      <main id="view" tabindex="-1"></main>
    </div>
  </div>`.s;
  S.shellRendered = true;
}

function renderStatus() {
  const el = document.getElementById('status');
  if (!el || !S.st) return;
  const cal = S.st.calendar;
  let cls = 'ok', text;
  if (S.syncing) { cls = 'busy'; text = 'Updating calendar…'; }
  else if (!S.st.settings.feedUrl && !cal.lastSuccess) { cls = 'warn'; text = 'Calendar not connected'; }
  else if (cal.lastError && (!cal.lastSuccess || cal.lastAttempt > cal.lastSuccess)) {
    cls = 'warn';
    text = cal.lastSuccess ? `Calendar not updated · last updated ${T.fmtRelativeStamp(new Date(cal.lastSuccess))}` : 'Calendar not updated';
  } else {
    text = `Calendar updated ${T.fmtRelativeStamp(new Date(cal.lastSuccess))}${cal.source === 'file' ? ' (from file)' : ''}`;
  }
  el.className = `status ${cls}`;
  el.innerHTML = html`<span class="dot"></span><span>${text}</span>`.s;
  const rn = document.getElementById('role-note');
  if (rn) rn.textContent = isViewer() ? 'View-only device' : 'Main device';
}

function parseRoute() {
  const h = location.hash.replace(/^#\/?/, '');
  const [path, query = ''] = h.split('?');
  const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
  return { name: parts[0] || 'today', parts, q: new URLSearchParams(query) };
}

function renderView() {
  if (!S.key || !S.st) return;
  if (!S.shellRendered) renderShell();
  renderStatus();
  const r = parseRoute();
  const routeId = location.hash;
  const sameRoute = routeId === S.route;
  const y = window.scrollY;
  S.route = routeId;
  document.querySelectorAll('[data-nav]').forEach((a) => {
    const active = a.dataset.nav === r.name || (r.name === 'subject' && a.dataset.nav === 'subjects') || (r.name === 'quiz' && a.dataset.nav === 'subjects');
    if (active) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  const view = document.getElementById('view');
  let out;
  try {
    switch (r.name) {
      case 'deadlines': out = viewDeadlines(r); break;
      case 'calendar': out = viewCalendar(); break;
      case 'subjects': out = viewSubjects(); break;
      case 'subject': out = viewSubject(r.parts[1]); break;
      case 'quiz': out = viewQuiz(r.parts[1], r.parts[2], r.parts[3]); break;
      case 'settings': out = viewSettings(); break;
      default: out = viewToday();
    }
  } catch (e) {
    console.error(e);
    out = html`<div class="empty"><h2>Something went wrong on this page</h2><p>${e.message}</p></div>`;
  }
  view.innerHTML = out.s;
  if (r.name === 'settings') updatePersistState();
  if (sameRoute) window.scrollTo(0, y);
  else {
    window.scrollTo(0, 0);
    const focusKey = r.q.get('focus');
    if (focusKey) {
      const el = document.getElementById(`asg-${cssId(focusKey)}`);
      if (el) { el.querySelector('details')?.setAttribute('open', ''); el.scrollIntoView({ block: 'center' }); el.classList.add('flash'); }
    }
  }
}

const cssId = (k) => k.replace(/[^a-zA-Z0-9_-]/g, '_');

// ======================================================================
// Shared bits
// ======================================================================
const codeTag = (code) => html`<span class="code-tag c-${code}">${code}</span>`;

function cdChip(a, now = new Date()) {
  if (a.submitted) return html`<span class="cd lvl-submitted" data-submitted="1">Submitted</span>`;
  const cd = T.countdown(a.dueDate, now);
  return html`<span class="cd lvl-${cd.level}" data-due="${a.due}">${cd.text}</span>`;
}

function weightLabel(a) {
  const w = M.weightForAssignment(S.st, a);
  if (!w) return html`<span class="missing">Weight missing</span>`;
  return html`<span>${w.value}%${w.shared ? ' (shared assessment)' : ''}${w.source === 'you' ? ' (entered by you)' : ''}</span>`;
}

function dueLabel(a) {
  return html`Due ${T.fmtDateTime(a.dueDate)}`;
}

function asgCard(a, { compact = false } = {}) {
  const tasks = a.tasks || [];
  const doneTasks = tasks.filter((t) => t.done).length;
  const cdTasks = a.assessment?.tasks || [];
  return html`<article class="asg lvl-${a.level}${a.missingFromFeed ? ' stale' : ''}" id="asg-${cssId(a.key)}">
    <div class="asg-row">
      <div class="asg-main">
        <div class="asg-top">${codeTag(a.code)}${a.missingFromFeed ? html`<span class="badge">No longer in Canvas feed</span>` : ''}</div>
        <h3 class="asg-title">${a.title}</h3>
        <p class="asg-meta">${dueLabel(a)} · ${weightLabel(a)}${tasks.length ? html` · ${doneTasks}/${tasks.length} tasks` : ''}</p>
      </div>
      <div class="asg-side">
        ${cdChip(a)}
        ${canEdit() ? html`<button class="btn sm ${a.submitted ? 'ghost' : 'primary'}" data-action="toggle-submit" data-key="${a.key}">${a.submitted ? 'Undo' : 'Mark submitted'}</button>` : ''}
      </div>
    </div>
    ${compact ? '' : html`<details class="asg-details">
      <summary>Tasks and details</summary>
      <div class="asg-body">
        <div class="tasks">
          <h4>Remaining tasks</h4>
          ${tasks.length ? html`<ul class="task-list">${tasks.map((t) => html`<li>
            <label class="check"><input type="checkbox" data-change="toggle-task" data-key="${a.key}" data-id="${t.id}" ${t.done ? raw('checked') : ''} ${canEdit() ? '' : raw('disabled')}><span>${t.text}</span></label>
            ${canEdit() ? html`<button class="icon-btn" title="Remove task" data-action="del-task" data-key="${a.key}" data-id="${t.id}">${icon('x')}</button>` : ''}
          </li>`)}</ul>` : html`<p class="muted">No tasks yet.</p>`}
          ${canEdit() ? html`<form class="task-add" data-submit="add-task" data-key="${a.key}">
            <input name="text" placeholder="Add a task, e.g. Finish experiment 3 notebook" aria-label="New task" maxlength="200">
            <button class="btn sm" type="submit">${icon('plus')}Add</button>
          </form>` : ''}
          ${cdTasks.length && canEdit() ? html`<button class="link" data-action="add-brief-tasks" data-key="${a.key}">Add ${cdTasks.length} tasks from the assignment brief</button>` : ''}
        </div>
        ${a.description ? html`<div class="desc"><h4>From Canvas</h4><div class="desc-text">${a.description}</div></div>` : ''}
        ${safeUrl(a.canvasUrl) ? html`<a class="ext" href="${safeUrl(a.canvasUrl)}" target="_blank" rel="noopener noreferrer">Open in Canvas ${icon('ext')}</a>` : ''}
      </div>
    </details>`}
  </article>`;
}

function emptyCalendar() {
  return html`<section class="panel empty-cal">
    <h2>Connect your Canvas calendar</h2>
    <p>Your deadlines and classes come from the Canvas calendar feed. Paste the feed link in Settings, or import a downloaded .ics file.</p>
    <div class="row gap">
      <a class="btn primary" href="#/settings">Add feed link</a>
      <button class="btn" data-action="import-ics">Import .ics file</button>
    </div>
  </section>`;
}

// ======================================================================
// Today
// ======================================================================
function viewToday() {
  const now = new Date();
  const st = S.st;
  const all = M.assignments(st, now);
  const hasCal = Object.keys(st.calendar.items).length > 0;
  const overdue = all.filter((a) => a.level === 'overdue');
  const soon = all.filter((a) => ['h24', 'd3', 'd7'].includes(a.level));
  const changes = (st.calendar.changes || []).filter((c) => !c.dismissed);
  const plan = M.weeklyPlan(st, now);
  const weak = M.weakTopics(st);

  return html`
    <div class="page-head">
      <h1>${T.fmtDayLong(now)}</h1>
      ${isViewer() ? html`<p class="sub">View-only. Updates come from your laptop.</p>` : ''}
    </div>
    ${hasCal ? '' : emptyCalendar()}
    ${changes.length ? html`<section class="panel alert">
      <h2>${icon('warn')} Due dates changed in Canvas</h2>
      <ul class="changes">${changes.map((c) => html`<li>${codeTag(c.code)} <strong>${c.title}</strong> moved from ${T.fmtDateTime(new Date(c.from))} to ${T.fmtDateTime(new Date(c.to))}</li>`)}</ul>
      <button class="btn sm" data-action="dismiss-changes">Got it</button>
    </section>` : ''}
    ${hasCal ? runway(all, now) : ''}
    <div class="today-grid">
      <section class="panel">
        <div class="panel-head"><h2>Needs attention</h2><a href="#/deadlines" class="link">All deadlines</a></div>
        ${overdue.length > 1 && canEdit() ? html`<div class="bulk">
          <span>${overdue.length} items are past their due date and not marked submitted.</span>
          <button class="btn sm" data-action="submit-all-overdue">Mark all ${overdue.length} as submitted</button>
        </div>` : ''}
        ${overdue.length || soon.length
    ? html`<div class="asg-list">${[...overdue, ...soon].map((a) => asgCard(a, { compact: true }))}</div>`
    : html`<p class="muted">Nothing due in the next 7 days.</p>`}
      </section>
      <section class="panel">
        <div class="panel-head"><h2>This week</h2></div>
        <p class="fine">Built from your deadlines, assessment weights and quiz results.${plan.unknownWeights ? ` Weights are missing for ${plan.unknownWeights} upcoming item${plan.unknownWeights > 1 ? 's' : ''}, so they're treated equally.` : ''}</p>
        <ol class="plan">${plan.days.map((d, i) => planDay(d, i))}</ol>
      </section>
    </div>
    <div class="today-grid">
      <section class="panel">
        <div class="panel-head"><h2>Weak topics</h2></div>
        ${weak.length ? html`<ul class="weak">${weak.slice(0, 6).map((w) => html`<li>
            <div><strong>${w.topic}</strong> <span class="muted">${w.code} · ${w.moduleTitle}</span>
            ${w.revise.length ? html`<div class="fine">Revise: ${w.revise.join('; ')}</div>` : ''}</div>
            <span class="pct ${pctClass(w.pct)}">${Math.round(w.pct)}%</span></li>`)}</ul>`
    : html`<p class="muted">Take a module quiz to see where you need more practice.</p>`}
      </section>
      <section class="panel">
        <div class="panel-head"><h2>Subjects</h2><a href="#/subjects" class="link">Open subjects</a></div>
        <div class="mini-subjects">${SUBJECTS.map((s) => miniSubject(s, all))}</div>
      </section>
    </div>`;
}

function planDay(d, i) {
  const date = T.dayKeyToDate(d.key, 12);
  const label = i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : T.fmtDayShort(date);
  return html`<li class="plan-day${i === 0 ? ' is-today' : ''}">
    <div class="plan-date">${label}</div>
    <div class="plan-body">
      ${d.due.map((a) => html`<div class="plan-due lvl-${a.level}"><span class="dot"></span>Due ${a.dueTimeAssumed ? '11:59 pm' : T.fmtTime(a.dueDate)}: ${a.title} <span class="muted">${a.code}</span></div>`)}
      ${d.focus.map((f) => {
    if (f.type === 'overdue') return html`<div class="plan-focus warn">Check ${f.count} overdue item${f.count > 1 ? 's' : ''}: mark them submitted or follow up.</div>`;
    if (f.type === 'assignment') return html`<div class="plan-focus"><a href="#/deadlines?focus=${encodeURIComponent(f.a.key)}">Work on ${f.a.title}</a> <span class="muted">${f.a.code} · due ${T.fmtDayShort(f.a.dueDate)}</span></div>`;
    return html`<div class="plan-focus revise"><a href="#/subject/${f.w.code}">Revise ${f.w.topic}</a> <span class="muted">${f.w.code} · ${f.w.moduleTitle}</span></div>`;
  })}
      ${d.sessions.map((s) => html`<div class="plan-session">${T.fmtTime(new Date(s.start))} ${s.title} <span class="muted">${s.code}</span></div>`)}
      ${!d.due.length && !d.focus.length && !d.sessions.length ? html`<div class="muted">Free</div>` : ''}
    </div>
  </li>`;
}

function runway(all, now) {
  const days = innerWidth < 700 ? 7 : 14;
  const today = T.dayKey(now);
  const overdue = all.filter((a) => a.level === 'overdue');
  const cols = [];
  for (let i = 0; i < days; i++) {
    const key = T.addDaysKey(today, i);
    const date = T.dayKeyToDate(key, 12);
    const due = all.filter((a) => !a.submitted && T.dayKey(a.dueDate) === key);
    const done = all.filter((a) => a.submitted && T.dayKey(a.dueDate) === key);
    const wd = T.weekdayOfKey(key);
    cols.push(html`<div class="rw-day${i === 0 ? ' is-today' : ''}${wd === 0 || wd === 6 ? ' is-weekend' : ''}">
      <div class="rw-date"><span class="rw-dow">${i === 0 ? 'Today' : T.fmtDayShort(date).split(' ')[0].replace(',', '')}</span><span class="rw-dnum">${key.slice(8).replace(/^0/, '')}</span></div>
      <div class="rw-track">${due.map((a) => html`<span class="rw-pin lvl-${a.level}"></span>`)}${done.map(() => html`<span class="rw-pin lvl-submitted"></span>`)}</div>
      <div class="rw-items">${due.map((a) => html`<a class="rw-chip lvl-${a.level}" href="#/deadlines?focus=${encodeURIComponent(a.key)}" title="${a.title}">
          <span class="rw-chip-code">${a.code}</span><span class="rw-chip-title">${a.title}</span></a>`)}</div>
    </div>`);
  }
  return html`<section class="runway" aria-label="Deadlines over the next ${days} days">
    <div class="rw-head">
      <h2>Next ${days} days</h2>
      <div class="legend"><span class="lvl-h24">24 hours</span><span class="lvl-d3">3 days</span><span class="lvl-d7">7 days</span><span class="lvl-later">Later</span><span class="lvl-overdue">Overdue</span></div>
    </div>
    ${overdue.length ? html`<a class="rw-overdue" href="#/deadlines">${overdue.length} overdue and not marked submitted</a>` : ''}
    <div class="rw-scroll"><div class="rw-grid" style="--days:${days}">${cols}</div></div>
  </section>`;
}

const pctClass = (p) => (p >= 85 ? 'hi' : p >= 70 ? 'mid' : 'lo');

function miniSubject(s, all) {
  const pending = all.filter((a) => a.code === s.code && !a.submitted);
  const next = pending.find((a) => a.dueDate > new Date());
  const g = M.gradeSummary(S.st, s.code);
  const p = M.subjectProgress(S.st, s.code);
  return html`<a class="mini-subject" href="#/subject/${s.code}">
    ${codeTag(s.code)}<span class="ms-name">${s.name}</span>
    <span class="ms-line">${next ? html`Next: ${next.title}, ${T.fmtDayShort(next.dueDate)}` : 'No upcoming deadlines'}</span>
    <span class="ms-line muted">${p.total ? `${p.done}/${p.total} modules done` : 'No modules yet'}${g.current != null ? ` · ${g.current.toFixed(1)}% so far` : ''}</span>
  </a>`;
}

// ======================================================================
// Deadlines
// ======================================================================
const GROUP_ORDER = ['overdue', 'h24', 'd3', 'd7', 'later', 'submitted'];

function viewDeadlines(r) {
  const filter = r.q.get('show') || 'pending';
  const subj = r.q.get('subject') || 'all';
  let list = M.assignments(S.st);
  if (subj !== 'all') list = list.filter((a) => a.code === subj);
  if (filter === 'pending') list = list.filter((a) => !a.submitted);
  if (filter === 'submitted') list = list.filter((a) => a.submitted);
  const groups = GROUP_ORDER.map((lvl) => ({ lvl, items: list.filter((a) => a.level === lvl) })).filter((g) => g.items.length);
  if (filter === 'submitted' || filter === 'all') {
    const sub = groups.find((g) => g.lvl === 'submitted');
    if (sub) sub.items.reverse();
  }
  const link = (show, subject) => `#/deadlines?show=${show}&subject=${subject}`;
  return html`
    <div class="page-head"><h1>Deadlines</h1></div>
    ${Object.keys(S.st.calendar.items).length ? '' : emptyCalendar()}
    <div class="filters">
      <div class="seg" role="tablist">${[['pending', 'To do'], ['submitted', 'Submitted'], ['all', 'All']].map(([k, l]) => html`<a role="tab" class="${filter === k ? 'on' : ''}" href="${link(k, subj)}">${l}</a>`)}</div>
      <div class="seg">${[['all', 'All subjects'], ...SUBJECTS.map((s) => [s.code, s.code])].map(([k, l]) => html`<a class="${subj === k ? 'on' : ''}" href="${link(filter, k)}">${l}</a>`)}</div>
    </div>
    ${groups.length ? groups.map((g) => html`<section class="group">
      <h2 class="group-title lvl-${g.lvl}"><span class="dot"></span>${T.LEVEL_LABEL[g.lvl]} <span class="count">${g.items.length}</span></h2>
      <div class="asg-list">${g.items.map((a) => asgCard(a))}</div>
    </section>`) : html`<p class="muted pad">Nothing here.</p>`}`;
}

// ======================================================================
// Calendar
// ======================================================================
function viewCalendar() {
  const now = new Date();
  const todayKey = T.dayKey(now);
  if (!S.calMonth) S.calMonth = todayKey.slice(0, 7);
  if (!S.calSelected) S.calSelected = todayKey;
  const [y, m] = S.calMonth.split('-').map(Number);
  const firstKey = `${S.calMonth}-01`;
  const lead = (T.weekdayOfKey(firstKey) + 6) % 7; // Monday first
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const all = M.assignments(S.st, now);
  const cells = [];
  const startKey = T.addDaysKey(firstKey, -lead);
  const weeks = Math.ceil((lead + daysInMonth) / 7);
  for (let i = 0; i < weeks * 7; i++) {
    const key = T.addDaysKey(startKey, i);
    const inMonth = key.slice(0, 7) === S.calMonth;
    const due = all.filter((a) => T.dayKey(a.dueDate) === key);
    const sessions = M.sessionsOnDay(S.st, key).filter((s) => s.kind !== 'survey');
    const items = [
      ...due.map((a) => html`<span class="cal-item lvl-${a.level}">${a.title}</span>`),
      ...sessions.map((s) => html`<span class="cal-item session">${T.fmtTime(new Date(s.start))} ${s.title}</span>`),
    ];
    cells.push(html`<button class="cal-cell${inMonth ? '' : ' out'}${key === todayKey ? ' today' : ''}${key === S.calSelected ? ' sel' : ''}" data-action="cal-day" data-day="${key}" aria-label="${T.fmtDayLong(T.dayKeyToDate(key, 12))}">
      <span class="cal-num">${Number(key.slice(8))}</span>
      <span class="cal-dots">${due.map((a) => html`<i class="lvl-${a.level}"></i>`)}${sessions.map(() => html`<i class="session"></i>`)}</span>
      <span class="cal-items">${items.slice(0, 3)}${items.length > 3 ? html`<span class="cal-more">+${items.length - 3} more</span>` : ''}</span>
    </button>`);
  }
  const sel = S.calSelected;
  const selDue = all.filter((a) => T.dayKey(a.dueDate) === sel);
  const selSessions = M.sessionsOnDay(S.st, sel);
  return html`
    <div class="page-head"><h1>Calendar</h1></div>
    <section class="panel cal">
      <div class="cal-head">
        <button class="icon-btn" data-action="cal-prev" aria-label="Previous month">${icon('left')}</button>
        <h2>${T.fmtMonth(T.dayKeyToDate(firstKey, 12))}</h2>
        <button class="icon-btn" data-action="cal-next" aria-label="Next month">${icon('right')}</button>
        <button class="btn sm ghost" data-action="cal-today">Today</button>
      </div>
      <div class="cal-grid">
        ${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => html`<div class="cal-dow">${d}</div>`)}
        ${cells}
      </div>
    </section>
    <section class="panel">
      <h2>${T.fmtDayLong(T.dayKeyToDate(sel, 12))}</h2>
      ${!selDue.length && !selSessions.length ? html`<p class="muted">Nothing on this day.</p>` : ''}
      ${selSessions.length ? html`<ul class="sessions">${selSessions.map((s) => html`<li>
        <span class="s-time">${s.allDay ? 'All day' : `${T.fmtTime(new Date(s.start))}${s.end && s.end !== s.start ? `–${T.fmtTime(new Date(s.end))}` : ''}`}</span>
        <span class="s-main">${codeTag(s.code)} ${s.title}${s.location ? html` <span class="muted">· ${s.location}</span>` : ''}</span>
        ${safeUrl(s.joinUrl) ? html`<a class="btn sm" href="${safeUrl(s.joinUrl)}" target="_blank" rel="noopener noreferrer">${icon('video')}Join</a>` : ''}
      </li>`)}</ul>` : ''}
      ${selDue.length ? html`<div class="asg-list">${selDue.map((a) => asgCard(a, { compact: true }))}</div>` : ''}
    </section>`;
}

// ======================================================================
// Subjects
// ======================================================================
function viewSubjects() {
  const all = M.assignments(S.st);
  return html`
    <div class="page-head"><h1>Subjects</h1><p class="sub">Spring 2026</p></div>
    <div class="subject-cards">${SUBJECTS.map((s) => {
    const p = M.subjectProgress(S.st, s.code);
    const g = M.gradeSummary(S.st, s.code);
    const asgs = all.filter((a) => a.code === s.code);
    const next = asgs.find((a) => !a.submitted && a.dueDate > new Date());
    const subCount = asgs.filter((a) => a.submitted).length;
    return html`<a class="subject-card" href="#/subject/${s.code}">
        <div class="sc-head">${codeTag(s.code)}<h2>${s.name}</h2></div>
        ${bar('Modules done', p.total ? (p.done / p.total) * 100 : null, p.total ? `${p.done} of ${p.total}` : 'No modules yet')}
        ${bar('Understanding', p.understanding, p.understanding != null ? `${Math.round(p.understanding)}% average quiz score` : 'No quizzes taken')}
        <dl class="sc-facts">
          <div><dt>Current mark</dt><dd>${g.current != null ? `${g.current.toFixed(1)}% (${M.bandOf(g.current)})` : '—'}</dd></div>
          <div><dt>Submitted</dt><dd>${subCount} of ${asgs.length} Canvas items</dd></div>
          <div><dt>Next deadline</dt><dd>${next ? html`${next.title}<br><span class="muted">${T.fmtDateTime(next.dueDate)}</span>` : 'None'}</dd></div>
        </dl>
      </a>`;
  })}</div>`;
}

function bar(label, pct, text) {
  return html`<div class="bar-row"><div class="bar-label"><span>${label}</span><span class="muted">${text}</span></div>
    <div class="bar" role="progressbar" aria-label="${label}" aria-valuenow="${pct == null ? 0 : Math.round(pct)}" aria-valuemin="0" aria-valuemax="100"><span style="width:${pct == null ? 0 : Math.max(2, Math.min(100, pct))}%" class="${pct == null ? '' : pctClass(pct)}"></span></div></div>`;
}

function viewSubject(code) {
  const s = M.subjectByCode(code);
  if (!s) return html`<div class="empty"><h2>Subject not found</h2><a href="#/subjects">Back to subjects</a></div>`;
  const st = S.st;
  const cd = st.courseData.subjects[code];
  const g = M.gradeSummary(st, code);
  const p = M.subjectProgress(st, code);
  const missing = M.missingInfo(st, code);
  const list = M.subjectAssessments(st, code);
  const mods = M.modulesOf(st, code);
  const weak = M.weakTopics(st, code);
  const recs = recommendations(code, { g, p, list, mods, weak, cd });
  const target = st.settings.targets[code] ?? 85;
  const canvasHref = `https://canvas.uts.edu.au/courses/${s.canvasId}`;
  return html`
    <a class="back" href="#/subjects">${icon('left')}Subjects</a>
    <div class="page-head subject-head">
      <div>${codeTag(code)}<h1>${s.name}</h1></div>
      <a class="ext" href="${canvasHref}" target="_blank" rel="noopener noreferrer">Canvas ${icon('ext')}</a>
    </div>
    <div class="stats">
      <div class="stat"><span class="stat-v">${p.total ? `${p.done}/${p.total}` : '—'}</span><span class="stat-l">Modules done</span></div>
      <div class="stat"><span class="stat-v">${p.understanding != null ? `${Math.round(p.understanding)}%` : '—'}</span><span class="stat-l">Understanding (quizzes)</span></div>
      <div class="stat"><span class="stat-v">${g.current != null ? `${g.current.toFixed(1)}%` : '—'}</span><span class="stat-l">Current mark${g.doneWeight ? ` (${g.doneWeight}% marked)` : ''}</span></div>
      <div class="stat"><span class="stat-v">${neededText(g)}</span><span class="stat-l">Needed on the rest for ${target}%</span></div>
    </div>

    ${missing.length ? html`<section class="panel missing-panel">
      <h2>${icon('warn')} Missing information</h2>
      <ul>${missing.map((m) => html`<li>${m}</li>`)}</ul>
      <p class="fine">Upload the subject outline, assignment briefs, rubrics and module materials to the Claude project, then import the course data file Claude gives you in Settings.</p>
    </section>` : ''}

    <section class="panel">
      <div class="panel-head"><h2>Path to ${M.bandOf(target)}</h2>
        <label class="target">Target
          <select data-change="set-target" data-code="${code}" ${canEdit() ? '' : raw('disabled')}>
            ${[[85, 'HD (85%)'], [75, 'D (75%)'], [65, 'C (65%)'], [50, 'P (50%)']].map(([v, l]) => html`<option value="${v}" ${v === target ? raw('selected') : ''}>${l}</option>`)}
          </select></label>
      </div>
      ${recs.length ? html`<ol class="recs">${recs.map((r) => html`<li class="rec ${r.kind || ''}">${r.text}</li>`)}</ol>` : html`<p class="muted">Recommendations appear once marks, weights or quiz results are available.</p>`}
    </section>

    <section class="panel">
      <div class="panel-head"><h2>Assessments</h2>${cd?.sources?.length ? html`<span class="fine">From: ${cd.sources.join(', ')}</span>` : ''}</div>
      ${list.length ? html`<div class="table-wrap"><table class="assess">
        <thead><tr><th>Assessment</th><th>Due</th><th>Weight</th><th>Status</th><th>Mark</th></tr></thead>
        <tbody>${list.map((a) => assessmentRow(code, a))}</tbody>
      </table></div>` : html`<p class="muted">No assessments yet. They appear from your Canvas calendar or the subject outline.</p>`}
      ${g.weightsComplete ? '' : html`<p class="fine">${g.missingWeights ? `${g.missingWeights} assessment${g.missingWeights > 1 ? 's have' : ' has'} no weight. ` : ''}${Math.abs(g.totalWeight - 100) > 0.5 && !g.missingWeights ? `Weights add up to ${g.totalWeight}%. ` : ''}The marks-needed calculation needs every weight, adding to 100%.</p>`}
    </section>

    <section class="panel">
      <div class="panel-head"><h2>Modules</h2></div>
      ${mods.length ? html`<ul class="modules">${mods.map((m) => moduleRow(code, m))}</ul>`
    : html`<p class="muted">No modules imported yet. Quizzes are created from your module materials.</p>`}
    </section>

    <section class="panel">
      <div class="panel-head"><h2>Learning feedback</h2></div>
      ${weak.length ? html`<h3 class="h3">Topics to revise</h3><ul class="weak">${weak.map((w) => html`<li>
        <div><strong>${w.topic}</strong> <span class="muted">${w.moduleTitle}</span>${w.revise.length ? html`<div class="fine">Revise: ${w.revise.join('; ')}</div>` : ''}</div>
        <span class="pct ${pctClass(w.pct)}">${Math.round(w.pct)}%</span></li>`)}</ul>` : ''}
      ${quizHistory(code, mods)}
    </section>

    ${cd?.learningOutcomes?.length ? html`<section class="panel"><h2>Learning outcomes</h2>
      <ul class="los">${cd.learningOutcomes.map((lo) => html`<li><strong>${lo.id}</strong> ${lo.text}</li>`)}</ul></section>` : ''}`;
}

function neededText(g) {
  if (g.status === 'secured') return 'Secured';
  if (g.status === 'possible') return `${Math.max(0, g.needed).toFixed(1)}%`;
  if (g.status === 'out-of-reach') return 'Out of reach';
  if (g.status === 'final') return 'All marked';
  return '—';
}

function assessmentRow(code, a) {
  const ed = canEdit();
  const markPct = a.mark && a.mark.outOf > 0 ? (a.mark.score / a.mark.outOf) * 100 : null;
  const status = a.linked.length
    ? (a.submitted ? html`<span class="pill ok">Submitted</span>` : html`<span class="pill lvl-${a.linked[0].level}">${a.linked.length > 1 ? `${a.linked.filter((x) => x.submitted).length}/${a.linked.length} parts` : 'Not submitted'}</span>`)
    : html`<span class="muted">Not in Canvas calendar</span>`;
  return html`<tr>
    <td><strong>${a.title}</strong>
      ${a.linked.length > 1 ? html`<div class="fine">${a.linked.map((x) => x.title).join(' + ')}</div>` : ''}
      ${a.rubric.length || a.hdTips.length ? html`<details class="rubric"><summary>Rubric and HD tips</summary>
        ${a.rubric.length ? html`<table class="rubric-t"><thead><tr><th>Criterion</th><th>Weight</th><th>HD standard</th></tr></thead>
          <tbody>${a.rubric.map((c) => html`<tr><td>${c.criterion}</td><td>${c.weight != null ? `${c.weight}%` : ''}</td><td>${c.hd || html`<span class="missing">Not provided</span>`}</td></tr>`)}</tbody></table>` : ''}
        ${a.hdTips.length ? html`<ul class="tips">${a.hdTips.map((t) => html`<li>${t}</li>`)}</ul>` : ''}
      </details>` : ''}
    </td>
    <td>${a.due ? T.fmtDayShort(a.due) : html`<span class="missing">Unknown</span>`}</td>
    <td>${a.weightSource === 'outline' ? `${a.weight}%`
    : html`<input class="num" type="number" min="0" max="100" step="0.5" inputmode="decimal" value="${a.weight ?? ''}" placeholder="?" aria-label="Weight for ${a.title}" data-change="set-weight" data-code="${code}" data-id="${a.id}" ${ed ? '' : raw('disabled')}>%`}</td>
    <td>${status}</td>
    <td class="mark-cell"><input class="num" type="number" min="0" step="0.5" inputmode="decimal" value="${a.mark?.score ?? ''}" placeholder="—" aria-label="Score for ${a.title}" data-change="set-mark" data-part="score" data-code="${code}" data-id="${a.id}" ${ed ? '' : raw('disabled')}>
      / <input class="num" type="number" min="1" step="0.5" inputmode="decimal" value="${a.mark?.outOf ?? 100}" aria-label="Out of" data-change="set-mark" data-part="outOf" data-code="${code}" data-id="${a.id}" ${ed ? '' : raw('disabled')}>
      ${markPct != null ? html`<span class="pct ${pctClass(markPct)}">${markPct.toFixed(0)}%</span>` : ''}</td>
  </tr>`;
}

function moduleRow(code, m) {
  const s = M.moduleStatus(S.st, code, m);
  const n = s.attempts.length;
  const ed = canEdit();
  return html`<li class="module">
    <label class="check"><input type="checkbox" data-change="toggle-module" data-code="${code}" data-mod="${m.id}" ${s.done ? raw('checked') : ''} ${ed ? '' : raw('disabled')}>
      <span><strong>${m.title}</strong>${m.topics?.length ? html`<span class="fine block">${m.topics.join(', ')}</span>` : ''}</span></label>
    <div class="mod-side">
      ${s.latestPct != null ? html`<span class="pct ${pctClass(s.latestPct)}" title="Latest attempt">${Math.round(s.latestPct)}%</span>` : ''}
      ${!s.hasQuiz ? html`<span class="missing">No quiz (materials not provided)</span>`
    : !ed ? html`<span class="fine">Quizzes on main device</span>`
      : !s.done && !n ? html`<span class="fine">Mark done to unlock the quiz</span>`
        : html`<a class="btn sm ${n ? '' : 'primary'}" href="#/quiz/${code}/${encodeURIComponent(m.id)}">${n ? 'Retake quiz' : 'Take quiz'}</a>`}
      ${n ? html`<a class="link" href="#/quiz/${code}/${encodeURIComponent(m.id)}/review">Review</a>` : ''}
    </div>
  </li>`;
}

function quizHistory(code, mods) {
  const rows = [];
  for (const m of mods) {
    for (const a of S.st.user.quizzes[M.moduleKey(code, m.id)] || []) rows.push({ m, a });
  }
  if (!rows.length) return html`<p class="muted">Quiz results will appear here.</p>`;
  rows.sort((x, y) => y.a.at.localeCompare(x.a.at));
  return html`<h3 class="h3">Quiz history</h3><ul class="history">${rows.slice(0, 12).map(({ m, a }) => html`<li>
    <span>${m.title} <span class="muted">attempt ${a.attempt} · ${T.fmtRelativeStamp(new Date(a.at))}</span></span>
    <span class="pct ${pctClass(a.pct)}">${a.correct}/${a.total}</span></li>`)}</ul>`;
}

function recommendations(code, { g, p, list, mods, weak, cd }) {
  const recs = [];
  const target = g.target;
  if (g.status === 'possible') {
    recs.push({ text: html`Average <strong>${Math.max(0, g.needed).toFixed(1)}%</strong> across the remaining ${g.remainingWeight}% of the subject to reach ${target}%.${g.current != null ? ` You're on ${g.current.toFixed(1)}% across what's marked so far.` : ''}` });
  } else if (g.status === 'secured') {
    recs.push({ kind: 'good', text: `You've already secured ${target}% overall from marked work.` });
  } else if (g.status === 'out-of-reach') {
    recs.push({ kind: 'warn', text: html`${target}% is no longer reachable; the maximum possible is ${g.maxPossible.toFixed(1)}%. Consider setting the target to ${M.bandOf(g.maxPossible)}.` });
  } else if (g.current != null) {
    recs.push({ text: `You're on ${g.current.toFixed(1)}% across marked work. Add the missing weights to see what you need on the rest.` });
  }
  const next = list.find((a) => !a.submitted && a.due && a.due > new Date());
  if (next) {
    const hd = next.rubric.filter((c) => c.hd);
    if (hd.length) {
      const top = [...next.rubric].sort((x, y) => (y.weight || 0) - (x.weight || 0))[0];
      recs.push({ text: html`Next up is <strong>${next.title}</strong> (${T.fmtDayShort(next.due)}). Its heaviest criterion is ${top.criterion}${top.weight ? ` (${top.weight}%)` : ''}; the HD standard asks for: ${top.hd || 'not provided'}.` });
    } else {
      recs.push({ text: html`Next up is <strong>${next.title}</strong> (${T.fmtDayShort(next.due)}). ${next.fromOutline ? 'Its rubric hasn\'t been provided, so HD criteria can\'t be shown.' : 'Import the brief and rubric to get HD criteria for it.'}` });
    }
    for (const t of next.hdTips.slice(0, 3)) recs.push({ text: t });
  }
  for (const w of weak.slice(0, 3)) {
    recs.push({ kind: 'warn', text: html`Revise <strong>${w.topic}</strong> (${w.moduleTitle}): ${Math.round(w.pct)}% on your latest quiz.${w.revise.length ? ` ${w.revise[0]}` : ''} Then retake the quiz.` });
  }
  const untested = mods.filter((m) => { const s = M.moduleStatus(S.st, code, m); return s.done && s.hasQuiz && !s.attempts.length; });
  if (untested.length) recs.push({ text: `Take the quiz for ${untested.map((m) => m.title).join(', ')}. Marked done but understanding not checked yet.` });
  for (const t of cd?.hdGuidance || []) recs.push({ text: t });
  return recs;
}

// ======================================================================
// Quiz
// ======================================================================
function findModule(code, modId) {
  return M.modulesOf(S.st, code).find((m) => m.id === modId);
}

function viewQuiz(code, modId, mode) {
  const mod = findModule(code, modId);
  const s = M.subjectByCode(code);
  if (!mod || !s) return html`<div class="empty"><h2>Quiz not found</h2><a href="#/subjects">Back to subjects</a></div>`;
  const key = M.moduleKey(code, modId);
  const attempts = S.st.user.quizzes[key] || [];
  if (mode === 'review') {
    const idx = attempts.length - 1;
    if (idx < 0) return html`<div class="empty"><h2>No attempts yet</h2></div>`;
    return quizReview(code, mod, attempts[idx]);
  }
  if (!canEdit()) return html`<a class="back" href="#/subject/${code}">${icon('left')}${code}</a><div class="empty"><h2>Quizzes are taken on your main device</h2><p>Your results appear here after you send an update from your laptop.</p></div>`;
  const n = attempts.length + 1;
  const qs = M.quizQuestionsFor(mod, n);
  if (!qs.length) return html`<div class="empty"><h2>This module has no quiz yet</h2><p>Module materials weren't provided, so no questions were written.</p></div>`;
  const added = n > 1 ? qs.length - (mod.quiz.questions || []).length : 0;
  return html`
    <a class="back" href="#/subject/${code}">${icon('left')}${code} ${s.name}</a>
    <div class="page-head"><h1>${mod.title}</h1>
      <p class="sub">Attempt ${n} · ${qs.length} questions${n > 1 ? (added ? ` · the same questions as before plus ${added} new` : ' · the same questions as before') : ''}</p></div>
    <form class="quiz" data-submit="quiz" data-code="${code}" data-mod="${mod.id}">
      ${qs.map((q, i) => html`<fieldset class="q">
        <legend><span class="q-num">${i + 1}</span><span class="q-kind">${q.kind === 'application' ? 'Application' : 'Concept'} · ${q.topic || 'General'}</span></legend>
        <p class="q-prompt">${q.prompt}</p>
        ${q.type === 'numeric'
    ? html`<label class="field inline"><span>Your answer</span><input name="${q.id}" type="text" inputmode="decimal" autocomplete="off"></label>`
    : html`<div class="opts">${q.options.map((o, oi) => html`<label class="opt"><input type="${q.type === 'multiple' ? 'checkbox' : 'radio'}" name="${q.id}" value="${oi}"><span>${o}</span></label>`)}</div>
              ${q.type === 'multiple' ? html`<p class="fine">Select all that apply.</p>` : ''}`}
      </fieldset>`)}
      <div class="quiz-foot"><p class="form-error" role="alert"></p><button class="btn primary" type="submit">Submit answers</button></div>
    </form>`;
}

function answerText(q, ans) {
  if (ans == null || ans === '' || (Array.isArray(ans) && !ans.length)) return 'No answer';
  if (q.type === 'numeric') return String(ans);
  const arr = Array.isArray(ans) ? ans : [ans];
  return arr.map((i) => q.options[Number(i)]).join('; ');
}
function correctText(q) {
  if (q.type === 'numeric') return `${q.answer}${q.tolerance ? ` (±${q.tolerance})` : ''}`;
  const arr = Array.isArray(q.answer) ? q.answer : [q.answer];
  return arr.map((i) => q.options[i]).join('; ');
}

function quizReview(code, mod, attempt) {
  const allQs = [...(mod.quiz?.questions || []), ...(mod.quiz?.retakeQuestions || [])];
  const qs = (attempt.qids || []).map((id) => allQs.find((q) => q.id === id)).filter(Boolean);
  const wrong = qs.filter((q) => !M.isCorrect(q, attempt.answers[q.id]));
  const weakT = Object.entries(attempt.topics || {}).filter(([, t]) => t.right / t.total < 0.7);
  const kinds = attempt.kinds || {};
  return html`
    <a class="back" href="#/subject/${code}">${icon('left')}${code}</a>
    <div class="page-head"><h1>${mod.title}</h1><p class="sub">Attempt ${attempt.attempt} · ${T.fmtRelativeStamp(new Date(attempt.at))}</p></div>
    <section class="panel score-panel">
      <div class="score"><span class="score-v ${pctClass(attempt.pct)}">${attempt.correct}/${attempt.total}</span><span class="score-p">${Math.round(attempt.pct)}%</span></div>
      <dl class="kinds">${Object.entries(kinds).map(([k, v]) => html`<div><dt>${k === 'application' ? 'Application' : 'Concept'}</dt><dd>${v.right}/${v.total}</dd></div>`)}</dl>
      <div class="row gap"><a class="btn primary" href="#/quiz/${code}/${encodeURIComponent(mod.id)}">Retake quiz</a><a class="btn" href="#/subject/${code}">Back to subject</a></div>
    </section>
    ${weakT.length ? html`<section class="panel alert"><h2>Revise these topics</h2><ul class="weak">${weakT.map(([topic, t]) => html`<li>
      <div><strong>${topic}</strong>${(attempt.revise?.[topic] || []).length ? html`<div class="fine">${attempt.revise[topic].join('; ')}</div>` : ''}</div>
      <span class="pct lo">${t.right}/${t.total}</span></li>`)}</ul>
      <p class="fine">Your next attempt repeats these questions and adds new ones.</p></section>`
    : html`<section class="panel"><p>No weak topics in this attempt.${wrong.length ? '' : ' Every answer was correct.'}</p></section>`}
    <section class="panel">
      <h2>Your answers</h2>
      <ol class="review">${qs.map((q) => {
    const ok = M.isCorrect(q, attempt.answers[q.id]);
    return html`<li class="${ok ? 'right' : 'wrong'}">
          <p class="q-prompt"><span class="mark">${ok ? icon('check') : icon('x')}</span>${q.prompt}</p>
          <p><span class="muted">Your answer:</span> ${answerText(q, attempt.answers[q.id])}</p>
          ${ok ? '' : html`<p><span class="muted">Correct answer:</span> ${correctText(q)}</p>`}
          ${q.explanation ? html`<p class="expl">${q.explanation}</p>` : ''}
        </li>`;
  })}</ol>
    </section>`;
}

function submitQuiz(form) {
  const { code, mod: modId } = form.dataset;
  const mod = findModule(code, modId);
  const key = M.moduleKey(code, modId);
  const attempts = S.st.user.quizzes[key] || [];
  const n = attempts.length + 1;
  const qs = M.quizQuestionsFor(mod, n);
  const fd = new FormData(form);
  const answers = {};
  let unanswered = 0;
  for (const q of qs) {
    if (q.type === 'multiple') answers[q.id] = fd.getAll(q.id).map(Number);
    else answers[q.id] = fd.get(q.id) ?? '';
    const v = answers[q.id];
    if (v === '' || (Array.isArray(v) && !v.length)) unanswered++;
  }
  if (unanswered) {
    const err = form.querySelector('.form-error');
    if (!form.dataset.warned) {
      err.textContent = `${unanswered} question${unanswered > 1 ? 's are' : ' is'} unanswered. Submit again to mark ${unanswered > 1 ? 'them' : 'it'} wrong.`;
      form.dataset.warned = '1';
      return;
    }
  }
  const g = M.gradeQuiz(qs, answers);
  const revise = {};
  for (const q of qs) {
    if (!M.isCorrect(q, answers[q.id]) && q.revise) {
      const t = q.topic || 'General';
      revise[t] ??= [];
      if (!revise[t].includes(q.revise)) revise[t].push(q.revise);
    }
  }
  attempts.push({
    at: new Date().toISOString(), attempt: n, qids: qs.map((q) => q.id), answers,
    correct: g.correct, total: g.total, pct: g.pct, topics: g.topics, kinds: g.kinds, revise,
  });
  S.st.user.quizzes[key] = attempts;
  scheduleSave();
  location.hash = `#/quiz/${code}/${encodeURIComponent(modId)}/review`;
}

// ======================================================================
// Settings
// ======================================================================
function viewSettings() {
  const st = S.st;
  const cal = st.calendar;
  const cdSubjects = Object.entries(st.courseData.subjects || {});
  const main = canEdit();
  return html`
    <div class="page-head"><h1>Settings</h1></div>

    <section class="panel">
      <h2>Canvas calendar</h2>
      <p>In Canvas, open <strong>Calendar</strong> and select <strong>Calendar Feed</strong> at the bottom right. Copy the link and paste it here. Treat it like a password: anyone with it can read your calendar.</p>
      <form class="stack" data-submit="feed">
        <label class="field"><span>Feed link</span>
          <span class="input-row"><input name="url" type="password" autocomplete="off" spellcheck="false" placeholder="https://canvas.uts.edu.au/feeds/calendars/user_….ics" value="${st.settings.feedUrl}">
          <button class="btn sm ghost" type="button" data-action="reveal-feed">Show</button></span></label>
        <div class="row gap wrap">
          <button class="btn primary" type="submit">Save and update</button>
          <button class="btn" type="button" data-action="import-ics">Import .ics file</button>
          ${st.settings.feedUrl ? html`<button class="btn ghost" type="button" data-action="clear-feed">Remove link</button>` : ''}
        </div>
      </form>
      <dl class="facts">
        <div><dt>Last updated</dt><dd>${cal.lastSuccess ? `${T.fmtRelativeStamp(new Date(cal.lastSuccess))} (${cal.source === 'file' ? 'from a file' : 'from the feed'})` : 'Never'}</dd></div>
        <div><dt>Events stored</dt><dd>${Object.keys(cal.items).length}</dd></div>
        ${cal.lastError ? html`<div><dt>Last problem</dt><dd class="warn-text">${cal.lastError}</dd></div>` : ''}
      </dl>
      <p class="fine">The calendar updates every time you open or unlock the dashboard. If an update fails, your last saved calendar stays on screen and you'll see a warning.</p>
    </section>

    <section class="panel">
      <h2>Course data</h2>
      <p>Quizzes, assessment weights, rubrics and HD guidance come from a course data file. Upload your outlines, briefs, rubrics, marks and module materials to the Claude project and ask for an updated course data file, then import it here.</p>
      ${main ? html`<button class="btn primary" data-action="import-course">Import course data file</button>` : html`<p class="fine">Course data arrives with updates from your laptop.</p>`}
      ${cdSubjects.length ? html`<ul class="cd-list">${cdSubjects.map(([code, d]) => html`<li>
        ${codeTag(code)} <span>${(d.assessments || []).length} assessments · ${(d.modules || []).length} modules · imported ${d.importedAt ? T.fmtRelativeStamp(new Date(d.importedAt)) : ''}</span>
        ${main ? html`<button class="link danger" data-action="remove-course" data-code="${code}">Remove</button>` : ''}</li>`)}</ul>`
    : html`<p class="muted">No course data imported yet.</p>`}
    </section>

    <section class="panel">
      <h2>${main ? 'Send to phone and backups' : 'Updates from your laptop'}</h2>
      ${main ? html`
        <p>Your phone doesn't share storage with this laptop. To update it, save an update file here, AirDrop it to your phone, then open Settings on your phone and import it. The same file works as a backup.</p>
        <div class="row gap wrap">
          <button class="btn primary" data-action="export-update">Save update file</button>
          <button class="btn" data-action="restore-backup">Restore from a file</button>
        </div>
        <p class="fine">Files are encrypted with a password you choose each time. Last saved: ${st.lastExport ? T.fmtRelativeStamp(new Date(st.lastExport)) : 'never'}.</p>`
    : html`
        <p>Import the update file you saved on your laptop. It replaces submissions, marks, quiz results and course data on this phone.</p>
        <button class="btn primary" data-action="import-update">Import update file</button>
        <p class="fine">Last update: ${st.lastImport ? T.fmtRelativeStamp(new Date(st.lastImport)) : 'never'}.</p>`}
    </section>

    <section class="panel">
      <h2>Security</h2>
      <div class="row gap wrap">
        <button class="btn" data-action="change-passcode">Change passcode</button>
        <button class="btn" data-action="new-recovery">Create new recovery code</button>
        <button class="btn" data-action="lock">Lock now</button>
      </div>
      <label class="field inline"><span>Lock after</span>
        <select data-change="autolock">${[5, 15, 30, 60].map((m) => html`<option value="${m}" ${st.settings.autoLockMin === m ? raw('selected') : ''}>${m} minutes of inactivity</option>`)}</select></label>
    </section>

    <section class="panel">
      <h2>This device</h2>
      <dl class="facts">
        <div><dt>Role</dt><dd>${main ? 'Main device (can edit)' : 'View-only device'} <button class="link" data-action="switch-role">Change</button></dd></div>
        <div><dt>Storage</dt><dd id="persist-state">Checking…</dd></div>
        <div><dt>Version</dt><dd>${APP_VERSION}</dd></div>
      </dl>
      <p class="fine">On iPhone, add this page to your Home Screen (Share › Add to Home Screen) and open it from there, so Safari keeps your data.</p>
      <button class="btn danger" data-action="erase">Erase all data on this device</button>
    </section>`;
}

async function updatePersistState() {
  const el = document.getElementById('persist-state');
  if (!el) return;
  try {
    const persisted = await navigator.storage?.persisted?.();
    const est = await navigator.storage?.estimate?.();
    const used = est?.usage ? `${(est.usage / 1024).toFixed(0)} KB used` : '';
    el.innerHTML = html`${persisted ? 'Protected from automatic clearing' : html`Not protected yet <button class="link" data-action="persist">Protect</button>`}${used ? ` · ${used}` : ''}`.s;
  } catch { el.textContent = 'Unknown'; }
}

async function askPassword({ title, confirm = false, intro }) {
  const r = await openDialog({
    title,
    body: html`${intro ? html`<p>${intro}</p>` : ''}
      <label class="field"><span>File password</span><input name="p1" type="password" autocomplete="new-password" required></label>
      ${confirm ? html`<label class="field"><span>Enter it again</span><input name="p2" type="password" autocomplete="new-password" required></label>` : ''}`,
    actions: [{ label: 'Cancel', value: 'cancel' }, { label: 'Continue', value: 'ok', kind: 'primary' }],
    validate: (v, d) => {
      if ((d.p1 || '').length < 6) return 'Use at least 6 characters.';
      if (confirm && d.p1 !== d.p2) return "The passwords don't match.";
      return null;
    },
  });
  return r?.value === 'ok' ? r.data.p1 : null;
}

async function exportUpdate() {
  const pw = await askPassword({ title: 'Save update file', confirm: true, intro: "Choose a password for this file. You'll type it on your phone when you import it." });
  if (!pw) return;
  await saveNow();
  const payload = { ...S.st };
  const box = await passwordEncrypt(pw, payload);
  const file = { format: 'uni-dashboard-update', version: 1, createdAt: new Date().toISOString(), ...box };
  downloadFile(`study-runway-update-${T.dayKey(new Date())}.json`, JSON.stringify(file));
  S.st.lastExport = new Date().toISOString();
  commit();
  toast('Update file saved. AirDrop it to your phone.');
}

async function readUpdateFile() {
  const f = await pickFile();
  if (!f) return null;
  let file;
  try { file = JSON.parse(await f.text()); } catch { toast("That file isn't an update file.", 'error'); return null; }
  if (file.format !== 'uni-dashboard-update') { toast("That file isn't an update file.", 'error'); return null; }
  let data = null;
  await openDialog({
    title: 'Open update file',
    body: html`<p>Saved ${T.fmtRelativeStamp(new Date(file.createdAt))}.</p><label class="field"><span>File password</span><input name="p1" type="password" required></label>`,
    actions: [{ label: 'Cancel', value: 'cancel' }, { label: 'Open', value: 'ok', kind: 'primary' }],
    validate: async (v, d) => {
      try { data = await passwordDecrypt(d.p1 || '', file); return null; } catch { return "That password didn't open the file."; }
    },
  });
  return data;
}

async function importUpdate() {
  const data = await readUpdateFile();
  if (!data) return;
  const keep = S.st.settings;
  const next = migrate(data);
  next.settings = { ...next.settings, role: keep.role, autoLockMin: keep.autoLockMin };
  // Keep this phone's calendar if it is newer than the one in the file.
  if (S.st.calendar.lastSuccess && (!next.calendar.lastSuccess || S.st.calendar.lastSuccess > next.calendar.lastSuccess)) {
    next.calendar = S.st.calendar;
  }
  next.lastImport = new Date().toISOString();
  S.st = next;
  commit();
  toast('Updated from your laptop.');
}

async function restoreBackup() {
  const data = await readUpdateFile();
  if (!data) return;
  if (!await confirmDialog('Restore from this file?', 'Everything on this device is replaced with the contents of the file.', 'Restore', 'danger')) return;
  const role = S.st.settings.role;
  S.st = migrate(data);
  S.st.settings.role = role;
  commit();
  toast('Restored.');
}

async function importCourseData() {
  const f = await pickFile('.json,application/json');
  if (!f) return;
  let data;
  try { data = JSON.parse(await f.text()); } catch { toast("That file isn't valid JSON.", 'error'); return; }
  const { errors, warnings } = M.validateCourseData(data);
  if (errors.length) {
    await openDialog({ title: "Couldn't import course data", body: html`<ul class="errs">${errors.slice(0, 12).map((e) => html`<li>${e}</li>`)}</ul>${errors.length > 12 ? html`<p>…and ${errors.length - 12} more.</p>` : ''}` });
    return;
  }
  const now = new Date().toISOString();
  const codes = [];
  for (const s of data.subjects) {
    S.st.courseData.subjects[String(s.code)] = { ...s, code: String(s.code), importedAt: now };
    codes.push(String(s.code));
  }
  S.st.courseData.importedAt = now;
  commit();
  if (warnings.length) toast(warnings[0], 'warn');
  else toast(`Imported course data for ${codes.join(', ')}.`);
}

async function changePasscode() {
  const r = await openDialog({
    title: 'Change passcode',
    body: html`<label class="field"><span>Current passcode</span><input name="cur" type="password" autocomplete="current-password" required></label>
      <label class="field"><span>New passcode</span><input name="p1" type="password" autocomplete="new-password" required></label>
      <label class="field"><span>Enter it again</span><input name="p2" type="password" autocomplete="new-password" required></label>`,
    actions: [{ label: 'Cancel', value: 'cancel' }, { label: 'Change passcode', value: 'ok', kind: 'primary' }],
    validate: async (v, d) => {
      if ((d.p1 || '').length < 6) return 'Use at least 6 characters.';
      if (d.p1 !== d.p2) return "The new passcodes don't match.";
      try { await V.unlockWithPasscode(d.cur); } catch { return 'Current passcode is wrong.'; }
      return null;
    },
  });
  if (r?.value !== 'ok') return;
  await V.setPasscode(S.key, r.data.p1);
  toast('Passcode changed.');
}

async function newRecovery() {
  if (!await confirmDialog('Create a new recovery code?', 'Your old recovery code stops working.', 'Create code')) return;
  const code = await V.rotateRecoveryCode(S.key);
  await openDialog({
    title: 'New recovery code',
    body: html`<p>Write this down. It's shown once.</p><div class="recovery">${code}</div>`,
    actions: [{ label: "I've saved it", value: 'ok', kind: 'primary' }],
  });
}

// ======================================================================
// Events
// ======================================================================
const actions = {
  sync: () => syncCalendar({ reason: 'manual' }),
  lock: () => lock(),
  'import-ics': () => importIcsFile(),
  'toggle-submit': (el) => {
    if (!canEdit()) return;
    const k = el.dataset.key;
    const u = S.st.user.asg[k] ||= {};
    u.submitted = !u.submitted;
    u.submittedAt = u.submitted ? new Date().toISOString() : null;
    commit();
    toast(u.submitted ? 'Marked as submitted.' : 'Marked as not submitted.');
  },
  'submit-all-overdue': async () => {
    const list = M.assignments(S.st).filter((a) => a.level === 'overdue');
    if (!await confirmDialog(`Mark ${list.length} items as submitted?`, list.map((a) => `${a.code} ${a.title}`).join(' · '), 'Mark submitted')) return;
    const now = new Date().toISOString();
    for (const a of list) { const u = S.st.user.asg[a.key] ||= {}; u.submitted = true; u.submittedAt = now; }
    commit();
  },
  'del-task': (el) => {
    const u = S.st.user.asg[el.dataset.key];
    if (!u) return;
    u.tasks = (u.tasks || []).filter((t) => t.id !== el.dataset.id);
    commit();
  },
  'add-brief-tasks': (el) => {
    const a = M.assignments(S.st).find((x) => x.key === el.dataset.key);
    const u = S.st.user.asg[a.key] ||= {};
    u.tasks ||= [];
    for (const t of a.assessment?.tasks || []) {
      if (!u.tasks.some((x) => x.text === t)) u.tasks.push({ id: Math.random().toString(36).slice(2, 9), text: t, done: false });
    }
    commit();
  },
  'dismiss-changes': () => { (S.st.calendar.changes || []).forEach((c) => { c.dismissed = true; }); commit(); },
  'cal-prev': () => { const [y, m] = S.calMonth.split('-').map(Number); S.calMonth = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`; renderView(); },
  'cal-next': () => { const [y, m] = S.calMonth.split('-').map(Number); S.calMonth = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`; renderView(); },
  'cal-today': () => { S.calMonth = null; S.calSelected = null; renderView(); },
  'cal-day': (el) => { S.calSelected = el.dataset.day; S.calMonth = el.dataset.day.slice(0, 7); renderView(); },
  'reveal-feed': (el) => { const i = el.parentElement.querySelector('input'); const show = i.type === 'password'; i.type = show ? 'text' : 'password'; el.textContent = show ? 'Hide' : 'Show'; },
  'clear-feed': async () => { if (await confirmDialog('Remove the feed link?', 'Your saved calendar stays. It just stops updating.', 'Remove')) { S.st.settings.feedUrl = ''; commit(); } },
  'import-course': () => importCourseData(),
  'remove-course': async (el) => {
    const code = el.dataset.code;
    if (!await confirmDialog(`Remove course data for ${code}?`, 'Quizzes and rubrics for this subject disappear. Your quiz history and marks are kept.', 'Remove', 'danger')) return;
    delete S.st.courseData.subjects[code];
    commit();
  },
  'export-update': () => exportUpdate(),
  'import-update': () => importUpdate(),
  'restore-backup': () => restoreBackup(),
  'change-passcode': () => changePasscode(),
  'new-recovery': () => newRecovery(),
  persist: async () => { const ok = await navigator.storage?.persist?.(); toast(ok ? 'Storage protected.' : 'The browser declined. On iPhone, open the dashboard from your Home Screen.'); updatePersistState(); },
  'switch-role': async () => {
    const toViewer = canEdit();
    const ok = await confirmDialog(
      toViewer ? 'Make this a view-only device?' : 'Make this the main device?',
      toViewer ? "You won't be able to edit submissions, marks or quizzes here." : 'Only one device should be the main device, or changes will conflict.',
      'Change role',
    );
    if (!ok) return;
    S.st.settings.role = toViewer ? 'viewer' : 'main';
    commit();
  },
  erase: async () => {
    const r = await openDialog({
      title: 'Erase all data on this device?',
      body: html`<p>Your submissions, marks, quiz results, course data and passcode are deleted from this device. Type ERASE to confirm.</p><label class="field"><span>Confirm</span><input name="c" autocomplete="off"></label>`,
      actions: [{ label: 'Cancel', value: 'cancel' }, { label: 'Erase', value: 'ok', kind: 'danger' }],
      validate: (v, d) => (d.c === 'ERASE' ? null : 'Type ERASE in capitals.'),
    });
    if (r?.value !== 'ok') return;
    S.key = null; S.st = null;
    await V.eraseAll();
    location.hash = '';
    location.reload();
  },
};

const changes = {
  'toggle-task': (el) => {
    const u = S.st.user.asg[el.dataset.key];
    const t = u?.tasks?.find((x) => x.id === el.dataset.id);
    if (t) { t.done = el.checked; commit(); }
  },
  'toggle-module': (el) => {
    const k = M.moduleKey(el.dataset.code, el.dataset.mod);
    S.st.user.modules[k] = { done: el.checked, doneAt: el.checked ? new Date().toISOString() : null };
    commit();
  },
  'set-target': (el) => { S.st.settings.targets[el.dataset.code] = Number(el.value); commit(); },
  'set-weight': (el) => {
    const k = `${el.dataset.code}:${el.dataset.id}`;
    const v = parseFloat(el.value);
    if (Number.isFinite(v) && v >= 0 && v <= 100) S.st.user.weights[k] = v; else delete S.st.user.weights[k];
    commit();
  },
  'set-mark': (el) => {
    const k = `${el.dataset.code}:${el.dataset.id}`;
    const row = el.closest('td');
    const score = parseFloat(row.querySelector('[data-part=score]').value);
    const outOf = parseFloat(row.querySelector('[data-part=outOf]').value) || 100;
    if (Number.isFinite(score) && score >= 0) S.st.user.marks[k] = { score, outOf };
    else delete S.st.user.marks[k];
    commit();
  },
  autolock: (el) => { S.st.settings.autoLockMin = Number(el.value); commit({ rerender: false }); },
};

const submits = {
  'add-task': (form) => {
    const text = form.text.value.trim();
    if (!text) return;
    const u = S.st.user.asg[form.dataset.key] ||= {};
    (u.tasks ||= []).push({ id: Math.random().toString(36).slice(2, 9), text, done: false });
    commit();
    const again = document.querySelector(`form[data-submit="add-task"][data-key="${CSS.escape(form.dataset.key)}"] input`);
    if (again) { again.closest('details')?.setAttribute('open', ''); again.focus(); }
  },
  feed: (form) => {
    const url = normaliseFeedUrl(form.url.value);
    if (url && !/^https:\/\//i.test(url)) { toast('The link should start with https:// or webcal://', 'error'); return; }
    S.st.settings.feedUrl = url;
    commit();
    if (url) syncCalendar({ reason: 'manual' });
  },
  quiz: (form) => submitQuiz(form),
};

document.addEventListener('click', (e) => {
  const g = e.target.closest('[data-gate-action]');
  if (g) {
    const a = g.dataset.gateAction;
    if (a === 'forgot') renderUnlock({ recovery: true });
    if (a === 'back-unlock') renderUnlock();
    if (a === 'copy-rc') navigator.clipboard?.writeText(document.getElementById('rc').textContent).then(() => toast('Copied.'), () => toast("Couldn't copy. Write it down instead."));
    return;
  }
  const el = e.target.closest('[data-action]');
  if (!el || !S.key) return;
  e.preventDefault();
  actions[el.dataset.action]?.(el, e);
});

document.addEventListener('change', (e) => {
  const el = e.target.closest('[data-change]');
  if (!el || !S.key) return;
  changes[el.dataset.change]?.(el, e);
});

document.addEventListener('submit', (e) => {
  const form = e.target;
  if (form.matches('[data-gate]')) { e.preventDefault(); onGateSubmit(form).catch((err) => { console.error(err); toast(err.message, 'error'); }); return; }
  if (form.matches('[data-submit]') && S.key) { e.preventDefault(); submits[form.dataset.submit]?.(form); }
});

window.addEventListener('hashchange', () => { if (S.key) renderView(); });
window.addEventListener('resize', (() => { let t; let w = innerWidth; return () => { clearTimeout(t); t = setTimeout(() => { if (S.key && (innerWidth < 700) !== (w < 700)) renderView(); w = innerWidth; }, 200); }; })());
window.addEventListener('pagehide', () => { if (S.key) saveNow(); });

// ======================================================================
// Service worker (offline + Home Screen)
// ======================================================================
function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') return;
  navigator.serviceWorker.register('./sw.js').then((reg) => {
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => {
        if (w.state === 'installed' && navigator.serviceWorker.controller) {
          toast('A new version is ready. Lock and reopen the dashboard to use it.');
        }
      });
    });
  }).catch(() => { /* offline support is optional */ });
}

boot();
