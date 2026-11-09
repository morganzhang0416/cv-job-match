import { CATEGORY_LABELS, IMPLIES, SKILL_GROUPS, type SkillCategory } from './skills-data.ts';
import { stem, tokenize, type Token } from './text.ts';
import { STOPWORDS } from './words.ts';

export type SkillKind = 'hard' | 'soft';

export interface Skill {
  id: number;
  /** Lowercase label. Stable, so it is safe to use inside keys. */
  key: string;
  label: string;
  category: SkillCategory;
  categoryLabel: string;
  kind: SkillKind;
  /**
   * Stems of the content words in the label. They let a resume say "managed stakeholders"
   * when the job says "Stakeholder Management". null when the label is too short for that.
   */
  labelStems: string[] | null;
  /** Skills that this skill proves. Only used on the resume side. */
  implies: number[];
}

export interface SkillHit {
  skill: number;
  /** Character positions in the text. */
  start: number;
  end: number;
  /** Token positions (both included). */
  first: number;
  last: number;
}

interface AliasEntry {
  skill: number;
  /** For an ambiguous alias (written with "?" in the data): the one spelling that may match. */
  exact: string | null;
  /** The alias names a person (written with "~" in the data), so it is skipped in "work with ..." phrases. */
  role: boolean;
}

const skills: Skill[] = [];
const skillByKey = new Map<string, number>();
const index = new Map<string, AliasEntry>();
let maxTokens = 1;

function keyOf(text: string): string {
  return tokenize(text)
    .map((token) => token.text)
    .join(' ');
}

interface ParsedAlias {
  text: string;
  contextual: boolean;
  role: boolean;
}

/** Reads the "?" and "~" markers in front of an alias in the data. */
function parseAlias(raw: string): ParsedAlias {
  let text = raw.trim();
  let contextual = false;
  let role = false;
  for (;;) {
    if (text.startsWith('?')) contextual = true;
    else if (text.startsWith('~')) role = true;
    else break;
    text = text.slice(1);
  }
  return { text, contextual, role };
}

function addAlias(skill: number, alias: ParsedAlias, source: string): void {
  const key = keyOf(alias.text);
  if (!key) throw new Error(`Skill data: empty alias in "${source}"`);
  const entry: AliasEntry = { skill, exact: alias.contextual ? alias.text : null, role: alias.role };
  const existing = index.get(key);
  if (existing) {
    if (existing.skill === skill && existing.exact === entry.exact && existing.role === entry.role) return;
    const owner = skills[existing.skill]?.label ?? '?';
    throw new Error(`Skill data: "${alias.text}" in "${source}" is already used by "${owner}"`);
  }
  index.set(key, entry);
  maxTokens = Math.max(maxTokens, key.split(' ').length);
}

function labelStemsOf(label: string): string[] | null {
  const words = tokenize(label)
    .map((token) => token.text)
    .filter((word) => !STOPWORDS.has(word));
  if (words.length < 2 || words.some((word) => word.length < 3 || !/^[a-z]+$/.test(word))) return null;
  return words.map(stem);
}

// Tool and language names are brand names, so they get no word-order fallback and no automatic plurals.
const BRAND_CATEGORIES: ReadonlySet<SkillCategory> = new Set<SkillCategory>(['tools', 'language']);

for (const category of Object.keys(SKILL_GROUPS) as SkillCategory[]) {
  for (const entry of SKILL_GROUPS[category]) {
    const parts = entry
      .split('|')
      .map((part) => part.trim())
      .filter(Boolean);
    const head = parts[0];
    if (!head) throw new Error(`Skill data: empty entry in "${category}"`);
    const parsedHead = parseAlias(head);
    const label = parsedHead.text;
    const key = label.toLowerCase();
    if (skillByKey.has(key)) throw new Error(`Skill data: label "${label}" is listed twice`);
    const id = skills.length;
    skills.push({
      id,
      key,
      label,
      category,
      categoryLabel: CATEGORY_LABELS[category],
      kind: category === 'soft' ? 'soft' : 'hard',
      labelStems: BRAND_CATEGORIES.has(category) ? null : labelStemsOf(label),
      implies: [],
    });
    skillByKey.set(key, id);
    addAlias(id, parsedHead, entry);
    for (const alias of parts.slice(1)) addAlias(id, parseAlias(alias), entry);
  }
}

function pluralWord(word: string): string | null {
  if (word.length < 3 || !/^[a-z]+$/.test(word) || /(?:ing|ed)$/.test(word)) return null;
  if (word.endsWith('sis')) return `${word.slice(0, -2)}es`;
  if (word.endsWith('s')) return word.endsWith('ss') ? `${word}es` : null;
  if (/(?:sh|ch|x|z)$/.test(word)) return `${word}es`;
  if (/[^aeiou]y$/.test(word)) return `${word.slice(0, -1)}ies`;
  return `${word}s`;
}

