import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { DEFAULT_PICK, extractBullets, MAX_BULLETS, MAX_PICK, pickBullets } from '../src/analyze/bullets.ts';
import { extractJobTerms } from '../src/analyze/keywords.ts';
import { normalizeText } from '../src/analyze/text.ts';

function sample(name: string): string {
  return normalizeText(readFileSync(new URL(`../public/samples/${name}`, import.meta.url), 'utf8'));
}

const RESUME = sample('resume.txt');
const TERMS = extractJobTerms(sample('job-description.txt'));

describe('extractBullets: the sample resume', () => {
  const bullets = extractBullets(RESUME);

  it('finds the 12 bullets in order', () => {
    assert.equal(bullets.length, 12);
    assert.ok(bullets[0]?.startsWith('Responsible for building new features'));
    assert.ok(bullets[11]?.startsWith('Supported customers by email'));
  });

  it('leaves out the summary, skills, education and certification lines', () => {
    const all = bullets.join('\n');
    for (const text of ['Software engineer with 6 years', 'JavaScript, TypeScript, React', 'Bachelor of Information', 'AWS Certified', 'alex.taylor@example.com']) {
      assert.ok(!all.includes(text), text);
    }
  });

  it('finds the same bullets when the symbols are missing', () => {
    const plain = extractBullets(RESUME.replace(/^- /gm, ''));
    assert.deepEqual(plain, bullets);
  });
});

describe('extractBullets: layout', () => {
  it('only uses experience-style sections', () => {
    const text = [
      'SUMMARY',
      '- Engineer with many years of experience building web apps for clients',
      'EXPERIENCE',
      '- Built a billing system for forty clients in the north',
      'SKILLS',
      '- Managed everything across the whole department every single day',
      'EDUCATION',
      '- Graduated with a first class degree from the local university',
      'CERTIFICATIONS',
      '- Completed the advanced cloud certification exam in 2022 with distinction',
    ].join('\n');
    assert.deepEqual(extractBullets(text), ['Built a billing system for forty clients in the north']);
  });

  it('knows common heading styles', () => {
    const text = [
      '## Skills & Experience',
      '- Built a billing system for forty clients in the north',
      '**Technical Skills**',
      '- Managed everything across the whole department every single day',
      'Personal Projects:',
      '- Wrote a small budgeting app for my family and friends',
      'Education and Training',
      '- Graduated with a first class degree from the local university',
    ].join('\n');
    assert.deepEqual(extractBullets(text), [
      'Built a billing system for forty clients in the north',
      'Wrote a small budgeting app for my family and friends',
    ]);
  });

  it('does not treat a job title as a heading', () => {
    const text = [
      'EXPERIENCE',
      'Training Coordinator',
      '- Built a training plan for twelve new starters each year',
      '- Ran the induction day for every new team member',
      '- Wrote the staff handbook for the whole company',
    ].join('\n');
    assert.equal(extractBullets(text).length, 3);
  });

  it('accepts many bullet styles', () => {
    const text = [
      'EXPERIENCE',
      '\u2022 Built the booking site for a local gym chain',
      '\u25CF Reduced support tickets by twenty percent',
      '\u25AA Trained new staff on the roster system',
      '- Led the weekly planning meeting for the team',
      '* Wrote tests for the payment code base',
      '1. Moved the old server to a managed cloud host',
      '2) Cleaned up the shared drive and added rules',
      '\uF0B7 Ran monthly demos for the main stakeholders',
    ].join('\n');
    assert.deepEqual(extractBullets(text), [
      'Built the booking site for a local gym chain',
      'Reduced support tickets by twenty percent',
      'Trained new staff on the roster system',
      'Led the weekly planning meeting for the team',
      'Wrote tests for the payment code base',
      'Moved the old server to a managed cloud host',
      'Cleaned up the shared drive and added rules',
      'Ran monthly demos for the main stakeholders',
    ]);
  });

  it('joins a line that wrapped in the middle of a sentence', () => {
    const text = [
      'EXPERIENCE',
      '\u2022 Built and maintained the customer billing platform that is used by more than',
      'two hundred staff across the whole company',
      '\u2022 Fixed the broken build for the team',
    ].join('\n');
    assert.deepEqual(extractBullets(text), [
      'Built and maintained the customer billing platform that is used by more than two hundred staff across the whole company',
      'Fixed the broken build for the team',
    ]);
  });

  it('joins a wrapped line that starts with a capital letter when the line above was full', () => {
    const text = [
      'EXPERIENCE',
      '\u2022 Led a team of five engineers through a long migration of all systems to the',
      'Cloud platform and cut running costs in the first year',
    ].join('\n');
    assert.deepEqual(extractBullets(text), [
      'Led a team of five engineers through a long migration of all systems to the Cloud platform and cut running costs in the first year',
    ]);
  });

  it('does not join a job title line that follows a bullet', () => {
    const text = [
      'EXPERIENCE',
      '\u2022 Led a team of five engineers through a migration to the cloud',
      'Junior Engineer, Beta Ltd, Wellington',
      'January 2019 - February 2021',
      '\u2022 Fixed the broken build for the team',
    ].join('\n');
    assert.deepEqual(extractBullets(text), [
      'Led a team of five engineers through a migration to the cloud',
      'Fixed the broken build for the team',
    ]);
  });

  it('handles a bullet symbol that sits alone on its line', () => {
    const text = ['EXPERIENCE', '\u2022', 'Built a reporting dashboard that cut manual work by half', '\u2022', 'Trained twelve new staff on the order system'].join('\n');
    assert.deepEqual(extractBullets(text), [
      'Built a reporting dashboard that cut manual work by half',
      'Trained twelve new staff on the order system',
    ]);
  });

  it('uses every bullet when the resume has no headings', () => {
    const text = ['- Built a reporting dashboard that cut manual work by half', '- Trained twelve new staff on the order system', '- Led the weekly planning meeting'].join('\n');
    assert.equal(extractBullets(text).length, 3);
  });

  it('uses bullets from any section when no section looks like experience', () => {
    const text = ['SKILLS', '- Managed the department budget and reports every month'].join('\n');
    assert.deepEqual(extractBullets(text), ['Managed the department budget and reports every month']);
  });

  it('splits a paragraph into sentences and keeps the ones that start like achievements', () => {
    const text = 'I am a hard worker. Experienced engineer with a proven record. Managed a small team of five people at the shop. Reduced waiting time by 20% in the call centre.';
    assert.deepEqual(extractBullets(text), ['Managed a small team of five people at the shop.', 'Reduced waiting time by 20% in the call centre.']);
  });

  it('removes bold marks from Markdown', () => {
    assert.deepEqual(extractBullets('- **Built** a new system for the team'), ['Built a new system for the team']);
  });

  it('returns nothing for text without bullets', () => {
    assert.deepEqual(extractBullets(''), []);
    assert.deepEqual(extractBullets('Just a name\nAuckland'), []);
  });
});

