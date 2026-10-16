// Hand-built test files. Images are minimal but structurally valid; the others are the
// kinds of files the upload endpoint must refuse.

const u16be = (n) => Buffer.from([(n >> 8) & 0xff, n & 0xff]);
const u32le = (n) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n);
  return b;
};

/** 1×1 PNG (real, decodable). */
export const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

/** 1×1 GIF (real, decodable). */
export const GIF = Buffer.from('R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==', 'base64');

/** Baseline JPEG skeleton: SOI, APP0, SOF0 (w×h), SOS, scan bytes, EOI. */
export function jpeg(width = 640, height = 480) {
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    Buffer.from([0xff, 0xe0, 0x00, 0x10]), Buffer.from('JFIF\0', 'latin1'), Buffer.from([1, 1, 0, 0, 1, 0, 1, 0, 0]),
    Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08]), u16be(height), u16be(width),
    Buffer.from([0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01]),
    Buffer.from([0xff, 0xda, 0x00, 0x0c, 0x03, 0x01, 0x00, 0x02, 0x11, 0x03, 0x11, 0x00, 0x3f, 0x00]),
    Buffer.from([0x12, 0x34, 0x56, 0x78, 0x9a]),
    Buffer.from([0xff, 0xd9]),
  ]);
}
export const JPEG = jpeg();

function riff(chunks) {
  const body = Buffer.concat([Buffer.from('WEBP', 'latin1'), ...chunks]);
  return Buffer.concat([Buffer.from('RIFF', 'latin1'), u32le(body.length), body]);
}
/** Lossless WebP header (VP8L). */
export function webpLossless(width = 300, height = 200) {
  const bits = (width - 1) | ((height - 1) << 14);
  const payload = Buffer.concat([Buffer.from([0x2f]), u32le(bits), Buffer.alloc(5)]);
  return riff([Buffer.from('VP8L', 'latin1'), u32le(payload.length), payload]);
}
/** Lossy WebP header (VP8). */
export function webpLossy(width = 320, height = 240) {
  const payload = Buffer.concat([
    Buffer.from([0x30, 0x01, 0x00, 0x9d, 0x01, 0x2a]),
    Buffer.from([width & 0xff, width >> 8, height & 0xff, height >> 8]),
    Buffer.alloc(8),
  ]);
  return riff([Buffer.from('VP8 ', 'latin1'), u32le(payload.length), payload]);
}
/** Extended WebP header (VP8X). */
export function webpExtended(width = 1000, height = 800) {
  const payload = Buffer.alloc(10);
  payload.writeUIntLE(width - 1, 4, 3);
  payload.writeUIntLE(height - 1, 7, 3);
  return riff([Buffer.from('VP8X', 'latin1'), u32le(payload.length), payload]);
}

/** PNG whose IHDR claims the given size (rest of the file unchanged). */
export function pngWithSize(width, height) {
  const b = Buffer.from(PNG);
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  return b;
}

// ---- things that are not (only) images ----------------------------------------------------

export const MP4 = Buffer.concat([
  Buffer.from([0x00, 0x00, 0x00, 0x18]), Buffer.from('ftypmp42', 'latin1'), Buffer.alloc(12),
  Buffer.from([0x00, 0x00, 0x00, 0x08]), Buffer.from('mdat', 'latin1'),
]);
export const PDF = Buffer.from('%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\ntrailer << >>\n%%EOF\n', 'latin1');
export const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><rect width="10" height="10"/></svg>');
export const HTML = Buffer.from('<!doctype html><html><body><script>alert(1)</script></body></html>');
export const ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00]);
export const DOCX = Buffer.concat([ZIP, Buffer.from('word/document.xml', 'latin1')]);
export const WEBM = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0xf7, 0x81, 0x01, 0x42, 0xf2]);
export const TEXT = Buffer.from('just some text, not an image');

/** An image with something else glued on after its end ("motion photo", polyglot). */
export const JPEG_WITH_VIDEO = Buffer.concat([JPEG, MP4]);
export const PNG_WITH_ZIP = Buffer.concat([PNG, ZIP]);
export const GIF_WITH_HTML = Buffer.concat([GIF, HTML]);
export const WEBP_WITH_EXTRA = Buffer.concat([webpLossless(), MP4]);
export const TRUNCATED_PNG = PNG.subarray(0, PNG.length - 12);
export const TRUNCATED_JPEG = JPEG.subarray(0, JPEG.length - 2);
