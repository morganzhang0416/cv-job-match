import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Request, RequestHandler, Response } from 'express';
import type { RewriteResult } from '../src/analyze/types.ts';
import { AppError } from '../src/errors.ts';
import { rateLimit } from '../src/http/rate-limit.ts';
import type { Rewriter } from '../src/rewrites.ts';
import { failure, JOB, makeForm, ok, postForm, postJson, rawRequest, RESUME } from './helpers/api.ts';
import { startServer, type TestServer } from './helpers/server.ts';

async function withServer(options: Parameters<typeof startServer>[0], run: (server: TestServer) => Promise<void>): Promise<void> {
  const server = await startServer(options);
  try {
    await run(server);
  } finally {
    await server.close();
  }
}

const sample = { jobDescription: JOB, resumeText: RESUME };

describe('security headers', () => {
  it('sends strict headers on API answers and on pages', async () => {
    await withServer({}, async (server) => {
      for (const path of ['/api/health', '/api/nothing', '/nothing-here']) {
        const { headers } = await fetch(server.url + path);
        const csp = headers.get('content-security-policy') ?? '';
        assert.match(csp, /default-src 'none'/, path);
        assert.match(csp, /script-src 'self'(;|$)/, path);
        assert.match(csp, /style-src 'self'(;|$)/, path);
        assert.match(csp, /frame-ancestors 'none'/, path);
        assert.ok(!/unsafe-inline|unsafe-eval|\*/.test(csp), `${path}: ${csp}`);
        assert.equal(headers.get('x-content-type-options'), 'nosniff');
        assert.equal(headers.get('referrer-policy'), 'no-referrer');
        assert.equal(headers.get('x-frame-options'), 'DENY');
        assert.equal(headers.get('x-powered-by'), null);
      }
    });
  });

  it('does not let the browser or a proxy keep API answers', async () => {
    await withServer({}, async (server) => {
      const answers = [
        await fetch(`${server.url}/api/health`),
        await fetch(`${server.url}/api/config`),
        await fetch(`${server.url}/api/nothing`),
        await postJson(server.url, sample),
        await postJson(server.url, {}),
      ];
      for (const answer of answers) assert.equal(answer.headers.get('cache-control'), 'no-store');
    });
  });

  it('sends no CORS headers, so other web sites cannot read the answers', async () => {
    await withServer({}, async (server) => {
      const get = await fetch(`${server.url}/api/health`, { headers: { origin: 'http://evil.example' } });
      assert.equal(get.headers.get('access-control-allow-origin'), null);
      const preflight = await fetch(`${server.url}/api/analyze`, {
        method: 'OPTIONS',
        headers: { origin: 'http://evil.example', 'access-control-request-method': 'POST' },
      });
      assert.equal(preflight.headers.get('access-control-allow-origin'), null);
      assert.equal(preflight.status, 405);
    });
  });
});

describe('host name check (DNS rebinding)', () => {
  const get = (server: TestServer, host: string): Promise<{ status: number; body: string }> =>
    rawRequest(server.url, { path: '/api/health', headers: { host } });

  it('answers requests that name this computer', async () => {
    await withServer({}, async (server) => {
      for (const host of ['localhost:3000', '127.0.0.1:3000', '[::1]:3000', 'LOCALHOST', '127.0.0.1']) {
        assert.equal((await get(server, host)).status, 200, host);
      }
    });
  });

  it('refuses a request that names another host', async () => {
    await withServer({}, async (server) => {
      for (const host of ['evil.example', 'evil.example:3000', 'localhost.evil.example', '127.0.0.1.evil.example', '10.0.0.5:3000']) {
        const response = await get(server, host);
        assert.equal(response.status, 403, host);
        assert.equal((JSON.parse(response.body) as { error: { code: string } }).error.code, 'bad_host');
      }
    });
  });

  it('checks pages too, not only the API', async () => {
    await withServer({}, async (server) => {
      const response = await rawRequest(server.url, { path: '/', headers: { host: 'evil.example' } });
      assert.equal(response.status, 403);
    });
  });

  it('does not check the host name when the tool listens on the network', async () => {
    await withServer({ config: { host: '0.0.0.0' } }, async (server) => {
      assert.equal((await get(server, 'tools.example.com')).status, 200);
    });
  });

  it('does not check the host name behind a trusted proxy', async () => {
    await withServer({ config: { trustProxy: true } }, async (server) => {
      assert.equal((await get(server, 'tools.example.com')).status, 200);
    });
  });
});

