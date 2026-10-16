import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair, exportJWK, createLocalJWKSet, SignJWT } from 'jose';
import { createTestApp, registerUser } from './helpers.js';
import { google } from '../src/oauth/providers/google.js';
import { createOAuthProviders } from '../src/oauth/index.js';
import { safeReturnTo } from '../src/oauth/state.js';
import { OAuthProviderError } from '../src/oauth/oauth2Provider.js';

// Spec §7.2.1 — "Continue with Google": one flow for sign-up and log-in.

const ORIGIN = 'http://localhost:5173';

/**
 * Stand-in for a provider: the authorization "code" names the profile that signs in,
 * so each test decides who comes back. `exchanges` records what the callback sent.
 */
function fakeProvider(id, profiles) {
  const exchanges = [];
  return {
    id,
    name: id[0].toUpperCase() + id.slice(1),
    exchanges,
    authorizationUrl: ({ state, codeChallenge, nonce, redirectUri }) =>
      `https://${id}.example/authorize?${new URLSearchParams({ state, code_challenge: codeChallenge, nonce, redirect_uri: redirectUri })}`,
    async exchange(args) {
      exchanges.push(args);
      if (args.code === 'boom') throw new OAuthProviderError('token endpoint said no');
      return profiles[args.code];
    },
  };
}

const profile = (providerUserId, email, name, emailVerified = true) => ({
  providerUserId,
  email,
  emailVerified,
  name,
  picture: null,
});
const PROFILES = {
  ram: profile('g-ram', 'ram.singh@gmail.com', 'Ram Singh'),
  ram2: profile('g-ram-2', 'ram.singh2@gmail.com', 'Ram Singh'),
  hindi: profile('g-hi', 'prajjwal.d@gmail.com', 'प्रज्ज्वल'),
  short: profile('g-short', 'x@gmail.com', 'Xi'),
  taken: profile('g-taken', 'taken@example.com', 'Taken'),
  unverified: profile('g-unv', 'unv@example.com', 'Unv', false),
  noemail: profile('g-none', null, 'None', false),
};

let ctx;
let fakeGoogle;
before(async () => {
  fakeGoogle = fakeProvider('google', PROFILES);
  const fakehub = fakeProvider('fakehub', { ram: profile('gh-ram', 'ram.singh@gmail.com', 'ram') });
  ctx = await createTestApp({ oauthProviders: [fakeGoogle, fakehub], publicOrigin: ORIGIN });
});
after(() => ctx.cleanup());

/** start → callback on `agent`, like a browser. Returns the callback's Location (relative). */
async function signInWith(agent, code, { provider = 'google', returnTo } = {}) {
  const qs = returnTo === undefined ? '' : `?returnTo=${encodeURIComponent(returnTo)}`;
  const start = await agent.get(`/api/auth/oauth/${provider}/start${qs}`);
  assert.equal(start.status, 302);
  const state = new URL(start.headers.location).searchParams.get('state');
  const cb = await agent.get(`/api/auth/oauth/${provider}/callback?code=${code}&state=${state}`);
  assert.equal(cb.status, 302);
  return cb.headers.location;
}
const errorOf = (location) => new URL(location, ORIGIN).searchParams.get('error');

describe('GET /api/auth/providers', () => {
  test('lists the configured providers', async () => {
    const res = await ctx.agent().get('/api/auth/providers');
    assert.deepEqual(res.body, {
      providers: [
        { id: 'google', name: 'Google', startUrl: '/api/auth/oauth/google/start' },
        { id: 'fakehub', name: 'Fakehub', startUrl: '/api/auth/oauth/fakehub/start' },
      ],
    });
  });

  test('none configured → empty list, and /start → 404', async () => {
    const bare = await createTestApp();
    try {
      assert.deepEqual((await bare.agent().get('/api/auth/providers')).body, { providers: [] });
      const res = await bare.agent().get('/api/auth/oauth/google/start');
      assert.equal(res.status, 404);
      assert.equal(res.body.error.code, 'NOT_FOUND');
    } finally {
      await bare.cleanup();
    }
  });
});

