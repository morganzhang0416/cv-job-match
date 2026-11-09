import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { analyzeMatch, MIN_JOB_TERMS } from '../src/analyze/index.ts';
import { levelFor, termKeysIn } from '../src/analyze/match.ts';
import { AppError } from '../src/errors.ts';

function sample(name: string): string {
  return readFileSync(new URL(`../public/samples/${name}`, import.meta.url), 'utf8');
}

const JOB = sample('job-description.txt');
const RESUME = sample('resume.txt');

const SMALL_JOB = ['Requirements', '- 3+ years of Python', '- SQL', '- Docker', 'Nice to have', '- Kubernetes'].join('\n');
const FILL = 'I enjoy my work and I work well with other people on many different kinds of projects every year.';

describe('levelFor', () => {
  it('uses the agreed limits', () => {
    const cases: Array<[number, string]> = [
      [100, 'excellent'],
      [80, 'excellent'],
      [79, 'strong'],
      [65, 'strong'],
      [64, 'fair'],
      [50, 'fair'],
      [49, 'partial'],
      [35, 'partial'],
      [34, 'low'],
      [0, 'low'],
    ];
    for (const [score, level] of cases) assert.equal(levelFor(score), level, `score ${score}`);
  });
});

describe('analyzeMatch: the sample files', () => {
  const { match } = analyzeMatch(JOB, RESUME);

  it('gives a strong match with real gaps', () => {
    assert.ok(match.score >= 60 && match.score <= 75, `score was ${match.score}`);
    assert.equal(match.level, levelFor(match.score));
    assert.equal(match.verdict.endsWith('match'), true);
  });

  it('finds the skills the resume has', () => {
    const matched = match.matched.map((item) => item.label);
    for (const label of ['React', 'Node.js', 'TypeScript', 'PostgreSQL', 'Docker', 'Jest', 'CI/CD']) {
      assert.ok(matched.includes(label), `${label} should be matched`);
    }
  });

  it('lists the gaps, most valuable first', () => {
    const missing = match.missing.map((item) => item.label);
    assert.equal(missing[0], 'Kubernetes');
    for (const label of ['Communication', 'GraphQL', 'Terraform', 'Datadog']) {
      assert.ok(missing.includes(label), `${label} should be missing`);
    }
    for (let i = 1; i < match.missing.length; i++) {
      const previous = match.missing[i - 1];
      const current = match.missing[i];
      assert.ok(previous && current && previous.weight >= current.weight);
    }
  });

  it('does not count the people the job works with', () => {
    const all = [...match.matched, ...match.missing].map((item) => item.label);
    assert.equal(all.includes('Product Management'), false);
  });

  it('does not take skills from the company, benefits or apply text', () => {
    const all = [...match.matched, ...match.missing].map((item) => item.label);
    // "learning budget" is in the Benefits section, so it is not a budget skill.
    for (const label of ['Budget Management', 'Diversity and Inclusion']) {
      assert.equal(all.includes(label), false, label);
    }
  });

  it('shows a snippet and counts for each keyword', () => {
    const kubernetes = match.missing.find((item) => item.label === 'Kubernetes');
    assert.equal(kubernetes?.importance, 'required');
    assert.match(kubernetes?.snippet ?? '', /Kubernetes/);
    assert.equal(kubernetes?.resumeCount, 0);
    const react = match.matched.find((item) => item.label === 'React');
    assert.equal(react?.jobCount, 2);
    assert.ok((react?.resumeCount ?? 0) >= 1);
  });

  it('builds a breakdown with consistent numbers', () => {
    assert.ok(match.breakdown.length >= 3);
    for (const row of match.breakdown) {
      assert.ok(row.matched <= row.total);
      assert.equal(row.percent, Math.round((100 * row.matched) / row.total));
    }
    const must = match.breakdown.find((row) => row.key === 'must-have');
    assert.ok(must && must.total > 0);
  });

  it('writes a plain summary', () => {
    const total = match.matched.length + match.missing.length;
    assert.ok(match.summary.startsWith(`Your resume covers ${match.matched.length} of ${total} keywords`));
    assert.match(match.summary, /missing/);
  });

  it('gives the same answer every time', () => {
    assert.deepEqual(analyzeMatch(JOB, RESUME), analyzeMatch(JOB, RESUME));
  });
});

