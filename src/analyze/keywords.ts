import type { Importance, TermKind } from './types.ts';
import { segmentAt, segmentJob, type JobSegment } from './job.ts';
import { findSkills, getSkill, joinReach, withImplied, type SkillHit } from './skills.ts';
import { blankContacts, excerpt, normalizeText, stem, tokenize, type Token } from './text.ts';
import { FILLER, STOPWORDS } from './words.ts';

/** One thing the job asks for: a skill from the dictionary, or a phrase that the job repeats. */
export interface JobTerm {
  key: string;
  label: string;
  kind: TermKind;
  category: string;
  importance: Importance;
  /** How many times the job description mentions it. */
  count: number;
  snippet: string;
  weight: number;
  /** Set when the term is a dictionary skill (a skill id). */
  skill: number | null;
  /** Set when the term is a repeated phrase: the stems of its words. */
  stems: string[] | null;
}

/** Higher means the job cares more. */
export const IMPORTANCE_RANK: Readonly<Record<Importance, number>> = { preferred: 0, standard: 1, required: 2 };
const RANK = IMPORTANCE_RANK;
const BASE_WEIGHT: Record<Importance, number> = { required: 3, standard: 2, preferred: 1 };
const KIND_FACTOR: Record<TermKind, number> = { hard: 1, soft: 0.6, phrase: 0.5 };

const MAX_PHRASES = 10;

/**
 * How much a term counts toward the score.
 * Must-haves count most. A term that the job repeats counts a little more (up to 2x at five mentions).
 * Soft skills and loose phrases count less than named skills.
 */
export function termWeight(importance: Importance, count: number, kind: TermKind): number {
  const repeat = 1 + 0.25 * (Math.min(Math.max(count, 1), 5) - 1);
  return Math.round(BASE_WEIGHT[importance] * repeat * KIND_FACTOR[kind] * 1000) / 1000;
}

interface Mention {
  count: number;
  importance: Importance;
  segment: JobSegment;
  focus: number;
}

function addMention(found: Map<string, Mention>, key: string, segment: JobSegment, focus: number): void {
  if (segment.importance === 'ignored') return;
  const importance = segment.importance;
  const entry = found.get(key);
  if (!entry) {
    found.set(key, { count: 1, importance, segment, focus });
    return;
  }
  entry.count++;
  if (RANK[importance] > RANK[entry.importance]) {
    entry.importance = importance;
    entry.segment = segment;
    entry.focus = focus;
  }
}

function skillTerms(text: string, segments: readonly JobSegment[], hits: readonly SkillHit[]): JobTerm[] {
  const found = new Map<string, Mention>();
  for (const hit of hits) {
    const segment = segmentAt(segments, hit.start);
    if (segment) addMention(found, String(hit.skill), segment, hit.start);
  }
  return [...found].map(([id, mention]) => {
    const skill = getSkill(Number(id));
    return {
      key: `skill:${skill.key}`,
      label: skill.label,
      kind: skill.kind,
      category: skill.categoryLabel,
      importance: mention.importance,
      count: mention.count,
      snippet: excerpt(text, mention.segment.start, mention.segment.end, mention.focus),
      weight: termWeight(mention.importance, mention.count, skill.kind),
      skill: skill.id,
      stems: null,
    };
  });
}

interface PhraseCandidate {
  words: string[];
  stems: string[];
}

function isSubsequence(small: readonly string[], big: readonly string[]): boolean {
  for (let start = 0; start + small.length <= big.length; start++) {
    if (small.every((value, offset) => big[start + offset] === value)) return true;
  }
  return false;
}

