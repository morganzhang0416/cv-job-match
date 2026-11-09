import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { after, before, describe, it } from 'node:test';
import { JOB, ok, postJson, rawRequest, RESUME } from './helpers/api.ts';
import { startServer, type TestServer } from './helpers/server.ts';

const publicDir = new URL('../public/', import.meta.url);
const read = (name: string): string => readFileSync(new URL(name, publicDir), 'utf8');
const html = read('index.html');
const css = read('styles.css');
const scriptNames = readdirSync(publicDir).filter((name) => name.endsWith('.js'));
const scripts = new Map(scriptNames.map((name) => [name, read(name)]));

const all = (text: string, pattern: RegExp): string[] => [...text.matchAll(pattern)].map((match) => match[1] ?? '');

let server: TestServer;
before(async () => {
  server = await startServer();
});
after(async () => {
  await server.close();
});

describe('the page', () => {
  it('is served at / with the strict security headers', async () => {
    for (const path of ['/', '/index.html']) {
      const response = await fetch(server.url + path);
      assert.equal(response.status, 200, path);
      assert.match(response.headers.get('content-type') ?? '', /^text\/html/);
      assert.equal(await response.text(), html);
      assert.match(response.headers.get('content-security-policy') ?? '', /script-src 'self'(;|$)/);
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    }
  });

  it('serves every file that the page loads, with the right type', async () => {
    const links = [...all(html, /\ssrc="(\/[^"]+)"/g), ...all(html, /\shref="(\/[^"]+)"/g)];
    assert.deepEqual([...links].sort(), ['/app.js', '/favicon.svg', '/favicon.svg', '/styles.css']);
    const types: Record<string, RegExp> = { '.js': /^(text|application)\/javascript/, '.css': /^text\/css/, '.svg': /^image\/svg\+xml/ };
    for (const link of new Set(links)) {
      const response = await fetch(server.url + link);
      assert.equal(response.status, 200, link);
      const extension = link.slice(link.lastIndexOf('.'));
      assert.match(response.headers.get('content-type') ?? '', types[extension] ?? /^$/, link);
    }
  });

  it('serves every script that another script imports', async () => {
    assert.ok(scripts.size >= 5);
    for (const [name, code] of scripts) {
      for (const target of all(code, /\bfrom '\.\/([\w-]+\.js)'/g)) {
        assert.ok(scripts.has(target), `${name} imports ${target}, which does not exist`);
        const response = await fetch(`${server.url}/${target}`);
        assert.equal(response.status, 200, target);
        await response.arrayBuffer();
      }
    }
  });

  it('has a language, a title and a description', () => {
    assert.match(html, /<html lang="en">/);
    assert.match(html, /<title>Resume and Job Match Analyzer<\/title>/);
    assert.match(html, /<meta name="description" content="[^"]{40,}"/);
  });
});

describe('the elements that app.js needs', () => {
  const ids = all(html, /\sid="([^"]+)"/g);

  it('are all in index.html', () => {
    const needed = all(scripts.get('app.js') ?? '', /\bneed\('([\w-]+)'/g);
    assert.ok(needed.length >= 25, `found ${needed.length} ids in app.js`);
    for (const id of needed) assert.ok(ids.includes(id), `index.html has no element with id "${id}"`);
  });

  it('have ids that are not used twice', () => {
    const seen = new Set<string>();
    for (const id of ids) {
      assert.ok(!seen.has(id), `the id "${id}" is used twice`);
      seen.add(id);
    }
  });

  it('are linked to labels and descriptions that exist', () => {
    for (const attribute of ['for', 'aria-labelledby', 'aria-describedby']) {
      for (const value of all(html, new RegExp(`\\s${attribute}="([^"]+)"`, 'g'))) {
        for (const id of value.split(/\s+/)) assert.ok(ids.includes(id), `${attribute}="${id}" points to nothing`);
      }
    }
    for (const target of all(html, /\shref="#([^"]+)"/g)) assert.ok(ids.includes(target), `#${target} points to nothing`);
  });

  it('give every field and every image a name for screen readers', () => {
    const labelBlocks = html.match(/<label\b[\s\S]*?<\/label>/g) ?? [];
    for (const tag of html.match(/<(?:input|textarea)\b[^>]*>/g) ?? []) {
      const id = /\sid="([^"]+)"/.exec(tag)?.[1];
      assert.ok(id, `a field has no id: ${tag}`);
      const named = html.includes(`for="${id}"`) || labelBlocks.some((block) => block.includes(`id="${id}"`));
      assert.ok(named, `the field "${id}" has no label`);
    }
    for (const tag of html.match(/<img\b[^>]*>/g) ?? []) assert.match(tag, /\salt="/, tag);
  });
});

describe('the strict content security policy', () => {
  it('finds no inline script, no inline style and no event handler in the page', () => {
    for (const tag of html.match(/<script\b[^>]*>/g) ?? []) assert.match(tag, /\ssrc="/, `inline script: ${tag}`);
    assert.doesNotMatch(html, /<style\b/i);
    assert.doesNotMatch(html, /\sstyle\s*=/i);
    assert.doesNotMatch(html, /\son[a-z]+\s*=/i);
    assert.doesNotMatch(html, /javascript:/i);
    assert.doesNotMatch(html, /\b(?:src|href)="(?:data|blob|https?):/i);
  });

  it('finds no import and no url() in the style sheet', () => {
    assert.doesNotMatch(css, /@import/i);
    assert.doesNotMatch(css, /url\(/i);
    assert.doesNotMatch(css, /expression\(/i);
  });

  it('finds no code in the scripts that turns text into HTML or code', () => {
    const risky = [
      /\.innerHTML\b/,
      /\.outerHTML\b/,
      /insertAdjacentHTML/,
      /document\.write/,
      /\beval\s*\(/,
      /new Function\s*\(/,
      /setAttribute\(\s*['"]style['"]/,
      /setTimeout\(\s*['"`]/,
      /localStorage|sessionStorage|indexedDB/,
    ];
    for (const [name, code] of scripts) {
      for (const pattern of risky) assert.doesNotMatch(code, pattern, `${name} uses ${pattern}`);
    }
  });
});

describe('the samples', () => {
  it('are served as plain text', async () => {
    for (const name of ['job-description', 'resume']) {
      const response = await fetch(`${server.url}/samples/${name}.txt`);
      assert.equal(response.status, 200);
      assert.match(response.headers.get('content-type') ?? '', /^text\/plain/);
      assert.equal(await response.text(), name === 'resume' ? RESUME : JOB);
    }
  });

  it('give a result that is worth showing in a demo', async () => {
    const result = await ok(await postJson(server.url, { jobDescription: JOB, resumeText: RESUME }));
    assert.ok(result.match.matched.length >= 8, 'some keywords match');
    assert.ok(result.match.missing.length >= 5, 'some keywords are missing');
    assert.ok(result.match.breakdown.length >= 3);
    const rewritten = result.rewrites.items.filter((entry) => entry.rewrite !== null);
    assert.ok(rewritten.length >= 4, `only ${rewritten.length} bullet points got a new version`);
  });
});

describe('files outside the public folder', () => {
  it('are not served', async () => {
    for (const path of ['/..%2f..%2fpackage.json', '/%2e%2e%2fpackage.json', '/..%5cpackage.json', '/samples/..%2f..%2fpackage.json', '/src/server.ts', '/package.json']) {
      const response = await rawRequest(server.url, { path });
      assert.ok([400, 403, 404].includes(response.status), `${path} gave ${response.status}`);
      assert.ok(!response.body.includes('resume-job-match-analyzer'), path);
    }
  });
});
