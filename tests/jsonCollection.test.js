import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { JsonCollection, DuplicateKeyError } from '../src/repositories/json/JsonCollection.js';

async function tmpDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'mywiki-col-'));
}

test('100 parallel inserts → 100 records persisted, valid JSON', async () => {
  const dir = await tmpDir();
  try {
    const col = await new JsonCollection({ dir, name: 'items' }).init();
    await Promise.all(Array.from({ length: 100 }, (_, i) => col.insert({ id: `id-${i}`, n: i })));
    const onDisk = JSON.parse(await fs.readFile(path.join(dir, 'items.json'), 'utf8'));
    assert.equal(onDisk.length, 100);
    assert.equal(new Set(onDisk.map((d) => d.id)).size, 100);

    const reloaded = await new JsonCollection({ dir, name: 'items' }).init();
    assert.equal(reloaded.size, 100);
    assert.deepEqual(reloaded.get('id-42'), { id: 'id-42', n: 42 });
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('reads return copies', async () => {
  const dir = await tmpDir();
  try {
    const col = await new JsonCollection({ dir, name: 'items' }).init();
    const inserted = await col.insert({ id: 'a', tags: ['x'] });
    inserted.tags.push('mutated');
    const fetched = col.get('a');
    fetched.tags.push('mutated');
    assert.deepEqual(col.get('a').tags, ['x']);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('unique indexes reject duplicates on insert and update', async () => {
  const dir = await tmpDir();
  try {
    const col = await new JsonCollection({
      dir,
      name: 'users',
      uniqueIndexes: { email: (d) => d.email.toLowerCase() },
    }).init();
    await col.insert({ id: '1', email: 'a@x.com' });
    await col.insert({ id: '2', email: 'b@x.com' });
    await assert.rejects(col.insert({ id: '3', email: 'A@X.com' }), DuplicateKeyError);
    await assert.rejects(col.update('2', { email: 'a@x.com' }), DuplicateKeyError);
    assert.equal(col.findByIndex('email', 'b@x.com').id, '2');
    await col.update('2', { email: 'c@x.com' });
    assert.equal(col.findByIndex('email', 'b@x.com'), null);
    assert.equal(col.findByIndex('email', 'c@x.com').id, '2');
    await col.delete('1');
    assert.equal(col.findByIndex('email', 'a@x.com'), null);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('corrupt file fails loudly instead of being overwritten', async () => {
  const dir = await tmpDir();
  try {
    await fs.writeFile(path.join(dir, 'bad.json'), '{not json');
    await assert.rejects(new JsonCollection({ dir, name: 'bad' }).init(), /Corrupt data file/);
    assert.equal(await fs.readFile(path.join(dir, 'bad.json'), 'utf8'), '{not json');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
