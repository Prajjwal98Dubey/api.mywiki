// Strict image check (spec §7.5, §9). Decides from the file's bytes alone — never from the
// client's filename or Content-Type — whether a buffer is exactly one JPEG, PNG, GIF or WebP
// image and nothing else. Anything else (video, documents, SVG, HTML, archives, truncated
// files, images with other data appended such as "motion photo" videos) is rejected.

/** The only formats that are ever stored. Extension is chosen from here, never from the user. */
export const IMAGE_TYPES = Object.freeze({
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
});
export const IMAGE_EXTENSIONS = Object.freeze(Object.fromEntries(Object.entries(IMAGE_TYPES).map(([m, e]) => [e, m])));

export const MAX_DIMENSION = 10_000; // px per side
export const MAX_PIXELS = 40_000_000; // decompression-bomb guard (~40 MP)

export class InvalidImageError extends Error {
  constructor(message) {
    super(message);
    this.name = 'InvalidImageError';
  }
}

const fail = (message) => {
  throw new InvalidImageError(message);
};
const ascii = (buf, start, end) => buf.toString('latin1', start, end);

// ---- JPEG ---------------------------------------------------------------------------

function parseJpeg(buf) {
  // SOI, then marker segments up to SOS; dimensions come from a SOFn segment.
  let pos = 2;
  let size = null;
  while (pos + 4 <= buf.length) {
    if (buf[pos] !== 0xff) fail('Corrupt JPEG (bad marker)');
    const marker = buf[pos + 1];
    if (marker === 0xff) {
      pos += 1; // fill byte
      continue;
    }
    if (marker === 0xd9) fail('Corrupt JPEG (no image data)');
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      pos += 2; // standalone markers
      continue;
    }
    const length = buf.readUInt16BE(pos + 2);
    if (length < 2 || pos + 2 + length > buf.length) fail('Corrupt JPEG (truncated segment)');
    // SOF0–SOF15 except DHT (C4), JPG (C8) and DAC (CC)
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      if (length < 7) fail('Corrupt JPEG (bad frame header)');
      size = { height: buf.readUInt16BE(pos + 5), width: buf.readUInt16BE(pos + 7) };
    }
    if (marker === 0xda) break; // SOS: entropy-coded data follows
    pos += 2 + length;
  }
  if (!size) fail('Corrupt JPEG (no frame header)');
  // Must end with EOI (FF D9). Trailing zero padding is tolerated; anything else
  // (e.g. an MP4 appended by a phone's "motion photo") is not an image and is refused.
  let end = buf.length;
  while (end > 0 && buf[end - 1] === 0x00) end--;
  if (end < 2 || buf[end - 2] !== 0xff || buf[end - 1] !== 0xd9) {
    fail('The JPEG has extra non-image data after the image (for example an embedded video)');
  }
  return size;
}

// ---- PNG ----------------------------------------------------------------------------

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function parsePng(buf) {
  // Walk every chunk: IHDR first, IEND last, nothing after IEND.
  let pos = 8;
  let size = null;
  let sawIend = false;
  let first = true;
  while (pos < buf.length) {
    if (pos + 12 > buf.length) fail('Corrupt PNG (truncated chunk)');
    const length = buf.readUInt32BE(pos);
    const type = ascii(buf, pos + 4, pos + 8);
    if (!/^[A-Za-z]{4}$/.test(type)) fail('Corrupt PNG (bad chunk type)');
    if (pos + 12 + length > buf.length) fail('Corrupt PNG (truncated chunk)');
    if (first) {
      if (type !== 'IHDR' || length !== 13) fail('Corrupt PNG (missing IHDR)');
      size = { width: buf.readUInt32BE(pos + 8), height: buf.readUInt32BE(pos + 12) };
      first = false;
    }
    pos += 12 + length;
    if (type === 'IEND') {
      sawIend = true;
      break;
    }
  }
  if (!sawIend) fail('Corrupt PNG (missing IEND)');
  if (pos !== buf.length) fail('The PNG has extra non-image data after the image');
  return size;
}

// ---- GIF ----------------------------------------------------------------------------

function parseGif(buf) {
  if (buf.length < 14) fail('Corrupt GIF (truncated)');
  if (buf[buf.length - 1] !== 0x3b) fail('The GIF has extra data after the image, or is truncated');
  return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
}

// ---- WebP ---------------------------------------------------------------------------

function parseWebp(buf) {
  if (buf.length < 30) fail('Corrupt WebP (truncated)');
  // RIFF size covers everything after the first 8 bytes; it must match the file exactly.
  const riffSize = buf.readUInt32LE(4);
  if (riffSize + 8 !== buf.length && riffSize + 9 !== buf.length) {
    fail('The WebP has extra data after the image, or is truncated');
  }
  const chunk = ascii(buf, 12, 16);
  if (chunk === 'VP8 ') {
    if (buf[23] !== 0x9d || buf[24] !== 0x01 || buf[25] !== 0x2a) fail('Corrupt WebP (bad VP8 header)');
    return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
  }
  if (chunk === 'VP8L') {
    if (buf[20] !== 0x2f) fail('Corrupt WebP (bad VP8L header)');
    const bits = buf.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (chunk === 'VP8X') {
    return { width: buf.readUIntLE(24, 3) + 1, height: buf.readUIntLE(27, 3) + 1 };
  }
  return fail('Corrupt WebP (unknown bitstream)');
}

// ---- entry point ----------------------------------------------------------------------

/**
 * → { mimeType, ext, width, height } when `buf` is exactly one valid JPEG/PNG/GIF/WebP image;
 * throws InvalidImageError otherwise.
 */
export function detectImage(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) fail('The file is empty or too small to be an image');

  let mimeType;
  let size;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    mimeType = 'image/jpeg';
    size = parseJpeg(buf);
  } else if (buf.subarray(0, 8).equals(PNG_SIGNATURE)) {
    mimeType = 'image/png';
    size = parsePng(buf);
  } else if (ascii(buf, 0, 6) === 'GIF87a' || ascii(buf, 0, 6) === 'GIF89a') {
    mimeType = 'image/gif';
    size = parseGif(buf);
  } else if (ascii(buf, 0, 4) === 'RIFF' && ascii(buf, 8, 12) === 'WEBP') {
    mimeType = 'image/webp';
    size = parseWebp(buf);
  } else {
    fail('Only JPEG, PNG, WebP and GIF images are allowed');
  }

  const { width, height } = size;
  if (!width || !height) fail('The image has no width or height');
  if (width > MAX_DIMENSION || height > MAX_DIMENSION || width * height > MAX_PIXELS) {
    fail(`The image is too large (max ${MAX_DIMENSION}×${MAX_DIMENSION} px, ${MAX_PIXELS / 1e6} megapixels)`);
  }
  return { mimeType, ext: IMAGE_TYPES[mimeType], width, height };
}
