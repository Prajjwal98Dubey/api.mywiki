import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createTestApp, registerUser, samplePageInput, sortedKeys } from './helpers.js';
import { buildSnippet, toSegments } from '../src/services/search.service.js';

let ctx;
before(async () => {
  ctx = await createTestApp();
  const owner = ctx.agent();
  await registerUser(owner);
  await owner.post('/api/pages').send(samplePageInput());
  await owner.post('/api/pages').send({ title: 'John Doe', shortDescription: 'British engineer', lead: 'John is a civil engineer.' });
  await owner.post('/api/pages').send({ title: 'Ada Example', shortDescription: 'Mathematician', lead: 'Ada wrote programs.' });
  await owner.post('/api/pages').send({ title: 'Doe', lead: 'A female deer.' });
  await owner.post('/api/pages').send({ title: 'Janet Smith', lead: 'Unrelated.' });
});
after(() => ctx.cleanup());

test('suggest: title prefix first, then word prefix', async () => {
  const res = await ctx.agent().get('/api/search/suggest?q=doe');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.results.map((r) => r.title), ['Doe', 'Jane Doe', 'John Doe']);
  assert.deepEqual(sortedKeys(res.body.results[0]), ['shortDescription', 'slug', 'thumbnail', 'title']);

  const ja = await ctx.agent().get('/api/search/suggest?q=JA');
  assert.deepEqual(ja.body.results.map((r) => r.title), ['Jane Doe', 'Janet Smith']);
});

test('suggest: limit and empty query', async () => {
  assert.equal((await ctx.agent().get('/api/search/suggest?q=doe&limit=1')).body.results.length, 1);
  assert.deepEqual((await ctx.agent().get('/api/search/suggest?q=')).body, { results: [] });
  assert.equal((await ctx.agent().get('/api/search/suggest?q=doe&limit=11')).status, 400);
});

test('search "engineer" finds Jane Doe with a highlighted segment', async () => {
  const res = await ctx.agent().get('/api/search?q=engineer');
  assert.equal(res.status, 200);
  const titles = res.body.results.map((r) => r.title);
  assert.ok(titles.includes('Jane Doe'));
  assert.ok(titles.includes('John Doe'));
  assert.ok(!titles.includes('Ada Example'));
  assert.equal(res.body.total, 2);

  const jane = res.body.results.find((r) => r.title === 'Jane Doe');
  assert.deepEqual(sortedKeys(jane), ['shortDescription', 'size', 'slug', 'snippet', 'title', 'updatedAt']);
  assert.ok(jane.snippet.some((s) => s.match && s.text.toLowerCase() === 'engineer'));
  assert.ok(jane.snippet.every((s) => typeof s.text === 'string' && typeof s.match === 'boolean'));
  assert.ok(jane.size > 0);
});

test('search ranks an exact title match first', async () => {
  const res = await ctx.agent().get('/api/search?q=Doe');
  assert.equal(res.body.results[0].title, 'Doe');
});

test('search: no match / empty / pagination', async () => {
  assert.deepEqual((await ctx.agent().get('/api/search?q=zzzzqqq')).body, { results: [], total: 0 });
  assert.deepEqual((await ctx.agent().get('/api/search?q=')).body, { results: [], total: 0 });
  const page2 = await ctx.agent().get('/api/search?q=doe&limit=1&offset=1');
  assert.equal(page2.body.results.length, 1);
  assert.ok(page2.body.total >= 3);
});

test('search reflects edits (plain-text cache invalidation)', async () => {
  const owner = ctx.agent();
  await registerUser(owner);
  const created = await owner.post('/api/pages').send({ title: 'Cache Test', lead: 'Before.' });
  assert.equal((await ctx.agent().get('/api/search?q=xylophonist')).body.total, 0);
  await owner
    .put('/api/pages/Cache_Test')
    .send({ title: 'Cache Test', lead: 'A noted xylophonist.', baseRevisionId: created.body.page.currentRevisionId });
  assert.equal((await ctx.agent().get('/api/search?q=xylophonist')).body.total, 1);
});

test('snippet helpers', () => {
  const regex = /engineer|doe/giu;
  assert.deepEqual(toSegments('Jane Doe is an engineer.', regex), [
    { text: 'Jane ', match: false },
    { text: 'Doe', match: true },
    { text: ' is an ', match: false },
    { text: 'engineer', match: true },
    { text: '.', match: false },
  ]);

  const long = `${'lorem '.repeat(60)}the engineer ${'ipsum '.repeat(60)}`.trim();
  const snippet = buildSnippet(long, /engineer/giu);
  const text = snippet.map((s) => s.text).join('');
  assert.ok(text.startsWith('…') && text.endsWith('…'));
  assert.ok(text.length <= 165);
  assert.ok(snippet.some((s) => s.match));
});
