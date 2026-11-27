const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createVapidKeys, sendWebPush, fromB64url, b64url, hkdfExtract, hkdfExpand, isAllowedPushEndpoint } = require('../electron/web-push');

test('Web Push uses valid P-256 VAPID keys and authenticated ES256 JWT', async () => {
  const vapid = createVapidKeys();
  const publicBytes = fromB64url(vapid.publicKey);
  assert.equal(publicBytes.length, 65);
  assert.equal(fromB64url(vapid.privateKey).length, 32);
  const ua = crypto.createECDH('prime256v1'); ua.generateKeys();
  const subscription = { endpoint: 'https://fcm.googleapis.com/send/endpoint', keys: { p256dh: b64url(ua.getPublicKey()), auth: b64url(crypto.randomBytes(16)) } };
  let request;
  const result = await sendWebPush(subscription, { title: 'Pedido pronto', body: 'Mesa 4' }, vapid, async (url, options) => {
    request = { url, options };
    return new Response('', { status: 201 });
  });
  assert.deepEqual(result, { sent: true });
  assert.equal(request.url, subscription.endpoint);
  assert.equal(request.options.headers['Content-Encoding'], 'aes128gcm');
  const auth = request.options.headers.Authorization.match(/^vapid t=([^,]+), k=(.+)$/);
  assert.ok(auth);
  assert.equal(auth[2], vapid.publicKey);
  const [head, body, signature] = auth[1].split('.');
  const publicJwk = { kty: 'EC', crv: 'P-256', x: b64url(publicBytes.subarray(1,33)), y: b64url(publicBytes.subarray(33,65)) };
  const publicKey = crypto.createPublicKey({ key: publicJwk, format: 'jwk' });
  assert.equal(crypto.verify('sha256', Buffer.from(`${head}.${body}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, fromB64url(signature)), true);
  assert.equal(JSON.parse(fromB64url(body).toString()).aud, 'https://fcm.googleapis.com');
});

test('Web Push aes128gcm payload can be decrypted by the subscribing browser key', async () => {
  const vapid = createVapidKeys();
  const ua = crypto.createECDH('prime256v1'); ua.generateKeys();
  const auth = crypto.randomBytes(16);
  const subscription = { endpoint: 'https://fcm.googleapis.com/send/endpoint', keys: { p256dh: b64url(ua.getPublicKey()), auth: b64url(auth) } };
  let body;
  await sendWebPush(subscription, { title: 'ALENGO', eventKey: 'ready-123' }, vapid, async (_url, options) => { body = Buffer.from(options.body); return new Response('', { status: 201 }); });
  const salt = body.subarray(0,16), rs = body.readUInt32BE(16), keyLength = body[20];
  assert.equal(rs, 4096); assert.equal(keyLength, 65);
  const serverPublic = body.subarray(21,21+keyLength), encrypted = body.subarray(21+keyLength);
  const shared = ua.computeSecret(serverPublic);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), ua.getPublicKey(), serverPublic]);
  const ikm = hkdfExpand(hkdfExtract(auth, shared), keyInfo, 32);
  const prk = hkdfExtract(salt, ikm), cek = hkdfExpand(prk, 'Content-Encoding: aes128gcm\0', 16), nonce = hkdfExpand(prk, 'Content-Encoding: nonce\0', 12);
  const decipher = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
  decipher.setAuthTag(encrypted.subarray(-16));
  const clear = Buffer.concat([decipher.update(encrypted.subarray(0,-16)), decipher.final()]);
  assert.equal(clear[clear.length-1], 2);
  assert.deepEqual(JSON.parse(clear.subarray(0,-1).toString()), { title: 'ALENGO', eventKey: 'ready-123' });
});

test('expired browser subscriptions are reported for cleanup', async () => {
  const vapid = createVapidKeys(), ua = crypto.createECDH('prime256v1'); ua.generateKeys();
  const subscription = { endpoint: 'https://fcm.googleapis.com/expired', keys: { p256dh: b64url(ua.getPublicKey()), auth: b64url(crypto.randomBytes(16)) } };
  const result = await sendWebPush(subscription, { title: 'x' }, vapid, async () => new Response('', { status: 410 }));
  assert.deepEqual(result, { expired: true });
});

test('Web Push accepts only known browser push-service hosts to prevent arbitrary endpoint requests', () => {
  assert.equal(isAllowedPushEndpoint('https://fcm.googleapis.com/push/1'), true);
  assert.equal(isAllowedPushEndpoint('https://updates.push.services.mozilla.com/wpush/v2/x'), true);
  assert.equal(isAllowedPushEndpoint('https://web.push.apple.com/x'), true);
  assert.equal(isAllowedPushEndpoint('https://127.0.0.1/internal'), false);
  assert.equal(isAllowedPushEndpoint('https://example.com/'), false);
});
