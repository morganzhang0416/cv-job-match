// @ts-check
// Pure helpers with no DOM code, so the tests can run them in Node.

/** @typedef {import('../src/analyze/types.ts').AnalyzeResponse} AnalyzeResponse */
/** @typedef {import('../src/analyze/types.ts').Importance} Importance */

/** @type {Readonly<Record<Importance, string>>} */
export const IMPORTANCE_LABEL = {
  required: 'Must-have',
  standard: 'Mentioned',
  preferred: 'Nice to have',
};

/**
 * @param {number} count
 * @param {string} one
 * @param {string} many
 */
export function plural(count, one, many) {
  return count === 1 ? one : many;
}

/** @param {number} bytes */
export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * The date on the user's clock, like 2026-11-09. `toISOString` would give the UTC date, which can be the day before.
 * @param {Date} [now]
 */
export function localDate(now = new Date()) {
  const two = (/** @type {number} */ value) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`;
}

/** Lower case, without punctuation at the ends. "Node.js," becomes "node.js". */
const normalize = (/** @type {string} */ word) => word.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}+#]+$/gu, '');

/**
 * Splits the new text into runs. A run is "added" when its words are not in the old text.
 * The space between words stays with the unchanged text, so a highlight never starts or ends with a space.
 * Space at the start and the end of the new text is dropped.
 * @param {string} before
 * @param {string} after
 * @returns {Array<{ text: string, added: boolean }>}
 */
export function diffWords(before, after) {
  const known = new Set(before.split(/\s+/).map(normalize).filter(Boolean));
  /** @type {Array<{ text: string, added: boolean }>} */
  const runs = [];
  let gap = '';
  for (const token of after.trim().split(/(\s+)/)) {
    if (token === '') continue;
    if (/^\s+$/.test(token)) {
      gap += token;
      continue;
    }
    const key = normalize(token);
    const added = key !== '' && !known.has(key);
    const last = runs[runs.length - 1];
    if (last && last.added === added) {
      last.text += gap + token;
    } else if (added) {
      if (last) last.text += gap;
      runs.push({ text: token, added });
    } else {
      runs.push({ text: gap + token, added });
    }
    gap = '';
  }
  return runs;
}

/** One line of plain text: line breaks become spaces. */
const oneLine = (/** @type {string} */ text) => text.replace(/\s+/g, ' ').trim();

/** Text for a Markdown table cell. */
const cell = (/** @type {string} */ text) => oneLine(text).replace(/\|/g, '\\|');

/**
 * A report that people can paste into a note or an email.
 * @param {AnalyzeResponse} data
 */
export function buildMarkdown(data) {
  const { match, rewrites } = data;
  /** @type {string[]} */
  const lines = ['# Resume and job match report', '', `**Match score: ${match.score} / 100 (${match.verdict})**`, '', oneLine(match.summary), ''];

  if (match.breakdown.length > 0) {
    lines.push('## Score breakdown', '', '| Area | Covered | Share |', '| --- | --- | --- |');
    for (const row of match.breakdown) lines.push(`| ${cell(row.label)} | ${row.matched} of ${row.total} | ${row.percent}% |`);
    lines.push('');
  }

  lines.push('## Missing keywords', '');
  if (match.missing.length === 0) {
    lines.push('Nothing is missing.', '');
  } else {
    for (const item of match.missing) {
      const quote = item.snippet ? `: "${oneLine(item.snippet)}"` : '';
      lines.push(`- **${oneLine(item.label)}** (${IMPORTANCE_LABEL[item.importance]}, ${oneLine(item.category)})${quote}`);
    }
    lines.push('');
  }

  lines.push('## Keywords already covered', '', match.matched.length > 0 ? match.matched.map((item) => oneLine(item.label)).join(', ') : 'None.', '');

  lines.push('## Bullet-point suggestions', '');
  if (rewrites.notice) lines.push(`> ${oneLine(rewrites.notice)}`, '');
  const author = rewrites.mode === 'ai' ? `Written by AI${rewrites.model ? ` (${oneLine(rewrites.model)})` : ''}.` : 'Built-in suggestions.';
  lines.push(`${author} Check that every line is true before you use it.`, '');
  for (const item of rewrites.items) {
    lines.push(`### Bullet ${item.id}`, '', `- **Before:** ${oneLine(item.original)}`);
    lines.push(item.rewrite === null ? '- **After:** No safe rewrite. See the tips.' : `- **After:** ${oneLine(item.rewrite)}`);
    if (item.keywordsAdded.length > 0) lines.push(`- **Keywords added (keep only if true):** ${item.keywordsAdded.map(oneLine).join(', ')}`);
    for (const tip of item.tips) lines.push(`- **Tip:** ${oneLine(tip)}`);
    for (const warning of item.warnings) lines.push(`- **Warning:** ${oneLine(warning)}`);
    lines.push('');
  }

  lines.push('---', 'The score compares keywords only. It does not judge how good your experience is.');
  return `${lines.join('\n')}\n`;
}

/** @param {AnalyzeResponse} data */
export function buildJson(data) {
  return `${JSON.stringify(data, null, 2)}\n`;
}
