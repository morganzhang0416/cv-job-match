import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { buildJson, buildMarkdown, diffWords, formatBytes, IMPORTANCE_LABEL, localDate, plural } from '../public/report.js';
import type { AnalyzeResponse, KeywordResult, RewriteItem } from '../src/analyze/types.ts';
import { JOB, ok, postJson, RESUME } from './helpers/api.ts';
import { startServer, type TestServer } from './helpers/server.ts';

const keyword = (label: string, extra: Partial<KeywordResult> = {}): KeywordResult => ({
  key: label.toLowerCase(),
  label,
  kind: 'hard',
  category: 'Languages',
  importance: 'standard',
  jobCount: 1,
  resumeCount: 1,
  weight: 2,
  snippet: '',
  ...extra,
});

const item = (id: number, extra: Partial<RewriteItem> = {}): RewriteItem => ({
  id,
  original: 'Worked on the REST API.',
  rewrite: 'Delivered the REST API with Docker.',
  source: 'ai',
  keywordsAdded: ['Docker'],
  tips: [],
  warnings: [],
  ...extra,
});

function makeResponse(extra: Partial<AnalyzeResponse> = {}): AnalyzeResponse {
  return {
    match: {
      score: 68,
      level: 'strong',
      verdict: 'Strong match',
      summary: 'Your resume covers 14 of 28 keywords.\n  Two are missing.',
      breakdown: [{ key: 'must-have', label: 'Must-have | skills', matched: 3, total: 5, percent: 60 }],
      matched: [keyword('TypeScript'), keyword('React')],
      missing: [
        keyword('Kubernetes', { category: 'DevOps', importance: 'required', resumeCount: 0, snippet: 'Experience with AWS,\n  Docker and Kubernetes.' }),
        keyword('GraphQL', { importance: 'preferred', resumeCount: 0 }),
      ],
    },
    rewrites: {
      mode: 'ai',
      model: 'test-model',
      notice: 'One suggestion\nwas not used.',
      items: [
        item(3, { keywordsAdded: ['Docker', 'Kubernetes'], tips: ['Add a number.'], warnings: ['Check this is true.'] }),
        item(5, { rewrite: null, keywordsAdded: [], tips: ['Start with a strong verb.'] }),
      ],
    },
    resume: { source: 'pdf', fileName: 'cv.pdf', characters: 2000, words: 350, bullets: 12, pages: 1 },
    ...extra,
  };
}

describe('diffWords', () => {
  const joined = (runs: Array<{ text: string }>): string => runs.map((run) => run.text).join('');
  const added = (runs: Array<{ text: string; added: boolean }>): string[] => runs.filter((run) => run.added).map((run) => run.text);

  it('marks only the words that are new', () => {
    const runs = diffWords('Worked on the REST API and the PostgreSQL database.', 'Built the REST API and the PostgreSQL database with Docker.');
    assert.deepEqual(added(runs), ['Built', 'with Docker.']);
  });

  it('gives back the new text unchanged, apart from space at the ends', () => {
    const cases: Array<[string, string]> = [
      ['Worked on the REST API.', 'Delivered the REST API with Docker.'],
      ['one two three', 'three two one'],
      ['a', 'b c d  e\tf\ng'],
      ['', 'Everything is new here'],
      ['Led a team of 5', '  Led a team of 5 engineers.  '],
    ];
    for (const [before, after] of cases) assert.equal(joined(diffWords(before, after)), after.trim(), after);
  });

  it('does not start or end a highlight with a space', () => {
    for (const run of diffWords('the cat sat', 'a big cat sat on the mat today')) {
      if (run.added) assert.equal(run.text, run.text.trim(), JSON.stringify(run.text));
    }
  });

  it('keeps words together in one highlight', () => {
    assert.deepEqual(added(diffWords('Built the API', 'Built the API with Docker and Kubernetes')), ['with Docker and Kubernetes']);
  });

  it('ignores letter case and punctuation at the ends of a word', () => {
    assert.deepEqual(diffWords('We use Node.js, React and C++.', 'we use node.js and (react) and c++'), [{ text: 'we use node.js and (react) and c++', added: false }]);
    assert.deepEqual(diffWords('Réseau privé', 'réseau PRIVÉ'), [{ text: 'réseau PRIVÉ', added: false }]);
  });

  it('never marks a mark of punctuation as new', () => {
    assert.deepEqual(diffWords('Built the API', 'Built — the API & more'), [
      { text: 'Built — the API & ', added: false },
      { text: 'more', added: true },
    ]);
  });

  it('treats a changed number as new', () => {
    assert.deepEqual(added(diffWords('Cut load time by 35%', 'Cut load time by 53%')), ['53%']);
  });

  it('handles empty and same text', () => {
    assert.deepEqual(diffWords('same words', 'same words'), [{ text: 'same words', added: false }]);
    assert.deepEqual(diffWords('something', ''), []);
    assert.deepEqual(diffWords('', 'new'), [{ text: 'new', added: true }]);
  });
});

