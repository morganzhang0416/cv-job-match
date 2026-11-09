import type { JobTerm } from './keywords.ts';
import { termKeysIn } from './match.ts';
import { opensWithAction, weaknessOf } from './quickfix.ts';
import { countWords } from './text.ts';

export const MAX_BULLETS = 80;
export const DEFAULT_PICK = 6;
export const MAX_PICK = 10;

const MIN_WORDS = 4;
const MAX_CHARS = 420;
const MAX_STATEMENT_WORDS = 45;
const MAX_WRAPPED_LINES = 3;
// A wrapped line runs close to the page edge, so a short line is the end of its bullet.
const MIN_WRAP_WIDTH = 60;
const MIN_MARKED_BULLETS = 3;
// A bullet that already names this many job keywords gains little, so more than this does not raise its rank.
const RELEVANCE_CAP = 3;

type Section = 'include' | 'skip' | 'none';

interface Candidate {
  text: string;
  /** true when the line started with a bullet symbol or number. */
  marked: boolean;
  section: Section;
}

interface Open {
  candidate: Candidate;
  lastLine: string;
  wrapped: number;
}

// Symbols from Word, PDF and the web. The private-use range holds the Wingdings bullets.
const SYMBOL_MARKER = /^[\u00B7\u00BB\u2022\u2023\u2043\u2219\u25A0-\u25FF\u2605\u2606\u2713\u2714\u2726\u2727\u2794\u27A2\u27A4\uE000-\uF8FF]\s*/u;
const TEXT_MARKER = /^(?:[-\u2013\u2014*+]|\d{1,2}[.)])(?:\s+|$)/;

const EXPERIENCE_HEADING = /\b(?:experience|history|projects?|achievements?|accomplishments?|highlights?|volunteering|internships?)$/;
const OTHER_HEADING =
  /^(?:(?:professional|personal|career|executive|technical|key|core|additional|relevant|other)\s+)*(?:summary|profile|objective|about me|skills|competencies|education|qualifications|certifications|certificates|licenses|courses|training|languages|interests|hobbies|references|referees|awards|honours|honors|publications|memberships|contact(?: details)?|details|information)(?:\s+and\s+[a-z]+)?$/;

const DATE_RANGE = /\b(?:19|20)\d{2}\b\s*(?:-|to|until)\s*(?:(?:[a-z]{3,9}\.?\s+)?(?:19|20)\d{2}\b|present|current|now|today)/i;
const CONTACT =
  /[\w.+-]+@[\w-]+(?:\.[\w-]+)+|\b(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]+\.(?:com|org|io|dev|me|nz|co\.nz)\/\S*|\+\d[\d ()-]{7,}\d|\(?\b0\d{1,2}\)?[ -]?\d{3,4}[ -]\d{3,4}\b/i;
const HEADER_LIKE = /\||^[A-Z][\w&'.-]*(?:\s+[A-Z][\w&'.-]*){1,4},\s+[A-Z]/;
const SENTENCE_BREAK = /(?<=[.!?])\s+(?=[A-Z])/;
const LIST_LABEL = /^(?:tech(?:nologies)?(?:\s+stack)?|tools?|stack|environment|skills?|keywords?)\s*[:-]/i;

function stripMarker(line: string): string | null {
  const match = SYMBOL_MARKER.exec(line) ?? TEXT_MARKER.exec(line);
  return match ? line.slice(match[0].length) : null;
}

