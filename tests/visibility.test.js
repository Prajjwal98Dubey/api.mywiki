import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createTestApp, registerUser, contentOf } from './helpers.js';

// Spec §6.5: unlisted pages open by URL but never show up in explore or search.

let ctx;
let owner;
let other;
let hidden; // the unlisted page
before(async () => {
  ctx = await createTestApp();
  owner = ctx.agent();
  other = ctx.agent();
  await registerUser(owner);
  await registerUser(other);
  await owner.post('/api/pages').send({ title: 'Visible Person', lead: 'A public zebracorn trainer.' });
  const res = await owner.post('/api/pages').send({
    title: 'Hidden Person',
    shortDescription: 'Zebracorn researcher',
    lead: 'A quiet zebracorn researcher. See [[Visible Person]].',
    visibility: 'unlisted',
  });
  hidden = res.body.page;
  await owner.post('/api/pages').send({ title: 'Linker', lead: 'Links to [[Hidden Person]].' });
});
after(() => ctx.cleanup());

const slugsOf = (pages) => pages.map((p) => p.slug);

describe('create', () => {
  test('visibility defaults to public and is returned on the page', async () => {
    const res = await owner.post('/api/pages').send({ title: 'Default Vis' });
    assert.equal(res.status, 201);
    assert.equal(res.body.page.visibility, 'public');
  });

  test('can be created unlisted', () => {
    assert.equal(hidden.visibility, 'unlisted');
  });

  test('"private" is reserved → 400; unknown values → 400', async () => {
    for (const visibility of ['private', 'secret']) {
      const res = await owner.post('/api/pages').send({ title: 'Nope', visibility });
      assert.equal(res.status, 400, visibility);
      assert.equal(res.body.error.code, 'VALIDATION_ERROR');
      assert.ok(res.body.error.details.some((d) => d.path === 'visibility'));
    }
  });
});

describe('unlisted pages are reachable by URL', () => {
  test('anyone with the link can read it, its summary and its history', async () => {
    const anon = ctx.agent();
    const page = await anon.get(`/api/pages/${hidden.slug}`);
    assert.equal(page.status, 200);
    assert.equal(page.body.page.visibility, 'unlisted');
    assert.equal((await anon.get(`/api/pages/${hidden.slug}/summary`)).status, 200);
    const revs = await anon.get(`/api/pages/${hidden.slug}/revisions`);
    assert.equal(revs.body.total, 1);
    assert.equal((await anon.get(`/api/pages/${hidden.slug}/revisions/${revs.body.revisions[0].id}`)).status, 200);
  });

  test('links to it are blue (linkStatus true)', async () => {
    const res = await ctx.agent().get('/api/pages/linker');
    assert.equal(res.body.linkStatus[hidden.slug], true);
  });
});

describe('unlisted pages are hidden from explore and search — for everyone', () => {
  for (const [who, agent] of [['anonymous', () => ctx.agent()], ['the owner', () => owner]]) {
    test(`recent list and count (${who})`, async () => {
      const list = await agent().get('/api/pages?limit=50');
      assert.ok(!slugsOf(list.body.pages).includes(hidden.slug));
      assert.ok(list.body.pages.every((p) => p.visibility === 'public'));
      const { count } = (await agent().get('/api/pages/count')).body;
      assert.equal(count, list.body.total);
    });

    test(`search and suggestions (${who})`, async () => {
      const search = await agent().get('/api/search?q=zebracorn');
      assert.deepEqual(slugsOf(search.body.results), ['visible-person']);
      assert.equal(search.body.total, 1);
      const suggest = await agent().get('/api/search/suggest?q=hidden');
      assert.deepEqual(suggest.body.results, []);
    });
  }

  test('random never picks it', async () => {
    for (let i = 0; i < 25; i++) {
      const { slug } = (await ctx.agent().get('/api/pages/random')).body;
      assert.notEqual(slug, hidden.slug);
    }
  });

  test('random → 404 when every page is unlisted', async () => {
    const solo = await createTestApp();
    try {
      const agent = solo.agent();
      await registerUser(agent);
      await agent.post('/api/pages').send({ title: 'Only Me', visibility: 'unlisted' });
      assert.equal((await solo.agent().get('/api/pages/random')).status, 404);
      assert.deepEqual((await solo.agent().get('/api/pages/count')).body, { count: 0 });
    } finally {
      await solo.cleanup();
    }
  });

  test('/mine still lists it, with its visibility', async () => {
    const mine = (await owner.get('/api/pages/mine')).body.pages;
    const entry = mine.find((p) => p.slug === hidden.slug);
    assert.equal(entry?.visibility, 'unlisted');
  });
});

