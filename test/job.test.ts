import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { segmentAt, segmentJob, type SegmentImportance } from '../src/analyze/job.ts';

function importanceOf(text: string, needle: string): SegmentImportance | undefined {
  const at = text.indexOf(needle);
  assert.ok(at >= 0, `"${needle}" is not in the text`);
  return segmentAt(segmentJob(text), at)?.importance;
}

describe('segmentJob: headings', () => {
  const job = [
    'About us',
    'We love dogs and coffee.',
    'Requirements',
    '- Experience with React',
    'Nice to have',
    '- GraphQL',
    'What you will do',
    '- Build web features',
  ].join('\n');

  it('reads the importance from the heading above', () => {
    assert.equal(importanceOf(job, 'React'), 'required');
    assert.equal(importanceOf(job, 'GraphQL'), 'preferred');
    assert.equal(importanceOf(job, 'web features'), 'standard');
  });

  it('ignores text about the company', () => {
    assert.equal(importanceOf(job, 'dogs'), 'ignored');
  });

  it('uses "standard" when there is no heading', () => {
    assert.equal(importanceOf('We build web apps with React.', 'React'), 'standard');
  });

  it('understands the different "About" headings', () => {
    const text = 'About you\nSQL\nAbout the role\nPython\nAbout Acme\nRust';
    assert.equal(importanceOf(text, 'SQL'), 'required');
    assert.equal(importanceOf(text, 'Python'), 'standard');
    assert.equal(importanceOf(text, 'Rust'), 'ignored');
  });

  it('does not take a line with a skill as a heading', () => {
    const text = 'Nice to have\nExperience with React\nSome other line';
    assert.equal(importanceOf(text, 'Experience with React'), 'preferred');
  });

  it('keeps the section when a heading is unknown', () => {
    const text = 'Requirements\nThe Team\nPython experience';
    assert.equal(importanceOf(text, 'Python'), 'required');
  });

  it('does not take a bullet as a heading', () => {
    const text = 'Requirements\n- Benefits\nSQL';
    assert.equal(importanceOf(text, 'SQL'), 'required');
  });

  it('works with numbered lists and bullet glyphs', () => {
    const text = 'Nice to have\n1. Kotlin\n• Swift\n2) Dart';
    assert.equal(importanceOf(text, 'Kotlin'), 'preferred');
    assert.equal(importanceOf(text, 'Swift'), 'preferred');
    assert.equal(importanceOf(text, 'Dart'), 'preferred');
  });
});

describe('segmentJob: labels on one line', () => {
  it('applies the label to that line only', () => {
    const text = 'Required skills: Python and SQL\nNice to have: Rust\nThe team uses Go';
    assert.equal(importanceOf(text, 'Python'), 'required');
    assert.equal(importanceOf(text, 'Rust'), 'preferred');
    assert.equal(importanceOf(text, 'Go'), 'standard');
  });
});

describe('segmentJob: cue words', () => {
  it('reads "must", "required" and "years of" as required', () => {
    assert.equal(importanceOf('You must know SQL.', 'SQL'), 'required');
    assert.equal(importanceOf('Java is required.', 'Java'), 'required');
    assert.equal(importanceOf('5+ years of Python.', 'Python'), 'required');
    assert.equal(importanceOf('Proven expertise in Terraform.', 'Terraform'), 'required');
  });

  it('reads "a plus" and "nice to have" as preferred, even in a required section', () => {
    assert.equal(importanceOf('Kotlin is a plus.', 'Kotlin'), 'preferred');
    assert.equal(importanceOf('Requirements\nDocker is a plus', 'Docker'), 'preferred');
    assert.equal(importanceOf('Experience with Go is preferred.', 'Go'), 'preferred');
    assert.equal(importanceOf('Ideally you know Rust.', 'Rust'), 'preferred');
  });

  it('handles each sentence on its own', () => {
    const text = 'We use React. You must know SQL. GraphQL is a plus.';
    assert.equal(importanceOf(text, 'React'), 'standard');
    assert.equal(importanceOf(text, 'SQL'), 'required');
    assert.equal(importanceOf(text, 'GraphQL'), 'preferred');
  });

  it('treats a semicolon as a break', () => {
    const text = 'You must know SQL; Python is a plus';
    assert.equal(importanceOf(text, 'SQL'), 'required');
    assert.equal(importanceOf(text, 'Python'), 'preferred');
  });
});

describe('segmentJob: boilerplate', () => {
  it('ignores equal opportunity and perks even in a required section', () => {
    const text = [
      'Requirements',
      'We are an equal opportunity employer and welcome diversity.',
      'We offer health insurance and a learning budget.',
      'Send your CV to apply.',
      'Strong SQL skills.',
    ].join('\n');
    assert.equal(importanceOf(text, 'equal opportunity'), 'ignored');
    assert.equal(importanceOf(text, 'health insurance'), 'ignored');
    assert.equal(importanceOf(text, 'Send your CV'), 'ignored');
    assert.equal(importanceOf(text, 'SQL'), 'required');
  });

  it('ignores a benefits section until the next heading', () => {
    const text = 'Benefits\nFree mentoring\nResponsibilities\nWrite code';
    assert.equal(importanceOf(text, 'mentoring'), 'ignored');
    assert.equal(importanceOf(text, 'Write code'), 'standard');
  });
});

describe('segmentAt', () => {
  it('finds the segment of a position, and nothing outside', () => {
    const text = 'One sentence here. Another one there.';
    const segments = segmentJob(text);
    assert.equal(segments.length, 2);
    assert.equal(segmentAt(segments, 0), segments[0]);
    assert.equal(segmentAt(segments, text.indexOf('Another')), segments[1]);
    assert.equal(segmentAt(segments, 9999), undefined);
  });

  it('gives segments that point at the right text', () => {
    const text = 'Requirements\n- Python and SQL\n- Docker';
    const texts = segmentJob(text).map((segment) => text.slice(segment.start, segment.end));
    assert.deepEqual(texts, ['Python and SQL', 'Docker']);
  });
});
