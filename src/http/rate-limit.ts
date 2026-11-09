import type { RequestHandler } from 'express';
import { AppError } from '../errors.ts';

export interface RateLimitOptions {
  /** How many requests one address may make in each window. */
  max: number;
  windowMs: number;
  /** The clock. Tests replace it. */
  now?: () => number;
}

interface Window {
  resetAt: number;
  count: number;
}

// The table never grows past this size, even when many different addresses call.
const MAX_TRACKED_ADDRESSES = 10_000;

/** Counts requests per address in fixed time windows. It keeps the counts in memory and keeps nothing else. */
export function rateLimit(options: RateLimitOptions): RequestHandler {
  const now = options.now ?? Date.now;
  const windows = new Map<string, Window>();
  let nextSweep = now() + options.windowMs;

  return (req, res, next) => {
    const time = now();
    if (time >= nextSweep) {
      for (const [address, window] of windows) {
        if (window.resetAt <= time) windows.delete(address);
      }
      nextSweep = time + options.windowMs;
    }

    const address = req.ip ?? req.socket.remoteAddress ?? 'unknown';
    let window = windows.get(address);
    if (window === undefined || window.resetAt <= time) {
      if (window === undefined && windows.size >= MAX_TRACKED_ADDRESSES) {
        // A Map keeps the order of insertion, so the first key has the oldest window.
        const oldest = windows.keys().next();
        if (!oldest.done) windows.delete(oldest.value);
      }
      window = { resetAt: time + options.windowMs, count: 0 };
      windows.set(address, window);
    }

    window.count += 1;
    if (window.count > options.max) {
      const seconds = Math.max(1, Math.ceil((window.resetAt - time) / 1000));
      res.set('Retry-After', String(seconds));
      next(new AppError(429, 'rate_limited', `Too many requests. Try again in ${seconds} ${seconds === 1 ? 'second' : 'seconds'}.`));
      return;
    }
    next();
  };
}
