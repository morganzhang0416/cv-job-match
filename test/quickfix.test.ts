import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { assess, opensWithAction, quickFix, weaknessOf } from '../src/analyze/quickfix.ts';

const numbersIn = (text: string): string[] => text.match(/\d[\d,.]*/g) ?? [];

describe('quickFix: rewrites only the weak opener', () => {
  const cases: Array<[string, string]> = [
    ['Responsible for building new features in React for 300 shops.', 'Built new features in React for 300 shops.'],
    ['Responsible for keeping the Git repositories tidy.', 'Kept the Git repositories tidy.'],
    ['I was responsible for managing the help desk', 'Managed the help desk'],
    ['Primarily responsible for testing the release builds', 'Tested the release builds'],
    ['Responsible for the payroll system', 'Owned the payroll system'],
    ['Worked on the REST API and the PostgreSQL database.', 'Contributed to the REST API and the PostgreSQL database.'],
    ['Worked closely with designers and testers.', 'Collaborated closely with designers and testers.'],
    ['Worked with React and Node.js every day.', 'Used React and Node.js every day.'],
    ['Helped with deployments to AWS (EC2 and S3) using GitHub Actions.', 'Supported deployments to AWS (EC2 and S3) using GitHub Actions.'],
    ['Assisted with month-end reporting', 'Supported month-end reporting'],
    ['Participated in code reviews for the team', 'Contributed to code reviews for the team'],
    ['Was involved in the move to a new server', 'Contributed to the move to a new server'],
    ['Handled customer complaints by phone', 'Managed customer complaints by phone'],
    ['I improved the company website and fixed many bugs.', 'Improved the company website and fixed many bugs.'],
    ['I led the weekly planning meeting', 'Led the weekly planning meeting'],
  ];

  for (const [input, expected] of cases) {
    it(input, () => {
      const result = quickFix(input);
      assert.equal(result.rewrite, expected);
      assert.deepEqual(numbersIn(result.rewrite ?? ''), numbersIn(input), 'numbers must stay the same');
    });
  }

  it('returns no rewrite when no rule fits, and keeps the tips', () => {
    for (const input of [
      'Reduced the page load time of the checkout page by 35%.',
      'Worked as a cashier at the main store',
      'Worked with a lot of different things.',
    ]) {
      assert.equal(quickFix(input).rewrite, null, input);
    }
    const weak = quickFix('Worked as a cashier at the main store');
    assert.ok(weak.tips.some((tip) => tip.includes('action verb')));
  });

  it('gives tips for the new text, not the old text', () => {
    const result = quickFix('Responsible for building new features in React for 300 shops.');
    assert.deepEqual(result.tips, []);
  });

  it('does not make a rewrite that is too short to be useful', () => {
    assert.equal(quickFix('I helped.').rewrite, null);
  });

  it('keeps a missing final full stop missing', () => {
    assert.equal(quickFix('Helped with deployments to AWS').rewrite, 'Supported deployments to AWS');
  });
});

describe('assess', () => {
  it('has nothing to say about a strong bullet', () => {
    const result = assess('Built a REST API that handles 2M requests a day.');
    assert.deepEqual(result, { tips: [], weakness: 0 });
  });

  it('flags a weak, short bullet without numbers', () => {
    const result = assess('Worked on the API.');
    assert.equal(result.tips.length, 3);
    assert.equal(result.weakness, 5);
  });

  it('flags first person', () => {
    const result = assess('I was responsible for the website');
    assert.ok(result.tips.some((tip) => tip.includes('Remove "I"')));
  });

  it('flags passive voice but not "was open"', () => {
    assert.ok(assess('The tests were written by me for all services in the project').tips.some((tip) => tip.includes('active voice')));
    assert.ok(!assess('Led a team that was open to new ideas and ran 12 experiments').tips.some((tip) => tip.includes('active voice')));
  });

  it('flags a bullet that is too long', () => {
    const long = `Built ${'a very detailed internal reporting tool '.repeat(8)}for 12 teams.`;
    assert.ok(assess(long).tips.some((tip) => tip.includes('long')));
  });

  it('accepts several number styles', () => {
    for (const text of ['Cut costs by $2k a month', 'Cut costs by 15% in a year', 'Trained 40 new staff', 'Saved about 1,200 hours']) {
      assert.ok(!assess(text).tips.some((tip) => tip.includes('Add a number')), text);
    }
    assert.ok(assess('Used S3 and EC2 for the project files').tips.some((tip) => tip.includes('Add a number')));
  });

  it('weaknessOf matches assess', () => {
    assert.equal(weaknessOf('Worked on the API.'), assess('Worked on the API.').weakness);
  });
});

describe('opensWithAction', () => {
  it('accepts past-tense verbs, weak openers and "I" with a past verb', () => {
    for (const text of ['Built a thing for the team', 'Led the weekly meeting', 'I improved the site', 'Responsible for the site', 'We worked on the API']) {
      assert.equal(opensWithAction(text), true, text);
    }
  });

  it('rejects descriptions and titles', () => {
    for (const text of ['I am a hard worker', 'Experienced engineer with a proven record', 'Software engineer with 6 years of experience', 'Motivated team player']) {
      assert.equal(opensWithAction(text), false, text);
    }
  });
});