describe('origin check (other web sites)', () => {
  const spy = (): { rewriter: Rewriter; calls: () => number } => {
    let calls = 0;
    const result: RewriteResult = { mode: 'offline', model: null, notice: null, items: [] };
    return {
      rewriter: {
        rewrite: () => {
          calls += 1;
          return Promise.resolve(result);
        },
      },
      calls: () => calls,
    };
  };

  it('refuses a post from a page on another site, and does not run it', async () => {
    const { rewriter, calls } = spy();
    await withServer({ rewriter }, async (server) => {
      const own = new URL(server.url);
      for (const origin of ['http://evil.example', 'https://evil.example:3000', 'null', 'not a url', `http://localhost:${own.port}`]) {
        const error = await failure(await postJson(server.url, sample, { origin }), 403);
        assert.equal(error.code, 'cross_origin', origin);
      }
      const form = makeForm({ jobDescription: JOB, resumeText: RESUME, useAi: 'true' });
      assert.equal((await failure(await postForm(server.url, form, { origin: 'http://evil.example' }), 403)).code, 'cross_origin');
      assert.equal(calls(), 0);
    });
  });

  it('accepts a post from its own page, and from tools that send no Origin', async () => {
    const { rewriter, calls } = spy();
    await withServer({ rewriter }, async (server) => {
      await ok(await postJson(server.url, sample, { origin: server.url }));
      await ok(await postJson(server.url, sample));
      assert.equal(calls(), 2);
    });
  });

  it('lets other web sites make reads, because the answers carry no secrets and no CORS headers', async () => {
    await withServer({}, async (server) => {
      const response = await fetch(`${server.url}/api/config`, { headers: { origin: 'http://evil.example' } });
      assert.equal(response.status, 200);
    });
  });
});

describe('rate limit in the app', () => {
  it('stops an address that makes too many analyses, and starts again after the window', async () => {
    let clock = 1_000_000;
    await withServer({ rateLimit: { max: 2, windowMs: 60_000, now: () => clock } }, async (server) => {
      // These requests are invalid on purpose. A refused request counts too.
      for (let attempt = 0; attempt < 2; attempt += 1) {
        assert.equal((await failure(await postJson(server.url, {}), 400)).code, 'job_too_short');
      }
      const blocked = await postJson(server.url, {});
      assert.equal(blocked.headers.get('retry-after'), '60');
      const error = await failure(blocked, 429);
      assert.equal(error.code, 'rate_limited');
      assert.match(error.message, /60 seconds/);

      assert.equal((await fetch(`${server.url}/api/health`)).status, 200);
      assert.equal((await fetch(`${server.url}/api/config`)).status, 200);

      clock += 45_000;
      assert.equal((await postJson(server.url, {})).headers.get('retry-after'), '15');

      clock += 15_000;
      assert.equal((await failure(await postJson(server.url, {}), 400)).code, 'job_too_short');
    });
  });

  it('ignores X-Forwarded-For when no proxy is trusted', async () => {
    await withServer({ rateLimit: { max: 1, windowMs: 60_000 } }, async (server) => {
      assert.equal((await postJson(server.url, {}, { 'x-forwarded-for': '10.0.0.1' })).status, 400);
      assert.equal((await postJson(server.url, {}, { 'x-forwarded-for': '10.0.0.2' })).status, 429);
    });
  });

  it('counts each client behind a trusted proxy, and cannot be fooled by a forged first address', async () => {
    await withServer({ config: { trustProxy: true }, rateLimit: { max: 1, windowMs: 60_000 } }, async (server) => {
      assert.equal((await postJson(server.url, {}, { 'x-forwarded-for': '10.0.0.1' })).status, 400);
      assert.equal((await postJson(server.url, {}, { 'x-forwarded-for': '10.0.0.2' })).status, 400);
      // The proxy adds the real address at the end. The first value is what the client claims.
      assert.equal((await postJson(server.url, {}, { 'x-forwarded-for': '9.9.9.9, 10.0.0.1' })).status, 429);
    });
  });
});

