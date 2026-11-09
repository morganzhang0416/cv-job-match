import { stemmer } from 'stemmer';

export interface Token {
  /** Lowercase text. */
  text: string;
  /** The token exactly as it was written. */
  raw: string;
  start: number;
  end: number;
}

const INVISIBLE = /[\u200B-\u200D\u2060\uFEFF\u00AD]/g;
// Control characters except tab (\u0009), newline (\u000A) and carriage return (\u000D).
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/** Cleans text from PDF, Word or the browser so that later steps see plain, predictable characters. */
export function normalizeText(input: string): string {
  return input
    .normalize('NFKC')
    .replace(/\r\n?/g, '\n')
    .replace(INVISIBLE, '')
    .replace(CONTROL, ' ')
    .replace(/[\u2018\u2019\u201A\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201E\u2033]/g, '"')
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/[ \t\u00A0]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Special forms first (c++, c#, .net), then plain runs of letters and digits.
// Hyphens, dots and slashes split words, so "problem-solving" and "problem solving" match each other.
const TOKEN_PATTERN = /[a-z]\+\+|[a-z]#|\.net\b|[a-z0-9]+/gi;

export function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  for (const match of text.matchAll(TOKEN_PATTERN)) {
    const raw = match[0];
    tokens.push({ text: raw.toLowerCase(), raw, start: match.index, end: match.index + raw.length });
  }
  return tokens;
}

const stemCache = new Map<string, string>();

/** Porter stem, so "managing", "managed" and "management" all become "manag". */
export function stem(word: string): string {
  const cached = stemCache.get(word);
  if (cached !== undefined) return cached;
  const result = word.length < 4 || /\d/.test(word) ? word : stemmer(word);
  stemCache.set(word, result);
  return result;
}

/**
 * Replaces emails, web links and phone numbers with spaces. The text keeps its length, so positions stay valid.
 * This stops a domain like "example.net" from looking like the .NET skill.
 */
export function blankContacts(text: string): string {
  return text.replace(CONTACT_PATTERN, (found) => ' '.repeat(found.length));
}

const CONTACT_PATTERN =
  /[\w.+-]+@[\w-]+(?:\.[\w-]+)+|\b(?:https?:\/\/|www\.)[^\s<>)\]]+|\b[a-z0-9-]+\.(?:com|org|io|dev|me|nz|co\.nz)\/[^\s<>)\]]*|\+?\d[\d ().-]{7,}\d/gi;

export function countWords(text: string): number {
  const words = text.match(/[\p{L}\p{N}][\p{L}\p{N}'+#.-]*/gu);
  return words ? words.length : 0;
}

/** A short piece of text around a match. It starts and ends on word boundaries inside [start, end). */
export function excerpt(text: string, start: number, end: number, focus: number, max = 160): string {
  const flat = (value: string): string => value.replace(/\s+/g, ' ').trim();
  const whole = flat(text.slice(start, end));
  if (whole.length <= max) return whole;
  let from = Math.max(start, focus - Math.floor(max / 3));
  if (from > start) {
    const space = text.indexOf(' ', from);
    if (space !== -1 && space < focus) from = space + 1;
  }
  let to = Math.min(end, from + max);
  if (to < end) {
    const space = text.lastIndexOf(' ', to);
    if (space > focus) to = space;
  }
  return `${from > start ? '…' : ''}${flat(text.slice(from, to))}${to < end ? '…' : ''}`;
}

/** Collapses white space and cuts long text at a word boundary. */
export function snippetOf(text: string, max = 160): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return `${cut.slice(0, lastSpace > max * 0.6 ? lastSpace : max).trimEnd()}…`;
}
