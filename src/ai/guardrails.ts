import type { JobTerm } from '../analyze/keywords.ts';
import { termKeysIn } from '../analyze/match.ts';
import { findSkills, getSkill, withImplied } from '../analyze/skills.ts';
import { countWords, stem, tokenize } from '../analyze/text.ts';
import { STOPWORDS } from '../analyze/words.ts';

export type Verdict =
  | { status: 'accepted'; rewrite: string; keywordsAdded: string[]; warnings: string[] }
  /** The suggestion says the same as the bullet, so there is nothing to show. */
  | { status: 'unchanged' }
  /** The reason completes the sentence "The AI suggestion was not used because ...". */
  | { status: 'rejected'; reason: string };

export const MAX_WORDS = 50;
const MIN_WORDS = 3;
// A rewrite may be a little longer than the bullet. A much longer one has probably added facts.
const GROWTH_FACTOR = 1.6;
const GROWTH_EXTRA_WORDS = 4;
// A rewrite that adds this many new words, and they are this share of its words, adds new facts.
const NEW_WORDS_MINIMUM = 4;
const NEW_WORDS_SHARE = 0.4;
// A rewrite should keep at least this share of the bullet's own words.
const KEPT_WORDS_SHARE = 0.4;
const KEPT_WORDS_MINIMUM_BULLET = 5;
const ROOT_LENGTH = 5;