describe('extractBullets: what it leaves out', () => {
  it('skips contact lines, skill lists, labels, very short and very long lines', () => {
    const text = [
      'EXPERIENCE',
      '- Email me at alex.taylor@example.com for a longer version of this',
      '- Portfolio at https://example.com/alex with all of my best work',
      '- Call 021 000 0000 any time to talk about my work history',
      '- JavaScript, TypeScript, React, Node.js, Express, Docker',
      '- Tech stack: React, Node, Postgres and AWS for everything',
      '- Fixed bugs',
      `- Built ${'a very detailed internal reporting tool '.repeat(12)}`,
      '- Built a booking site for a local gym chain',
    ].join('\n');
    assert.deepEqual(extractBullets(text), ['Built a booking site for a local gym chain']);
  });

  it('keeps a bullet that has a year range in it', () => {
    const bullets = extractBullets('- Reduced costs by 15% between 2019-2021 across the whole team');
    assert.equal(bullets.length, 1);
  });

  it('removes duplicates', () => {
    const line = '- Built a booking site for a local gym chain';
    assert.equal(extractBullets([line, line, line.toUpperCase()].join('\n')).length, 1);
  });

  it('stops at the limit', () => {
    const lines = Array.from({ length: MAX_BULLETS + 20 }, (_, index) => `- Built feature number ${index} for the customer portal`);
    assert.equal(extractBullets(lines.join('\n')).length, MAX_BULLETS);
  });
});

describe('pickBullets', () => {
  const bullets = extractBullets(RESUME);

  it('returns the default number, with ids that point back into the list', () => {
    const picked = pickBullets(bullets, TERMS);
    assert.equal(picked.length, DEFAULT_PICK);
    for (const item of picked) assert.equal(bullets[item.id - 1], item.text);
  });

  it('puts weak bullets that touch the job before strong ones', () => {
    const picked = pickBullets(bullets, TERMS);
    const ids = picked.map((item) => item.id);
    const weakApi = ids.indexOf(2);
    const strongLoad = ids.indexOf(5);
    assert.ok(weakApi !== -1 && weakApi < (strongLoad === -1 ? Infinity : strongLoad), `ids were ${ids.join(',')}`);
    assert.ok((picked[0]?.relevance ?? 0) > 0);
    assert.ok((picked[0]?.weakness ?? 0) > 0);
  });

  it('puts a strong bullet that has no link to the job last', () => {
    const list = ['Reduced customer waiting time by 40% in the main branch', 'Worked on the REST API and the PostgreSQL database.', 'Helped with deployments to AWS using GitHub Actions.'];
    assert.deepEqual(
      pickBullets(list, TERMS).map((item) => item.id),
      [2, 3, 1],
    );
  });

  it('keeps the resume order when bullets tie', () => {
    const list = ['Reduced customer waiting time by 40% in the main branch', 'Cut the cost of printing by 15% for the whole office'];
    assert.deepEqual(
      pickBullets(list, TERMS).map((item) => item.id),
      [1, 2],
    );
  });

  it('respects the limit and keeps it between 1 and the maximum', () => {
    assert.equal(pickBullets(bullets, TERMS, 2).length, 2);
    assert.equal(pickBullets(bullets, TERMS, 0).length, DEFAULT_PICK);
    assert.equal(pickBullets(bullets, TERMS, Number.NaN).length, DEFAULT_PICK);
    assert.equal(pickBullets(bullets, TERMS, -5).length, 1);
    const many = Array.from({ length: 30 }, (_, index) => `Built feature number ${index} for the portal`);
    assert.equal(pickBullets(many, TERMS, 99).length, MAX_PICK);
  });

  it('returns an empty list when there are no bullets', () => {
    assert.deepEqual(pickBullets([], TERMS), []);
  });
});
