import multer from 'multer';
import { HttpError } from '../lib/errors.js';

const send = (res, status, code, message, details) => {
  const error = { code, message };
  if (details !== undefined) error.details = details;
  res.status(status).json({ error });
};

/** Maps every error to the spec §7.1 shape. */
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  if (res.headersSent) return req.socket.destroy();

  if (err instanceof HttpError) return send(res, err.status, err.code, err.message, err.details);

  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') return send(res, 413, 'PAYLOAD_TOO_LARGE', 'The file is too large');
    return send(res, 400, 'VALIDATION_ERROR', `Upload error: ${err.message}`, err.field ? [{ path: err.field, message: err.message }] : undefined);
  }

  // body-parser errors
  if (err.type === 'entity.parse.failed') return send(res, 400, 'VALIDATION_ERROR', 'Malformed JSON body');
  if (err.type === 'entity.too.large') return send(res, 413, 'PAYLOAD_TOO_LARGE', 'The request body is too large');
  if (err.type === 'encoding.unsupported' || err.type === 'charset.unsupported') {
    return send(res, 415, 'UNSUPPORTED_MEDIA_TYPE', err.message);
  }
  if (typeof err.status === 'number' && err.status >= 400 && err.status < 500) {
    return send(res, err.status, 'VALIDATION_ERROR', err.expose ? err.message : 'Bad request');
  }

  console.error('[error]', req.method, req.originalUrl, err);
  send(res, 500, 'INTERNAL', 'Something went wrong on our side');
}

export function notFoundHandler(req, _res, next) {
  next(new HttpError(404, 'NOT_FOUND', `No route for ${req.method} ${req.path}`));
}
