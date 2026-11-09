import path from 'node:path';
import express, { type Express } from 'express';
import { isLocalHost, toPublicConfig, type AppConfig } from './config.ts';
import { readBody } from './http/body.ts';
import { apiNotFound, errorHandler, methodNotAllowed } from './http/errors.ts';
import { readInput } from './http/input.ts';
import { rateLimit, type RateLimitOptions } from './http/rate-limit.ts';
import { localHostOnly, noStore, sameOriginOnly, securityHeaders } from './http/security.ts';
import { createRewriter, type Rewriter } from './rewrites.ts';
import { analyze } from './service.ts';

const PUBLIC_DIR = path.join(import.meta.dirname, '..', 'public');

/** One address may start 30 analyses in 10 minutes. */
export const DEFAULT_RATE_LIMIT: RateLimitOptions = { max: 30, windowMs: 10 * 60 * 1000 };

export interface AppOptions {
  config: AppConfig;
  /** Replaces the rewriter that is built from the config. Tests use this. */
  rewriter?: Rewriter;
  rateLimit?: RateLimitOptions;
  /** Receives one short line for each API request and each server error. It never gets resume or job text. */
  log?: (line: string) => void;
}

export function createApp(options: AppOptions): Express {
  const { config } = options;
  const log = options.log ?? ((line: string): void => console.log(line));
  const rewriter = options.rewriter ?? createRewriter(config.ai, { log });
  const limiter = rateLimit(options.rateLimit ?? DEFAULT_RATE_LIMIT);

  const app = express();
  app.disable('x-powered-by');
  // Trust one proxy hop at most, so a client cannot choose its own address with a forged header.
  app.set('trust proxy', config.trustProxy ? 1 : false);

  app.use(securityHeaders);
  if (isLocalHost(config.host) && !config.trustProxy) app.use(localHostOnly);

  app.use('/api', noStore, (req, res, next) => {
    const started = performance.now();
    res.on('finish', () => log(`${req.method} ${req.baseUrl}${req.path} ${res.statusCode} ${Math.round(performance.now() - started)}ms`));
    next();
  });
  app.use('/api', sameOriginOnly);

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.get('/api/config', (_req, res) => {
    res.json(toPublicConfig(config));
  });

  app.post('/api/analyze', limiter, readBody, async (req, res) => {
    const input = readInput(req.body, req.file);
    res.json(await analyze(input, rewriter));
  });
  app.all('/api/analyze', methodNotAllowed('POST'));

  app.use('/api', apiNotFound);

  app.use(express.static(PUBLIC_DIR, { dotfiles: 'ignore' }));
  app.use((_req, res) => {
    res.status(404).type('text/plain').send('Not found');
  });

  app.use(errorHandler(log));
  return app;
}
