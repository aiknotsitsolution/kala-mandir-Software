/** Expected, user-facing API errors + async wrapper. */

export class ApiError extends Error {
  constructor(status, message, code) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export const badRequest = (message, code = "bad_request") => new ApiError(400, message, code);
export const unauthorized = (message = "Authentication required", code = "unauthorized") =>
  new ApiError(401, message, code);
export const forbidden = (message = "You do not have permission to perform this action", code = "forbidden") =>
  new ApiError(403, message, code);
export const notFound = (message = "Not found", code = "not_found") => new ApiError(404, message, code);
export const conflict = (message, code = "conflict") => new ApiError(409, message, code);

/** Wrap an async express handler so thrown/rejected errors reach next(). */
export function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}
