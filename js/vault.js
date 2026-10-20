// On-device encrypted storage (IndexedDB). Nothing leaves this device.
import {
  deriveKey, newDataKey, wrapKey, unwrapKey, encryptJSON, decryptJSON,
  randomBytes, toB64, fromB64, newRecoveryCode, normaliseRecoveryCode, ITERATIONS,
} from './crypto.js';

const DB_NAME = 'uni-dashboard';
const STORE = 'kv';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    let result;
    Promise.resolve(fn(store)).then((r) => { result = r; });
    t.oncomplete = () => { db.close(); resolve(result); };
    t.onerror = () => { db.close(); reject(t.error); };
    t.onabort = () => { db.close(); reject(t.error); };
  });
}

const reqP = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export const idbGet = (k) => tx('readonly', (s) => reqP(s.get(k)));
export const idbSet = (k, v) => tx('readwrite', (s) => { s.put(v, k); });
export const idbClear = () => tx('readwrite', (s) => { s.clear(); });

export async function hasVault() {
  return !!(await idbGet('meta'));
}

export class LockedError extends Error {
  constructor(retryAt) { super('locked'); this.retryAt = retryAt; }
}
export class WrongSecretError extends Error {
  constructor(retryAt) { super('wrong'); this.retryAt = retryAt; }
}

function lockoutDelayMs(failed) {
  if (failed < 5) return 0;
  return Math.min(30000 * 2 ** (failed - 5), 3600000);
}

export async function getLockout() {
  const meta = await idbGet('meta');
  return meta ? { failed: meta.failed || 0, lockUntil: meta.lockUntil || 0 } : { failed: 0, lockUntil: 0 };
}

/** Create a new vault. Returns { key, recoveryCode }. */
export async function createVault(passcode, initialState) {
  const dataKey = await newDataKey();
  const recoveryCode = newRecoveryCode();
  const passSalt = randomBytes(16);
  const recSalt = randomBytes(16);
  const passKek = await deriveKey(passcode, passSalt);
  const recKek = await deriveKey(recoveryCode, recSalt);
  const meta = {
    v: 1,
    created: new Date().toISOString(),
    iterations: ITERATIONS,
    pass: { salt: toB64(passSalt), ...(await wrapKey(dataKey, passKek)) },
    rec: { salt: toB64(recSalt), ...(await wrapKey(dataKey, recKek)) },
    failed: 0,
    lockUntil: 0,
  };
  await idbSet('meta', meta);
  await idbSet('data', await encryptJSON(dataKey, initialState));
  return { key: dataKey, recoveryCode };
}

async function attempt(slot, secret) {
  const meta = await idbGet('meta');
  if (!meta) throw new Error('No data on this device yet.');
  const now = Date.now();
  if (meta.lockUntil && meta.lockUntil > now) throw new LockedError(meta.lockUntil);
  try {
    const kek = await deriveKey(secret, fromB64(meta[slot].salt), meta.iterations);
    const key = await unwrapKey(meta[slot], kek);
    meta.failed = 0;
    meta.lockUntil = 0;
    await idbSet('meta', meta);
    return key;
  } catch {
    meta.failed = (meta.failed || 0) + 1;
    const delay = lockoutDelayMs(meta.failed);
    meta.lockUntil = delay ? now + delay : 0;
    await idbSet('meta', meta);
    throw new WrongSecretError(meta.lockUntil);
  }
}

export const unlockWithPasscode = (passcode) => attempt('pass', passcode);

/** Recovery: unlocks with the recovery code and sets a new passcode. */
export async function resetWithRecovery(code, newPasscode) {
  const key = await attempt('rec', normaliseRecoveryCode(code));
  await setPasscode(key, newPasscode);
  return key;
}

export async function setPasscode(key, newPasscode) {
  const meta = await idbGet('meta');
  const salt = randomBytes(16);
  const kek = await deriveKey(newPasscode, salt);
  meta.pass = { salt: toB64(salt), ...(await wrapKey(key, kek)) };
  await idbSet('meta', meta);
}

/** Replace the recovery code (shown once). */
export async function rotateRecoveryCode(key) {
  const meta = await idbGet('meta');
  const recoveryCode = newRecoveryCode();
  const salt = randomBytes(16);
  const kek = await deriveKey(recoveryCode, salt);
  meta.rec = { salt: toB64(salt), ...(await wrapKey(key, kek)) };
  await idbSet('meta', meta);
  return recoveryCode;
}

export async function loadState(key) {
  const box = await idbGet('data');
  return decryptJSON(key, box);
}

export async function saveState(key, state) {
  await idbSet('data', await encryptJSON(key, state));
}

export async function eraseAll() {
  await idbClear();
}
