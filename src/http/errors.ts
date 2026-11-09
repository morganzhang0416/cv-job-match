import type { ErrorRequestHandler, RequestHandler } from 'express';
import type { ApiErrorBody } from '../analyze/types.ts';
import { AppError } from '../errors.ts';

export const apiNotFound: RequestHandler = (_req, _res, next) => {
  next(new AppError(404, 'not_found', 'There is no such API address.'));
};

export function methodNotAllowed(allow: string): RequestHandler {
  return (_req, res, next) => {
    res.set('Allow', allow);
    next(new AppError(405, 'method_not_allowed', `Use ${allow} for this address.`));
  };
}

function clientErrorStatus(error: unknown): number | null {
  if (typeof error !== 'object' || error === null) return null;
  const status = 'status' in error ? error.status : undefined;
  return typeof status === 'number' && status >= 400 && status < 500 ? status : null;
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'unknown error';
}

/**
 * Sends every error as JSON: { error: { code, message } }.
 * For an unexpected error, the log gets the error type only, because its message could quote the resume.
 */
export function errorHandler(log: (line: string) => void): ErrorRequestHandler {
  return (error: unknown, req, res, next) => {
    if (res.headersSent) {
      next(error);
      return;
    }
    let known: AppError;
    const clientStatus = clientErrorStatus(error);
    if (error instanceof AppError) {
      known = error;
    } else if (clientStatus !== null) {
      known = new AppError(clientStatus, 'bad_request', 'The request could not be read.');
    } else {
      log(`${req.method} ${req.path} failed with an unexpected error: ${errorName(error)}`);
      known = new AppError(500, 'server_error', 'Something went wrong on the server. Try again.');
    }
    const body: ApiErrorBody = { error: { code: known.code, message: known.message } };
    res.status(known.status).json(body);
  };
}
