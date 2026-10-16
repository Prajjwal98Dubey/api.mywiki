import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import {
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  HeadBucketCommand,
} from '@aws-sdk/client-s3';
import { createTestApp, registerUser } from './helpers.js';
import { createImageStore } from '../src/images/imageStore.js';
import { loadConfig } from '../src/config/env.js';
import * as f from './imageFixtures.js';

/** In-memory stand-in for S3Client: same commands, same error shapes. */
function fakeS3() {
  const objects = new Map(); // "bucket/key" → object
  const calls = [];
  const s3Error = (name, status) => Object.assign(new Error(name), { name, $metadata: { httpStatusCode: status } });
  const client = {
    objects,
    calls,
    failNext: null, // { command: 'PutObject', status }
    async send(cmd) {
      const { input } = cmd;
      const op = cmd.constructor.name.replace(/Command$/, '');
      calls.push({ op, input });
      if (client.failNext?.command === op) {
        const { status } = client.failNext;
        client.failNext = null;
        throw s3Error('InternalError', status);
      }
      const id = `${input.Bucket}/${input.Key}`;
      if (cmd instanceof HeadBucketCommand) {
        if (input.Bucket !== 'mywiki-images') throw s3Error('NotFound', 404);
        return {};
      }
      if (cmd instanceof PutObjectCommand) {
        const body = Buffer.from(input.Body);
        objects.set(id, {
          body,
          contentType: input.ContentType,
          metadata: input.Metadata,
          cacheControl: input.CacheControl,
          etag: `"${crypto.createHash('md5').update(body).digest('hex')}"`,
          lastModified: new Date('2026-10-16T12:00:00Z'),
        });
        return { ETag: objects.get(id).etag };
      }
      const obj = objects.get(id);
      if (!obj) throw s3Error(cmd instanceof GetObjectCommand ? 'NoSuchKey' : 'NotFound', 404);
      if (input.IfNoneMatch && input.IfNoneMatch === obj.etag) throw s3Error('NotModified', 304);
      const meta = { ContentLength: obj.body.length, ContentType: obj.contentType, ETag: obj.etag, LastModified: obj.lastModified };
      if (cmd instanceof HeadObjectCommand) return meta;
      if (cmd instanceof GetObjectCommand) return { ...meta, Body: Readable.from([obj.body]) };
      throw new Error(`fake S3: unsupported ${op}`);
    },
  };
  return client;
}

const S3 = { bucket: 'mywiki-images', region: 'ap-south-1', prefix: 'mywiki-profile-img/', endpoint: undefined, forcePathStyle: false };

let ctx;
let s3;
let agent;
before(async () => {
  s3 = fakeS3();
  ctx = await createTestApp({ imageStorage: 's3', s3: S3, s3Client: s3 });
  agent = ctx.agent();
  await registerUser(agent);
});
after(() => ctx.cleanup());

const upload = (buf, filename, contentType) =>
  agent.post('/api/uploads/image').attach('image', buf, { filename, contentType });
const puts = () => s3.calls.filter((c) => c.op === 'PutObject').length;

