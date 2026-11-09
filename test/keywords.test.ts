import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  countStemMatch,
  extractJobTerms,
  profileResume,
  termWeight,
  type JobTerm,
} from '../src/analyze/keywords.ts';
import { stem } from '../src/analyze/text.ts';
import { skillIdByKey } from '../src/analyze/skills.ts';

function byKey(terms: readonly JobTerm[], key: string): JobTerm | undefined {
  return terms.find((term) => term.key === key);
}

describe('extractJobTerms: skills', () => {
  const job = [
    'About us',
    'We make boats and we offer mentoring and a learning budget.',
    'Requirements',
    '- 5+ years of React and Node.js',
    '- Docker',
    'Nice to have',
    '- GraphQL',
    '- React Native',
    'Benefits',
    'Free coaching, flexible hours.',
  ].join('\n');
  const terms = extractJobTerms(job);

  it('finds skills with the importance of their section', () => {
    assert.equal(byKey(terms, 'skill:react')?.importance, 'required');
    assert.equal(byKey(terms, 'skill:docker')?.importance, 'required');
    assert.equal(byKey(terms, 'skill:graphql')?.importance, 'preferred');
  });

  it('does not take skills from company or benefits text', () => {
    assert.equal(byKey(terms, 'skill:mentoring'), undefined);
    assert.equal(terms.some((term) => /coaching|mentor/i.test(term.label)), false);
  });

  it('gives a snippet from the job description', () => {
    assert.equal(byKey(terms, 'skill:docker')?.snippet, 'Docker');
    assert.match(byKey(terms, 'skill:graphql')?.snippet ?? '', /GraphQL/);
  });

  it('counts mentions and keeps the strongest importance', () => {
    const text = 'Nice to have\nSQL\nRequirements\nSQL and Python\nYou use SQL daily.';
    const sql = byKey(extractJobTerms(text), 'skill:sql');
    assert.equal(sql?.count, 3);
    assert.equal(sql?.importance, 'required');
  });

  it('marks the kind of the term', () => {
    const found = extractJobTerms('Requirements\nPython, communication and teamwork');
    assert.equal(byKey(found, 'skill:python')?.kind, 'hard');
    assert.equal(byKey(found, 'skill:communication')?.kind, 'soft');
  });

  it('does not take skills from an email or a link', () => {
    const found = extractJobTerms('Send questions to python@example.com or visit https://react.example.com/jobs.');
    assert.deepEqual(found, []);
  });

  it('puts the text of a long sentence around the match', () => {
    const filler = 'This is a very long sentence about many different things that we do every single day. ';
    const text = `Requirements\n${filler.repeat(4)}You need Kubernetes experience. ${filler.repeat(4)}`;
    const snippet = byKey(extractJobTerms(text), 'skill:kubernetes')?.snippet ?? '';
    assert.match(snippet, /Kubernetes/);
    assert.ok(snippet.length < 200);
  });
});

describe('extractJobTerms: phrases', () => {
  it('keeps a two-word phrase that the job repeats', () => {
    const text = 'Requirements\nExperience in widget polishing.\nWe value widget polishing skills.';
    const phrase = extractJobTerms(text).find((term) => term.kind === 'phrase');
    assert.equal(phrase?.label, 'widget polishing');
    assert.equal(phrase?.count, 2);
    assert.deepEqual(phrase?.stems, ['widget', 'polish']);
  });

  it('ignores a phrase that appears once', () => {
    const text = 'Requirements\nExperience in widget polishing. Python.';
    assert.equal(extractJobTerms(text).filter((term) => term.kind === 'phrase').length, 0);
  });

  it('prefers the longer phrase when it repeats as often', () => {
    const text = 'Requirements\nQuantum widget polishing is key.\nWe need quantum widget polishing daily.';
    const labels = extractJobTerms(text)
      .filter((term) => term.kind === 'phrase')
      .map((term) => term.label);
    assert.deepEqual(labels, ['quantum widget polishing']);
  });

  it('does not join words across a comma or a sentence', () => {
    const text = 'Requirements\nwidget, polishing. widget, polishing. widget. Polishing.';
    assert.equal(extractJobTerms(text).filter((term) => term.kind === 'phrase').length, 0);
  });

  it('does not use words that the dictionary already covers or that are filler', () => {
    const text = 'Requirements\nReact development and React development. You will work with a great team. A great team.';
    const phrases = extractJobTerms(text).filter((term) => term.kind === 'phrase');
    assert.deepEqual(phrases, []);
  });

  it('does not take phrases from company text', () => {
    const text = 'About us\nWidget polishing is our passion. Widget polishing is fun.\nRequirements\nPython';
    assert.equal(extractJobTerms(text).filter((term) => term.kind === 'phrase').length, 0);
  });
});

describe('termWeight', () => {
  it('weighs must-haves above standard and preferred terms', () => {
    assert.equal(termWeight('required', 1, 'hard'), 3);
    assert.equal(termWeight('standard', 1, 'hard'), 2);
    assert.equal(termWeight('preferred', 1, 'hard'), 1);
  });

  it('adds weight for repeats, up to double', () => {
    assert.equal(termWeight('required', 2, 'hard'), 3.75);
    assert.equal(termWeight('required', 5, 'hard'), 6);
    assert.equal(termWeight('required', 50, 'hard'), 6);
  });

  it('counts soft skills and phrases for less', () => {
    assert.equal(termWeight('required', 1, 'soft'), 1.8);
    assert.equal(termWeight('required', 1, 'phrase'), 1.5);
  });
});

describe('profileResume and countStemMatch', () => {
  const pair = ['stakeholder', 'management'].map(stem);

  it('finds the words close together in any order', () => {
    assert.equal(countStemMatch(profileResume('I managed stakeholders weekly'), pair), 1);
    assert.equal(countStemMatch(profileResume('Stakeholder management is my focus'), pair), 1);
    assert.equal(countStemMatch(profileResume('Management of stakeholders'), pair), 1);
  });

  it('does not match words that are far apart or in different sentences', () => {
    assert.equal(countStemMatch(profileResume('stakeholders were happy with our work on the management'), pair), 0);
    assert.equal(countStemMatch(profileResume('I met stakeholders. Management agreed.'), pair), 0);
  });

  it('counts each place once', () => {
    const profile = profileResume('Stakeholder management. Managed stakeholders.');
    assert.equal(countStemMatch(profile, pair), 2);
  });

  it('records implied skills but not skills the resume names', () => {
    const profile = profileResume('Built apps with Next.js. Also React.');
    const javascript = skillIdByKey('javascript');
    const react = skillIdByKey('react');
    assert.ok(javascript !== undefined && react !== undefined);
    // Next.js proves JavaScript, which the resume does not name. It also proves React, which the resume names.
    assert.ok(profile.implied.has(javascript));
    assert.equal(profile.implied.has(react), false);
    assert.ok(profile.skillCounts.has(react));
  });

  it('blanks emails and links so they do not count as skills', () => {
    const profile = profileResume('python@example.com https://react.example.com');
    assert.equal(profile.skillCounts.size, 0);
  });
});