describe('rateLimit (the middleware alone)', () => {
  function caller(handler: RequestHandler): (address: string) => { allowed: boolean; error: AppError | null; retryAfter: string | null } {
    return (address) => {
      let retryAfter: string | null = null;
      let outcome: unknown = 'next was not called';
      const request = { ip: address, socket: { remoteAddress: address } } as unknown as Request;
      const response = {
        set(name: string, value: string) {
          if (name === 'Retry-After') retryAfter = value;
          return response;
        },
      } as unknown as Response;
      handler(request, response, (error?: unknown) => {
        outcome = error;
      });
      assert.notEqual(outcome, 'next was not called');
      return { allowed: outcome === undefined, error: outcome instanceof AppError ? outcome : null, retryAfter };
    };
  }

  it('allows the limit in each window and refuses the rest with a 429', () => {
    let clock = 0;
    const hit = caller(rateLimit({ max: 3, windowMs: 10_000, now: () => clock }));
    assert.deepEqual([hit('a').allowed, hit('a').allowed, hit('a').allowed], [true, true, true]);
    const refused = hit('a');
    assert.equal(refused.allowed, false);
    assert.equal(refused.error?.status, 429);
    assert.equal(refused.error?.code, 'rate_limited');
    assert.equal(refused.retryAfter, '10');
  });

  it('counts each address on its own', () => {
    const hit = caller(rateLimit({ max: 1, windowMs: 10_000, now: () => 0 }));
    assert.equal(hit('a').allowed, true);
    assert.equal(hit('b').allowed, true);
    assert.equal(hit('a').allowed, false);
    assert.equal(hit('b').allowed, false);
  });

  it('starts a new window when the old one is over, and rounds the wait up', () => {
    let clock = 0;
    const hit = caller(rateLimit({ max: 1, windowMs: 10_000, now: () => clock }));
    assert.equal(hit('a').allowed, true);
    clock = 9_001;
    assert.equal(hit('a').retryAfter, '1');
    clock = 10_000;
    assert.equal(hit('a').allowed, true);
  });

  it('forgets the oldest address when it tracks 10,000 addresses', () => {
    const hit = caller(rateLimit({ max: 1, windowMs: 600_000, now: () => 0 }));
    assert.equal(hit('first').allowed, true);
    assert.equal(hit('first').allowed, false);
    for (let index = 0; index < 10_000; index += 1) assert.equal(hit(`address-${index}`).allowed, true);
    assert.equal(hit('first').allowed, true);
    // A recent address is still remembered.
    assert.equal(hit('address-9999').allowed, false);
  });
});

describe('errors and logs', () => {
  it('answers an unexpected error with a fixed message, and logs only the error type', async () => {
    const broken: Rewriter = {
      rewrite: () => Promise.reject(new Error('SECRET-RESUME-TEXT')),
    };
    await withServer({ rewriter: broken }, async (server) => {
      const response = await postJson(server.url, sample);
      const error = await failure(response, 500);
      assert.equal(error.code, 'server_error');
      assert.ok(!JSON.stringify(error).includes('SECRET'));
      assert.deepEqual(
        server.logs.map((line) => line.replace(/\d+ms$/, 'Nms')),
        ['POST /api/analyze failed with an unexpected error: Error', 'POST /api/analyze 500 Nms'],
      );
    });
  });

  it('logs the method, the path, the status and the time, and nothing from the request', async () => {
    await withServer({}, async (server) => {
      await ok(await postForm(server.url, makeForm({ jobDescription: JOB }, { data: Buffer.from(RESUME), name: 'Alex-Taylor-CV.txt' })));
      await failure(await postJson(server.url, {}), 400);
      await fetch(`${server.url}/api/health`);
      assert.equal(server.logs.length, 3);
      for (const line of server.logs) assert.match(line, /^(GET|POST) \/api\/[a-z]+ \d{3} \d+ms$/);
      const all = server.logs.join('\n');
      assert.ok(!/alex|taylor|kauri|typescript/i.test(all));
    });
  });
});