/** Two or three word phrases that the job repeats and that are not already dictionary skills. */
function phraseTerms(
  text: string,
  blanked: string,
  tokens: readonly Token[],
  segments: readonly JobSegment[],
  hits: readonly SkillHit[],
): JobTerm[] {
  const covered = new Uint8Array(tokens.length);
  for (const hit of hits) covered.fill(1, hit.first, hit.last + 1);
  const usable = tokens.map(
    (token, i) =>
      covered[i] === 0 && /^[a-z]{3,}$/.test(token.text) && !STOPWORDS.has(token.text) && !FILLER.has(token.text),
  );
  const segmentOf = tokens.map((token) => segmentAt(segments, token.start));
  const reach = joinReach(blanked, tokens, false);

  const mentions = new Map<string, Mention>();
  const candidates = new Map<string, PhraseCandidate>();
  for (let i = 0; i < tokens.length; i++) {
    const segment = segmentOf[i];
    if (!segment || segment.importance === 'ignored' || !usable[i]) continue;
    for (const size of [2, 3]) {
      const last = i + size - 1;
      if (last >= tokens.length || (reach[i] ?? i) < last || segmentOf[last] !== segment) continue;
      if (usable.slice(i, last + 1).some((ok) => !ok)) continue;
      const words = tokens.slice(i, last + 1).map((token) => token.text);
      const stems = words.map(stem);
      if (new Set(stems).size < size) continue;
      const key = stems.join(' ');
      if (!candidates.has(key)) candidates.set(key, { words, stems });
      addMention(mentions, key, segment, tokens[i]?.start ?? segment.start);
    }
  }

  const repeated = [...mentions].filter(([, mention]) => mention.count >= 2);
  const trigrams = repeated.filter(([key]) => key.split(' ').length === 3);
  const kept = repeated.filter(([key, mention]) => {
    const stems = key.split(' ');
    // "event driven" inside "event driven design" (same count) is not a second keyword.
    return (
      stems.length === 3 ||
      !trigrams.some(([bigKey, big]) => big.count >= mention.count && isSubsequence(stems, bigKey.split(' ')))
    );
  });

  kept.sort(
    ([, a], [, b]) => b.count - a.count || RANK[b.importance] - RANK[a.importance] || a.focus - b.focus,
  );
  return kept.slice(0, MAX_PHRASES).flatMap(([key, mention]) => {
    const candidate = candidates.get(key);
    if (!candidate) return [];
    return [
      {
        key: `phrase:${key}`,
        label: candidate.words.join(' '),
        kind: 'phrase' as const,
        category: 'Phrase',
        importance: mention.importance,
        count: mention.count,
        snippet: excerpt(text, mention.segment.start, mention.segment.end, mention.focus),
        weight: termWeight(mention.importance, mention.count, 'phrase'),
        skill: null,
        stems: candidate.stems,
      },
    ];
  });
}

/** Everything the job description asks for, with importance and weight. */
export function extractJobTerms(jobText: string): JobTerm[] {
  const text = normalizeText(jobText);
  const blanked = blankContacts(text);
  const tokens = tokenize(blanked);
  const segments = segmentJob(blanked);
  const hits = findSkills(blanked, tokens);
  return [...skillTerms(text, segments, hits), ...phraseTerms(text, blanked, tokens, segments, hits)];
}

/** What the resume says, prepared for matching. */
export interface ResumeProfile {
  text: string;
  tokens: Token[];
  stems: string[];
  /** For every token: the last token that can still be in the same phrase. */
  reach: number[];
  /** Skill id to the number of times the resume names it. */
  skillCounts: Map<number, number>;
  /** Skills that the resume does not name but proves, mapped to the skill that proves them. */
  implied: Map<number, number>;
}

export function profileResume(resumeText: string): ResumeProfile {
  const text = blankContacts(normalizeText(resumeText));
  const tokens = tokenize(text);
  const skillCounts = new Map<number, number>();
  for (const hit of findSkills(text, tokens)) skillCounts.set(hit.skill, (skillCounts.get(hit.skill) ?? 0) + 1);

  const implied = new Map<number, number>();
  for (const id of skillCounts.keys()) {
    for (const other of withImplied([id])) {
      if (other !== id && !skillCounts.has(other) && !implied.has(other)) implied.set(other, id);
    }
  }
  return {
    text,
    tokens,
    stems: tokens.map((token) => stem(token.text)),
    reach: joinReach(text, tokens, false),
    skillCounts,
    implied,
  };
}

/**
 * Counts places where all the stems sit close together, in any order and with at most one word in between.
 * This lets "managed stakeholders" match "stakeholder management".
 */
export function countStemMatch(profile: ResumeProfile, stems: readonly string[]): number {
  const needed = new Set(stems);
  const span = stems.length + 1;
  let count = 0;
  for (let i = 0; i < profile.stems.length; i++) {
    if (!needed.has(profile.stems[i] ?? '')) continue;
    const limit = Math.min(i + span - 1, profile.reach[i] ?? i);
    const seen = new Set<string>();
    for (let j = i; j <= limit; j++) {
      const stemmed = profile.stems[j];
      if (stemmed !== undefined && needed.has(stemmed)) seen.add(stemmed);
    }
    if (seen.size === needed.size) {
      count++;
      i = limit;
    }
  }
  return count;
}