describe('PATCH /api/pages/:slug/settings', () => {
  const url = () => `/api/pages/${hidden.slug}/settings`;

  test('anonymous → 401, non-owner → 403', async () => {
    assert.equal((await ctx.agent().patch(url()).send({ visibility: 'public' })).status, 401);
    assert.equal((await other.patch(url()).send({ visibility: 'public' })).status, 403);
  });

  test('invalid bodies → 400', async () => {
    for (const body of [{}, { visibility: 'private' }, { visibility: 'everyone' }, { visibility: 1 }]) {
      const res = await owner.patch(url()).send(body);
      assert.equal(res.status, 400, JSON.stringify(body));
      assert.equal(res.body.error.code, 'VALIDATION_ERROR');
    }
    assert.match((await owner.patch(url()).send({ visibility: 'private' })).body.error.message, /not available yet/);
  });

  test('owner makes it public: no new revision, updatedAt unchanged, now discoverable', async () => {
    const before = (await owner.get(`/api/pages/${hidden.slug}`)).body.page;
    const res = await owner.patch(url()).send({ visibility: 'public' });
    assert.equal(res.status, 200);
    assert.deepEqual(Object.keys(res.body), ['page']);
    assert.equal(res.body.page.visibility, 'public');
    assert.equal(res.body.page.revisionCount, before.revisionCount);
    assert.equal(res.body.page.currentRevisionId, before.currentRevisionId);
    assert.equal(res.body.page.updatedAt, before.updatedAt);
    assert.ok(slugsOf((await ctx.agent().get('/api/search?q=zebracorn')).body.results).includes(hidden.slug));

    const back = await owner.patch(url()).send({ visibility: 'unlisted' });
    assert.equal(back.body.page.visibility, 'unlisted');
    assert.ok(!slugsOf((await ctx.agent().get('/api/search?q=zebracorn')).body.results).includes(hidden.slug));
  });

  test('PUT ignores visibility; content edits and restores keep it', async () => {
    const { page } = (await owner.get(`/api/pages/${hidden.slug}`)).body;
    const put = await owner.put(`/api/pages/${hidden.slug}`).send({
      ...contentOf(page),
      lead: 'Edited lead.',
      visibility: 'public',
      baseRevisionId: page.currentRevisionId,
    });
    assert.equal(put.status, 200);
    assert.equal(put.body.page.visibility, 'unlisted');
    assert.equal(put.body.page.revisionCount, page.revisionCount + 1);

    const revs = (await owner.get(`/api/pages/${hidden.slug}/revisions`)).body.revisions;
    const first = revs.find((r) => r.revNumber === 1);
    const restored = await owner.post(`/api/pages/${hidden.slug}/revisions/${first.id}/restore`).send({});
    assert.equal(restored.body.page.visibility, 'unlisted');
    const snap = (await owner.get(`/api/pages/${hidden.slug}/revisions/${first.id}`)).body.revision.snapshot;
    assert.equal('visibility' in snap, false);
  });
});

test('pages stored before the field existed count as public', async () => {
  const now = new Date().toISOString();
  const { user } = await registerUser(ctx.agent());
  await ctx.repos.pages.create({
    id: crypto.randomUUID(),
    slug: 'legacy-zebracorn',
    ownerId: user.id,
    title: 'Legacy Zebracorn',
    shortDescription: '',
    infobox: { name: '', image: null, birthDate: null, birthPlace: '', deathDate: null, deathPlace: '', fields: [] },
    lead: 'Old page.',
    sections: [],
    references: [],
    seeAlso: [],
    externalLinks: [],
    categories: [],
    currentRevisionId: null,
    revisionCount: 0,
    createdAt: now,
    updatedAt: now,
  });
  assert.equal((await ctx.agent().get('/api/pages/legacy-zebracorn')).body.page.visibility, 'public');
  assert.ok(slugsOf((await ctx.agent().get('/api/pages?limit=50')).body.pages).includes('legacy-zebracorn'));
  assert.ok(slugsOf((await ctx.agent().get('/api/search/suggest?q=legacy')).body.results).includes('legacy-zebracorn'));
});
