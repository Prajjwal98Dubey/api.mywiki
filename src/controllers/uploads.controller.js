import fs from 'node:fs/promises';
import { HttpError, badRequest } from '../lib/errors.js';
import { hasValidMagicBytes } from '../middleware/upload.js';

export function createUploadsController() {
  return {
    async image(req, res) {
      const file = req.file;
      if (!file) {
        throw badRequest('No image was uploaded (expected multipart field "image")', [
          { path: 'image', message: 'Required' },
        ]);
      }
      let valid = false;
      try {
        valid = await hasValidMagicBytes(file.path, file.mimetype);
      } finally {
        if (!valid) await fs.rm(file.path, { force: true });
      }
      if (!valid) {
        throw new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'The file content is not a valid JPEG, PNG, WebP or GIF image');
      }
      res.status(201).json({
        url: `/uploads/${file.filename}`,
        filename: file.filename,
        size: file.size,
        mimeType: file.mimetype,
      });
    },
  };
}
