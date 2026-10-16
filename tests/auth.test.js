import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createTestApp, registerUser, sortedKeys } from './helpers.js';

let ctx;
before(async () => (ctx = await createTestApp()));
after(() => ctx.cleanup());

describe('register / me / logout', () => {
  test('register sets an httpOnly cookie and me returns the user', async () => {
    const agent = ctx.agent();
    const res = await agent
      .post('/api/auth/register')
      .send({ username: 'JaneDoe', email: 'Jane@Example.com', password: 'password123' });
    assert.equal(res.status, 201);
    assert.deepEqual(sortedKeys(res.body.user), ['createdAt', 'email', 'id', 'username']);
    assert.equal(res.body.user.email, 'jane@example.com');
    const cookie = res.headers['set-cookie'].join(';');
    assert.match(cookie, /token=/);
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=Lax/i);

    const me = await agent.get('/api/auth/me');
    assert.equal(me.status, 200);
    assert.equal(me.body.user.username, 'JaneDoe');
    assert.equal(me.body.user.passwordHash, undefined);

    const out = await agent.post('/api/auth/logout');
    assert.equal(out.status, 204);
    const me2 = await agent.get('/api/auth/me');
    assert.deepEqual(me2.body, { user: null });
  });

  test('never stores the plain password', async () => {
    const user = await ctx.repos.users.findByEmail('jane@example.com');
    assert.ok(user);
    assert.match(user.passwordHash, /^\$2[aby]\$/);
  });

  test('duplicate email (any case) → 409 EMAIL_TAKEN', async () => {
    const res = await ctx
      .agent()
      .post('/api/auth/register')
      .send({ username: 'Other', email: 'JANE@example.com', password: 'password123' });
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'EMAIL_TAKEN');
  });

  test('duplicate username (any case) → 409 USERNAME_TAKEN', async () => {
    const res = await ctx
      .agent()
      .post('/api/auth/register')
      .send({ username: 'janedoe', email: 'new@example.com', password: 'password123' });
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'USERNAME_TAKEN');
  });

  test('validation errors carry details with paths', async () => {
    const res = await ctx.agent().post('/api/auth/register').send({ username: 'a!', email: 'nope', password: 'short' });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
    const paths = res.body.error.details.map((d) => d.path).sort();
    assert.deepEqual(paths, ['email', 'password', 'username']);
  });
});

describe('login', () => {
  test('correct credentials → 200 + cookie', async () => {
    const { credentials } = await registerUser(ctx.agent());
    const agent = ctx.agent();
    const res = await agent.post('/api/auth/login').send({ email: credentials.email.toUpperCase(), password: credentials.password });
    assert.equal(res.status, 200);
    assert.equal(res.body.user.username, credentials.username);
    const me = await agent.get('/api/auth/me');
    assert.equal(me.body.user.username, credentials.username);
  });

  test('wrong password and unknown email → same 401', async () => {
    const { credentials } = await registerUser(ctx.agent());
    const bad = await ctx.agent().post('/api/auth/login').send({ email: credentials.email, password: 'wrong-password' });
    const unknown = await ctx.agent().post('/api/auth/login').send({ email: 'ghost@example.com', password: 'whatever1' });
    for (const res of [bad, unknown]) {
      assert.equal(res.status, 401);
      assert.equal(res.body.error.code, 'UNAUTHENTICATED');
      assert.equal(res.body.error.message, 'Incorrect email or password');
    }
  });

  test('an invalid token is ignored and the cookie cleared', async () => {
    const res = await ctx.agent().get('/api/auth/me').set('Cookie', 'token=garbage');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { user: null });
    assert.match(res.headers['set-cookie'].join(';'), /token=;/);
  });
});

describe('rate limiting', () => {
  test('login is limited → 429 RATE_LIMITED', async () => {
    const limited = await createTestApp({ rateLimit: { enabled: true, loginMax: 2, registerMax: 2 } });
    try {
      const agent = limited.agent();
      const body = { email: 'x@example.com', password: 'whatever1' };
      assert.equal((await agent.post('/api/auth/login').send(body)).status, 401);
      assert.equal((await agent.post('/api/auth/login').send(body)).status, 401);
      const res = await agent.post('/api/auth/login').send(body);
      assert.equal(res.status, 429);
      assert.equal(res.body.error.code, 'RATE_LIMITED');
    } finally {
      await limited.cleanup();
    }
  });
});
