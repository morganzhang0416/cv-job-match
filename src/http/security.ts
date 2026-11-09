import type { RequestHandler } from 'express';
import { isLocalHost } from '../config.ts';
import { AppError } from '../errors.ts';

// The page loads only its own files. It has no inline script or style, so nothing a resume says can run as code.
const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self'",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

export const securityHeaders: RequestHandler = (_req, res, next) => {
  res.set({
    'Content-Security-Policy': CONTENT_SECURITY_POLICY,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  });
  next();
};

/** Resumes and AI answers must never be cached by the browser or a proxy. */
export const noStore: RequestHandler = (_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
};

/**
 * Blocks "DNS rebinding": a web site that points its own name at this computer to talk to the tool.
 * When the server listens only on this computer, the Host header must name this computer.
 */
export const localHostOnly: RequestHandler = (req, _res, next) => {
  const name = req.hostname;
  if (name !== undefined && isLocalHost(name)) {
    next();
    return;
  }
  next(new AppError(403, 'bad_host', 'This tool only answers requests to localhost.'));
};

const READ_ONLY_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Blocks a web page on another site that tries to post to this tool, for example to use the AI key.
 * Browsers always send an Origin header on such a request. Tools like curl send none, so they pass.
 */
export const sameOriginOnly: RequestHandler = (req, _res, next) => {
  const origin = req.get('origin');
  if (origin === undefined || READ_ONLY_METHODS.has(req.method)) {
    next();
    return;
  }
  let originHost: string | null = null;
  try {
    originHost = new URL(origin).host;
  } catch {
    // "null" and other values that are not web addresses fail the check below.
  }
  if (originHost !== null && originHost === req.host) {
    next();
    return;
  }
  next(new AppError(403, 'cross_origin', 'This request came from another web site, so I did not run it.'));
};
