import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createTestApp, registerUser, samplePageInput, contentOf, sortedKeys } from './helpers.js';

let ctx;
let owner; // agent of the page owner
let other; // agent of another user
before(async () => {
  ctx = await createTestApp();
  owner = ctx.agent();
  other = ctx.agent();
  await registerUser(owner, { username: 'JaneDoe' });
  await registerUser(other);
});
after(() => ctx.cleanup());

describe('create', () => {
  test('requires login', async () => {
    const res = await ctx.agent().post('/api/pages').send(samplePageInput());
    assert.equal(res.status, 401);
    assert.equal(res.body.error.code, 'UNAUTHENTICATED');
  });

  test('201 with { page, linkStatus, canEdit } in the spec shape', async () => {
    const res = await owner.post('/api/pages').send(samplePageInput());
    assert.equal(res.status, 201);
    assert.deepEqual(sortedKeys(res.body), ['canEdit', 'linkStatus', 'page']);
    assert.equal(res.body.canEdit, true);
    const { page } = res.body;
    assert.deepEqual(sortedKeys(page), [
      'categories', 'createdAt', 'currentRevisionId', 'externalLinks', 'id', 'infobox', 'lead',
      'ownerId', 'references', 'revisionCount', 'sections', 'seeAlso', 'shortDescription', 'slug',
      'title', 'updatedAt', 'visibility',
    ]);
    assert.equal(page.slug, 'jane-doe');
    assert.equal(page.revisionCount, 1);
    assert.ok(page.currentRevisionId);
    assert.ok(page.sections.every((s) => typeof s.id === 'string' && s.id.length > 0));
    assert.deepEqual(res.body.linkStatus, { 'iit-bombay': false, mumbai: false, 'john-doe': false });
  });

  test('same name for a different person → base slug + random suffix (no 409)', async () => {
    const dup = await other.post('/api/pages').send(samplePageInput({ title: 'jane  DOE' }));
    assert.equal(dup.status, 201);
    assert.match(dup.body.page.slug, /^jane-doe-[a-z0-9]{9}$/);
    assert.equal(dup.body.page.title, 'jane  DOE'.trim());

    const third = await owner.post('/api/pages').send(samplePageInput());
    assert.match(third.body.page.slug, /^jane-doe-[a-z0-9]{9}$/);
    assert.notEqual(third.body.page.slug, dup.body.page.slug);

    // The suffixed URL resolves to that exact page; the bare one to the first page.
    const got = await ctx.agent().get(`/api/pages/${dup.body.page.slug}`);
    assert.equal(got.body.page.id, dup.body.page.id);
    assert.equal(got.body.owner.username, (await other.get('/api/auth/me')).body.user.username);
    assert.equal((await ctx.agent().get('/api/pages/jane-doe')).body.owner.username, 'JaneDoe');
  });

  test('concurrent creates with the same name all get distinct slugs', async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, () => owner.post('/api/pages').send({ title: 'Ram Singh' })),
    );
    assert.deepEqual(results.map((r) => r.status), [201, 201, 201, 201, 201]);
    const slugs = results.map((r) => r.body.page.slug);
    assert.equal(new Set(slugs).size, 5);
    assert.equal(slugs.filter((s) => s === 'ram-singh').length, 1);
  });

  test('a title that collides with an app route gets a suffix', async () => {
    const res = await owner.post('/api/pages').send({ title: 'Login' });
    assert.equal(res.status, 201);
    assert.match(res.body.page.slug, /^login-[a-z0-9]{9}$/);
  });

  test('a client-sent slug is ignored', async () => {
    const res = await owner.post('/api/pages').send(samplePageInput({ title: 'Sita Devi', slug: 'hijack' }));
    assert.equal(res.status, 201);
    assert.equal(res.body.page.slug, 'sita-devi');
  });

  test('bad cite id → 400 with a path', async () => {
    const input = samplePageInput({ title: 'Cite Test' });
    input.sections[1].content = 'Oops{{cite|missing}}';
    const res = await owner.post('/api/pages').send(input);
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
    assert.ok(res.body.error.details.some((d) => d.path === 'sections.1.content'));
  });

  test('rule checks: first section level, limits, URLs, dates', async () => {
    const cases = [
      [{ sections: [{ heading: 'Sub', level: 3, content: '' }] }, 'sections.0.level'],
      [{ title: 'x'.repeat(101) }, 'title'],
      [{ shortDescription: 'x'.repeat(121) }, 'shortDescription'],
      [{ externalLinks: [{ label: 'Bad', url: 'javascript:alert(1)' }] }, 'externalLinks.0.url'],
      [{ categories: Array.from({ length: 21 }, (_, i) => `C${i}`) }, 'categories'],
      [{ infobox: { ...samplePageInput().infobox, birthDate: '1998-02-30' } }, 'infobox.birthDate'],
      [{ references: [{ id: 'bad id!', title: 'x' }], lead: '', sections: [] }, 'references.0.id'],
    ];
    for (const [overrides, path] of cases) {
      const res = await owner.post('/api/pages').send(samplePageInput({ title: 'Rules', ...overrides }));
      assert.equal(res.status, 400, `expected 400 for ${path}`);
      assert.ok(
        res.body.error.details.some((d) => d.path === path),
        `expected a detail at ${path}, got ${JSON.stringify(res.body.error.details)}`,
      );
    }
  });

  test('title without usable characters → page-<suffix>', async () => {
    const res = await owner.post('/api/pages').send(samplePageInput({ title: '!!!' }));
    assert.equal(res.status, 201);
    assert.match(res.body.page.slug, /^page-[a-z0-9]{9}$/);
    assert.equal(res.body.page.title, '!!!');
  });

  test('minimal input fills defaults', async () => {
    const res = await owner.post('/api/pages').send({ title: 'Minimal Person' });
    assert.equal(res.status, 201);
    const { page } = res.body;
    assert.deepEqual(page.sections, []);
    assert.deepEqual(page.infobox.fields, []);
    assert.equal(page.infobox.image, null);
    assert.equal(page.infobox.birthDate, null);
  });
});