function classifyHeading(line: string): Section | null {
  if (/^[a-z]/.test(line)) return null;
  const text = line
    .replace(/\([^)]*\)/g, ' ')
    .replace(/^[#*_\s]+|[#*_:\s]+$/g, '')
    .replace(/&/g, ' and ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  if (text.length < 3 || text.length > 40 || /[^a-z ]/.test(text) || text.split(' ').length > 5) return null;
  if (EXPERIENCE_HEADING.test(text)) return 'include';
  return OTHER_HEADING.test(text) ? 'skip' : null;
}

function isContinuation(open: Open, line: string): boolean {
  if (open.wrapped >= MAX_WRAPPED_LINES || DATE_RANGE.test(line) || CONTACT.test(line)) return false;
  if (/^[a-z(%$\d]/.test(line)) return true;
  return open.lastLine.length >= MIN_WRAP_WIDTH && !/[.!?:;]$/.test(open.lastLine) && !HEADER_LIKE.test(line);
}

function isStatement(line: string): boolean {
  const words = countWords(line);
  return (
    /^[A-Z]/.test(line) &&
    words >= MIN_WORDS &&
    words <= MAX_STATEMENT_WORDS &&
    !DATE_RANGE.test(line) &&
    !CONTACT.test(line) &&
    opensWithAction(line)
  );
}

/** Walks the resume line by line and joins wrapped lines. Lines without a symbol count only if they start like an achievement. */
function scan(resumeText: string): Candidate[] {
  const candidates: Candidate[] = [];
  let section: Section = 'none';
  let open: Open | null = null;
  let symbolAlone = false;

  for (const rawLine of resumeText.split(/\r\n|\r|\n/)) {
    const line = rawLine.replace(/\s+/g, ' ').trim();
    if (!line) {
      open = null;
      symbolAlone = false;
      continue;
    }

    const rest = stripMarker(line);
    // Some PDFs put the bullet symbol alone on a line and the text on the next one.
    if (rest !== null && rest.trim() === '') {
      symbolAlone = true;
      open = null;
      continue;
    }

    let begin: { text: string; marked: boolean } | null = null;
    if (rest !== null || symbolAlone) {
      begin = { text: rest ?? line, marked: true };
    } else {
      const heading = classifyHeading(line);
      if (heading) {
        section = heading;
        open = null;
        continue;
      }
      if (open && isContinuation(open, line)) {
        open.candidate.text += ` ${line}`;
        open.lastLine = line;
        open.wrapped += 1;
        continue;
      }
      open = null;
      const sentences = line.split(SENTENCE_BREAK);
      if (sentences.length > 1) {
        for (const sentence of sentences) {
          if (isStatement(sentence)) candidates.push({ text: sentence, marked: false, section });
        }
        continue;
      }
      if (isStatement(line)) begin = { text: line, marked: false };
    }
    symbolAlone = false;

    if (begin) {
      const candidate: Candidate = { ...begin, section };
      candidates.push(candidate);
      open = { candidate, lastLine: line, wrapped: 0 };
    }
  }
  return candidates;
}

function looksLikeList(text: string): boolean {
  if (LIST_LABEL.test(text)) return true;
  const parts = text.split(/\s*[,;|\u2022\u00B7]\s*/).filter(Boolean);
  return parts.length >= 4 && countWords(text) / parts.length <= 2.5;
}

function keep(text: string): boolean {
  return countWords(text) >= MIN_WORDS && text.length <= MAX_CHARS && !CONTACT.test(text) && !looksLikeList(text);
}

/**
 * Finds the bullet points in the resume text, in the order they appear.
 * Only the experience, project and volunteering parts count, because skills and education lines are not achievements.
 */
export function extractBullets(resumeText: string): string[] {
  const all = scan(resumeText);
  const usable = all.filter((item) => item.section !== 'skip');
  let chosen = usable.filter((item) => item.marked);
  if (chosen.length < MIN_MARKED_BULLETS) chosen = usable;
  if (chosen.length === 0) chosen = all.filter((item) => item.marked);

  const seen = new Set<string>();
  const bullets: string[] = [];
  for (const item of chosen) {
    const text = item.text.replace(/\*\*|__/g, '').replace(/\s+/g, ' ').trim();
    const key = text.toLowerCase().replace(/[^a-z0-9]+/g, '');
    if (!keep(text) || seen.has(key)) continue;
    seen.add(key);
    bullets.push(text);
    if (bullets.length >= MAX_BULLETS) break;
  }
  return bullets;
}

export interface PickedBullet {
  /** Position in the list that extractBullets returned, starting at 1. */
  id: number;
  text: string;
  /** How many job keywords the bullet already names. */
  relevance: number;
  weakness: number;
}

/**
 * Chooses the bullets that gain the most from a rewrite: weak ones that still touch the job's keywords.
 * A bullet with no link to the job cannot honestly be tailored, so it ranks low.
 */
export function pickBullets(bullets: readonly string[], terms: readonly JobTerm[], limit = DEFAULT_PICK): PickedBullet[] {
  const max = Math.min(Math.max(Math.trunc(limit) || DEFAULT_PICK, 1), MAX_PICK);
  return bullets
    .map((text, index) => {
      const relevance = termKeysIn(terms, text).size;
      const weakness = weaknessOf(text);
      return { id: index + 1, text, relevance, weakness, rank: Math.min(relevance, RELEVANCE_CAP) * 2 + weakness };
    })
    .sort((a, b) => b.rank - a.rank || a.id - b.id)
    .slice(0, max)
    .map(({ id, text, relevance, weakness }) => ({ id, text, relevance, weakness }));
}
