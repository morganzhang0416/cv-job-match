import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ACCEPTED_EXTENSIONS, loadConfig, MAX_JOB_CHARS, MAX_RESUME_CHARS, toPublicConfig } from '../src/config.ts';

describe('loadConfig: server settings', () => {
  it('uses safe defaults: this computer only, port 3000, no AI', () => {
    const config = loadConfig({});
    assert.equal(config.host, '127.0.0.1');
    assert.equal(config.port, 3000);
    assert.equal(config.trustProxy, false);
    assert.equal(config.ai, null);
    assert.deepEqual(config.warnings, []);
  });

  it('treats empty values as not set', () => {
    const config = loadConfig({ HOST: '  ', PORT: '', GITHUB_TOKEN: '   ', AI_BASE_URL: '' });
    assert.equal(config.host, '127.0.0.1');
    assert.equal(config.port, 3000);
    assert.equal(config.ai, null);
    assert.deepEqual(config.warnings, []);
  });

  it('warns when the tool is open to the network, and not for this computer', () => {
    for (const host of ['127.0.0.1', 'localhost', '::1', '[::1]', 'LOCALHOST']) {
      assert.deepEqual(loadConfig({ HOST: host }).warnings, [], host);
    }
    for (const host of ['0.0.0.0', '192.168.1.20', 'my-server']) {
      const { warnings } = loadConfig({ HOST: host });
      assert.equal(warnings.length, 1, host);
      assert.match(warnings[0] ?? '', /no login/i);
    }
  });

  it('reads the port, and allows 0 for "any free port"', () => {
    assert.equal(loadConfig({ PORT: '8080' }).port, 8080);
    assert.equal(loadConfig({ PORT: '0' }).port, 0);
  });

  it('uses the default port and warns when the port is not valid', () => {
    for (const port of ['abc', '-1', '65536', '80.5', '1e3', '0x10', '+80']) {
      const config = loadConfig({ PORT: port });
      assert.equal(config.port, 3000, port);
      assert.match(config.warnings.join(' '), /PORT must be a whole number/);
    }
  });

  it('reads TRUST_PROXY as a flag, and ignores strange values', () => {
    for (const value of ['1', 'true', 'TRUE', 'yes', 'on']) assert.equal(loadConfig({ TRUST_PROXY: value }).trustProxy, true, value);
    for (const value of ['0', 'false', 'no', 'off', 'maybe']) assert.equal(loadConfig({ TRUST_PROXY: value }).trustProxy, false, value);
  });
});

describe('loadConfig: GitHub Models', () => {
  it('turns AI on when a GitHub token is set, with the usual defaults', () => {
    const { ai, warnings } = loadConfig({ GITHUB_TOKEN: 'example-github-token' });
    assert.deepEqual(warnings, []);
    assert.deepEqual(ai, {
      provider: 'GitHub Models',
      baseUrl: 'https://models.github.ai/inference',
      apiKey: 'example-github-token',
      model: 'openai/gpt-4o-mini',
      jsonMode: true,
      timeoutMs: 30_000,
    });
  });

  it('also accepts GH_TOKEN, and prefers GITHUB_TOKEN', () => {
    assert.equal(loadConfig({ GH_TOKEN: 'from-gh' }).ai?.apiKey, 'from-gh');
    assert.equal(loadConfig({ GH_TOKEN: 'from-gh', GITHUB_TOKEN: 'from-github' }).ai?.apiKey, 'from-github');
  });

  it('picks the model: AI_MODEL, then GITHUB_MODELS_MODEL, then the default', () => {
    assert.equal(loadConfig({ GITHUB_TOKEN: 't', GITHUB_MODELS_MODEL: 'openai/gpt-4.1' }).ai?.model, 'openai/gpt-4.1');
    assert.equal(loadConfig({ GITHUB_TOKEN: 't', GITHUB_MODELS_MODEL: 'openai/gpt-4.1', AI_MODEL: 'other/model' }).ai?.model, 'other/model');
  });

  it('removes the trailing slash from the endpoint', () => {
    const config = loadConfig({ GITHUB_TOKEN: 't', GITHUB_MODELS_ENDPOINT: 'https://models.example.com/inference///' });
    assert.equal(config.ai?.baseUrl, 'https://models.example.com/inference');
  });

  it('turns AI off and warns when the endpoint is not a web address', () => {
    const config = loadConfig({ GITHUB_TOKEN: 't', GITHUB_MODELS_ENDPOINT: 'not a url' });
    assert.equal(config.ai, null);
    assert.match(config.warnings.join(' '), /GITHUB_MODELS_ENDPOINT is not a valid web address/);
  });
});

