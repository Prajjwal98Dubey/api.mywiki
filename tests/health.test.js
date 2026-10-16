import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createTestApp } from './helpers.js';

let ctx;
before(async () => (ctx = await createTestApp()));
after(() => ctx.cleanup());

test('GET /api/health', async () => {
  const res = await ctx.agent().get('/api/health');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true, storage: ctx.repos.driver });
});

test('unknown /api route → 404 in the spec error shape', async () => {
  const res = await ctx.agent().get('/api/does-not-exist');
  assert.equal(res.status, 404);
  assert.equal(res.body.error.code, 'NOT_FOUND');
  assert.equal(typeof res.body.error.message, 'string');
});

test('malformed JSON → 400 VALIDATION_ERROR', async () => {
  const res = await ctx
    .agent()
    .post('/api/auth/login')
    .set('Content-Type', 'application/json')
    .send('{"email": ');
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'VALIDATION_ERROR');
});

test('security headers are set', async () => {
  const res = await ctx.agent().get('/api/health');
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
  assert.equal(res.headers['x-powered-by'], undefined);
});