// People write "dashboards" and "stakeholders" as often as the singular, so the plural is added by code.
// A plural never replaces a listed alias.
for (const [key, entry] of [...index]) {
  const skill = skills[entry.skill];
  if (!skill || entry.exact !== null || BRAND_CATEGORIES.has(skill.category)) continue;
  const parts = key.split(' ');
  const plural = pluralWord(parts[parts.length - 1] ?? '');
  if (!plural) continue;
  parts[parts.length - 1] = plural;
  const pluralKey = parts.join(' ');
  if (!index.has(pluralKey)) index.set(pluralKey, { skill: entry.skill, exact: null, role: entry.role });
}

for (const [from, targets] of Object.entries(IMPLIES)) {
  const fromId = skillByKey.get(from);
  if (fromId === undefined) throw new Error(`Skill data: IMPLIES key "${from}" is not a skill label`);
  const ids = targets.map((target) => {
    const id = skillByKey.get(target);
    if (id === undefined) throw new Error(`Skill data: IMPLIES "${from}" points to unknown skill "${target}"`);
    return id;
  });
  const skill = skills[fromId];
  if (skill) skill.implies = ids;
}

export const SKILLS: readonly Skill[] = skills;

export function getSkill(id: number): Skill {
  const skill = skills[id];
  if (!skill) throw new Error(`Unknown skill id ${id}`);
  return skill;
}

export function skillIdByKey(key: string): number | undefined {
  return skillByKey.get(key.toLowerCase());
}

/** All skill ids that a set of skills proves, including the skills themselves. */
export function withImplied(ids: Iterable<number>): Set<number> {
  const result = new Set<number>();
  const queue = [...ids];
  while (queue.length > 0) {
    const id = queue.pop();
    if (id === undefined || result.has(id)) continue;
    result.add(id);
    queue.push(...getSkill(id).implies);
  }
  return result;
}

// One line break is fine (PDF text wraps lines). A bullet, a blank line, a comma or a full stop is not.
const FLOW_GAP = /^[ \t]*-?[ \t]*\n?[ \t]*$/;
const LOOSE_GAP = /^[ \t]*[-/&]?[ \t]*\n?[ \t]*$/;

/**
 * Can two neighbouring tokens belong to the same phrase? Loose mode also accepts "/" and "&" ("CI/CD", "P&L")
 * and a dot with no spaces ("node.js").
 */
export function joinable(gap: string, loose: boolean): boolean {
  if (gap === '.') return loose;
  return (loose ? LOOSE_GAP : FLOW_GAP).test(gap);
}

/** For every token: the index of the last token that can still be in the same phrase. */
export function joinReach(text: string, tokens: readonly Token[], loose: boolean): number[] {
  const reach = new Array<number>(tokens.length);
  for (let i = tokens.length - 1; i >= 0; i--) {
    const next = tokens[i + 1];
    const current = tokens[i];
    reach[i] =
      next && current && joinable(text.slice(current.end, next.start), loose) ? (reach[i + 1] ?? i) : i;
  }
  return reach;
}

