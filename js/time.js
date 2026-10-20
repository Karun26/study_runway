// Time helpers. Everything is displayed in Australia/Sydney time.
export const TZ = 'Australia/Sydney';

const partsFmtCache = new Map();
function partsFmt(tz) {
  if (!partsFmtCache.has(tz)) {
    partsFmtCache.set(tz, new Intl.DateTimeFormat('en-AU', {
      timeZone: tz, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }));
  }
  return partsFmtCache.get(tz);
}

/** Wall-clock parts of an instant in a time zone. */
export function zonedParts(date, tz = TZ) {
  const p = {};
  for (const { type, value } of partsFmt(tz).formatToParts(date)) p[type] = value;
  return {
    y: +p.year, m: +p.month, d: +p.day,
    h: +p.hour % 24, mi: +p.minute, s: +p.second,
  };
}

/** Offset (minutes) of tz from UTC at the given instant. */
export function tzOffsetMinutes(date, tz = TZ) {
  const p = zonedParts(date, tz);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s);
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
}

/** Convert a wall-clock time in tz to a UTC Date (handles daylight saving). */
export function zonedToDate(y, m, d, h = 0, mi = 0, s = 0, tz = TZ) {
  let guess = Date.UTC(y, m - 1, d, h, mi, s);
  // Two passes settle DST transitions.
  for (let i = 0; i < 2; i++) {
    const off = tzOffsetMinutes(new Date(guess), tz);
    guess = Date.UTC(y, m - 1, d, h, mi, s) - off * 60000;
  }
  return new Date(guess);
}

/** 'YYYY-MM-DD' key of the Sydney calendar day containing the instant. */
export function dayKey(date) {
  const p = zonedParts(date);
  return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
}

export function dayKeyToDate(key, h = 0, mi = 0) {
  const [y, m, d] = key.split('-').map(Number);
  return zonedToDate(y, m, d, h, mi);
}

export function addDaysKey(key, n) {
  const [y, m, d] = key.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}

export function weekdayOfKey(key) { // 0 = Sunday
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

const fmt = (opts) => new Intl.DateTimeFormat('en-AU', { timeZone: TZ, ...opts });
const F = {
  time: fmt({ hour: 'numeric', minute: '2-digit' }),
  dayShort: fmt({ weekday: 'short', day: 'numeric', month: 'short' }),
  dayLong: fmt({ weekday: 'long', day: 'numeric', month: 'long' }),
  dateTime: fmt({ weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }),
  month: fmt({ month: 'long', year: 'numeric' }),
};

export const fmtTime = (d) => F.time.format(d).replace(' ', ' ');
export const fmtDayShort = (d) => F.dayShort.format(d);
export const fmtDayLong = (d) => F.dayLong.format(d);
export const fmtDateTime = (d) => F.dateTime.format(d);
export const fmtMonth = (d) => F.month.format(d);

/** Relative label like "today 9:32 pm" or "Sat 17 Oct, 4:10 pm". */
export function fmtRelativeStamp(date, now = new Date()) {
  const dk = dayKey(date), nk = dayKey(now);
  if (dk === nk) return `today ${fmtTime(date)}`;
  if (dk === addDaysKey(nk, -1)) return `yesterday ${fmtTime(date)}`;
  return fmtDateTime(date);
}

/** Countdown text and urgency level for a due instant. */
export function countdown(due, now = new Date()) {
  const ms = due - now;
  const abs = Math.abs(ms);
  const mins = Math.floor(abs / 60000);
  const days = Math.floor(mins / 1440);
  const hours = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  let text;
  if (days >= 1) text = `${days}d ${hours}h`;
  else if (hours >= 1) text = `${hours}h ${m}m`;
  else text = `${m}m`;
  let level;
  if (ms < 0) level = 'overdue';
  else if (ms <= 864e5) level = 'h24';
  else if (ms <= 3 * 864e5) level = 'd3';
  else if (ms <= 7 * 864e5) level = 'd7';
  else level = 'later';
  return { text: ms < 0 ? `${text} overdue` : `${text} left`, level };
}

export const LEVEL_LABEL = {
  overdue: 'Overdue',
  h24: 'Due within 24 hours',
  d3: 'Due within 3 days',
  d7: 'Due within 7 days',
  later: 'Later',
  submitted: 'Submitted',
};
