import type { NextFunction, Request, Response } from 'express';
import mongoose from 'mongoose';
import { ZodError } from 'zod';
import { AppError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    error: { code: 'NOT_FOUND', message: `No route for ${req.method} ${req.path}` },
  });
}

function toAppError(error: unknown): AppError | undefined {
  if (error instanceof AppError) return error;
  if (error instanceof ZodError) {
    return new AppError(400, 'VALIDATION_ERROR', 'Invalid request', error.issues);
  }
  if (error instanceof mongoose.Error.CastError) {
    return new AppError(400, 'BAD_REQUEST', `Invalid value for ${error.path}`);
  }
  if (error instanceof mongoose.Error.ValidationError) {
    const fields = Object.values(error.errors).map((item) => ({
      path: item.path,
      message: item.message,
    }));
    return new AppError(400, 'VALIDATION_ERROR', 'Invalid data', fields);
  }
  if (error instanceof Error && (error as { code?: unknown }).code === 11000) {
    return new AppError(409, 'CONFLICT', 'That record already exists');
  }
  if (error instanceof SyntaxError && 'body' in error) {
    return new AppError(400, 'BAD_REQUEST', 'Malformed JSON body');
  }
  const status = (error as { status?: unknown } | null)?.status;
  if (error instanceof Error && status === 413) {
    return new AppError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large');
  }
  return undefined;
}

// Express identifies error middleware by its four parameters.
export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (res.headersSent) {
    next(error);
    return;
  }
  const known = toAppError(error);
  if (known) {
    res.status(known.status).json({
      error: { code: known.code, message: known.message, details: known.details },
    });
    return;
  }
  logger.error({ err: error, method: req.method, path: req.path }, 'Unhandled request error');
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' } });
}
