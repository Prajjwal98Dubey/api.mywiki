import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createTestApp, registerUser } from './helpers.js';

// 1×1 transparent PNG
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

let ctx;
let agent;
before(async () => {
  ctx = await createTestApp({ maxUploadBytes: 1024 });
  agent = ctx.agent();
  await registerUser(agent);
});
after(() => ctx.cleanup());

test('requires login', async () => {
  const res = await ctx.agent().post('/api/uploads/image').attach('image', PNG, 'a.png');
  assert.equal(res.status, 401);
});

test('valid PNG → 201, served at /uploads with nosniff', async () => {
  const res = await agent.post('/api/uploads/image').attach('image', PNG, { filename: '../../evil.svg.png', contentType: 'image/png' });
  assert.equal(res.status, 201);
  assert.match(res.body.url, /^\/uploads\/[0-9a-f-]{36}\.png$/);
  assert.equal(res.body.mimeType, 'image/png');
  assert.equal(res.body.size, PNG.length);
  assert.equal(res.body.url, `/uploads/${res.body.filename}`);

  const served = await ctx.agent().get(res.body.url);
  assert.equal(served.status, 200);
  assert.equal(served.headers['content-type'], 'image/png');
  assert.equal(served.headers['x-content-type-options'], 'nosniff');
});

test('a .txt renamed to .jpg → 415 and the file is removed', async () => {
  const before = await fs.readdir(ctx.config.uploadDir);
  const res = await agent
    .post('/api/uploads/image')
    .attach('image', Buffer.from('just some text, not an image'), { filename: 'notes.jpg', contentType: 'image/jpeg' });
  assert.equal(res.status, 415);
  assert.equal(res.body.error.code, 'UNSUPPORTED_MEDIA_TYPE');
  assert.deepEqual(await fs.readdir(ctx.config.uploadDir), before);
});

test('disallowed MIME types (SVG) → 415', async () => {
  const res = await agent
    .post('/api/uploads/image')
    .attach('image', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), { filename: 'x.svg', contentType: 'image/svg+xml' });
  assert.equal(res.status, 415);
});

test('too large → 413 PAYLOAD_TOO_LARGE', async () => {
  const big = Buffer.concat([PNG, Buffer.alloc(2048)]);
  const res = await agent.post('/api/uploads/image').attach('image', big, { filename: 'big.png', contentType: 'image/png' });
  assert.equal(res.status, 413);
  assert.equal(res.body.error.code, 'PAYLOAD_TOO_LARGE');
  const leftovers = (await fs.readdir(ctx.config.uploadDir)).filter((f) => f.startsWith('big'));
  assert.deepEqual(leftovers, []);
});

test('missing or wrongly-named field → 400', async () => {
  assert.equal((await agent.post('/api/uploads/image').field('x', 'y')).status, 400);
  const wrong = await agent.post('/api/uploads/image').attach('photo', PNG, 'a.png');
  assert.equal(wrong.status, 400);
  assert.equal(wrong.body.error.code, 'VALIDATION_ERROR');
});

test('path traversal on /uploads is not possible', async () => {
  const res = await ctx.agent().get('/uploads/..%2F..%2Fpackage.json');
  assert.notEqual(res.status, 200);
  assert.ok(!(await fs.readdir(path.dirname(ctx.config.uploadDir))).includes('package.json'));
});
