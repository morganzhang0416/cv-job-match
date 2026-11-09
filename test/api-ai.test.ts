import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { failure, JOB, makeForm, ok, postForm, postJson, RESUME } from './helpers/api.ts';
import { completion, sendJson, sentData, startMockAi, unusedBaseUrl, type MockAi } from './helpers/mock-ai.ts';
import { startServer, type TestServer } from './helpers/server.ts';

const KEY = 'test-key-123';
const sample = { jobDescription: JOB, resumeText: RESUME };

type Behaviour = 'good' | 'garbage' | 'broken' | 'adds-a-number';
let behaviour: Behaviour = 'good';

/** The weak opener of a bullet becomes a verb that does not change the meaning. */
const improve = (text: string): string => text.replace(/^(Worked on|Helped with|Responsible for|Handled)\s+/i, 'Delivered ');

let ai: MockAi;
let server: TestServer;
before(async () => {
  ai = await startMockAi((request, response) => {
    if (behaviour === 'broken') return sendJson(response, 500, '{"error":"boom"}');
    if (behaviour === 'garbage') return sendJson(response, 200, completion('I am sorry, I cannot help with that.'));
    const { bullets } = sentData(request);
    const replies = bullets.map(({ id, text }) => ({ id, rewrite: behaviour === 'adds-a-number' ? `${text} and cut cloud costs by 73%` : improve(text) }));
    sendJson(response, 200, completion(JSON.stringify(replies)));
  });
  server = await startServer({ config: { ai: ai.config({ apiKey: KEY }) } });
});
after(async () => {
  await server.close();
  await ai.close();
});

const resetMock = (): void => {
  behaviour = 'good';
  ai.requests.length = 0;
  server.logs.length = 0;
};

