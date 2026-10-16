export class HttpError extends Error {
  /**
   * @param {number} status
   * @param {string} code    one of the codes in spec §7.1
   * @param {string} message human readable
   * @param {unknown} [details]
   */
  constructor(status, code, message, details) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const PAGE_NOT_FOUND_MESSAGE = 'MyWiki does not have an article with this exact name.';

export const badRequest =(message, details) => new HttpError(400, 'VALIDATION_ERROR', message, details);
export const unauthenticated = (message = 'You must be logged in') =>
  new HttpError(401, 'UNAUTHENTICATED', message);
export const forbidden = (message = 'You do not have permission to do that') =>
  new HttpError(403, 'FORBIDDEN', message);
export const notFound = (message = 'Not found') => new HttpError(404, 'NOT_FOUND', message);
export const conflict = (code, message, details) => new HttpError(409, code, message, details);

/** Converts zod issues to the spec's `details` array: [{ path: "a.0.b", message }]. */
export function zodIssuesToDetails(issues, prefix = []) {
  return issues.map((issue) => ({
    path: [...prefix, ...issue.path].join('.'),
    message: issue.message,
  }));
}
