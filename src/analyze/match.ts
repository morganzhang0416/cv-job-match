import type { BreakdownRow, KeywordResult, MatchLevel, MatchResult } from './types.ts';
import { countStemMatch, IMPORTANCE_RANK, profileResume, type JobTerm, type ResumeProfile } from './keywords.ts';
import { getSkill } from './skills.ts';

const LEVELS: ReadonlyArray<readonly [number, MatchLevel]> = [
  [80, 'excellent'],
  [65, 'strong'],
  [50, 'fair'],
  [35, 'partial'],
];

const VERDICT: Record<MatchLevel, string> = {
  excellent: 'Excellent match',
  strong: 'Strong match',
  fair: 'Fair match',
  partial: 'Partial match',
  low: 'Low match',
};

const ADVICE: Record<MatchLevel, string> = {
  excellent: 'Your resume fits this job very well. Use the bullet ideas below to make it even sharper.',
  strong: 'Your resume fits this job well. Add the missing keywords where they are true to raise the score.',
  fair: 'Your resume fits part of this job. Start with the missing must-haves, and only where they are true.',
  partial:
    'Your resume fits only a small part of this job. Add real examples for the missing must-haves, or check that this job is the right one for you.',
  low: 'Your resume does not fit this job well yet. Check that you chose the right resume and job, then add real examples for the missing must-haves.',
};

export function levelFor(score: number): MatchLevel {
  for (const [minimum, level] of LEVELS) {
    if (score >= minimum) return level;
  }
  return 'low';
}

interface CountOptions {
  /** Count a skill as present when the resume names a skill that proves it (React proves JavaScript). */
  implied: boolean;
}

/** How many times the resume covers a job term. 0 means the term is missing. */
export function countTerm(term: JobTerm, profile: ResumeProfile, options: CountOptions = { implied: true }): number {
  if (term.skill === null) return term.stems ? countStemMatch(profile, term.stems) : 0;
  const direct = profile.skillCounts.get(term.skill);
  if (direct) return direct;
  if (options.implied && profile.implied.has(term.skill)) return 1;
  const stems = getSkill(term.skill).labelStems;
  return stems ? countStemMatch(profile, stems) : 0;
}

/**
 * The keys of the job terms that a short text names (for example one bullet).
 * Implied skills do not count here, so this shows which words the text really uses.
 */
export function termKeysIn(terms: readonly JobTerm[], text: string): Set<string> {
  const profile = profileResume(text);
  const keys = new Set<string>();
  for (const term of terms) {
    if (countTerm(term, profile, { implied: false }) > 0) keys.add(term.key);
  }
  return keys;
}

function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

function breakdownRow(key: string, label: string, items: readonly KeywordResult[]): BreakdownRow | null {
  if (items.length === 0) return null;
  const matched = items.filter((item) => item.resumeCount > 0).length;
  return { key, label, matched, total: items.length, percent: Math.round((100 * matched) / items.length) };
}

function summarize(level: MatchLevel, matched: number, total: number, missing: readonly KeywordResult[]): string {
  const parts = [`Your resume covers ${matched} of ${total} keywords from the job description.`];
  if (missing.length === 0) {
    parts.push('Nothing is missing.');
  } else {
    const musts = missing.filter((item) => item.importance === 'required').length;
    const extra = musts > 0 ? `, and ${musts} of them ${plural(musts, 'is a must-have', 'are must-haves')}` : '';
    parts.push(`${missing.length} ${plural(missing.length, 'keyword is', 'keywords are')} missing${extra}.`);
  }
  parts.push(ADVICE[level]);
  return parts.join(' ');
}

/** Compares the job terms with the resume and builds the score, the breakdown and the keyword lists. */
export function scoreMatch(terms: readonly JobTerm[], profile: ResumeProfile): MatchResult {
  let total = 0;
  let earned = 0;
  const results: KeywordResult[] = [];
  for (const term of terms) {
    const resumeCount = countTerm(term, profile);
    total += term.weight;
    if (resumeCount > 0) earned += term.weight;
    results.push({
      key: term.key,
      label: term.label,
      kind: term.kind,
      category: term.category,
      importance: term.importance,
      jobCount: term.count,
      resumeCount,
      weight: round(term.weight, 2),
      snippet: term.snippet,
    });
  }

  const byValue = (a: KeywordResult, b: KeywordResult): number =>
    b.weight - a.weight ||
    IMPORTANCE_RANK[b.importance] - IMPORTANCE_RANK[a.importance] ||
    a.label.localeCompare(b.label);
  const matched = results.filter((item) => item.resumeCount > 0).sort(byValue);
  const missing = results.filter((item) => item.resumeCount === 0).sort(byValue);

  // 100 means nothing is missing, so a rounded-up 100 is capped at 99.
  const raw = total > 0 ? Math.round((100 * earned) / total) : 0;
  const score = missing.length === 0 ? 100 : Math.min(99, raw);
  const level = levelFor(score);

  const skillsOnly = results.filter((item) => item.kind !== 'phrase');
  const breakdown = [
    breakdownRow(
      'must-have',
      'Must-have skills',
      skillsOnly.filter((item) => item.importance === 'required'),
    ),
    breakdownRow(
      'technical',
      'Technical and professional skills',
      results.filter((item) => item.kind === 'hard'),
    ),
    breakdownRow(
      'soft',
      'Soft skills',
      results.filter((item) => item.kind === 'soft'),
    ),
    breakdownRow(
      'other',
      'Other keywords',
      results.filter((item) => item.kind === 'phrase'),
    ),
  ].filter((row): row is BreakdownRow => row !== null);

  return {
    score,
    level,
    verdict: VERDICT[level],
    summary: summarize(level, matched.length, results.length, missing),
    breakdown,
    matched,
    missing,
  };
}
