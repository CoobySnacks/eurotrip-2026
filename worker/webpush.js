/**
 * webpush.js — RFC 8291 Web Push encryption + RFC 8292 VAPID, in pure Web Crypto.
 *
 * Exists because GitHub Actions cron proved unusable for timed notifications:
 * an every-10-minutes schedule on this repo ran 202 minutes apart. Cloudflare
 * cron triggers fire on time, so sending happens here rather than in Actions.
 *
 * No dependencies — Workers give us ECDH, HMAC and AES-GCM natively.
 */

const enc = new TextEncoder();

/* ---------- base64url ---------- */
export function b64urlToBytes(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  return Uint8Array.from(bin, c => c.charCodeAt(0));
}

export function bytesToB64url(b) {
  let s = '';
  for (const x of new Uint8Array(b)) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const concat = (...arrs) => {
  const total = arrs.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const a of arrs) { out.set(a, o); o += a.length; }
  return out;
};

/* ---------- HKDF (extract + one expand round; every output here is <= 32 bytes) ---------- */
async function hmac(keyBytes, data) {
  const k = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data));
}

async function hkdf(salt, ikm, info, length) {
  const prk = await hmac(salt, ikm);
  const okm = await hmac(prk, concat(info, new Uint8Array([1])));
  return okm.slice(0, length);
}

/* ---------- VAPID ---------- */

/** Import the raw 32-byte private scalar as an ECDSA key for signing. */
async function importVapidKey(privB64url, pubB64url) {
  const d = b64urlToBytes(privB64url);
  const pub = b64urlToBytes(pubB64url);       // 0x04 || X || Y
  const jwk = {
    kty: 'EC', crv: 'P-256', ext: true,
    d: bytesToB64url(d),
    x: bytesToB64url(pub.slice(1, 33)),
    y: bytesToB64url(pub.slice(33, 65)),
  };
  return crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
}

/** Signed JWT for the push service's origin. */
async function vapidHeader(endpoint, publicKey, privateKey, subject) {
  const aud = new URL(endpoint).origin;
  const header = bytesToB64url(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const body = bytesToB64url(enc.encode(JSON.stringify({
    aud,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: subject,
  })));
  const key = await importVapidKey(privateKey, publicKey);
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${header}.${body}`));
  // Web Crypto already returns r||s, which is what JOSE wants
  return `vapid t=${header}.${body}.${bytesToB64url(sig)}, k=${publicKey}`;
}

/* ---------- payload encryption (aes128gcm) ---------- */
async function encryptPayload(plaintext, ua_publicB64, authB64) {
  const ua_public = b64urlToBytes(ua_publicB64);
  const auth = b64urlToBytes(authB64);

  // ephemeral application-server keypair
  const as = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const as_public = new Uint8Array(await crypto.subtle.exportKey('raw', as.publicKey)); // 65 bytes

  const uaKey = await crypto.subtle.importKey(
    'raw', ua_public, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, as.privateKey, 256));

  // RFC 8291 §3.4
  const keyInfo = concat(enc.encode('WebPush: info'), new Uint8Array([0]), ua_public, as_public);
  const ikm = await hkdf(auth, shared, keyInfo, 32);

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, concat(enc.encode('Content-Encoding: aes128gcm'), new Uint8Array([0])), 16);
  const nonce = await hkdf(salt, ikm, concat(enc.encode('Content-Encoding: nonce'), new Uint8Array([0])), 12);

  const aesKey = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt']);
  // 0x02 marks the final record
  const padded = concat(enc.encode(plaintext), new Uint8Array([2]));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aesKey, padded));

  // header: salt(16) | rs(4) | idlen(1) | keyid(65)
  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, 4096);
  return concat(salt, rs, new Uint8Array([as_public.length]), as_public, ct);
}

/* ---------- send ---------- */

/**
 * @returns {Promise<{ok:boolean, status:number, gone:boolean}>}
 *   `gone` means 404/410 — the subscription is dead and should be pruned.
 */
export async function sendPush(subscription, payloadObj, vapid, ttl = 3600) {
  const body = await encryptPayload(
    JSON.stringify(payloadObj),
    subscription.keys.p256dh,
    subscription.keys.auth,
  );
  const auth = await vapidHeader(
    subscription.endpoint, vapid.publicKey, vapid.privateKey, vapid.subject);

  const res = await fetch(subscription.endpoint, {
    method: 'POST',
    headers: {
      'Authorization': auth,
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      'TTL': String(ttl),
    },
    body,
  });
  return { ok: res.ok, status: res.status, gone: res.status === 404 || res.status === 410 };
}
