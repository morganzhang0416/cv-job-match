// @ts-check
import { h, svg } from './dom.js';
import { diffWords, IMPORTANCE_LABEL, plural } from './report.js';

/** @typedef {import('../src/analyze/types.ts').AnalyzeResponse} AnalyzeResponse */
/** @typedef {import('../src/analyze/types.ts').BreakdownRow} BreakdownRow */
/** @typedef {import('../src/analyze/types.ts').KeywordResult} KeywordResult */
/** @typedef {import('../src/analyze/types.ts').ResumeInfo} ResumeInfo */
/** @typedef {import('../src/analyze/types.ts').RewriteItem} RewriteItem */
/** @typedef {import('../src/analyze/types.ts').RewriteResult} RewriteResult */

/** @typedef {(text: string, button: HTMLButtonElement) => void} CopyHandler */

const VISIBLE_MISSING = 8;
const RING_RADIUS = 52;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

/**
 * Draws the whole result into `body`. Everything is built with DOM calls, never with HTML strings.
 * @param {HTMLElement} body
 * @param {AnalyzeResponse} data
 * @param {CopyHandler} onCopy Called when the user presses a Copy button.
 */
export function renderResults(body, data, onCopy) {
  body.replaceChildren(
    summaryCard(data),
    missingCard(data.match.missing),
    coveredCard(data.match.matched),
    rewritesCard(data.rewrites, data.resume, onCopy),
  );
}

/** Runs `change` after the browser has drawn the first frame, so the CSS transition can play. */
function afterFirstDraw(/** @type {() => void} */ change) {
  requestAnimationFrame(() => requestAnimationFrame(change));
}

/** @param {number} score */
function scoreRing(score) {
  const circle = { cx: '60', cy: '60', r: String(RING_RADIUS), fill: 'none', 'stroke-width': '12' };
  const bar = svg('circle', {
    ...circle,
    class: 'ring-bar',
    'stroke-linecap': 'round',
    'stroke-dasharray': String(RING_LENGTH),
    'stroke-dashoffset': String(RING_LENGTH),
    transform: 'rotate(-90 60 60)',
  });
  const picture = svg('svg', { viewBox: '0 0 120 120', 'aria-hidden': 'true', focusable: 'false' }, [svg('circle', { ...circle, class: 'ring-track' }), bar]);
  afterFirstDraw(() => {
    bar.style.strokeDashoffset = String(RING_LENGTH * (1 - score / 100));
  });
  return h('div', { class: 'ring', attrs: { role: 'img', 'aria-label': `Match score: ${score} out of 100` } }, [
    picture,
    h('div', { class: 'ring-number', attrs: { 'aria-hidden': 'true' } }, [h('strong', { text: String(score) }), h('span', { text: 'out of 100' })]),
  ]);
}

/** @param {ResumeInfo} resume */
function describeResume(resume) {
  const details = [
    resume.fileName,
    resume.pages === null ? null : `${resume.pages} ${plural(resume.pages, 'page', 'pages')}`,
    `${resume.words.toLocaleString('en-NZ')} words`,
  ]
    .filter(Boolean)
    .join(', ');
  return `I read your resume (${details}) and found ${resume.bullets} ${plural(resume.bullets, 'bullet point', 'bullet points')}.`;
}

/** @param {BreakdownRow[]} rows */
function breakdownList(rows) {
  return h(
    'ul',
    { class: 'breakdown', attrs: { 'aria-label': 'Score breakdown' } },
    rows.map((row) => {
      const fill = h('span', { class: 'bar-fill' });
      afterFirstDraw(() => {
        fill.style.width = `${row.percent}%`;
      });
      return h('li', {}, [
        h('div', { class: 'bar-label' }, [h('span', { text: row.label }), h('span', { class: 'muted', text: `${row.matched} of ${row.total}` })]),
        h('div', { class: 'bar-track', attrs: { role: 'img', 'aria-label': `${row.label}: ${row.matched} of ${row.total} covered (${row.percent}%)` } }, [fill]),
      ]);
    }),
  );
}

/** @param {AnalyzeResponse} data */
function summaryCard({ match, resume }) {
  return h('section', { class: `card summary level-${match.level}`, attrs: { 'aria-labelledby': 'summary-title' } }, [
    scoreRing(match.score),
    h('div', { class: 'summary-text' }, [
      h('h3', { text: match.verdict, attrs: { id: 'summary-title' } }),
      h('p', { text: match.summary }),
      h('p', { class: 'muted small', text: describeResume(resume) }),
    ]),
    breakdownList(match.breakdown),
  ]);
}

/** @param {KeywordResult[]} items */
function keywordList(items) {
  return h(
    'ul',
    { class: 'keyword-list' },
    items.map((item) =>
      h('li', { class: `keyword importance-${item.importance}` }, [
        h('div', { class: 'keyword-head' }, [
          h('strong', { text: item.label }),
          h('span', { class: `tag tag-${item.importance}`, text: IMPORTANCE_LABEL[item.importance] }),
          h('span', { class: 'tag', text: item.category }),
        ]),
        item.snippet ? h('blockquote', { text: item.snippet }) : null,
      ]),
    ),
  );
}

