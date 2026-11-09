import { countWords } from './text.ts';
import { findSkills, getSkill } from './skills.ts';

/** What is weak about a bullet and how to fix it. */
export interface Assessment {
  tips: string[];
  /** Higher means the bullet has more to gain from a rewrite. */
  weakness: number;
}

export interface QuickFix {
  /** null when no rule can change the bullet without changing what it says. */
  rewrite: string | null;
  tips: string[];
}

const WEAK_OPENER =
  /^(?:(?:i|we)\s+)?(?:(?:was|am|were|have been)\s+)?(?:(?:primarily|mainly|solely)\s+)?(?:responsible\s+for|worked\s+(?:on|with|as|in)|helped|assisted|involved\s+in|participated\s+in|took\s+part\s+in|tasked\s+with|duties\s+(?:included|were)|in\s+charge\s+of|handled|dealt\s+with|exposed\s+to)\b/i;
const FIRST_PERSON = /^(?:i|my|i'm|i've)\b/i;
const PASSIVE =
  /^(?:\S+\s+){0,4}?(?:was|were|been)\s+(?:\w+ly\s+)?(?:\w{3,}ed|built|written|done|made|given|taken|chosen|driven|run|set|held|led|sold|kept)\b/i;
const NUMBER_TOKEN = /^[~(]?[$£€]?\d[\d,.]*(?:%|\+|[kKmMbB]|x)?\)?[.,;]?$/;

const IRREGULAR_PAST = new Set(
  'led ran built wrote made drove grew took gave saw set cut put won taught sold kept began brought found got held oversaw spoke thought understood chose dealt'.split(
    ' ',
  ),
);

// Words that end in "ed" but describe a person, not an action.
const NOT_ACTIONS = new Set(
  'experienced motivated skilled qualified dedicated accomplished seasoned talented passionate driven detailed committed focused proven certified trained educated based located related advanced'.split(
    ' ',
  ),
);

function isPastVerb(word: string): boolean {
  const lower = word.toLowerCase();
  return !NOT_ACTIONS.has(lower) && (IRREGULAR_PAST.has(lower) || (lower.length > 3 && lower.endsWith('ed')));
}

/** True when the line starts like an achievement: a weak opener or a past-tense verb ("Built", "I improved"). */
export function opensWithAction(text: string): boolean {
  if (WEAK_OPENER.test(text)) return true;
  const words = /^([A-Za-z']+)(?:\s+(?:also\s+)?([A-Za-z']+))?/.exec(text);
  const first = words?.[1] ?? '';
  return /^(?:i|we)$/i.test(first) ? isPastVerb(words?.[2] ?? '') : isPastVerb(first);
}

const GERUND_PAST: Readonly<Record<string, string>> = {
  administering: 'administered',
  analysing: 'analysed',
  analyzing: 'analyzed',
  answering: 'answered',
  auditing: 'audited',
  automating: 'automated',
  budgeting: 'budgeted',
  building: 'built',
  cleaning: 'cleaned',
  collecting: 'collected',
  configuring: 'configured',
  coordinating: 'coordinated',
  creating: 'created',
  delivering: 'delivered',
  deploying: 'deployed',
  designing: 'designed',
  developing: 'developed',
  documenting: 'documented',
  driving: 'drove',
  ensuring: 'ensured',
  fixing: 'fixed',
  handling: 'managed',
  implementing: 'implemented',
  improving: 'improved',
  installing: 'installed',
  integrating: 'integrated',
  investigating: 'investigated',
  keeping: 'kept',
  launching: 'launched',
  leading: 'led',
  liaising: 'liaised',
  maintaining: 'maintained',
  managing: 'managed',
  mentoring: 'mentored',
  migrating: 'migrated',
  monitoring: 'monitored',
  negotiating: 'negotiated',
  onboarding: 'onboarded',
  optimising: 'optimised',
  optimizing: 'optimized',
  ordering: 'ordered',
  organising: 'organised',
  organizing: 'organized',
  overseeing: 'oversaw',
  planning: 'planned',
  preparing: 'prepared',
  processing: 'processed',
  producing: 'produced',
  publishing: 'published',
  reconciling: 'reconciled',
  recruiting: 'recruited',
  reporting: 'reported',
  researching: 'researched',
  resolving: 'resolved',
  reviewing: 'reviewed',
  running: 'ran',
  scheduling: 'scheduled',
  securing: 'secured',
  selling: 'sold',
  serving: 'served',
  setting: 'set',
  supervising: 'supervised',
  supporting: 'supported',
  teaching: 'taught',
  testing: 'tested',
  tracking: 'tracked',
  training: 'trained',
  updating: 'updated',
  writing: 'wrote',
};

const PEOPLE_START =
  /^(?:the\s+|a\s+|our\s+|other\s+|senior\s+|junior\s+|cross-functional\s+)*(?:designers?|developers?|engineers?|analysts?|stakeholders?|teams?|colleagues?|clients?|customers?|managers?|partners?|vendors?|users?|testers?|architects?|product|business|executives?|leaders?|staff|students|patients|data\s+scientists?)\b/i;

