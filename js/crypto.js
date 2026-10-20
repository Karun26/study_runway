// Encryption helpers built on the browser's Web Crypto API.
// Data is encrypted with a random AES-256-GCM key. That key is stored only
// in wrapped (encrypted) form: once under your passcode, once under your
// recovery code. Keys are derived with PBKDF2-SHA256.

export const ITERATIONS = 600000;
const enc = new TextEncoder();
const dec = new TextDecoder();

export function toB64(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

export function fromB64(str) {
  const s = atob(str);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export const randomBytes = (n) => crypto.getRandomValues(new Uint8Array(n));

export async function deriveKey(secret, salt, iterations = ITERATIONS) {
  const base = await crypto.subtle.importKey(
    'raw', enc.encode(secret.normalize('NFKC')), 'PBKDF2', false, ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['wrapKey', 'unwrapKey', 'encrypt', 'decrypt'],
  );
}

export function newDataKey() {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

export async function wrapKey(dataKey, kek) {
  const iv = randomBytes(12);
  const wrapped = await crypto.subtle.wrapKey('raw', dataKey, kek, { name: 'AES-GCM', iv });
  return { iv: toB64(iv), key: toB64(wrapped) };
}

export function unwrapKey(box, kek) {
  return crypto.subtle.unwrapKey(
    'raw', fromB64(box.key), kek, { name: 'AES-GCM', iv: fromB64(box.iv) },
    { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'],
  );
}

export async function encryptJSON(key, obj) {
  const iv = randomBytes(12);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(obj)));
  return { iv: toB64(iv), ct: toB64(ct) };
}

export async function decryptJSON(key, box) {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(box.iv) }, key, fromB64(box.ct));
  return JSON.parse(dec.decode(pt));
}

/** Encrypt a value with a password, for backup and phone files. */
export async function passwordEncrypt(password, obj) {
  const salt = randomBytes(16);
  const key = await deriveKey(password, salt);
  const box = await encryptJSON(key, obj);
  return { salt: toB64(salt), iterations: ITERATIONS, ...box };
}

export async function passwordDecrypt(password, box) {
  const key = await deriveKey(password, fromB64(box.salt), box.iterations || ITERATIONS);
  return decryptJSON(key, box);
}

// Recovery codes: 25 characters from Crockford base32 (≈125 bits).
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export function newRecoveryCode() {
  const bytes = randomBytes(25);
  const chars = Array.from(bytes, (b) => ALPHABET[b & 31]).join('');
  return chars.match(/.{5}/g).join('-');
}

export function normaliseRecoveryCode(input) {
  return (input || '').toUpperCase()
    .replace(/[OQ]/g, '0').replace(/[IL]/g, '1').replace(/U/g, 'V')
    .replace(/[^0-9A-Z]/g, '')
    .match(/.{1,5}/g)?.join('-') || '';
}
