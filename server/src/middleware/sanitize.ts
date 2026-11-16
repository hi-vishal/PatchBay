import type { NextFunction, Request, Response } from 'express';

/** Removes keys MongoDB would treat as operators or path traversal, at any depth. */
export function stripMongoOperators<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => stripMongoOperators(item)) as T;
  if (value === null || typeof value !== 'object') return value;

  const clean: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (key.startsWith('$') || key.includes('.')) continue;
    clean[key] = stripMongoOperators(item);
  }
  return clean as T;
}

/**
 * Express 5 exposes req.query through a getter that re-parses on every read, which breaks
 * express-mongo-sanitize. Redefining the property keeps one sanitized value per request.
 */
export function setRequestQuery(req: Request, query: unknown): void {
  Object.defineProperty(req, 'query', {
    value: query,
    writable: true,
    configurable: true,
    enumerable: true,
  });
}

export function sanitizeRequest(req: Request, _res: Response, next: NextFunction): void {
  if (req.body) req.body = stripMongoOperators(req.body);
  req.params = stripMongoOperators(req.params);
  setRequestQuery(req, stripMongoOperators(req.query));
  next();
}
