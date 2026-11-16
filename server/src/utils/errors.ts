export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new AppError(400, 'BAD_REQUEST', message, details);

export const unauthorized = (message = 'Authentication required') =>
  new AppError(401, 'UNAUTHORIZED', message);

export const forbidden = (message = 'You do not have access to this resource') =>
  new AppError(403, 'FORBIDDEN', message);

export const notFound = (resource = 'Resource') =>
  new AppError(404, 'NOT_FOUND', `${resource} not found`);

export const conflict = (message: string) => new AppError(409, 'CONFLICT', message);

export const serviceUnavailable = (code: string, message: string) =>
  new AppError(503, code, message);

/** Reduces an unknown thrown value to a message that is safe to store and show. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
