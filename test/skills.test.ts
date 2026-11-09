import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { findSkills, getSkill, SKILLS, skillIdByKey, withImplied } from '../src/analyze/skills.ts';

function labels(text: string): string[] {
  return findSkills(text).map((hit) => getSkill(hit.skill).label);
}

describe('skill dictionary', () => {
  it('loads without duplicate aliases and is large enough to be useful', () => {
    assert.ok(SKILLS.length > 400);
    for (const skill of SKILLS) assert.equal(skill.key, skill.label.toLowerCase());
  });
});

describe('findSkills', () => {
  it('finds tools, with different spellings', () => {
    assert.deepEqual(labels('We use Node.js, React and PostgreSQL.'), ['Node.js', 'React', 'PostgreSQL']);
    assert.deepEqual(labels('nodejs / node js / Node.JS'), ['Node.js', 'Node.js', 'Node.js']);
    assert.deepEqual(labels('problem-solving and problem solving'), ['Problem Solving', 'Problem Solving']);
  });

  it('prefers the longest alias', () => {
    assert.deepEqual(labels('machine learning'), ['Machine Learning']);
    assert.deepEqual(labels('CI/CD pipelines on GitHub Actions'), ['CI/CD', 'GitHub Actions']);
    assert.deepEqual(labels('Experience with Azure DevOps'), ['Azure DevOps']);
  });

  it('reads plurals', () => {
    assert.deepEqual(labels('Designed APIs and microservices'), ['REST APIs', 'Microservices']);
    assert.deepEqual(labels('Built dashboards for stakeholders'), ['Data Visualization', 'Stakeholder Management']);
    assert.deepEqual(labels('tax returns and reconciliations'), ['Tax', 'Reconciliation']);
  });

  it('handles C++, C# and .NET', () => {
    assert.deepEqual(labels('C++ and C#'), ['C++', 'C#']);
    assert.deepEqual(labels('ASP.NET Core and .NET 8'), ['.NET', '.NET']);
    assert.deepEqual(labels('the internet'), []);
  });

  it('does not join words across a comma or a full stop', () => {
    assert.deepEqual(labels('integration, testing'), []);
    assert.deepEqual(labels('Good at integration. Testing follows.'), []);
    assert.deepEqual(labels('integration testing'), ['Integration Testing']);
  });

  it('gives positions that point at the match', () => {
    const text = 'Built with TypeScript today';
    const [hit] = findSkills(text);
    assert.ok(hit);
    assert.equal(text.slice(hit.start, hit.end), 'TypeScript');
  });
});

describe('ambiguous words', () => {
  it('accepts Go and R in lists and after "in" or "with"', () => {
    assert.deepEqual(labels('Experience with Go and Python'), ['Go', 'Python']);
    assert.deepEqual(labels('Languages: Go, Python, SQL'), ['Go', 'Python', 'SQL']);
    assert.deepEqual(labels('Python, R, SQL'), ['Python', 'R', 'SQL']);
    assert.deepEqual(labels('proficiency in R'), ['R']);
    assert.deepEqual(labels('tools such as Excel, Power BI'), ['Excel', 'Power BI']);
    assert.deepEqual(labels('Go, Rust, Python'), ['Go', 'Rust', 'Python']);
  });

  it('rejects normal English uses', () => {
    assert.deepEqual(labels('Go live in Q4'), []);
    assert.deepEqual(labels('We go to the shops'), []);
    assert.deepEqual(labels('R&D budget'), ['Budget Management']);
    assert.deepEqual(labels('Excel in a fast-paced role'), []);
    assert.deepEqual(labels('You will excel at this'), []);
    assert.deepEqual(labels('a spark of creativity'), ['Creativity']);
    assert.deepEqual(labels('Vitamin C helps'), []);
    assert.deepEqual(labels('Plan A, B and C'), []);
    assert.deepEqual(labels('We rely on rust and oil'), []);
  });

  it('keeps Go-to-Market as its own skill', () => {
    assert.deepEqual(labels('Own the go-to-market plan'), ['Go-to-Market']);
  });

  it('needs the exact spelling', () => {
    assert.deepEqual(labels('with EXCEL and with excel'), []);
    assert.deepEqual(labels('React, Node, AWS'), ['React', 'Node.js', 'AWS']);
  });

  it('accepts a language list at the start of a line', () => {
    assert.deepEqual(labels('Go, Python, SQL'), ['Go', 'Python', 'SQL']);
    assert.deepEqual(labels('• Go, Python'), ['Go', 'Python']);
  });
});

describe('implied skills', () => {
  it('lets one skill prove another', () => {
    const react = skillIdByKey('react');
    const javascript = skillIdByKey('javascript');
    assert.ok(react !== undefined && javascript !== undefined);
    assert.ok(withImplied([react]).has(javascript));
  });

  it('follows chains', () => {
    const next = skillIdByKey('next.js');
    const javascript = skillIdByKey('javascript');
    assert.ok(next !== undefined && javascript !== undefined);
    assert.ok(withImplied([next]).has(javascript));
  });

  it('does not go the other way', () => {
    const react = skillIdByKey('react');
    const javascript = skillIdByKey('javascript');
    assert.ok(react !== undefined && javascript !== undefined);
    assert.ok(!withImplied([javascript]).has(react));
  });

  it('treats Grafana as monitoring', () => {
    const grafana = skillIdByKey('grafana');
    const monitoring = skillIdByKey('monitoring and observability');
    assert.ok(grafana !== undefined && monitoring !== undefined);
    assert.ok(withImplied([grafana]).has(monitoring));
  });
});

describe('people in the job text', () => {
  it('does not count the people you work with as a skill', () => {
    assert.deepEqual(labels('You will work with product managers and designers'), []);
    assert.deepEqual(labels('Led planning with the product owner'), ['Leadership']);
    assert.deepEqual(labels('Partner with senior leaders and the project manager'), []);
    assert.deepEqual(labels('Collaborate with designers, data scientists and product managers'), ['Collaboration']);
    assert.deepEqual(labels('Report findings to product owners'), []);
    assert.deepEqual(labels('Present results to senior leaders every month'), []);
  });

  it('still counts a title or a role you hold', () => {
    assert.deepEqual(labels('Senior Product Manager'), ['Product Management']);
    assert.deepEqual(labels('Promoted to Team Lead in 2022'), ['Leadership']);
    assert.deepEqual(labels('5+ years as a business analyst'), ['Business Analysis']);
    assert.deepEqual(labels('We need a project manager'), ['Project Management']);
    assert.deepEqual(labels('Worked with the team as a project manager'), ['Project Management']);
    assert.deepEqual(labels('Worked with clients. Project manager for 3 years'), ['Project Management']);
  });
});

describe('generic words', () => {
  it('needs more than the word "strategy" or "analyse" for a soft skill', () => {
    assert.deepEqual(labels('Own the SEO and paid search strategy'), ['SEO', 'SEM']);
    assert.deepEqual(labels('Analyse data using SQL'), ['Data Analysis', 'SQL']);
    assert.deepEqual(labels('Strong analytical skills'), ['Analytical Skills']);
  });
});
