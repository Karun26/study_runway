// iCalendar parsing and Canvas-specific normalisation.
import { TZ, zonedToDate } from './time.js';

export const SUBJECTS = [
  { code: '36106', name: 'Machine Learning Algorithms and Applications', canvasId: '41782' },
  { code: '36100', name: 'Data Science for Innovation', canvasId: '41794' },
  { code: '36103', name: 'Statistical Thinking for Data Science', canvasId: '41818' },
];
const BY_CANVAS = Object.fromEntries(SUBJECTS.map((s) => [s.canvasId, s.code]));
const KNOWN_CODES = new Set(SUBJECTS.map((s) => s.code));

function unfold(text) {
  return text.replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '');
}

function unescapeText(v) {
  return v.replace(/\\([\\;,nN])/g, (_, c) => (c === 'n' || c === 'N' ? '\n' : c));
}

function parseLine(line) {
  // NAME;PARAM=a;PARAM="b:c":VALUE  — colons inside quotes belong to params.
  let inQuote = false, split = -1;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') inQuote = !inQuote;
    else if (ch === ':' && !inQuote) { split = i; break; }
  }
  if (split < 0) return null;
  const head = line.slice(0, split);
  const value = line.slice(split + 1);
  const [name, ...rawParams] = head.split(';');
  const params = {};
  for (const p of rawParams) {
    const eq = p.indexOf('=');
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, '');
  }
  return { name: name.toUpperCase(), params, value };
}

/** Parse an ICS date/date-time value into { date: Date, allDay, ymd }. */
export function parseIcsDate(value, params = {}) {
  const v = value.trim();
  const m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, z] = m;
  const ymd = `${y}-${mo}-${d}`;
  if (!h || params.VALUE === 'DATE') {
    return { allDay: true, ymd, date: zonedToDate(+y, +mo, +d, 0, 0, 0, TZ) };
  }
  if (z) return { allDay: false, ymd, date: new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +(s || 0))) };
  let tz = params.TZID || TZ;
  try { new Intl.DateTimeFormat('en', { timeZone: tz }); } catch { tz = TZ; }
  return { allDay: false, ymd, date: zonedToDate(+y, +mo, +d, +h, +mi, +(s || 0), tz) };
}

/** Raw parse: returns { calName, events: [{...props}] }. Throws on non-calendar input. */
export function parseICS(text) {
  if (typeof text !== 'string' || !/BEGIN:VCALENDAR/i.test(text)) {
    throw new Error('This is not a calendar file (no BEGIN:VCALENDAR found).');
  }
  const lines = unfold(text).split('\n');
  const events = [];
  let calName = '';
  let cur = null;
  let depth = 0; // ignore nested components like VALARM
  for (const line of lines) {
    if (!line) continue;
    const up = line.toUpperCase();
    if (up === 'BEGIN:VEVENT') { cur = {}; depth = 0; continue; }
    if (up === 'END:VEVENT') { if (cur) events.push(cur); cur = null; continue; }
    if (cur && up.startsWith('BEGIN:')) { depth++; continue; }
    if (cur && up.startsWith('END:')) { depth--; continue; }
    const p = parseLine(line);
    if (!p) continue;
    if (!cur) { if (p.name === 'X-WR-CALNAME') calName = unescapeText(p.value); continue; }
    if (depth > 0) continue;
    switch (p.name) {
      case 'UID': cur.uid = p.value.trim(); break;
      case 'SUMMARY': cur.summary = unescapeText(p.value).trim(); break;
      case 'DESCRIPTION': cur.description = unescapeText(p.value).trim(); break;
      case 'LOCATION': cur.location = unescapeText(p.value).trim(); break;
      case 'URL': cur.url = p.value.trim(); break;
      case 'DTSTART': cur.start = parseIcsDate(p.value, p.params); break;
      case 'DTEND': cur.end = parseIcsDate(p.value, p.params); break;
      case 'DTSTAMP': cur.stamp = parseIcsDate(p.value, p.params); break;
      case 'STATUS': cur.status = p.value.trim().toUpperCase(); break;
      default: break;
    }
  }
  return { calName, events };
}

function findZoom(...texts) {
  for (const t of texts) {
    const m = (t || '').match(/https:\/\/[a-z0-9.-]*zoom\.(?:us|uts\.edu\.au)\/j\/\d+[^\s)\]"]*/i)
      || (t || '').match(/https:\/\/zoom\.uts\.edu\.au\/j\/\d+/i);
    if (m) return m[0];
  }
  return '';
}

/** Turn "[label] (https://...)" link syntax into plain text, keep URLs separately. */
function cleanDescription(text) {
  if (!text) return '';
  return text
    .replace(/\[([^\]]*)\]\s*\((https?:[^)\s]+|#)\)/g, (_, label) => label.trim())
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/ /g, ' ')
    .trim();
}