function hasNumber(text: string): boolean {
  return text.split(/\s+/).some((word) => NUMBER_TOKEN.test(word));
}

/** Finds what is weak about a bullet. Every tip is a plain sentence that can be shown to the user. */
export function assess(text: string): Assessment {
  const tips: string[] = [];
  let weakness = 0;
  const words = countWords(text);

  if (FIRST_PERSON.test(text)) {
    tips.push('Remove "I". Start with an action verb such as Built, Led or Reduced.');
    weakness += 2;
  }
  if (WEAK_OPENER.test(text)) {
    tips.push('Start with a strong action verb (for example Built, Led or Reduced) instead of "Responsible for" or "Worked on".');
    weakness += 3;
  }
  if (PASSIVE.test(text)) {
    tips.push('Use active voice. Say what you did, not what was done.');
    weakness += 1;
  }
  if (words < 6) {
    tips.push('This is very short. Say what you did and what changed because of it.');
    weakness += 1;
  } else if (words > 35) {
    tips.push('This is long. Try to keep it to one or two lines.');
    weakness += 1;
  }
  if (!hasNumber(text)) {
    tips.push('Add a number if you can: how many, how much or how fast.');
    weakness += 1;
  }
  return { tips, weakness };
}

export function weaknessOf(text: string): number {
  return assess(text).weakness;
}

const capitalize = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

function startsWithTool(text: string): boolean {
  return findSkills(text).some((hit) => hit.start === 0 && getSkill(hit.skill).kind === 'hard');
}

function pastFromGerund(rest: string): string | null {
  const first = /^[A-Za-z]+/.exec(rest)?.[0] ?? '';
  const past = GERUND_PAST[first.toLowerCase()];
  return past ? `${capitalize(past)}${rest.slice(first.length)}` : null;
}

function fixOpener(text: string): string | null {
  let match = /^(?:(?:i\s+)?(?:was|am|have been)\s+|i\s+)?(?:(?:primarily|mainly|solely)\s+)?responsible\s+for\s+([\s\S]+)$/i.exec(text);
  if (match?.[1]) {
    const rest = match[1];
    if (/^[A-Za-z]+ing\b/.test(rest)) return pastFromGerund(rest);
    return `Owned ${rest}`;
  }

  match = /^(?:i\s+)?(?:also\s+)?worked\s+(?:(closely)\s+)?(on|with|alongside)\s+([\s\S]+)$/i.exec(text);
  if (match?.[2] && match[3]) {
    const [, closely, preposition, rest] = match;
    if (preposition.toLowerCase() === 'on') return `Contributed to ${rest}`;
    if (PEOPLE_START.test(rest)) return `Collaborated ${closely ? `${closely.toLowerCase()} ` : ''}${preposition.toLowerCase()} ${rest}`;
    return startsWithTool(rest) ? `Used ${rest}` : null;
  }

  match = /^(?:i\s+)?(?:helped|assisted)\s+(?:out\s+)?with\s+([\s\S]+)$/i.exec(text);
  if (match?.[1]) return `Supported ${match[1]}`;

  match = /^(?:i\s+)?(?:(?:was|am|have been)\s+involved\s+in|participated\s+in|took\s+part\s+in)\s+([\s\S]+)$/i.exec(text);
  if (match?.[1]) return `Contributed to ${match[1]}`;

  match = /^(?:i\s+)?handled\s+([\s\S]+)$/i.exec(text);
  if (match?.[1]) return `Managed ${match[1]}`;

  match = /^(?:i\s+)?tasked\s+with\s+([\s\S]+)$/i.exec(text);
  if (match?.[1] && /^[A-Za-z]+ing\b/.test(match[1])) return pastFromGerund(match[1]);
  return null;
}

/** Removes a leading "I" when a past-tense verb follows: "I improved the site" becomes "Improved the site". */
function dropFirstPerson(text: string): string | null {
  const match = /^i\s+([A-Za-z]+)\b([\s\S]*)$/i.exec(text);
  const verb = match?.[1]?.toLowerCase();
  if (!match || !verb || !(verb.endsWith('ed') || IRREGULAR_PAST.has(verb))) return null;
  return `${capitalize(match[1] ?? '')}${match[2] ?? ''}`;
}

/**
 * Rewrites a weak opener with plain rules, with no AI and no new facts.
 * Only the first words change. The rest of the bullet stays exactly as written.
 */
export function quickFix(bullet: string): QuickFix {
  const original = bullet.trim();
  let text = original;

  const withoutI = dropFirstPerson(text);
  if (withoutI) text = withoutI;

  const reopened = fixOpener(text);
  if (reopened) text = reopened;

  const changed = text !== original;
  if (!changed || countWords(text) < 3) return { rewrite: null, tips: assess(original).tips };

  const rewrite = original.endsWith('.') && !text.endsWith('.') ? `${text}.` : text;
  return { rewrite, tips: assess(rewrite).tips };
}