describe('the AI service is set up', () => {
  it('shows the provider and model to the browser, but never the key', async () => {
    resetMock();
    const text = await (await fetch(`${server.url}/api/config`)).text();
    const config = JSON.parse(text) as Record<string, unknown>;
    assert.equal(config.aiAvailable, true);
    assert.equal(config.aiProvider, ai.config().provider);
    assert.equal(config.aiModel, 'test-model');
    assert.ok(!text.includes(KEY));
  });

  it('sends nothing to the AI unless the caller asks for it', async () => {
    resetMock();
    const result = await ok(await postJson(server.url, sample));
    assert.equal(result.rewrites.mode, 'offline');
    assert.equal(result.rewrites.notice, null);
    assert.equal(ai.requests.length, 0);

    const off = await ok(await postJson(server.url, { ...sample, useAi: false }));
    assert.equal(off.rewrites.mode, 'offline');
    assert.equal(ai.requests.length, 0);
  });

  it('uses the AI when the caller asks for it, and sends only the job text and a few bullets', async () => {
    resetMock();
    const result = await ok(await postJson(server.url, { ...sample, useAi: true }));

    assert.equal(result.rewrites.mode, 'ai');
    assert.equal(result.rewrites.model, 'test-model');
    assert.equal(result.rewrites.notice, null);
    assert.equal(result.rewrites.items.length, 6);
    const improved = result.rewrites.items.filter((item) => item.rewrite?.startsWith('Delivered '));
    assert.ok(improved.length >= 2, 'at least two bullets have a weak opener');
    for (const item of improved) assert.equal(item.source, 'ai');

    assert.equal(ai.requests.length, 1);
    const [request] = ai.requests;
    assert.ok(request);
    assert.equal(request.method, 'POST');
    assert.equal(request.path, '/v1/chat/completions');
    assert.equal(request.headers.authorization, `Bearer ${KEY}`);
    const sent = sentData(request);
    assert.equal(sent.bullets.length, 6);
    const everything = JSON.stringify(request.body);
    for (const private_ of ['alex.taylor@example.com', '021 000 0000', 'Alex Taylor']) {
      assert.ok(!everything.includes(private_), `${private_} must not be sent`);
    }
  });

  it('reads useAi from a form too', async () => {
    resetMock();
    const result = await ok(await postForm(server.url, makeForm({ jobDescription: JOB, resumeText: RESUME, useAi: 'true' })));
    assert.equal(result.rewrites.mode, 'ai');
    assert.equal(ai.requests.length, 1);
  });

  it('does not call the AI when the resume has no bullet points', async () => {
    resetMock();
    const skillsOnly =
      'Alex Taylor\nSoftware Engineer\n\nSKILLS\nJavaScript, TypeScript, React, Node.js, Express, PostgreSQL, MongoDB, AWS, Docker, Git, GitHub Actions, Jest, REST APIs, Agile, Python, Linux, Terraform, Kubernetes, SQL, Redis\n';
    const result = await ok(await postJson(server.url, { jobDescription: JOB, resumeText: skillsOnly, useAi: true }));
    assert.equal(ai.requests.length, 0);
    assert.match(result.rewrites.notice ?? '', /could not find bullet points/);
  });

  it('falls back to the built-in suggestions when the AI service fails', async () => {
    resetMock();
    behaviour = 'broken';
    const result = await ok(await postJson(server.url, { ...sample, useAi: true }));
    assert.equal(result.rewrites.mode, 'offline');
    assert.match(result.rewrites.notice ?? '', /built-in suggestions/);
    assert.equal(result.rewrites.items.length, 6);
    assert.ok(result.rewrites.items.every((item) => item.source === 'offline'));
    assert.ok(server.logs.includes('AI request failed: server'));
    assert.ok(!server.logs.join('\n').includes(KEY));
  });

  it('falls back when the AI answers with something that is not a list of rewrites', async () => {
    resetMock();
    behaviour = 'garbage';
    const result = await ok(await postJson(server.url, { ...sample, useAi: true }));
    assert.equal(result.rewrites.mode, 'offline');
    assert.match(result.rewrites.notice ?? '', /built-in suggestions/);
    assert.ok(server.logs.includes('AI request failed: bad_reply'));
  });

  it('does not show an AI suggestion that adds a fact, and uses the built-in one instead', async () => {
    resetMock();
    behaviour = 'adds-a-number';
    const result = await ok(await postJson(server.url, { ...sample, useAi: true }));
    assert.equal(result.rewrites.mode, 'ai');
    assert.match(result.rewrites.notice ?? '', /did not pass the safety checks/);
    for (const item of result.rewrites.items) {
      assert.equal(item.source, 'offline');
      assert.ok(!(item.rewrite ?? '').includes('73'));
      assert.ok(item.warnings.some((warning) => warning.startsWith('The AI suggestion was not used because')));
    }
  });
});

describe('the AI service cannot be reached', () => {
  it('falls back to the built-in suggestions and says so', async () => {
    const down = await startServer({ config: { ai: ai.config({ baseUrl: await unusedBaseUrl(), apiKey: KEY }) } });
    try {
      const result = await ok(await postJson(down.url, { ...sample, useAi: true }));
      assert.equal(result.rewrites.mode, 'offline');
      assert.match(result.rewrites.notice ?? '', /built-in suggestions/);
      assert.ok(down.logs.includes('AI request failed: network'));
      assert.ok(!down.logs.join('\n').includes(KEY));
    } finally {
      await down.close();
    }
  });
});

describe('no AI service is set up', () => {
  it('says so when the caller asks for the AI', async () => {
    const plain = await startServer();
    try {
      const result = await ok(await postJson(plain.url, { ...sample, useAi: true }));
      assert.equal(result.rewrites.mode, 'offline');
      assert.equal(result.rewrites.notice, 'AI is not set up on this server, so I used the built-in suggestions.');
      const bad = await failure(await postJson(plain.url, { ...sample, useAi: 'sometimes' }), 400);
      assert.equal(bad.code, 'invalid_request');
    } finally {
      await plain.close();
    }
  });
});
