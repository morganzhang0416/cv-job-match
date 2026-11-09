import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { isOlder, minimumFromRange, parseVersion, tooOldMessage } from '../scripts/node-version.mjs';

const scriptsDir = new URL('../scripts/', import.meta.url);
const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  engines?: { node?: string };
  scripts: Record<string, string>;
};

/** Runs a copy of the real check next to a package.json that has the given fields. */
function runCheck(fields: Record<string, unknown>): { status: number | null; stdout: string; stderr: string } {
  const dir = mkdtempSync(join(tmpdir(), 'rjma-node-check-'));
  try {
    mkdirSync(join(dir, 'scripts'));
    for (const file of ['check-node.mjs', 'node-version.mjs']) {
      cpSync(new URL(file, scriptsDir), join(dir, 'scripts', file));
    }
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'check-node-test', ...fields }));
    return spawnSync(process.execPath, [join(dir, 'scripts', 'check-node.mjs')], { encoding: 'utf8' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('minimumFromRange', () => {
  it('reads a ">=" range', () => {
    assert.deepEqual(minimumFromRange('>=22.18.0'), [22, 18, 0]);
    assert.deepEqual(minimumFromRange('>= 22.18'), [22, 18, 0]);
    assert.deepEqual(minimumFromRange(' >=22 '), [22, 0, 0]);
    assert.deepEqual(minimumFromRange('>=v20.11.1'), [20, 11, 1]);
  });

  it('returns nothing for a range that it does not understand, so the check is skipped', () => {
    for (const range of ['^22.18.0', '>=22.18.0 <25', '22', '*', '', undefined, null, 22]) {
      assert.equal(minimumFromRange(range), undefined, String(range));
    }
  });
});

describe('parseVersion', () => {
  it('reads the numbers, with or without a "v"', () => {
    assert.deepEqual(parseVersion('20.3.0'), [20, 3, 0]);
    assert.deepEqual(parseVersion('v22.23.4'), [22, 23, 4]);
    assert.deepEqual(parseVersion('22.18.0-nightly2025'), [22, 18, 0]);
  });

  it('returns nothing for text that is not a version', () => {
    for (const text of ['', 'abc', '22', '22.18']) assert.equal(parseVersion(text), undefined, text);
  });
});

describe('isOlder', () => {
  const minimum = [22, 18, 0];

  it('is true for a lower major, minor or patch version', () => {
    assert.equal(isOlder([20, 3, 0], minimum), true);
    assert.equal(isOlder([18, 20, 4], minimum), true);
    assert.equal(isOlder([22, 17, 9], minimum), true);
    assert.equal(isOlder([22, 18, 0], [22, 18, 1]), true);
  });

  it('is false for the same version or a higher one', () => {
    assert.equal(isOlder([22, 18, 0], minimum), false);
    assert.equal(isOlder([22, 18, 1], minimum), false);
    assert.equal(isOlder([22, 23, 4], minimum), false);
    assert.equal(isOlder([24, 0, 0], minimum), false);
  });
});

describe('tooOldMessage', () => {
  it('names both versions and says how to fix it', () => {
    const message = tooOldMessage('20.3.0', '22.18.0');
    assert.match(message, /needs Node\.js 22\.18\.0 or newer\. You have Node\.js 20\.3\.0\./);
    assert.match(message, /https:\/\/nodejs\.org\//);
    assert.match(message, /nvm install 22/);
    assert.match(message, /node --version/);
    assert.match(message, /\$env:Path/);
  });
});

describe('check-node.mjs', () => {
  it('prints nothing and succeeds when this Node.js is new enough', () => {
    const result = runCheck({ engines: { node: '>=18.0.0' } });
    assert.equal(result.status, 0);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, '');
  });

  it('stops with a clear message when this Node.js is too old', () => {
    const result = runCheck({ engines: { node: '>=999.1.0' } });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /needs Node\.js 999\.1\.0 or newer/);
    assert.ok(result.stderr.includes(`You have Node.js ${process.versions.node}.`), result.stderr);
    assert.match(result.stderr, /How to fix it/);
    assert.doesNotMatch(result.stderr, /ERR_UNKNOWN_FILE_EXTENSION/);
  });

  it('does nothing when "engines" is missing or has a range that it does not understand', () => {
    for (const fields of [{}, { engines: {} }, { engines: { node: '^999.0.0' } }]) {
      const result = runCheck(fields);
      assert.equal(result.status, 0, JSON.stringify(fields));
      assert.equal(result.stderr, '');
    }
  });
});

describe('package.json', () => {
  it('asks for a Node.js that can run TypeScript files (22.18.0 or newer), in a form that the check understands', () => {
    const minimum = minimumFromRange(packageJson.engines?.node);
    assert.ok(minimum, `engines.node is "${packageJson.engines?.node}"`);
    assert.equal(isOlder(minimum, [22, 18, 0]), false);
  });

  it('runs the check before every script that starts Node.js with the app or its tests', () => {
    for (const name of ['start', 'dev', 'test', 'start:dist']) {
      assert.ok(packageJson.scripts[name], `script "${name}" exists`);
      assert.equal(packageJson.scripts[`pre${name}`], 'node scripts/check-node.mjs', `pre${name}`);
    }
  });
});