describe('analyzeMatch: scores', () => {
  it('gives 100 when everything is covered', () => {
    const resume = `${FILL} I used Python for 5 years, wrote SQL, ran Docker and Kubernetes in production.`;
    const { match } = analyzeMatch(SMALL_JOB, resume);
    assert.equal(match.score, 100);
    assert.equal(match.level, 'excellent');
    assert.deepEqual(match.missing, []);
    assert.match(match.summary, /Nothing is missing/);
  });

  it('gives a low score when nothing is covered', () => {
    const { match } = analyzeMatch(SMALL_JOB, `${FILL} I paint houses and I bake bread on weekends for my friends.`);
    assert.equal(match.score, 0);
    assert.equal(match.level, 'low');
    assert.equal(match.matched.length, 0);
    assert.match(match.summary, /4 keywords are missing, and 3 of them are must-haves/);
  });

  it('weighs must-haves more than nice-to-haves', () => {
    const job = 'Requirements\n- Python\n- SQL\nNice to have\n- GraphQL\n- Terraform';
    const withMust = analyzeMatch(job, `${FILL} I know Python well.`).match.score;
    const withNice = analyzeMatch(job, `${FILL} I know GraphQL well.`).match.score;
    assert.ok(withMust > withNice, `${withMust} should be above ${withNice}`);
  });

  it('never shows 100 while a keyword is missing', () => {
    const { match } = analyzeMatch(SMALL_JOB, `${FILL} I use Python, SQL and Docker every day.`);
    assert.equal(match.missing.length, 1);
    assert.ok(match.score < 100);
  });

  it('lets a skill prove the skill under it', () => {
    const job = 'Requirements\n- JavaScript\n- SQL\n- Docker';
    const { match } = analyzeMatch(job, `${FILL} I built apps with Next.js, SQL and Docker.`);
    const javascript = match.matched.find((item) => item.label === 'JavaScript');
    assert.equal(javascript?.resumeCount, 1);
  });

  it('reads another word order for a multi-word skill', () => {
    const job = 'Requirements\n- Stakeholder management\n- SQL\n- Python';
    const { match } = analyzeMatch(job, `${FILL} I managed stakeholders, SQL databases and Python scripts every week.`);
    assert.ok(match.matched.some((item) => item.label === 'Stakeholder Management'));
  });

  it('does not match a language name inside normal words', () => {
    const job = 'Requirements\n- Experience with Go\n- Python\n- SQL';
    const { match } = analyzeMatch(job, `${FILL} I go to the gym, I use Python and I query SQL tables.`);
    assert.ok(match.missing.some((item) => item.label === 'Go'));
  });
});

describe('analyzeMatch: errors', () => {
  it('asks for a fuller job description when it finds almost nothing', () => {
    assert.throws(
      () => analyzeMatch('We want a nice person who likes to work with us and be happy.', RESUME),
      (error: unknown) =>
        error instanceof AppError && error.status === 422 && error.code === 'job_too_vague' && error.message.includes(String(MIN_JOB_TERMS)),
    );
  });

  it('asks for a fuller resume when it is very short', () => {
    assert.throws(
      () => analyzeMatch(JOB, 'Python developer.'),
      (error: unknown) => error instanceof AppError && error.status === 422 && error.code === 'resume_too_short',
    );
  });
});

describe('termKeysIn', () => {
  it('gives the keys of the job terms that a text names', () => {
    const { terms } = analyzeMatch(JOB, RESUME);
    const keys = termKeysIn(terms, 'Built dashboards with React and deployed on Kubernetes.');
    assert.ok(keys.has('skill:react'));
    assert.ok(keys.has('skill:kubernetes'));
    assert.equal(keys.has('skill:graphql'), false);
  });

  it('does not count implied skills', () => {
    const { terms } = analyzeMatch(JOB, RESUME);
    const keys = termKeysIn(terms, 'Built pages with React.');
    assert.equal(keys.has('skill:javascript'), false);
  });
});