const FIRST_PERSON = /^(?:i|we|my|our)\b/i;
const LINK_OR_MARKUP = /https?:\/\/|www\.|\b[\w.+-]+@[\w-]+\.[\w.-]+\b|[<>`{}]|\]\(/i;

// A number that is not part of a name such as S3, EC2 or v2.
const NUMBER = /(?<![A-Za-z\d])\d[\d,]*(?:\.\d+)?/g;
const NUMBER_WORDS: Readonly<Record<string, string>> = {
  two: '2',
  three: '3',
  four: '4',
  five: '5',
  six: '6',
  seven: '7',
  eight: '8',
  nine: '9',
  ten: '10',
  eleven: '11',
  twelve: '12',
};

/** The numbers in a text, as digits. "one" is left out because it is often not a number ("no one"). */
function numbersIn(text: string): Set<string> {
  const found = new Set<string>();
  for (const match of text.matchAll(NUMBER)) found.add(match[0].replace(/,/g, '').replace(/\.$/, ''));
  for (const word of text.toLowerCase().match(/[a-z]+/g) ?? []) {
    const value = NUMBER_WORDS[word];
    if (value) found.add(value);
  }
  return found;
}

function hardSkillsIn(text: string): Set<number> {
  const ids = new Set<number>();
  for (const hit of findSkills(text)) {
    if (getSkill(hit.skill).kind === 'hard') ids.add(hit.skill);
  }
  return ids;
}

interface RoleClaim {
  word: RegExp;
  /** A phrase in the bullet that already says the same thing in other words. */
  excusedBy?: RegExp;
}

const RESPONSIBLE = /\b(?:responsible\s+for|in\s+charge\s+of|accountable\s+for)\b/i;

// Words that make a person's role bigger. A rewrite may use one only when the bullet already says it.
const ROLE_CLAIMS: readonly RoleClaim[] = [
  { word: /\blead(?:s|ing)?\b|\bled\b/i },
  { word: /\bmanag(?:e|es|ed|ing|ement)\b/i, excusedBy: new RegExp(`${RESPONSIBLE.source}|\\bhandled\\b`, 'i') },
  { word: /\bdirect(?:s|ed|ing)\b/i },
  { word: /\bhead(?:s|ed|ing)\b/i },
  { word: /\boversaw\b|\boversee(?:s|n|ing)?\b/i },
  { word: /\bsupervis(?:e|es|ed|ing|ion)\b/i },
  { word: /\bspearhead(?:s|ed|ing)?\b/i },
  { word: /\bmentor(?:s|ed|ing)?\b/i },
  { word: /\bcoach(?:es|ed|ing)?\b/i },
  { word: /\bowned\b|\bowning\b|\bownership\b/i, excusedBy: RESPONSIBLE },
  { word: /\b(?:co-?)?found(?:ed|ing)\b/i },
  { word: /\barchitect(?:s|ed|ing)?\b/i },
  { word: /\bpioneer(?:s|ed|ing)?\b|\bchampioned\b|\bdrove\b/i },
];

function newRoleClaim(original: string, rewrite: string): string | null {
  for (const { word, excusedBy } of ROLE_CLAIMS) {
    const found = word.exec(rewrite);
    if (found && !word.test(original) && !excusedBy?.test(original)) return found[0].toLowerCase();
  }
  return null;
}

/**
 * The meaningful words of a text. Each word is reduced to the first letters of its stem, so that
 * "deployments" and "deployed" count as the same word ("deploy" and "deploi" are different stems).
 */
function contentRoots(text: string): Set<string> {
  const roots = new Set<string>();
  for (const token of tokenize(text)) {
    if (!STOPWORDS.has(token.text)) roots.add(stem(token.text).slice(0, ROOT_LENGTH));
  }
  return roots;
}

// Text without case, spaces and punctuation. A dot or comma between digits stays, so "25" and "2.5" are different.
const compact = (text: string): string => text.toLowerCase().replace(/(?<=\d)[.,](?=\d)/g, '#').replace(/[^a-z0-9#]+/g, '');

function list(values: readonly string[]): string {
  if (values.length <= 1) return values.join('');
  return `${values.slice(0, -1).join(', ')} and ${values[values.length - 1]}`;
}

const labelsOf = (ids: Iterable<number>): string[] => [...ids].map((id) => getSkill(id).label);

/**
 * Checks a rewrite from the AI against the bullet it came from. These checks do not trust the AI.
 * A rewrite is refused when it adds a number, adds a skill that the bullet does not name or imply,
 * makes the role bigger ("led", "owned"), adds many new words, is much longer than the bullet,
 * or uses "I", a link or markup.
 */
export function checkRewrite(original: string, rewrite: string, terms: readonly JobTerm[]): Verdict {
  if (compact(rewrite) === compact(original)) return { status: 'unchanged' };

  const words = countWords(rewrite);
  if (words < MIN_WORDS) return { status: 'rejected', reason: 'it is too short to be a bullet point' };
  const limit = Math.min(MAX_WORDS, Math.ceil(countWords(original) * GROWTH_FACTOR) + GROWTH_EXTRA_WORDS);
  if (words > limit) return { status: 'rejected', reason: 'it is much longer than your bullet, so it probably adds new facts' };

  if (FIRST_PERSON.test(rewrite)) return { status: 'rejected', reason: 'it starts with "I", "we" or "my"' };
  if (LINK_OR_MARKUP.test(rewrite) && !LINK_OR_MARKUP.test(original)) {
    return { status: 'rejected', reason: 'it contains a link or markup' };
  }

  const numbersBefore = numbersIn(original);
  // "one" counts as a number in the bullet, so a rewrite may write "1" for it.
  if (/\bone\b/i.test(original)) numbersBefore.add('1');
  const numbersAfter = numbersIn(rewrite);
  const newNumbers = [...numbersAfter].filter((value) => !numbersBefore.has(value));
  if (newNumbers.length > 0) {
    return { status: 'rejected', reason: `it added a number that is not in your bullet (${list(newNumbers)})` };
  }

  const skillsBefore = hardSkillsIn(original);
  const skillsAfter = hardSkillsIn(rewrite);
  const allowed = withImplied(skillsBefore);
  const newSkills = [...skillsAfter].filter((id) => !allowed.has(id));
  if (newSkills.length > 0) {
    return { status: 'rejected', reason: `it added a skill that is not in your bullet (${list(labelsOf(newSkills))})` };
  }

  const roleClaim = newRoleClaim(original, rewrite);
  if (roleClaim) {
    return { status: 'rejected', reason: `it makes your role bigger than your bullet says ("${roleClaim}")` };
  }

  const rootsBefore = contentRoots(original);
  const rootsAfter = contentRoots(rewrite);
  const fresh = [...rootsAfter].filter((value) => !rootsBefore.has(value));
  if (fresh.length >= NEW_WORDS_MINIMUM && fresh.length / rootsAfter.size > NEW_WORDS_SHARE) {
    return { status: 'rejected', reason: 'it adds new details that are not in your bullet' };
  }
  const kept = [...rootsBefore].filter((value) => rootsAfter.has(value));
  if (rootsBefore.size >= KEPT_WORDS_MINIMUM_BULLET && kept.length / rootsBefore.size < KEPT_WORDS_SHARE) {
    return { status: 'rejected', reason: 'it changes too much of your bullet' };
  }

  const warnings: string[] = [];
  const leftOut = [...numbersBefore].filter((value) => !numbersAfter.has(value) && value !== '1');
  if (leftOut.length > 0) warnings.push(`The suggestion no longer includes ${list(leftOut)} from your bullet.`);
  const dropped = [...skillsBefore].filter((id) => !skillsAfter.has(id));
  if (dropped.length > 0) warnings.push(`The suggestion no longer names ${list(labelsOf(dropped))}.`);

  const before = termKeysIn(terms, original);
  const after = termKeysIn(terms, rewrite);
  const keywordsAdded = terms.filter((term) => after.has(term.key) && !before.has(term.key)).map((term) => term.label);

  return { status: 'accepted', rewrite, keywordsAdded, warnings };
}