describe('start', () => {
  test('302 to the provider with state, PKCE S256 and nonce; sets the oauth_tx cookie', async () => {
    const res = await ctx.agent().get('/api/auth/oauth/google/start?returnTo=/ram-singh');
    assert.equal(res.status, 302);
    const url = new URL(res.headers.location);
    assert.equal(url.host, 'google.example');
    assert.ok(url.searchParams.get('state').length >= 32);
    assert.ok(url.searchParams.get('nonce').length >= 32);
    assert.match(url.searchParams.get('code_challenge'), /^[A-Za-z0-9_-]{43}$/);
    assert.equal(url.searchParams.get('redirect_uri'), `${ORIGIN}/api/auth/oauth/google/callback`);
    const cookie = res.headers['set-cookie'].join(';');
    assert.match(cookie, /oauth_tx=/);
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /Path=\/api\/auth\/oauth/);
    assert.match(cookie, /SameSite=Lax/i);
    assert.match(cookie, /Max-Age=600/);
  });
});

describe('sign-up and log-in through one flow', () => {
  test('first visit: user (no password) + identity created, logged in, relative redirect to returnTo', async () => {
    const agent = ctx.agent();
    const location = await signInWith(agent, 'ram', { returnTo: '/my-pages?tab=1' });
    assert.equal(location, '/my-pages?tab=1');

    const me = (await agent.get('/api/auth/me')).body.user;
    assert.equal(me.email, 'ram.singh@gmail.com');
    assert.equal(me.username, 'ram_singh');

    assert.equal((await ctx.repos.users.findById(me.id)).passwordHash, null);
    const [identity, ...rest] = await ctx.repos.identities.listByUser(me.id);
    assert.equal(rest.length, 0);
    assert.equal(identity.provider, 'google');
    assert.equal(identity.providerUserId, 'g-ram');
    assert.equal(identity.email, 'ram.singh@gmail.com');
    assert.ok(identity.lastLoginAt);
  });

  test('the callback hands the provider the PKCE verifier and nonce from /start', () => {
    const last = fakeGoogle.exchanges.at(-1);
    assert.match(last.codeVerifier, /^[A-Za-z0-9_-]{43}$/);
    assert.ok(last.nonce.length >= 32);
    assert.equal(last.redirectUri, `${ORIGIN}/api/auth/oauth/google/callback`);
  });

  test('returning visit: same account, lastLoginAt updated, nothing duplicated', async () => {
    const userId = (await ctx.repos.users.findByEmail('ram.singh@gmail.com')).id;
    const [before] = await ctx.repos.identities.listByUser(userId);
    await new Promise((r) => setTimeout(r, 5));
    const agent = ctx.agent();
    assert.equal(await signInWith(agent, 'ram'), '/');
    assert.equal((await agent.get('/api/auth/me')).body.user.id, userId);
    const after = await ctx.repos.identities.listByUser(userId);
    assert.equal(after.length, 1);
    assert.ok(after[0].lastLoginAt > before.lastLoginAt);
  });

  test('usernames: numeric suffix on clashes, email fallback for non-Latin names, padding for short ones', async () => {
    const a = ctx.agent();
    await signInWith(a, 'ram2');
    assert.equal((await a.get('/api/auth/me')).body.user.username, 'ram_singh2');
    const b = ctx.agent();
    await signInWith(b, 'hindi');
    assert.equal((await b.get('/api/auth/me')).body.user.username, 'prajjwald');
    const c = ctx.agent();
    await signInWith(c, 'short');
    assert.equal((await c.get('/api/auth/me')).body.user.username, 'xi_user');
  });

  test('another provider with the same verified email links to the same (password-less) account', async () => {
    const agent = ctx.agent();
    await signInWith(agent, 'ram', { provider: 'fakehub' });
    const me = (await agent.get('/api/auth/me')).body.user;
    assert.equal(me.username, 'ram_singh');
    const providers = (await ctx.repos.identities.listByUser(me.id)).map((i) => i.provider).sort();
    assert.deepEqual(providers, ['fakehub', 'google']);
  });

  test('OAuth-only accounts: password login → the usual 401; register with that email → EMAIL_TAKEN', async () => {
    const login = await ctx.agent().post('/api/auth/login').send({ email: 'ram.singh@gmail.com', password: 'whatever123' });
    assert.equal(login.status, 401);
    assert.equal(login.body.error.message, 'Incorrect email or password');
    const reg = await ctx
      .agent()
      .post('/api/auth/register')
      .send({ username: 'RamCopy', email: 'RAM.SINGH@gmail.com', password: 'password123' });
    assert.equal(reg.status, 409);
    assert.equal(reg.body.error.code, 'EMAIL_TAKEN');
  });
});

