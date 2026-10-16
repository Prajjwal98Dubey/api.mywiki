import { badRequest, zodIssuesToDetails } from '../lib/errors.js';

/**
 * validate({ body, query, params }) — parses each part with zod.
 * Parsed values go to `req.valid.{body,query,params}`; `req.body` is also replaced.
 * (Express 5's `req.query` is read-only, hence `req.valid`.)
 */
export function validate(schemas) {
  return (req, _res, next) => {
    req.valid ??= {};
    for (const part of ['params', 'query', 'body']) {
      const schema = schemas[part];
      if (!schema) continue;
      const result = schema.safeParse(req[part]);
      if (!result.success) {
        const details = zodIssuesToDetails(result.error.issues);
        const first = details[0];
        const message = first ? (first.path ? `${first.path}: ${first.message}` : first.message) : 'Invalid request';
        return next(badRequest(message, details));
      }
      req.valid[part] = result.data;
      if (part === 'body') req.body = result.data;
    }
    next();
  };
}
