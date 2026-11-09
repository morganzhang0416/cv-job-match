import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { blankContacts, countWords, normalizeText, snippetOf, stem, tokenize } from '../src/analyze/text.ts';

describe('normalizeText', () => {
  it('makes quotes, dashes, spaces and line breaks plain', () => {
    const input = '“Smart”  quotes\u00A0and\u2013dashes\r\n\r\n\r\n\r\nNext\u200B line';
    assert.equal(normalizeText(input), '"Smart" quotes and-dashes\n\nNext line');
  });

  it('removes control characters but keeps tabs as spaces', () => {
    assert.equal(normalizeText('a\u0000b\tc'), 'a b c');
  });
});

describe('tokenize', () => {
  it('keeps c++, c# and .net as single tokens', () => {
    const texts = tokenize('C++, C# and ASP.NET').map((token) => token.text);
    assert.deepEqual(texts, ['c++', 'c#', 'and', 'asp', '.net']);
  });

  it('splits hyphens, dots and slashes', () => {
    const texts = tokenize('problem-solving CI/CD node.js').map((token) => token.text);
    assert.deepEqual(texts, ['problem', 'solving', 'ci', 'cd', 'node', 'js']);
  });

  it('gives correct positions and the original spelling', () => {
    const [token] = tokenize('  Python');
    assert.deepEqual(token, { text: 'python', raw: 'Python', start: 2, end: 8 });
  });
});

describe('stem', () => {
  it('joins word forms', () => {
    assert.equal(stem('managing'), stem('management'));
    assert.equal(stem('managed'), stem('manage'));
    assert.equal(stem('stakeholders'), stem('stakeholder'));
  });

  it('leaves short words and words with digits alone', () => {
    assert.equal(stem('aws'), 'aws');
    assert.equal(stem('es6'), 'es6');
  });
});

describe('blankContacts', () => {
  it('blanks emails, links and phone numbers and keeps the length', () => {
    const text = 'Mail jo@example.net, see https://github.com/jo or +64 21 123 4567 now';
    const blanked = blankContacts(text);
    assert.equal(blanked.length, text.length);
    assert.ok(!/example|github|4567/.test(blanked));
    assert.ok(blanked.startsWith('Mail '));
    assert.ok(blanked.endsWith(' now'));
  });

  it('leaves normal text alone', () => {
    assert.equal(blankContacts('Built Node.js and ASP.NET apps in 2021'), 'Built Node.js and ASP.NET apps in 2021');
  });
});

describe('countWords and snippetOf', () => {
  it('counts words', () => {
    assert.equal(countWords('One two-three four.'), 3);
    assert.equal(countWords(''), 0);
  });

  it('cuts long text at a word boundary', () => {
    const snippet = snippetOf('word '.repeat(100), 40);
    assert.ok(snippet.length <= 41);
    assert.ok(snippet.endsWith('…'));
    assert.equal(snippetOf('short   text'), 'short text');
  });
});
