import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { detectImage, InvalidImageError } from '../src/images/detectImage.js';
import * as f from './imageFixtures.js';

describe('accepts exactly-one-image files', () => {
  const cases = [
    ['PNG', f.PNG, 'image/png', '.png', 1, 1],
    ['GIF', f.GIF, 'image/gif', '.gif', 1, 1],
    ['JPEG', f.jpeg(640, 480), 'image/jpeg', '.jpg', 640, 480],
    ['JPEG + zero padding', Buffer.concat([f.JPEG, Buffer.alloc(16)]), 'image/jpeg', '.jpg', 640, 480],
    ['WebP lossless', f.webpLossless(300, 200), 'image/webp', '.webp', 300, 200],
    ['WebP lossy', f.webpLossy(320, 240), 'image/webp', '.webp', 320, 240],
    ['WebP extended', f.webpExtended(1000, 800), 'image/webp', '.webp', 1000, 800],
  ];
  for (const [name, buf, mimeType, ext, width, height] of cases) {
    test(name, () => assert.deepEqual(detectImage(buf), { mimeType, ext, width, height }));
  }
});

describe('rejects everything else', () => {
  const cases = {
    'MP4 video': f.MP4,
    'WebM video': f.WEBM,
    'PDF document': f.PDF,
    'DOCX / ZIP': f.DOCX,
    'SVG (scriptable)': f.SVG,
    'HTML': f.HTML,
    'plain text': f.TEXT,
    'empty file': Buffer.alloc(0),
    'JPEG with an MP4 appended (motion photo)': f.JPEG_WITH_VIDEO,
    'PNG with a ZIP appended (polyglot)': f.PNG_WITH_ZIP,
    'GIF with HTML appended': f.GIF_WITH_HTML,
    'WebP with data after the RIFF container': f.WEBP_WITH_EXTRA,
    'truncated PNG': f.TRUNCATED_PNG,
    'truncated JPEG': f.TRUNCATED_JPEG,
    'zero-size image': f.pngWithSize(0, 10),
    'oversized image (bomb guard)': f.pngWithSize(20_000, 20_000),
    'too many pixels': f.pngWithSize(9000, 9000),
  };
  for (const [name, buf] of Object.entries(cases)) {
    test(name, () => assert.throws(() => detectImage(buf), InvalidImageError));
  }
});

test('error messages explain the refusal', () => {
  assert.throws(() => detectImage(f.MP4), /Only JPEG, PNG, WebP and GIF images are allowed/);
  assert.throws(() => detectImage(f.JPEG_WITH_VIDEO), /extra non-image data/);
  assert.throws(() => detectImage(f.pngWithSize(20_000, 20_000)), /too large/);
});
