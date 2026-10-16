import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createTestApp, registerUser, samplePageInput, contentOf, sortedKeys } from './helpers.js';

let ctx;
let owner;
let other;
let ownerUser;
before(async () => {
  ctx = await createTestApp();
  owner = ctx.agent();
  other = ctx.agent();
  ({ user: ownerUser } = await registerUser(owner, { username: 'Historian' }));
  await registerUser(other);
});
after(() => ctx.cleanup());

async function edit(slug, mutate, editSummary) {
  const { body } = await owner.get(`/api/pages/${slug}`);
  const content = contentOf(body.page);
  mutate(content);
  return owner.put(`/api/pages/${slug}`).send({ ...content, baseRevisionId: body.page.currentRevisionId, editSummary });
}

test('two edits → 3 revisions with correct sizes and deltas', async () => {
  await owner.post('/api/pages').send(samplePageInput());
  await edit('Jane_Doe', (c) => (c.lead += ' She also writes.'), 'Expanded lead');
  await edit('Jane_Doe', (c) => (c.sections = c.sections.slice(0, 1)), 'Trimmed sections');

  const res = await ctx.agent().get('/api/pages/Jane_Doe/revisions');
  assert.equal(res.status, 200);
  assert.equal(res.body.total, 3);
  const [r3, r2, r1] = res.body.revisions;
  assert.deepEqual([r3.revNumber, r2.revNumber, r1.revNumber], [3, 2, 1]);
  assert.deepEqual(sortedKeys(r1), [
    'authorId', 'authorUsername', 'createdAt', 'editSummary', 'id', 'pageId', 'revNumber', 'size', 'sizeDelta',
  ]);
  assert.equal(r1.editSummary, 'Created page');
  assert.equal(r1.sizeDelta, r1.size);
  assert.equal(r2.sizeDelta, r2.size - r1.size);
  assert.equal(r3.sizeDelta, r3.size - r2.size);
  assert.ok(r2.sizeDelta > 0);
  assert.ok(r3.sizeDelta < 0);
  assert.equal(r3.authorUsername, 'Historian');
  assert.equal(r3.authorId, ownerUser.id);

  const page = (await ctx.agent().get('/api/pages/Jane_Doe')).body.page;
  assert.equal(page.revisionCount, 3);
  assert.equal(page.currentRevisionId, r3.id);
});

test('revision size is the byte size of the snapshot', async () => {
  const { revisions } = (await ctx.agent().get('/api/pages/Jane_Doe/revisions')).body;
  const { revision } = (await ctx.agent().get(`/api/pages/Jane_Doe/revisions/${revisions[0].id}`)).body;
  assert.equal(revision.size, Buffer.byteLength(JSON.stringify(revision.snapshot)));
  assert.deepEqual(sortedKeys(revision.snapshot), [
    'categories', 'externalLinks', 'infobox', 'lead', 'references', 'sections', 'seeAlso', 'shortDescription', 'title',
  ]);
});

test('pagination of the history', async () => {
  const res = await ctx.agent().get('/api/pages/Jane_Doe/revisions?limit=1&offset=1');
  assert.equal(res.body.total, 3);
  assert.equal(res.body.revisions.length, 1);
  assert.equal(res.body.revisions[0].revNumber, 2);
});

test('a null edit does not create a revision', async () => {
  const res = await edit('Jane_Doe', () => {}, 'Nothing');
  assert.equal(res.status, 200);
  assert.equal(res.body.page.revisionCount, 3);
});

test('a stale baseRevisionId → 409 EDIT_CONFLICT with currentRevisionId', async () => {
  const { body } = await owner.get('/api/pages/Jane_Doe');
  const { revisions } = (await ctx.agent().get('/api/pages/Jane_Doe/revisions')).body;
  const res = await owner
    .put('/api/pages/Jane_Doe')
    .send({ ...contentOf(body.page), lead: 'changed', baseRevisionId: revisions[1].id });
  assert.equal(res.status, 409);
  assert.equal(res.body.error.code, 'EDIT_CONFLICT');
  assert.equal(res.body.error.details.currentRevisionId, body.page.currentRevisionId);
});