describe('read', () => {
  test('GET /api/pages/:slug for anonymous users', async () => {
    const res = await ctx.agent().get('/api/pages/Jane_Doe');
    assert.equal(res.status, 200);
    assert.deepEqual(sortedKeys(res.body), ['canEdit', 'linkStatus', 'owner', 'page']);
    assert.equal(res.body.canEdit, false);
    assert.equal(res.body.owner.username, 'JaneDoe');
    assert.deepEqual(sortedKeys(res.body.owner), ['id', 'username']);
  });

  test('canEdit is true only for the owner', async () => {
    assert.equal((await owner.get('/api/pages/Jane_Doe')).body.canEdit, true);
    assert.equal((await other.get('/api/pages/Jane_Doe')).body.canEdit, false);
  });

  test('lookups are case-insensitive and accept names / old-style slugs', async () => {
    for (const param of ['jane-doe', 'Jane-Doe', 'Jane%20Doe', 'Jane_Doe']) {
      const res = await ctx.agent().get(`/api/pages/${param}`);
      assert.equal(res.status, 200, param);
      assert.equal(res.body.page.slug, 'jane-doe');
    }
  });

  test('missing page → 404 with the Wikipedia message', async () => {
    const res = await ctx.agent().get('/api/pages/Nobody_Here');
    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'NOT_FOUND');
    assert.equal(res.body.error.message, 'MyWiki does not have an article with this exact name.');
  });

  test('linkStatus turns blue once the target exists', async () => {
    await owner.post('/api/pages').send({ title: 'Mumbai', lead: 'A city.' });
    const res = await ctx.agent().get('/api/pages/Jane_Doe');
    assert.equal(res.body.linkStatus.mumbai, true);
    assert.equal(res.body.linkStatus['iit-bombay'], false);
  });

  test('summary', async () => {
    const res = await ctx.agent().get('/api/pages/Jane_Doe/summary');
    assert.equal(res.status, 200);
    assert.deepEqual(sortedKeys(res.body), ['excerpt', 'shortDescription', 'slug', 'thumbnail', 'title']);
    assert.equal(res.body.excerpt, 'Jane Doe (born 15 March 1998) is an Indian software engineer.');
    assert.equal(res.body.thumbnail, null);
  });

  test('summary excerpt is capped around 300 chars', async () => {
    const lead = Array.from({ length: 100 }, (_, i) => `word${i}`).join(' ');
    await owner.post('/api/pages').send({ title: 'Long Lead', lead });
    const res = await ctx.agent().get('/api/pages/Long_Lead/summary');
    assert.ok(res.body.excerpt.length <= 301);
    assert.ok(res.body.excerpt.endsWith('…'));
  });

  test('list recent, count, random, mine', async () => {
    const list = await ctx.agent().get('/api/pages?sort=recent&limit=2&offset=0');
    assert.equal(list.status, 200);
    assert.equal(list.body.pages.length, 2);
    assert.ok(list.body.total >= 5);
    assert.deepEqual(sortedKeys(list.body.pages[0]), ['createdAt', 'shortDescription', 'slug', 'thumbnail', 'title', 'updatedAt', 'visibility']);
    assert.ok(list.body.pages[0].createdAt >= list.body.pages[1].createdAt);

    const count = await ctx.agent().get('/api/pages/count');
    assert.deepEqual(count.body, { count: list.body.total });

    const random = await ctx.agent().get('/api/pages/random');
    assert.equal(random.status, 200);
    assert.equal(typeof random.body.slug, 'string');

    assert.equal((await ctx.agent().get('/api/pages/mine')).status, 401);
    const mine = (await owner.get('/api/pages/mine')).body.pages;
    const othersPages = (await other.get('/api/pages/mine')).body.pages;
    assert.equal(othersPages.length, 1); // the second "Jane Doe"
    assert.equal(mine.length + othersPages.length, list.body.total);
    assert.ok(!mine.some((p) => p.slug === othersPages[0].slug));
  });

  test('bad list query → 400', async () => {
    assert.equal((await ctx.agent().get('/api/pages?limit=500')).status, 400);
    assert.equal((await ctx.agent().get('/api/pages?sort=bogus')).status, 400);
  });

  test('slug-check', async () => {
    const check = async (qs) => (await ctx.agent().get(`/api/pages/slug-check${qs}`)).body;
    assert.deepEqual(await check('?title=Jane%20Doe'), { slug: 'jane-doe', available: false });
    assert.deepEqual(await check('?title=John%20Doe'), { slug: 'john-doe', available: true });
    assert.deepEqual(await check('?title=Random'), { slug: 'random', available: false });
    assert.deepEqual(await check('?title=%21%21'), { slug: '', available: false });
    assert.deepEqual(await check(''), { slug: '', available: false });
  });
});

