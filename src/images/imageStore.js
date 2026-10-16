import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import express from 'express';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  HeadBucketCommand,
} from '@aws-sdk/client-s3';
import { IMAGE_TYPES, IMAGE_EXTENSIONS } from './detectImage.js';

/**
 * Where uploaded images live (IMAGE_STORAGE=local | s3). Both stores keep the public
 * URL `/uploads/<uuid>.<ext>`, so pages and the client never change when switching.
 *
 *   save(image)             image = { buffer, mimeType, ext, width, height } from detectImage()
 *                           → { filename }  (random UUID name; extension from the verified type)
 *   put(filename, image)    same, with a given name (migration script)
 *   exists(filename)        → boolean
 *   serve                   Express router for GET/HEAD /uploads/:filename
 *   verify()                startup check (S3: bucket reachable with these credentials)
 *
 * Only callers that already ran detectImage() may store anything, and stores refuse
 * types outside IMAGE_TYPES as a second line of defence.
 */

/** Names the server itself generates; anything else is a 404 without touching storage. */
export const FILENAME_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp|gif)$/;
const CACHE_CONTROL = 'public, max-age=31536000, immutable'; // names are random and never reused

function assertImage(image) {
  if (!image || !Buffer.isBuffer(image.buffer) || IMAGE_TYPES[image.mimeType] !== image.ext) {
    throw new Error('Refusing to store something that is not a verified image');
  }
}
const newFilename = (ext) => `${crypto.randomUUID()}${ext}`;
const contentTypeFor = (filename) => IMAGE_EXTENSIONS[path.extname(filename)];

const setImageHeaders = (res, filename) => {
  res.set({
    'Content-Type': contentTypeFor(filename), // derived from the verified extension, never from storage
    'X-Content-Type-Options': 'nosniff',
    'Content-Disposition': 'inline',
    'Cache-Control': CACHE_CONTROL,
  });
};

// ---- local disk -----------------------------------------------------------------------

function createLocalImageStore(config) {
  fs.mkdirSync(config.uploadDir, { recursive: true });
  const fileFor = (filename) => path.join(config.uploadDir, filename);

  const store = {
    driver: 'local',
    async put(filename, image) {
      assertImage(image);
      await fs.promises.writeFile(fileFor(filename), image.buffer, { flag: 'wx' });
      return { filename };
    },
    save: (image) => store.put(newFilename(image.ext), image),
    exists: async (filename) => fs.promises.access(fileFor(filename)).then(() => true, () => false),
    verify: async () => {},
    serve: express.Router().get('/:filename', (req, res, next) => {
      const { filename } = req.params;
      if (!FILENAME_PATTERN.test(filename)) return next();
      setImageHeaders(res, filename);
      res.sendFile(fileFor(filename), { dotfiles: 'deny', lastModified: true }, (err) => {
        if (err && !res.headersSent) next(err.status === 404 || err.code === 'ENOENT' ? undefined : err);
      });
    }),
  };
  return store;
}

// ---- Amazon S3 ----------------------------------------------------------------------------

function createS3ImageStore(config) {
  const { bucket, region, prefix, endpoint, forcePathStyle } = config.s3;
  const client =
    config.s3Client ?? new S3Client({ region, ...(endpoint ? { endpoint, forcePathStyle } : {}) });
  const keyFor = (filename) => `${prefix}${filename}`;
  const status = (err) => err?.$metadata?.httpStatusCode;

  async function exists(filename) {
    try {
      await client.send(new HeadObjectCommand({ Bucket: bucket, Key: keyFor(filename) }));
      return true;
    } catch (err) {
      if (status(err) === 404 || err?.name === 'NotFound') return false;
      throw err;
    }
  }

  async function serveImage(req, res, next) {
    const { filename } = req.params;
    if (!FILENAME_PATTERN.test(filename)) return next(); // never ask S3 for arbitrary keys
    const input = {
      Bucket: bucket,
      Key: keyFor(filename),
      IfNoneMatch: req.get('If-None-Match') || undefined,
    };
    let object;
    try {
      object = await client.send(req.method === 'HEAD' ? new HeadObjectCommand(input) : new GetObjectCommand(input));
    } catch (err) {
      if (status(err) === 304) {
        setImageHeaders(res, filename);
        return res.status(304).end();
      }
      if (status(err) === 404 || ['NoSuchKey', 'NotFound'].includes(err?.name)) return next(); // → 404
      console.error(`[images] S3 read failed for ${filename}:`, err?.name, err?.message);
      return res.status(500).json({ error: { code: 'INTERNAL', message: 'Could not load the image' } });
    }

    setImageHeaders(res, filename);
    if (object.ContentLength != null) res.set('Content-Length', String(object.ContentLength));
    if (object.ETag) res.set('ETag', object.ETag);
    if (object.LastModified) res.set('Last-Modified', object.LastModified.toUTCString());
    if (req.method === 'HEAD') return res.end();
    try {
      await pipeline(object.Body, res);
    } catch (err) {
      // Client went away or S3 dropped the stream mid-way; nothing more can be sent.
      if (!res.writableEnded) res.destroy(err);
    }
  }

  const store = {
    driver: 's3',
    async put(filename, image) {
      assertImage(image);
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: keyFor(filename),
          Body: image.buffer,
          ContentLength: image.buffer.length,
          ContentType: image.mimeType,
          ContentDisposition: 'inline',
          CacheControl: CACHE_CONTROL,
          Metadata: { width: String(image.width), height: String(image.height) },
        }),
      );
      return { filename };
    },
    save: (image) => store.put(newFilename(image.ext), image),
    exists,
    async verify() {
      try {
        await client.send(new HeadBucketCommand({ Bucket: bucket }));
      } catch (err) {
        const why = status(err) === 403 ? 'access denied (check the IAM permissions)' : status(err) === 404 ? 'bucket not found' : err?.message ?? err?.name;
        throw new Error(`S3 bucket "${bucket}" (${region}) is not usable: ${why}`, { cause: err });
      }
    },
    serve: express.Router().get('/:filename', serveImage),
  };
  return store;
}

export function createImageStore(config) {
  return config.imageStorage === 's3' ? createS3ImageStore(config) : createLocalImageStore(config);
}
