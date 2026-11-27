'use strict';
const crypto = require('node:crypto');

const b64url = value => Buffer.from(value).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
const fromB64url = value => Buffer.from(String(value || '').replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(String(value || '').length / 4) * 4, '='), 'base64');

function isAllowedPushEndpoint(endpoint) {
  try { const host = new URL(String(endpoint || '')).hostname.toLowerCase(); return ['fcm.googleapis.com','push.services.mozilla.com','push.apple.com','notify.windows.com'].some(domain => host === domain || host.endsWith(`.${domain}`)); } catch { return false; }
}

function createVapidKeys() {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  return { publicKey: b64url(ecdh.getPublicKey()), privateKey: b64url(ecdh.getPrivateKey()) };
}
function hkdfExtract(salt, ikm) { return crypto.createHmac('sha256', salt).update(ikm).digest(); }
function hkdfExpand(prk, info, length) {
  let output = Buffer.alloc(0), previous = Buffer.alloc(0), counter = 1;
  while (output.length < length) {
    previous = crypto.createHmac('sha256', prk).update(Buffer.concat([previous, Buffer.from(info), Buffer.from([counter++])])).digest();
    output = Buffer.concat([output, previous]);
  }
  return output.subarray(0, length);
}
function vapidAuthorization(endpoint, keys) {
  const url = new URL(endpoint), publicBytes = fromB64url(keys.publicKey), privateBytes = fromB64url(keys.privateKey);
  const jwk = { kty: 'EC', crv: 'P-256', x: b64url(publicBytes.subarray(1, 33)), y: b64url(publicBytes.subarray(33, 65)), d: b64url(privateBytes) };
  const privateKey = crypto.createPrivateKey({ key: jwk, format: 'jwk' });
  const head = b64url(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const body = b64url(JSON.stringify({ aud: url.origin, exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60, sub: 'https://alengo-atendimento.pages.dev/' }));
  const unsigned = `${head}.${body}`;
  const signature = crypto.sign('sha256', Buffer.from(unsigned), { key: privateKey, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${unsigned}.${b64url(signature)}, k=${keys.publicKey}`;
}
function encryptPayload(subscription, payload) {
  const uaPublic = fromB64url(subscription.keys?.p256dh), authSecret = fromB64url(subscription.keys?.auth);
  if (uaPublic.length !== 65 || authSecret.length < 16) throw new Error('Inscrição Web Push inválida.');
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey(), shared = ecdh.computeSecret(uaPublic);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]);
  const ikm = hkdfExpand(hkdfExtract(authSecret, shared), keyInfo, 32);
  const salt = crypto.randomBytes(16), prk = hkdfExtract(salt, ikm);
  const cek = hkdfExpand(prk, 'Content-Encoding: aes128gcm\0', 16);
  const nonce = hkdfExpand(prk, 'Content-Encoding: nonce\0', 12);
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const plain = Buffer.concat([Buffer.from(JSON.stringify(payload)), Buffer.from([2])]);
  const encrypted = Buffer.concat([cipher.update(plain), cipher.final(), cipher.getAuthTag()]);
  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(4096, 16);
  header[20] = asPublic.length;
  return Buffer.concat([header, asPublic, encrypted]);
}
async function sendWebPush(subscription, payload, keys, fetchImpl = fetch) {
  if (!subscription.endpoint?.startsWith('https://') || !isAllowedPushEndpoint(subscription.endpoint)) throw new Error('Endpoint Web Push inválido ou não reconhecido.');
  const body = encryptPayload(subscription, payload);
  const response = await fetchImpl(subscription.endpoint, {
    method: 'POST',
    headers: {
      Authorization: vapidAuthorization(subscription.endpoint, keys),
      'Content-Type': 'application/octet-stream',
      'Content-Encoding': 'aes128gcm',
      TTL: '90',
      Urgency: 'high'
    },
    body,
    signal: AbortSignal.timeout(9000)
  });
  if (response.status === 404 || response.status === 410) return { expired: true };
  if (!response.ok) throw new Error(`Push HTTP ${response.status}: ${(await response.text()).slice(0, 180)}`);
  return { sent: true };
}

module.exports = { createVapidKeys, vapidAuthorization, encryptPayload, sendWebPush, isAllowedPushEndpoint, b64url, fromB64url, hkdfExtract, hkdfExpand };