/** @param {KeywordResult[]} missing */
function missingCard(missing) {
  const card = h('section', { class: 'card', attrs: { 'aria-labelledby': 'missing-title' } }, [
    h('h3', { text: `Missing keywords (${missing.length})`, attrs: { id: 'missing-title' } }),
  ]);
  if (missing.length === 0) {
    card.append(h('p', { class: 'ok-note', text: 'Nothing is missing. Your resume covers every keyword from the job description.' }));
    return card;
  }
  card.append(
    h('p', { class: 'muted', text: 'The most valuable ones come first. Add a keyword only where it is true for you, and back it up with a real example.' }),
    keywordList(missing.slice(0, VISIBLE_MISSING)),
  );
  const rest = missing.slice(VISIBLE_MISSING);
  if (rest.length > 0) {
    card.append(h('details', { class: 'more' }, [h('summary', { text: `Show ${rest.length} more` }), keywordList(rest)]));
  }
  return card;
}

/** @param {KeywordResult[]} matched */
function coveredCard(matched) {
  const title = `Keywords you already cover (${matched.length})`;
  if (matched.length === 0) {
    return h('section', { class: 'card' }, [h('h3', { text: title }), h('p', { class: 'muted', text: 'I did not find any keyword from the job description in your resume.' })]);
  }
  return h('section', { class: 'card' }, [
    h('details', {}, [h('summary', { text: title }), h('ul', { class: 'chips' }, matched.map((item) => h('li', { class: 'chip', text: item.label })))]),
  ]);
}

/**
 * @param {RewriteItem} item
 * @param {CopyHandler} onCopy
 */
function rewriteCard(item, onCopy) {
  const rewrite = item.rewrite;
  const head = h('div', { class: 'rewrite-head' }, [h('h4', { text: `Bullet ${item.id}` })]);
  const card = h('li', { class: 'rewrite' }, [head]);

  if (rewrite === null) {
    card.append(h('div', { class: 'version' }, [h('span', { class: 'label', text: 'Your bullet point' }), h('p', { text: item.original })]));
    card.append(
      item.tips.length === 0
        ? h('p', { class: 'ok-note', text: 'This bullet point already looks strong. No change needed.' })
        : h('p', { class: 'muted small', text: 'I have no safe rewrite for this one. Try the tips below.' }),
    );
  } else {
    head.append(h('span', { class: `badge badge-${item.source}`, text: item.source === 'ai' ? 'AI' : 'Built-in' }));
    const copy = h('button', { class: 'small', text: 'Copy new version', attrs: { type: 'button', 'aria-label': `Copy the new version of bullet ${item.id}` } });
    copy.addEventListener('click', () => onCopy(rewrite, copy));
    head.append(copy);
    card.append(
      h('div', { class: 'compare' }, [
        h('div', { class: 'version' }, [h('span', { class: 'label', text: 'Before' }), h('p', { text: item.original })]),
        h('div', { class: 'version after' }, [
          h('span', { class: 'label', text: 'After' }),
          h(
            'p',
            {},
            diffWords(item.original, rewrite).map((run) => (run.added ? h('mark', { text: run.text }) : run.text)),
          ),
        ]),
      ]),
    );
  }

  if (item.keywordsAdded.length > 0) {
    card.append(
      h('div', { class: 'added-line' }, [
        h('strong', { text: 'Keywords added:' }),
        h('ul', { class: 'chips' }, item.keywordsAdded.map((word) => h('li', { class: 'chip', text: word }))),
        h('span', { class: 'muted', text: 'Keep them only if they are true for you.' }),
      ]),
    );
  }

  const notes = [
    ...item.warnings.map((text) => h('li', { class: 'warning', text: `⚠ ${text}` })),
    ...item.tips.map((text) => h('li', { text })),
  ];
  if (notes.length > 0) card.append(h('ul', { class: 'notes' }, notes));
  return card;
}

/**
 * @param {RewriteResult} rewrites
 * @param {ResumeInfo} resume
 * @param {CopyHandler} onCopy
 */
function rewritesCard(rewrites, resume, onCopy) {
  const who = rewrites.mode === 'ai' ? `Written by AI${rewrites.model ? ` (${rewrites.model})` : ''}` : 'Built-in suggestions';
  const card = h('section', { class: 'card', attrs: { 'aria-labelledby': 'rewrites-title' } }, [
    h('div', { class: 'section-head' }, [
      h('h3', { text: 'Bullet-point rewrites', attrs: { id: 'rewrites-title' } }),
      h('span', { class: `badge badge-${rewrites.mode}`, text: who }),
    ]),
  ]);
  if (rewrites.notice) card.append(h('p', { class: 'notice', text: rewrites.notice }));

  const count = rewrites.items.length;
  if (count === 0) {
    if (!rewrites.notice) card.append(h('p', { class: 'muted', text: 'There are no bullet points to rewrite.' }));
    return card;
  }
  const intro =
    count >= resume.bullets
      ? `Here ${plural(count, 'is your bullet point', 'are your bullet points')}, with ideas to make ${plural(count, 'it', 'them')} stronger.`
      : `I picked ${count} of your ${resume.bullets} bullet points that can improve the most.`;
  card.append(
    h('p', { class: 'muted', text: `${intro} New words are highlighted.` }),
    h('p', { class: 'caution', text: 'Check that every line is true before you use it. Do not add skills or numbers that you cannot back up.' }),
    h('ol', { class: 'rewrite-list' }, rewrites.items.map((item) => rewriteCard(item, onCopy))),
  );
  return card;
}