describe('update / delete', () => {
  test('non-owner PUT → 403, anonymous → 401', async () => {
    const { body } = await ctx.agent().get('/api/pages/Jane_Doe');
    const payload = { ...contentOf(body.page), baseRevisionId: body.page.currentRevisionId };
    assert.equal((await other.put('/api/pages/Jane_Doe').send(payload)).status, 403);
    assert.equal((await ctx.agent().put('/api/pages/Jane_Doe').send(payload)).status, 401);
  });

  test('owner PUT updates content and keeps the slug', async () => {
    const { body } = await owner.get('/api/pages/Jane_Doe');
    const res = await owner.put('/api/pages/Jane_Doe').send({
      ...contentOf(body.page),
      title: 'Jane A. Doe',
      baseRevisionId: body.page.currentRevisionId,
      editSummary: 'Middle initial',
    });
    assert.equal(res.status, 200);
    assert.deepEqual(sortedKeys(res.body), ['canEdit', 'linkStatus', 'page']);
    assert.equal(res.body.page.title, 'Jane A. Doe');
    assert.equal(res.body.page.slug, 'jane-doe');
    assert.equal(res.body.page.revisionCount, 2);
    assert.ok(res.body.page.updatedAt >= body.page.updatedAt);
  });

  test('PUT without baseRevisionId → 400', async () => {
    const { body } = await owner.get('/api/pages/Jane_Doe');
    const res = await owner.put('/api/pages/Jane_Doe').send(contentOf(body.page));
    assert.equal(res.status, 400);
    assert.ok(res.body.error.details.some((d) => d.path === 'baseRevisionId'));
  });

  test('DELETE: non-owner 403, owner 204 and revisions are gone', async () => {
    const created = await owner.post('/api/pages').send({ title: 'To Delete' });
    const { page } = created.body;
    assert.equal((await other.delete('/api/pages/To_Delete')).status, 403);
    assert.equal((await owner.delete('/api/pages/To_Delete')).status, 204);
    assert.equal((await ctx.agent().get('/api/pages/To_Delete')).status, 404);
    assert.equal(await ctx.repos.revisions.findById(page.currentRevisionId), null);
  });
});
