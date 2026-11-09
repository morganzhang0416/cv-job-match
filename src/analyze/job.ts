import type { Importance } from './types.ts';
import { findSkills } from './skills.ts';
import { tokenize } from './text.ts';

export type SegmentImportance = Importance | 'ignored';

/** A sentence or part of a sentence from the job description, with how much the job cares about it. */
export interface JobSegment {
  start: number;
  end: number;
  importance: SegmentImportance;
}

const PREFERRED_HEADING =
  /\b(?:nice[- ]to[- ]haves?|good[- ]to[- ]haves?|great[- ]to[- ]haves?|bonus(?: points| skills)?|preferred|desirable|desired|extra credit|an? (?:plus|advantage)|would be (?:a )?(?:plus|great|nice)|beneficial|optional)\b/;

const IGNORED_HEADING =
  /\b(?:benefits?|perks|what we offer|we offer|why (?:join|work|us)|our (?:values|culture|story|mission|vision|benefits|people)|who we are|company (?:overview|description|culture|profile)|equal opportunit(?:y|ies)|diversity|eeo|how to apply|application process|hiring process|interview process|next steps|compensation|salary|pay range|location|working (?:here|at)|life at|what'?s in it for you|our commitment|disclaimer|join us|apply now)\b/;

const REQUIRED_HEADING =
  /\b(?:requirements?|qualifications?|must[- ]haves?|essential|required|minimum|what you(?:'ll| will)? (?:need|bring|have)|what we(?:'re| are) looking for|who you are|you(?:'ll| will)? bring|you have|your (?:profile|background|experience|skills)|skills|experience|ideal candidate|the candidate|candidate profile|key (?:skills|criteria)|selection criteria)\b/;

const STANDARD_HEADING =
  /\b(?:responsibilit(?:y|ies)|what you(?:'ll| will)(?: be)? (?:do|doing|work on|own)|the role|your role|role (?:overview|description|summary)|job (?:description|summary|duties)|duties|key accountabilit(?:y|ies)|day[- ]to[- ]day|in this role|the job|the position|your impact|your mission|you will|tech(?:nical)? stack|our stack|technologies|tools(?: (?:and|&) technologies)?|tools we use|our tech|overview|summary|description)\b/;

/** Sentences about the company, the hiring process or perks. They never produce keywords. */
const BOILERPLATE =
  /\b(?:equal opportunity|equal employment|we are an? (?:equal|inclusive)|(?:celebrate|embrace|value|welcome) diversity|committed to (?:diversity|inclusion)|reasonable (?:accommodations?|adjustments?)|(?:background|police|criminal|credit|reference) checks?|right to work|work (?:visa|rights|permit)|visa sponsorship|unsolicited|recruitment agenc(?:y|ies)|privacy (?:policy|notice)|apply (?:now|today|online|via|through|by)|send (?:us )?your (?:cv|resume)|submit (?:your|an?) (?:cv|resume|application)|applications? (?:close|will close)|closing date|salary (?:range|band)|competitive salary|health insurance|paid (?:time off|leave|holidays?)|share options?|stock options?|learning budget|gym membership|free (?:lunch|snacks|coffee|fruit))\b/i;

const PREFERRED_CUE =
  /\b(?:nice[- ]to[- ]haves?|(?:is|are|would be) (?:a |an )?(?:plus|bonus|advantage|advantageous|beneficial|valuable|helpful|great|nice)|an? (?:plus|bonus|advantage)|bonus points|preferred|preferably|desirable|desired|advantageous|beneficial|good to have|great to have|not (?:essential|required|necessary|mandatory)|optional|ideally)\b/i;

const REQUIRED_CUE =
  /\b(?:must(?: have)?|required|requires?|essential|mandatory|minimum|at least \d|\d+\+?\s*(?:years?|yrs?)|proven|expert(?:ise)?|proficien(?:t|cy)|need to have|should have)\b/i;

const BULLET_PREFIX = /^[ \t]*(?:[•●▪■◦‣▸►➢✓✔○·–—*+-]+|\d{1,2}[.)]|[a-z][.)])[ \t]+/;
const INLINE_LABEL = /^([^:]{2,40}):[ \t]+(\S.*)$/;
const CLAUSE_BREAK = /(?<=[.!?])\s+(?=[A-Z(])|;\s+/g;

function classifyHeading(label: string): SegmentImportance | null {
  const text = label.trim().toLowerCase();
  if (/^about\b/.test(text)) {
    if (/^about (?:you|yourself)\b/.test(text)) return 'required';
    if (/^about (?:the )?(?:role|job|position|opportunity)\b/.test(text)) return 'standard';
    return 'ignored';
  }
  if (PREFERRED_HEADING.test(text)) return 'preferred';
  if (IGNORED_HEADING.test(text)) return 'ignored';
  if (REQUIRED_HEADING.test(text)) return 'required';
  if (STANDARD_HEADING.test(text)) return 'standard';
  return null;
}

/** A heading is short, has no sentence punctuation or numbers, and does not name a skill. */
function headingClass(content: string): SegmentImportance | null {
  const bare = content.replace(/:\s*$/, '').trim();
  if (!bare || bare.length > 70 || /[.,;:!?\d]/.test(bare) || bare.split(/\s+/).length > 8) return null;
  const cls = classifyHeading(bare);
  if (cls === null) return null;
  return findSkills(bare, tokenize(bare)).length > 0 ? null : cls;
}

function clauseImportance(clause: string, base: SegmentImportance): SegmentImportance {
  if (base === 'ignored' || BOILERPLATE.test(clause)) return 'ignored';
  if (base === 'preferred' || PREFERRED_CUE.test(clause)) return 'preferred';
  if (REQUIRED_CUE.test(clause)) return 'required';
  return base;
}

/**
 * Splits a job description into sentences and decides how important each one is.
 * Headings such as "Requirements" or "Nice to have", cue words such as "must" or "a plus",
 * and company text such as "About us" or "Benefits" all play a part.
 * Pass text without emails and links (see blankContacts). Positions refer to this text.
 */
export function segmentJob(text: string): JobSegment[] {
  const segments: JobSegment[] = [];
  let section: SegmentImportance = 'standard';
  let lineStart = 0;

  for (const line of text.split('\n')) {
    const here = lineStart;
    lineStart += line.length + 1;

    const bullet = BULLET_PREFIX.exec(line);
    const lead = bullet ? bullet[0].length : (/^[ \t]*/.exec(line)?.[0].length ?? 0);
    const content = line.slice(lead).trimEnd();
    if (!content) continue;

    let base = section;
    let contentOffset = lead;
    let body = content;

    const label = INLINE_LABEL.exec(content);
    const labelClass = label?.[1] ? classifyHeading(label[1]) : null;
    if (label?.[2] && labelClass !== null) {
      base = labelClass;
      contentOffset = lead + content.length - label[2].length;
      body = label[2];
    } else if (!bullet) {
      const cls = headingClass(content);
      if (cls !== null) {
        section = cls;
        continue;
      }
    }

    let from = 0;
    const push = (end: number): void => {
      const clause = body.slice(from, end);
      if (clause.trim()) {
        segments.push({
          start: here + contentOffset + from,
          end: here + contentOffset + end,
          importance: clauseImportance(clause, base),
        });
      }
    };
    for (const match of body.matchAll(CLAUSE_BREAK)) {
      push(match.index);
      from = match.index + match[0].length;
    }
    push(body.length);
  }
  return segments;
}

/** Finds the segment that holds a character position. Segments are sorted and do not overlap. */
export function segmentAt(segments: readonly JobSegment[], position: number): JobSegment | undefined {
  let low = 0;
  let high = segments.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const segment = segments[mid];
    if (!segment) return undefined;
    if (position < segment.start) high = mid - 1;
    else if (position >= segment.end) low = mid + 1;
    else return segment;
  }
  return undefined;
}