/**
 * Canvas-aware normalisation.
 * Returns { calName, items: { key: item } } where item.kind is one of
 * 'assignment' | 'lecture' | 'tutorial' | 'class' | 'event' | 'survey'.
 */
export function normaliseCanvas(text) {
  const { calName, events } = parseICS(text);
  const items = {};
  for (const e of events) {
    if (!e.uid || !e.start || e.status === 'CANCELLED') continue;
    const summary = e.summary || '(untitled)';
    const bracket = summary.match(/\[([^\]]+)\]\s*$/);
    const courseLabel = bracket ? bracket[1].trim() : '';
    let code = (courseLabel.match(/^(\d{5})\b/) || [])[1] || '';
    const ctx = (e.url || '').match(/course_(\d+)/);
    if (!code && ctx && BY_CANVAS[ctx[1]]) code = BY_CANVAS[ctx[1]];
    let title = bracket ? summary.slice(0, bracket.index).trim() : summary;
    title = title.replace(/\s*\(\d+ students?\)\s*$/i, '').trim() || summary;

    const isAssignment = e.uid.startsWith('event-assignment');
    const asgId = ((e.url || '').match(/#assignment_(\d+)/) || [])[1]
      || (isAssignment ? (e.uid.match(/(\d+)$/) || [])[1] : '');

    let kind;
    if (isAssignment) kind = 'assignment';
    else if (/\bSFS\b|feedback survey/i.test(summary)) kind = 'survey';
    else if (/\blecture\b/i.test(title)) kind = 'lecture';
    else if (/\btutorial\b/i.test(title)) kind = 'tutorial';
    else if (courseLabel && title.replace(/\s+/g, ' ') === courseLabel.replace(/\s+/g, ' ')) kind = 'class';
    else kind = 'event';

    title = title.replace(/\s+/g, ' ');
    if (kind === 'class') title = 'Class';
    else if (kind === 'lecture' || kind === 'tutorial') {
      title = title.replace(/^\d{5}\s+.*?\s+[-–]\s+(?=(lecture|tutorial))/i, '');
    } else if (kind !== 'assignment') {
      title = title.replace(/^\d{5}\s+/, '');
    }

    let due = null, dueTimeAssumed = false;
    if (kind === 'assignment') {
      if (e.start.allDay) {
        // Canvas exports assignments due at 11:59 pm as all-day events.
        const [y, m, d] = e.start.ymd.split('-').map(Number);
        due = zonedToDate(y, m, d, 23, 59, 0);
        dueTimeAssumed = true;
      } else {
        due = e.start.date;
      }
    }

    const key = kind === 'assignment' && asgId ? `asg:${asgId}` : e.uid;
    const canvasUrl = asgId && ctx
      ? `https://canvas.uts.edu.au/courses/${ctx[1]}/assignments/${asgId}`
      : (/^https:\/\//.test(e.url || '') ? e.url : '');

    const item = {
      key,
      uid: e.uid,
      kind,
      code: KNOWN_CODES.has(code) ? code : (code || 'other'),
      courseLabel,
      title,
      start: e.start.date.toISOString(),
      end: e.end ? e.end.date.toISOString() : null,
      allDay: !!e.start.allDay,
      due: due ? due.toISOString() : null,
      dueTimeAssumed,
      assignmentId: asgId || null,
      location: e.location && !/^https?:/i.test(e.location) ? e.location : '',
      joinUrl: findZoom(e.location, e.description),
      canvasUrl,
      description: cleanDescription(e.description).slice(0, 20000),
      stamp: e.stamp ? e.stamp.date.toISOString() : null,
    };
    const prev = items[key];
    if (!prev || (item.stamp || '') >= (prev.stamp || '')) items[key] = item;
  }
  return { calName, items };
}

/**
 * Merge freshly fetched items into stored calendar state.
 * Never touches user data (submitted flags etc. live elsewhere).
 * Returns { items, changes } where changes lists due-date moves.
 */
export function mergeCalendar(oldItems = {}, newItems, nowIso = new Date().toISOString()) {
  const items = {};
  const changes = [];
  for (const [key, it] of Object.entries(newItems)) {
    const prev = oldItems[key];
    if (prev && prev.kind === 'assignment' && prev.due && it.due && prev.due !== it.due) {
      changes.push({ key, title: it.title, code: it.code, from: prev.due, to: it.due, at: nowIso });
    }
    items[key] = { ...it, missingFromFeed: false };
  }
  // Keep assignments that disappeared from the feed so their history isn't lost.
  for (const [key, prev] of Object.entries(oldItems)) {
    if (!items[key] && prev.kind === 'assignment') items[key] = { ...prev, missingFromFeed: true };
  }
  return { items, changes };
}

export function normaliseFeedUrl(url) {
  let u = (url || '').trim();
  if (/^webcals?:\/\//i.test(u)) u = u.replace(/^webcals?:\/\//i, 'https://');
  return u;
}