describe('failures → 302 /login?error=…', () => {
  test('password account with the same email → oauth_account_exists, nothing linked, not logged in', async () => {
    const { user } = await registerUser(ctx.agent(), { email: 'taken@example.com' });
    const agent = ctx.agent();
    const location = await signInWith(agent, 'taken', { returnTo: '/create' });
    assert.equal(location, '/login?error=oauth_account_exists&returnTo=%2Fcreate');
    assert.deepEqual((await agent.get('/api/auth/me')).body, { user: null });
    assert.deepEqual(await ctx.repos.identities.listByUser(user.id), []);
  });

  test('unverified or missing email → oauth_email_unverified, no account created', async () => {
    assert.equal(errorOf(await signInWith(ctx.agent(), 'unverified')), 'oauth_email_unverified');
    assert.equal(errorOf(await signInWith(ctx.agent(), 'noemail')), 'oauth_email_unverified');
    assert.equal(await ctx.repos.users.findByEmail('unv@example.com'), null);
  });

  test('user cancels at the provider → oauth_cancelled', async () => {
    const agent = ctx.agent();
    await agent.get('/api/auth/oauth/google/start');
    const res = await agent.get('/api/auth/oauth/google/callback?error=access_denied&state=x');
    assert.equal(res.headers.location, '/login?error=oauth_cancelled');
  });

  test('provider failure → oauth_failed (no provider text in the URL)', async () => {
    const location = await signInWith(ctx.agent(), 'boom');
    assert.equal(location, '/login?error=oauth_failed');
  });

  test('missing cookie, wrong state, or another provider’s transaction → oauth_failed', async () => {
    const noCookie = await ctx.agent().get('/api/auth/oauth/google/callback?code=ram&state=abc');
    assert.equal(errorOf(noCookie.headers.location), 'oauth_failed');

    const a = ctx.agent();
    await a.get('/api/auth/oauth/google/start');
    const wrong = await a.get('/api/auth/oauth/google/callback?code=ram&state=not-the-state');
    assert.equal(errorOf(wrong.headers.location), 'oauth_failed');

    const b = ctx.agent();
    const start = await b.get('/api/auth/oauth/google/start');
    const state = new URL(start.headers.location).searchParams.get('state');
    const cross = await b.get(`/api/auth/oauth/fakehub/callback?code=ram&state=${state}`);
    assert.equal(errorOf(cross.headers.location), 'oauth_failed');
  });

  test('a transaction works once (the cookie is cleared by the callback)', async () => {
    const agent = ctx.agent();
    const start = await agent.get('/api/auth/oauth/google/start');
    const state = new URL(start.headers.location).searchParams.get('state');
    assert.equal(await (await agent.get(`/api/auth/oauth/google/callback?code=ram&state=${state}`)).headers.location, '/');
    const replay = await agent.get(`/api/auth/oauth/google/callback?code=ram&state=${state}`);
    assert.equal(errorOf(replay.headers.location), 'oauth_failed');
  });
});

test('safeReturnTo only allows same-site paths', () => {
  assert.equal(safeReturnTo('/ram-singh?x=1#top'), '/ram-singh?x=1#top');
  for (const bad of ['//evil.com', '/\\evil.com', 'https://evil.com', 'javascript:alert(1)', '', undefined, '/a\nb']) {
    assert.equal(safeReturnTo(bad), '/', String(bad));
  }
});

