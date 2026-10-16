import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import multer from 'multer';
import express from 'express';
import { HttpError } from '../lib/errors.js';

/** MIME allow-list → extension. The extension never comes from the user's filename. */
export const IMAGE_TYPES = Object.freeze({
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
});

export function createImageUpload(config) {
  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, config.uploadDir),
    filename: (_req, file, cb) => cb(null, crypto.randomUUID() + IMAGE_TYPES[file.mimetype]),
  });

  return multer({
    storage,
    limits: { fileSize: config.maxUploadBytes, files: 1, fields: 5, parts: 10 },
    fileFilter: (_req, file, cb) => {
      if (IMAGE_TYPES[file.mimetype]) return cb(null, true);
      cb(new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Only JPEG, PNG, WebP and GIF images are allowed'));
    },
  }).single('image');
}

/** Checks the file's leading bytes match its claimed MIME type. */
export async function hasValidMagicBytes(filePath, mimeType) {
  const fh = await fs.open(filePath, 'r');
  try {
    const buf = Buffer.alloc(12);
    const { bytesRead } = await fh.read(buf, 0, 12, 0);
    const b = buf.subarray(0, bytesRead);
    const ascii = (start, end) => b.subarray(start, end).toString('latin1');
    switch (mimeType) {
      case 'image/jpeg':
        return b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
      case 'image/png':
        return b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
      case 'image/gif':
        return ascii(0, 6) === 'GIF87a' || ascii(0, 6) === 'GIF89a';
      case 'image/webp':
        return ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP';
      default:
        return false;
    }
  } finally {
    await fh.close();
  }
}

/** Static file serving for /uploads with nosniff and a 7-day cache. */
export function staticUploads(config) {
  return express.static(config.uploadDir, {
    maxAge: '7d',
    index: false,
    dotfiles: 'deny',
    setHeaders: (res) => res.setHeader('X-Content-Type-Options', 'nosniff'),
  });
}