test('concurrent edits from the same base: exactly one wins', async () => {
  const { body } = await owner.get('/api/pages/Jane_Doe');
  const base = { ...contentOf(body.page), baseRevisionId: body.page.currentRevisionId };
  const results = await Promise.all(
    ['A', 'B', 'C'].map((x) => owner.put('/api/pages/Jane_Doe').send({ ...base, lead: `Version ${x}` })),
  );
  const statuses = results.map((r) => r.status).sort();
  assert.deepEqual(statuses, [200, 409, 409]);
  // Roll back to keep the rest of the file predictable.
  const latest = (await ctx.agent().get('/api/pages/Jane_Doe/revisions?limit=1')).body.revisions[0];
  assert.equal(latest.revNumber, 4);
});

test('GET one revision: isCurrent, linkStatus for that snapshot, owner', async () => {
  const { revisions } = (await ctx.agent().get('/api/pages/Jane_Doe/revisions')).body;
  const current = await ctx.agent().get(`/api/pages/Jane_Doe/revisions/${revisions[0].id}`);
  assert.equal(current.status, 200);
  assert.deepEqual(sortedKeys(current.body), ['isCurrent', 'linkStatus', 'owner', 'revision']);
  assert.equal(current.body.isCurrent, true);
  assert.equal(current.body.owner.username, 'Historian');

  const first = revisions.find((r) => r.revNumber === 1);
  const old = await ctx.agent().get(`/api/pages/Jane_Doe/revisions/${first.id}`);
  assert.equal(old.body.isCurrent, false);
  // Rev 1 still had the "Open source"/"Career" sections; Mumbai link is in section 1 anyway.
  assert.equal(old.body.linkStatus.mumbai, false);
  assert.equal(old.body.revision.snapshot.sections.length, 3);
});

test('a revision of another page → 404', async () => {
  const created = await owner.post('/api/pages').send({ title: 'Other Page' });
  const res = await ctx.agent().get(`/api/pages/Jane_Doe/revisions/${created.body.page.currentRevisionId}`);
  assert.equal(res.status, 404);
  assert.equal((await ctx.agent().get('/api/pages/Jane_Doe/revisions/nope')).status, 404);
});

test('restore: owner only; creates rev n+1 equal to the target snapshot', async () => {
  const { revisions } = (await ctx.agent().get('/api/pages/Jane_Doe/revisions')).body;
  const first = revisions.find((r) => r.revNumber === 1);
  const url = `/api/pages/Jane_Doe/revisions/${first.id}/restore`;

  assert.equal((await ctx.agent().post(url)).status, 401);
  assert.equal((await other.post(url)).status, 403);

  const res = await owner.post(url).send({});
  assert.equal(res.status, 200);
  assert.deepEqual(sortedKeys(res.body), ['canEdit', 'linkStatus', 'page']);
  assert.equal(res.body.page.revisionCount, 5);

  const after = (await ctx.agent().get('/api/pages/Jane_Doe/revisions')).body.revisions;
  assert.equal(after[0].revNumber, 5);
  assert.equal(after[0].editSummary, 'Restored revision 1 by Historian');
  const restored = (await ctx.agent().get(`/api/pages/Jane_Doe/revisions/${after[0].id}`)).body.revision;
  const original = (await ctx.agent().get(`/api/pages/Jane_Doe/revisions/${first.id}`)).body.revision;
  assert.deepEqual(restored.snapshot, original.snapshot);
  assert.equal(after[0].size, first.size);
});

test('restore with a custom edit summary', async () => {
  const { revisions } = (await ctx.agent().get('/api/pages/Jane_Doe/revisions')).body;
  const second = revisions.find((r) => r.revNumber === 2);
  const res = await owner
    .post(`/api/pages/Jane_Doe/revisions/${second.id}/restore`)
    .send({ editSummary: 'Back to the expanded lead' });
  assert.equal(res.status, 200);
  const latest = (await ctx.agent().get('/api/pages/Jane_Doe/revisions?limit=1')).body.revisions[0];
  assert.equal(latest.editSummary, 'Back to the expanded lead');
});