describe('Google provider: real request shapes and id_token verification (network mocked)', () => {
  const CLIENT_ID = 'cid.apps.googleusercontent.com';
  const config = { oauth: { google: { clientId: CLIENT_ID, clientSecret: 'sec' } } };
  let signKey;
  let jwks;
  let otherKey;

  before(async () => {
    const pair = await generateKeyPair('RS256');
    signKey = pair.privateKey;
    const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
    jwks = createLocalJWKSet({ keys: [jwk] });
    otherKey = (await generateKeyPair('RS256')).privateKey;
  });

  const idToken = (claims, { key = signKey, aud = CLIENT_ID, iss = 'https://accounts.google.com', exp = '5m' } = {}) =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
      .setIssuer(iss)
      .setAudience(aud)
      .setIssuedAt()
      .setExpirationTime(exp)
      .sign(key);

  /** Mocks Google's token endpoint to return `id_token`; records the request. */
  function mockTokenEndpoint(t, token) {
    const calls = [];
    t.mock.method(globalThis, 'fetch', async (url, init) => {
      calls.push({ url: String(url), form: Object.fromEntries(new URLSearchParams(init.body.toString())) });
      return new Response(JSON.stringify({ access_token: 'at', id_token: token }), { status: 200 });
    });
    return calls;
  }

  const exchange = (nonce = 'n-123') =>
    google.create(config, { jwks }).exchange({ code: 'the-code', codeVerifier: 'the-verifier', nonce, redirectUri: 'http://cb' });

  test('enabled only when both credentials are set', () => {
    assert.equal(createOAuthProviders({ oauth: { google: { clientId: 'id' } } }).size, 0);
    assert.deepEqual([...createOAuthProviders(config).keys()], ['google']);
  });

  test('authorization URL', () => {
    const url = new URL(
      google.create(config, { jwks }).authorizationUrl({ state: 'st', codeChallenge: 'ch', nonce: 'nn', redirectUri: 'http://cb' }),
    );
    assert.equal(url.origin + url.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
    assert.deepEqual(Object.fromEntries(url.searchParams), {
      response_type: 'code',
      client_id: CLIENT_ID,
      redirect_uri: 'http://cb',
      scope: 'openid email profile',
      state: 'st',
      code_challenge: 'ch',
      code_challenge_method: 'S256',
      prompt: 'select_account',
      nonce: 'nn',
    });
  });

  test('valid id_token → profile; token request carries the code and PKCE verifier', async (t) => {
    const calls = mockTokenEndpoint(
      t,
      await idToken({ sub: '1098', email: 'Ram.Singh@Gmail.com', email_verified: true, name: 'Ram Singh', picture: 'https://p/1', nonce: 'n-123' }),
    );
    assert.deepEqual(await exchange(), {
      providerUserId: '1098',
      email: 'ram.singh@gmail.com',
      emailVerified: true,
      name: 'Ram Singh',
      picture: 'https://p/1',
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://oauth2.googleapis.com/token');
    assert.deepEqual(calls[0].form, {
      grant_type: 'authorization_code',
      code: 'the-code',
      redirect_uri: 'http://cb',
      client_id: CLIENT_ID,
      client_secret: 'sec',
      code_verifier: 'the-verifier',
    });
  });

  const rejects = async (t, token, nonce) => {
    mockTokenEndpoint(t, await token);
    await assert.rejects(exchange(nonce), OAuthProviderError);
  };
  const claims = { sub: '1', email: 'a@gmail.com', email_verified: true, nonce: 'n-123' };

  test('rejects a wrong nonce', (t) => rejects(t, idToken(claims), 'other-nonce'));
  test('rejects a token for another client (aud)', (t) => rejects(t, idToken(claims, { aud: 'someone-else' })));
  test('rejects a token from another issuer', (t) => rejects(t, idToken(claims, { iss: 'https://evil.example' })));
  test('rejects a token signed with an unknown key', (t) => rejects(t, idToken(claims, { key: otherKey })));
  test('rejects an expired token', (t) => rejects(t, idToken(claims, { exp: Math.floor(Date.now() / 1000) - 60 })));

  test('token endpoint errors → OAuthProviderError with the OAuth error code', async (t) => {
    t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 }));
    await assert.rejects(exchange(), (err) => err instanceof OAuthProviderError && err.details.error === 'invalid_grant');
  });
});