describe('uploading to S3', () => {
  let uploaded;

  test('a valid image is stored in the bucket under the prefix, with its verified type', async () => {
    const res = await upload(f.PNG, 'me.png', 'image/png');
    assert.equal(res.status, 201);
    assert.match(res.body.url, /^\/uploads\/[0-9a-f-]{36}\.png$/);
    assert.deepEqual(
      { mimeType: res.body.mimeType, size: res.body.size, width: res.body.width, height: res.body.height },
      { mimeType: 'image/png', size: f.PNG.length, width: 1, height: 1 },
    );
    const obj = s3.objects.get(`mywiki-images/mywiki-profile-img/${res.body.filename}`);
    assert.ok(obj, 'object written to the bucket');
    assert.ok(obj.body.equals(f.PNG));
    assert.equal(obj.contentType, 'image/png');
    assert.deepEqual(obj.metadata, { width: '1', height: '1' });
    assert.match(obj.cacheControl, /immutable/);
    uploaded = res.body;
  });

  test('a mislabeled image is stored under its real type', async () => {
    const res = await upload(f.webpLossless(), 'photo.jpg', 'image/jpeg');
    assert.equal(res.status, 201);
    assert.equal(res.body.mimeType, 'image/webp');
    assert.match(res.body.filename, /\.webp$/);
  });

  const refused = {
    'MP4 declared as video/mp4': [f.MP4, 'clip.mp4', 'video/mp4'],
    'MP4 bytes declared as image/jpeg': [f.MP4, 'clip.jpg', 'image/jpeg'],
    'PDF declared as image/png': [f.PDF, 'cv.png', 'image/png'],
    'DOCX declared as application/vnd…': [f.DOCX, 'cv.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    'SVG': [f.SVG, 'x.svg', 'image/svg+xml'],
    'HTML declared as image/gif': [f.HTML, 'x.gif', 'image/gif'],
    'JPEG with an embedded video': [f.JPEG_WITH_VIDEO, 'motion.jpg', 'image/jpeg'],
    'PNG/ZIP polyglot': [f.PNG_WITH_ZIP, 'poly.png', 'image/png'],
    'truncated PNG': [f.TRUNCATED_PNG, 'cut.png', 'image/png'],
  };
  for (const [name, [buf, filename, type]] of Object.entries(refused)) {
    test(`refused, nothing written to S3: ${name}`, async () => {
      const before = puts();
      const res = await upload(buf, filename, type);
      assert.equal(res.status, 415);
      assert.equal(res.body.error.code, 'UNSUPPORTED_MEDIA_TYPE');
      assert.equal(puts(), before);
    });
  }

  test('S3 write failure → 500 INTERNAL', async () => {
    s3.failNext = { command: 'PutObject', status: 500 };
    const res = await upload(f.PNG, 'a.png', 'image/png');
    assert.equal(res.status, 500);
    assert.equal(res.body.error.code, 'INTERNAL');
  });

  describe('serving from S3 at /uploads/:filename', () => {
    test('GET streams the bytes with safe, cacheable headers', async () => {
      const res = await ctx.agent().get(uploaded.url).buffer(true).parse((r, cb) => {
        const chunks = [];
        r.on('data', (c) => chunks.push(c)).on('end', () => cb(null, Buffer.concat(chunks)));
      });
      assert.equal(res.status, 200);
      assert.ok(res.body.equals(f.PNG));
      assert.equal(res.headers['content-type'], 'image/png');
      assert.equal(res.headers['content-length'], String(f.PNG.length));
      assert.equal(res.headers['x-content-type-options'], 'nosniff');
      assert.equal(res.headers['content-disposition'], 'inline');
      assert.match(res.headers['cache-control'], /max-age=31536000, immutable/);
      assert.ok(res.headers.etag);
    });

    test('conditional GET → 304', async () => {
      const first = await ctx.agent().get(uploaded.url);
      const res = await ctx.agent().get(uploaded.url).set('If-None-Match', first.headers.etag);
      assert.equal(res.status, 304);
    });

    test('HEAD reads metadata only', async () => {
      const before = s3.calls.filter((c) => c.op === 'GetObject').length;
      const res = await ctx.agent().head(uploaded.url);
      assert.equal(res.status, 200);
      assert.equal(res.headers['content-length'], String(f.PNG.length));
      assert.equal(s3.calls.filter((c) => c.op === 'GetObject').length, before);
    });

    test('missing image → 404 in the spec error shape', async () => {
      const res = await ctx.agent().get(`/uploads/${crypto.randomUUID()}.png`);
      assert.equal(res.status, 404);
      assert.equal(res.body.error.code, 'NOT_FOUND');
    });

    test('names the server never generates are 404 without asking S3', async () => {
      const before = s3.calls.length;
      for (const p of ['/uploads/..%2F..%2F.env', '/uploads/notes.txt', '/uploads/abc.exe', `/uploads/${crypto.randomUUID()}.svg`]) {
        assert.equal((await ctx.agent().get(p)).status, 404, p);
      }
      assert.equal(s3.calls.length, before);
    });

    test('Content-Type comes from the verified extension, even if the stored object says otherwise', async () => {
      s3.objects.get(`mywiki-images/mywiki-profile-img/${uploaded.filename}`).contentType = 'text/html';
      const res = await ctx.agent().get(uploaded.url);
      assert.equal(res.headers['content-type'], 'image/png');
    });

    test('S3 read failure → 500', async () => {
      s3.failNext = { command: 'GetObject', status: 503 };
      const res = await ctx.agent().get(uploaded.url);
      assert.equal(res.status, 500);
      assert.equal(res.body.error.code, 'INTERNAL');
    });
  });
});

describe('store guards and config', () => {
  test('the store itself refuses anything not verified as an image', async () => {
    const store = createImageStore({ imageStorage: 's3', s3: S3, s3Client: fakeS3() });
    await assert.rejects(store.put('x.mp4', { buffer: f.MP4, mimeType: 'video/mp4', ext: '.mp4' }));
    await assert.rejects(store.save({ buffer: f.PNG, mimeType: 'image/png', ext: '.html' }));
  });

  test('verify(): reachable bucket passes, a wrong bucket fails with a clear message', async () => {
    await createImageStore({ imageStorage: 's3', s3: S3, s3Client: fakeS3() }).verify();
    const bad = createImageStore({ imageStorage: 's3', s3: { ...S3, bucket: 'nope' }, s3Client: fakeS3() });
    await assert.rejects(bad.verify(), /S3 bucket "nope" .* bucket not found/);
  });

  test('IMAGE_STORAGE=s3 requires a bucket and a region', () => {
    assert.throws(() => loadConfig({ IMAGE_STORAGE: 's3' }), /S3_BUCKET must be set/);
    assert.throws(() => loadConfig({ IMAGE_STORAGE: 's3', S3_BUCKET: 'b' }), /S3_REGION/);
    const c = loadConfig({ IMAGE_STORAGE: 's3', S3_BUCKET: 'b', AWS_REGION: 'ap-south-1', S3_PREFIX: '/images/' });
    assert.deepEqual([c.s3.region, c.s3.prefix], ['ap-south-1', 'images/']);
  });

  test('profile pictures go to the "mywiki-profile-img/" folder by default', async () => {
    const c = loadConfig({ IMAGE_STORAGE: 's3', S3_BUCKET: 'b', S3_REGION: 'ap-south-1' });
    assert.equal(c.s3.prefix, 'mywiki-profile-img/');
    assert.equal(loadConfig({ S3_PREFIX: 'mywiki-profile-img' }).s3.prefix, 'mywiki-profile-img/'); // slash optional

    const client = fakeS3();
    const store = createImageStore({ ...c, s3Client: client });
    const { filename } = await store.save({ buffer: f.PNG, mimeType: 'image/png', ext: '.png', width: 1, height: 1 });
    assert.deepEqual([...client.objects.keys()], [`b/mywiki-profile-img/${filename}`]);
  });
});
