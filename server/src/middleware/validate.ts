import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { ZodType } from 'zod';
import { setRequestQuery } from './sanitize.js';

interface RequestSchemas {
  body?: ZodType;
  params?: ZodType;
  query?: ZodType;
}

/** Parses each part of the request and replaces it with the validated, stripped result. */
export function validate(schemas: RequestSchemas): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (schemas.params) req.params = schemas.params.parse(req.params) as Request['params'];
    if (schemas.query) setRequestQuery(req, schemas.query.parse(req.query));
    if (schemas.body) req.body = schemas.body.parse(req.body);
    next();
  };
}
