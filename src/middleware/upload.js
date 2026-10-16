import multer from 'multer';
import { HttpError } from '../lib/errors.js';
import { IMAGE_TYPES } from '../images/detectImage.js';

/**
 * Multipart parsing for POST /api/uploads/image (field "image", one file).
 * The file is kept in memory (≤ MAX_UPLOAD_MB) so nothing is written anywhere until
 * detectImage() has verified the bytes. The declared type is only a first, cheap filter
 * that rejects videos/documents early; the bytes decide what actually gets stored.
 */
export function createImageUpload(config) {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: config.maxUploadBytes, files: 1, fields: 5, parts: 10 },
    fileFilter: (_req, file, cb) => {
      if (IMAGE_TYPES[file.mimetype]) return cb(null, true);
      cb(new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Only JPEG, PNG, WebP and GIF images are allowed'));
    },
  }).single('image');
}