describe('loadConfig: any OpenAI-compatible service', () => {
  it('uses AI_BASE_URL and AI_MODEL, and does not need a key (for example a local Ollama)', () => {
    const { ai, warnings } = loadConfig({ AI_BASE_URL: 'http://localhost:11434/v1/', AI_MODEL: 'llama3.1' });
    assert.deepEqual(warnings, []);
    assert.equal(ai?.baseUrl, 'http://localhost:11434/v1');
    assert.equal(ai?.apiKey, null);
    assert.equal(ai?.model, 'llama3.1');
    assert.equal(ai?.provider, 'localhost:11434');
  });

  it('wins over a GitHub token', () => {
    const { ai } = loadConfig({ AI_BASE_URL: 'https://api.example.com/v1', AI_MODEL: 'm', AI_API_KEY: 'k', GITHUB_TOKEN: 'gh' });
    assert.equal(ai?.provider, 'api.example.com');
    assert.equal(ai?.apiKey, 'k');
  });

  it('turns AI off and warns when AI_MODEL is missing', () => {
    const config = loadConfig({ AI_BASE_URL: 'https://api.example.com/v1', GITHUB_TOKEN: 'gh' });
    assert.equal(config.ai, null, 'it must not fall back to GitHub Models, because the user chose another service');
    assert.match(config.warnings.join(' '), /AI_MODEL/);
  });

  it('turns AI off for a bad address, and never repeats the address or a password in the warning', () => {
    const withLogin = new URL('https://example.com/v1');
    withLogin.username = 'someone';
    withLogin.password = 'secret-pass';
    for (const value of ['nope', 'ftp://example.com/v1', withLogin.href]) {
      const config = loadConfig({ AI_BASE_URL: value, AI_MODEL: 'm' });
      assert.equal(config.ai, null, value);
      assert.equal(config.warnings.length, 1, value);
      assert.ok(!config.warnings.join(' ').includes('secret-pass'), 'the password must not be printed');
    }
  });

  it('warns when a key would be sent over plain http to another computer', () => {
    const open = loadConfig({ AI_BASE_URL: 'http://ai.internal:8000/v1', AI_MODEL: 'm', AI_API_KEY: 'k' });
    assert.match(open.warnings.join(' '), /without encryption/);
    assert.notEqual(open.ai, null, 'the warning does not turn AI off');

    for (const base of ['http://localhost:8000/v1', 'http://[::1]:8000/v1', 'https://ai.internal/v1']) {
      assert.deepEqual(loadConfig({ AI_BASE_URL: base, AI_MODEL: 'm', AI_API_KEY: 'k' }).warnings, [], base);
    }
    assert.deepEqual(loadConfig({ AI_BASE_URL: 'http://ai.internal:8000/v1', AI_MODEL: 'm' }).warnings, [], 'no key, nothing to protect');
  });

  it('reads the time limit and the JSON switch', () => {
    const base = { AI_BASE_URL: 'http://localhost:1/v1', AI_MODEL: 'm' };
    assert.equal(loadConfig({ ...base, AI_TIMEOUT_MS: '5000' }).ai?.timeoutMs, 5000);
    assert.equal(loadConfig({ ...base, AI_JSON_MODE: 'false' }).ai?.jsonMode, false);
    assert.equal(loadConfig(base).ai?.jsonMode, true);

    for (const value of ['10', '999999', 'soon']) {
      const config = loadConfig({ ...base, AI_TIMEOUT_MS: value });
      assert.equal(config.ai?.timeoutMs, 30_000, value);
      assert.match(config.warnings.join(' '), /AI_TIMEOUT_MS/);
    }
  });
});

describe('toPublicConfig', () => {
  it('tells the browser what it needs and never the key', () => {
    const config = loadConfig({ GITHUB_TOKEN: 'example-secret-token' });
    const info = toPublicConfig(config);
    assert.deepEqual(info, {
      aiAvailable: true,
      aiProvider: 'GitHub Models',
      aiModel: 'openai/gpt-4o-mini',
      maxUploadMb: 5,
      maxJobChars: MAX_JOB_CHARS,
      maxResumeChars: MAX_RESUME_CHARS,
      acceptedExtensions: [...ACCEPTED_EXTENSIONS],
    });
    assert.ok(!JSON.stringify(info).includes('example-secret-token'));
  });

  it('says that AI is not available when it is off', () => {
    const info = toPublicConfig(loadConfig({}));
    assert.equal(info.aiAvailable, false);
    assert.equal(info.aiProvider, null);
    assert.equal(info.aiModel, null);
  });
});