const GLUED = /[A-Za-z0-9&+#-]/;
const LIST_PUNCTUATION = new Set([',', '/', '&', '|', '(', ';', ':', '[']);
const BULLET_GLYPHS = new Set([...'•●▪■◦‣▸►➢✓✔○·–—*+-']);
const LEAD_WORDS = new Set(['in', 'with', 'using', 'and', 'or', 'of', 'including', 'like', 'plus', 'via', 'on']);

/**
 * Ambiguous skills (Go, R, Excel, Spark, Swift ...) only count when they are spelled exactly like the skill
 * and stand in a list or after words such as "in", "with" or "using". "Go live in Q4" is not the language Go.
 */
function ambiguousAliasOk(text: string, tokens: readonly Token[], from: number, to: number, exact: string): boolean {
  const first = tokens[from];
  const last = tokens[to];
  if (!first || !last || text.slice(first.start, last.end) !== exact) return false;
  const before = text.charAt(first.start - 1);
  const after = text.charAt(last.end);
  if ((before && GLUED.test(before)) || (after && GLUED.test(after))) return false;

  const previous = tokens[from - 1];
  if (exact.length === 1) {
    // "Plan A, B and C" is not a list of programming languages.
    const beforeThat = tokens[from - 2];
    if (previous && previous.text.length === 1 && /^[ ,/&|]*$/.test(text.slice(previous.end, first.start))) return false;
    if (previous && (previous.text === 'and' || previous.text === 'or') && beforeThat?.text.length === 1) return false;
  }

  let k = first.start - 1;
  while (k >= 0 && (text.charAt(k) === ' ' || text.charAt(k) === '\t')) k--;
  const mark = k >= 0 ? text.charAt(k) : '\n';
  const atLineStart = mark === '\n' || BULLET_GLYPHS.has(mark);
  if (!atLineStart && LIST_PUNCTUATION.has(mark)) return true;
  if (atLineStart) return /^[ \t]*[,|;/]/.test(text.slice(last.end, last.end + 12));

  if (!previous || !/^[ \t]+$/.test(text.slice(previous.end, first.start))) return false;
  if (LEAD_WORDS.has(previous.text)) return true;
  return previous.text === 'as' && tokens[from - 2]?.text === 'such';
}

const COLLABORATION_LEADS = new Set(['with', 'from', 'by', 'between', 'alongside', 'among', 'under']);
// Words that can sit between "with" and the person: "with the designers, data scientists and product managers".
const PEOPLE_WORDS = new Set(
  (
    'the a an our your their its other fellow senior junior cross functional and or ' +
    'designers designer developers developer engineers engineer analysts analyst scientists scientist testers tester ' +
    'architects architect managers manager leaders leader owners owner masters master leads lead executives executive ' +
    'directors director stakeholders stakeholder teams team colleagues colleague partners partner clients client ' +
    'customers customer vendors vendor suppliers supplier users user specialists specialist experts expert ' +
    'agencies agency sponsors sponsor product project business data software ux ui qa test engineering technical ' +
    'account sales marketing finance financial design security solution solutions delivery program programme ' +
    'operations tech scrum'
  ).split(' '),
);
const LIST_GAP = /^[ \t]*[,/&]?[ \t]*\n?[ \t]*$/;
// "Present results to senior leaders": the person after "to" is the audience. "Promoted to team lead" is different.
const RECIPIENT_VERBS = new Set(
  (
    'report reports reporting reported present presents presenting presented escalate escalates escalating escalated ' +
    'provide provides providing provided give gives giving gave send sends sending sent share shares sharing shared ' +
    'communicate communicates communicating communicated update updates updating updated advise advises advising advised ' +
    'explain explains explaining explained deliver delivers delivering delivered demo demos demonstrate demonstrates ' +
    'demonstrating demonstrated'
  ).split(' '),
);
function followsRecipientVerb(text: string, tokens: readonly Token[], toIndex: number): boolean {
  for (let i = toIndex - 1, hops = 0; i >= 0 && hops < 4; i--, hops++) {
    const token = tokens[i];
    const next = tokens[i + 1];
    if (!token || !next || !joinable(text.slice(token.end, next.start), false)) return false;
    if (RECIPIENT_VERBS.has(token.text)) return true;
  }
  return false;
}

/** "Work with product managers" and "report findings to the team lead" name other people. They are not the reader's own skill. */
function inCollaboratorPhrase(text: string, tokens: readonly Token[], from: number): boolean {
  let k = from;
  for (let steps = 0; steps < 8 && k > 0; steps++) {
    const previous = tokens[k - 1];
    const current = tokens[k];
    if (!previous || !current || !LIST_GAP.test(text.slice(previous.end, current.start))) return false;
    if (COLLABORATION_LEADS.has(previous.text)) return true;
    if (previous.text === 'to') return followsRecipientVerb(text, tokens, k - 1);
    if (!PEOPLE_WORDS.has(previous.text)) return false;
    k--;
  }
  return false;
}

/** Finds skills in a text. The longest alias wins, so "machine learning" is one hit and not two. */
export function findSkills(text: string, tokens: readonly Token[] = tokenize(text)): SkillHit[] {
  const hits: SkillHit[] = [];
  const reach = joinReach(text, tokens, true);
  let i = 0;
  while (i < tokens.length) {
    const longest = Math.min(maxTokens, (reach[i] ?? i) - i + 1);
    let hit: SkillHit | null = null;
    for (let n = longest; n >= 1 && hit === null; n--) {
      const last = i + n - 1;
      const key = tokens
        .slice(i, last + 1)
        .map((token) => token.text)
        .join(' ');
      const entry = index.get(key);
      if (!entry) continue;
      if (entry.exact !== null && !ambiguousAliasOk(text, tokens, i, last, entry.exact)) continue;
      if (entry.role && inCollaboratorPhrase(text, tokens, i)) continue;
      const startToken = tokens[i];
      const endToken = tokens[last];
      if (startToken && endToken) {
        hit = { skill: entry.skill, start: startToken.start, end: endToken.end, first: i, last };
      }
    }
    if (hit) {
      hits.push(hit);
      i = hit.last + 1;
    } else {
      i++;
    }
  }
  return hits;
}
