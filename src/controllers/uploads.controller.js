import { HttpError, badRequest } from '../lib/errors.js';
import { detectImage, InvalidImageError } from '../images/detectImage.js';

export function createUploadsController({ imageStore }) {
  return {
    /** POST /api/uploads/image → 201 { url, filename, size, mimeType, width, height } */
    async image(req, res) {
      const file = req.file;
      if (!file) {
        throw badRequest('No image was uploaded (expected multipart field "image")', [
          { path: 'image', message: 'Required' },
        ]);
      }

      // The strict gate: only exactly-one JPEG/PNG/WebP/GIF image gets past this line.
      let image;
      try {
        image = { buffer: file.buffer, ...detectImage(file.buffer) };
      } catch (err) {
        if (err instanceof InvalidImageError) throw new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', err.message);
        throw err;
      }

      let filename;
      try {
        ({ filename } = await imageStore.save(image));
      } catch (err) {
        console.error(`[images] storing upload failed (${imageStore.driver}):`, err?.name, err?.message);
        throw new HttpError(500, 'INTERNAL', 'Could not store the image. Please try again.');
      }

      res.status(201).json({
        url: `/uploads/${filename}`,
        filename,
        size: image.buffer.length,
        mimeType: image.mimeType, // the verified type, not what the client claimed
        width: image.width,
        height: image.height,
      });
    },
  };
}
