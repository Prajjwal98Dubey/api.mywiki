// npm run migrate:uploads-to-s3
//
// Copies the images in UPLOAD_DIR (local disk) to the S3 bucket from .env, keeping their
// file names, so every `/uploads/<file>` URL already stored in pages keeps working after
// switching to IMAGE_STORAGE=s3. Each file goes through the same strict image check as
// new uploads; anything that fails it is reported and NOT copied. Safe to re-run: files
// already in the bucket are skipped. Local files are never deleted.

import fs from 'node:fs/promises';
import path from 'node:path';
import { loadConfig } from '../src/config/env.js';
import { createImageStore, FILENAME_PATTERN } from '../src/images/imageStore.js';
import { detectImage, InvalidImageError } from '../src/images/detectImage.js';

const config = loadConfig({ ...process.env, IMAGE_STORAGE: 's3' });
const s3 = createImageStore(config);
await s3.verify();

let files = [];
try {
  files = (await fs.readdir(config.uploadDir)).sort();
} catch (err) {
  if (err.code !== 'ENOENT') throw err;
}
console.log(`Copying ${config.uploadDir} → s3://${config.s3.bucket}/${config.s3.prefix} (${files.length} files)`);

const counts = { copied: 0, present: 0, rejected: 0, ignored: 0 };
for (const name of files) {
  if (!FILENAME_PATTERN.test(name)) {
    counts.ignored++;
    console.log(`  - ${name}: not an upload file name, ignored`);
    continue;
  }
  if (await s3.exists(name)) {
    counts.present++;
    continue;
  }
  const buffer = await fs.readFile(path.join(config.uploadDir, name));
  let info;
  try {
    info = detectImage(buffer);
  } catch (err) {
    if (!(err instanceof InvalidImageError)) throw err;
    counts.rejected++;
    console.log(`  ! ${name}: rejected (${err.message})`);
    continue;
  }
  if (info.ext !== path.extname(name)) {
    counts.rejected++;
    console.log(`  ! ${name}: rejected (content is ${info.mimeType}, name says ${path.extname(name)})`);
    continue;
  }
  await s3.put(name, { buffer, ...info });
  counts.copied++;
  console.log(`  + ${name} (${info.mimeType}, ${info.width}×${info.height}, ${buffer.length} bytes)`);
}

console.log(
  `Done: ${counts.copied} copied, ${counts.present} already in S3, ${counts.rejected} rejected, ${counts.ignored} ignored.`,
);
if (counts.rejected) process.exitCode = 1;