describe('buildMarkdown', () => {
  const lines = (data: AnalyzeResponse): string[] => buildMarkdown(data).split('\n');

  it('writes the score, the summary and the breakdown table', () => {
    const text = lines(makeResponse());
    assert.equal(text[0], '# Resume and job match report');
    assert.ok(text.includes('**Match score: 68 / 100 (Strong match)**'));
    assert.ok(text.includes('Your resume covers 14 of 28 keywords. Two are missing.'), 'the summary is one line');
    assert.ok(text.includes('| Area | Covered | Share |'));
    assert.ok(text.includes('| Must-have \\| skills | 3 of 5 | 60% |'), 'a pipe in a table cell is escaped');
  });

  it('lists the missing keywords with their importance, group and the line from the job', () => {
    const text = lines(makeResponse());
    assert.ok(text.includes('- **Kubernetes** (Must-have, DevOps): "Experience with AWS, Docker and Kubernetes."'));
    assert.ok(text.includes('- **GraphQL** (Nice to have, Languages)'));
    assert.ok(text.includes('TypeScript, React'));
  });

  it('writes each bullet point with before, after, added keywords, tips and warnings', () => {
    const text = lines(makeResponse());
    assert.ok(text.includes('### Bullet 3'));
    assert.ok(text.includes('- **Before:** Worked on the REST API.'));
    assert.ok(text.includes('- **After:** Delivered the REST API with Docker.'));
    assert.ok(text.includes('- **Keywords added (keep only if true):** Docker, Kubernetes'));
    assert.ok(text.includes('- **Tip:** Add a number.'));
    assert.ok(text.includes('- **Warning:** Check this is true.'));
  });

  it('says so when a bullet point has no safe rewrite', () => {
    const text = lines(makeResponse());
    const start = text.indexOf('### Bullet 5');
    assert.ok(start > 0);
    assert.equal(text[start + 3], '- **After:** No safe rewrite. See the tips.');
    assert.ok(!text.slice(start).some((line) => line.startsWith('- **Keywords added')));
  });

  it('says who wrote the suggestions, and repeats the notice', () => {
    const ai = lines(makeResponse());
    assert.ok(ai.includes('Written by AI (test-model). Check that every line is true before you use it.'));
    assert.ok(ai.includes('> One suggestion was not used.'));

    const base = makeResponse();
    const offline = lines(makeResponse({ rewrites: { ...base.rewrites, mode: 'offline', model: null, notice: null } }));
    assert.ok(offline.includes('Built-in suggestions. Check that every line is true before you use it.'));
    assert.ok(!offline.some((line) => line.startsWith('>')));
  });

  it('handles a result with nothing missing, nothing covered and no bullet points', () => {
    const base = makeResponse();
    const text = buildMarkdown({
      ...base,
      match: { ...base.match, score: 100, missing: [], matched: [], breakdown: [] },
      rewrites: { mode: 'offline', model: null, notice: null, items: [] },
    });
    assert.match(text, /## Missing keywords\n\nNothing is missing\./);
    assert.match(text, /## Keywords already covered\n\nNone\./);
    assert.ok(!text.includes('Score breakdown'));
    assert.ok(!text.includes('### Bullet'));
  });

  it('does not repeat the file name, and ends with one new line', () => {
    const text = buildMarkdown(makeResponse());
    assert.ok(!text.includes('cv.pdf'));
    assert.ok(text.endsWith('keywords only. It does not judge how good your experience is.\n'));
    assert.ok(!text.endsWith('\n\n'));
  });
});

describe('buildJson', () => {
  it('gives back the same data as readable JSON', () => {
    const data = makeResponse();
    const text = buildJson(data);
    assert.deepEqual(JSON.parse(text), data);
    assert.ok(text.includes('\n  "match": {'));
    assert.ok(text.endsWith('}\n'));
  });
});

describe('small helpers', () => {
  it('formats file sizes', () => {
    assert.equal(formatBytes(0), '0 B');
    assert.equal(formatBytes(1023), '1023 B');
    assert.equal(formatBytes(1024), '1 KB');
    assert.equal(formatBytes(340 * 1024), '340 KB');
    assert.equal(formatBytes(2.5 * 1024 * 1024), '2.5 MB');
    assert.equal(formatBytes(5 * 1024 * 1024), '5.0 MB');
  });

  it('writes a file date from the local clock, not from UTC', () => {
    // Built from local parts, so the answer is the same in every time zone.
    assert.equal(localDate(new Date(2026, 10, 9, 0, 30)), '2026-11-09');
    assert.equal(localDate(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
    assert.equal(localDate(new Date(2028, 1, 29, 12, 0)), '2028-02-29');
    assert.match(localDate(), /^\d{4}-\d{2}-\d{2}$/);
  });

  it('chooses the singular or the plural', () => {
    assert.equal(plural(1, 'page', 'pages'), 'page');
    assert.equal(plural(0, 'page', 'pages'), 'pages');
    assert.equal(plural(2, 'page', 'pages'), 'pages');
  });

  it('has a label for each level of importance', () => {
    assert.deepEqual(IMPORTANCE_LABEL, { required: 'Must-have', standard: 'Mentioned', preferred: 'Nice to have' });
  });
});

describe('the report for a real answer from the server', () => {
  let server: TestServer;
  before(async () => {
    server = await startServer();
  });
  after(async () => {
    await server.close();
  });

  it('covers every missing keyword and every rewrite, and has no broken values', async () => {
    const result = await ok(await postJson(server.url, { jobDescription: JOB, resumeText: RESUME }));
    const text = buildMarkdown(result);

    assert.ok(text.includes(`**Match score: ${result.match.score} / 100 (${result.match.verdict})**`));
    for (const missing of result.match.missing) assert.ok(text.includes(`**${missing.label}**`), missing.label);
    for (const rewrite of result.rewrites.items) assert.ok(text.includes(`### Bullet ${rewrite.id}\n`), String(rewrite.id));
    assert.doesNotMatch(text, /undefined|\[object|NaN|\bnull\b/);
    assert.deepEqual(JSON.parse(buildJson(result)), result);
  });
});
