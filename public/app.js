// @ts-check
import { analyze, ApiError, fetchConfig, fetchSample } from './api.js';
import { h } from './dom.js';
import { renderResults } from './render.js';
import { buildJson, buildMarkdown, formatBytes, localDate } from './report.js';

/** @typedef {import('../src/analyze/types.ts').AnalyzeResponse} AnalyzeResponse */
/** @typedef {import('../src/analyze/types.ts').PublicConfig} PublicConfig */

// The server checks the same limits. These are here so people get an answer without waiting.
const MIN_JOB_CHARS = 50;
const REQUEST_TIMEOUT_MS = 90_000;
const DEFAULT_EXTENSIONS = ['.pdf', '.docx', '.txt', '.md'];
const BUTTON_LABEL = 'Analyze my resume';

/**
 * Finds an element that index.html must contain.
 * @template {HTMLElement} T
 * @param {string} id
 * @param {new () => T} type
 * @returns {T}
 */
function need(id, type) {
  const element = document.getElementById(id);
  if (!(element instanceof type)) throw new Error(`index.html is missing #${id}`);
  return element;
}

const form = need('analyze-form', HTMLFormElement);
const jobInput = need('job', HTMLTextAreaElement);
const jobCount = need('job-count', HTMLElement);
const clearJob = need('clear-job', HTMLButtonElement);
const modeFile = need('mode-file', HTMLInputElement);
const modeText = need('mode-text', HTMLInputElement);
const filePanel = need('resume-file-panel', HTMLElement);
const textPanel = need('resume-text-panel', HTMLElement);
const fileInput = need('resume-file', HTMLInputElement);
const dropzone = need('dropzone', HTMLElement);
const fileLimits = need('file-limits', HTMLElement);
const fileCard = need('file-card', HTMLElement);
const fileName = need('file-name', HTMLElement);
const fileSize = need('file-size', HTMLElement);
const changeFile = need('change-file', HTMLButtonElement);
const removeFile = need('remove-file', HTMLButtonElement);
const resumeText = need('resume-text', HTMLTextAreaElement);
const useAi = need('use-ai', HTMLInputElement);
const aiHint = need('ai-hint', HTMLElement);
const analyzeButton = need('analyze', HTMLButtonElement);
const sampleButton = need('sample', HTMLButtonElement);
const statusBox = need('status', HTMLElement);
const errorBox = need('error', HTMLElement);
const results = need('results', HTMLElement);
const resultsTitle = need('results-title', HTMLElement);
const resultsBody = need('results-body', HTMLElement);
const copyReport = need('copy-report', HTMLButtonElement);
const downloadJson = need('download-json', HTMLButtonElement);
const printReport = need('print-report', HTMLButtonElement);

/** @type {PublicConfig | null} */
let config = null;
/** @type {File | null} */
let selectedFile = null;
/** @type {AnalyzeResponse | null} */
let lastResponse = null;
let busy = false;

const number = new Intl.NumberFormat('en-NZ');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

const maxJobChars = () => config?.maxJobChars ?? 20_000;
const maxResumeChars = () => config?.maxResumeChars ?? 60_000;
const maxUploadMb = () => config?.maxUploadMb ?? 5;
const extensions = () => config?.acceptedExtensions ?? DEFAULT_EXTENSIONS;

/* Messages */

/** @param {string} message */
function showError(message) {
  errorBox.textContent = message;
  errorBox.hidden = false;
  errorBox.scrollIntoView({ block: 'nearest', behavior: reducedMotion.matches ? 'auto' : 'smooth' });
}

function hideError() {
  errorBox.hidden = true;
  errorBox.textContent = '';
}

/** @param {string} message */
function say(message) {
  statusBox.textContent = message;
}

/* Job description */

function updateJobCount() {
  const length = jobInput.value.length;
  jobCount.classList.toggle('over-limit', length > maxJobChars());
  if (length === 0) jobCount.textContent = `Up to ${number.format(maxJobChars())} characters`;
  else if (length > maxJobChars()) jobCount.textContent = `${number.format(length)} characters. This is too long. The limit is ${number.format(maxJobChars())}.`;
  else jobCount.textContent = `${number.format(length)} characters`;
}

/* Resume: file or text */

/** @param {'file' | 'text'} mode */
function setMode(mode) {
  modeFile.checked = mode === 'file';
  modeText.checked = mode === 'text';
  filePanel.hidden = mode !== 'file';
  textPanel.hidden = mode !== 'text';
}

const getMode = () => (modeText.checked ? 'text' : 'file');

/** @param {string[]} items */
function joinWords(items) {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} or ${items[items.length - 1]}`;
}

function describeLimits() {
  const names = extensions().map((extension) => extension.replace('.', '').toUpperCase());
  fileLimits.textContent = `${joinWords(names)}. Up to ${maxUploadMb()} MB.`;
  fileInput.accept = extensions().join(',');
}

function showFile() {
  const chosen = selectedFile !== null;
  fileCard.hidden = !chosen;
  dropzone.hidden = chosen;
  fileInput.hidden = chosen;
  fileName.textContent = selectedFile?.name ?? '';
  fileSize.textContent = selectedFile ? formatBytes(selectedFile.size) : '';
}

function clearFile() {
  selectedFile = null;
  fileInput.value = '';
  showFile();
}

/**
 * Returns a reason when the file is not accepted, or null when it is fine.
 * @param {File} file
 */
function fileProblem(file) {
  const dot = file.name.lastIndexOf('.');
  const extension = dot > 0 ? file.name.slice(dot).toLowerCase() : '';
  if (extension && !extensions().includes(extension)) {
    return `I cannot read "${extension}" files. Please use ${joinWords(extensions().map((item) => item.replace('.', '').toUpperCase()))}.`;
  }
  if (file.size === 0) return 'This file is empty. Choose another file, or paste your resume text.';
  if (file.size > maxUploadMb() * 1024 * 1024) {
    // Round up, so a file that is a little over the limit never shows the same number as the limit.
    const megabytes = Math.ceil((file.size / (1024 * 1024)) * 10) / 10;
    return `This file is too big (${megabytes.toFixed(1)} MB). The limit is ${maxUploadMb()} MB.`;
  }
  return null;
}

/** @param {File | null | undefined} file */
function chooseFile(file) {
  hideError();
  if (!file) return;
  const problem = fileProblem(file);
  if (problem) {
    clearFile();
    showError(problem);
    return;
  }
  selectedFile = file;
  showFile();
  say(`Resume chosen: ${file.name}.`);
}

/** @param {DragEvent} event */
const dragHasFiles = (event) => Array.from(event.dataTransfer?.types ?? []).includes('Files');

/* AI choice */

function applyConfig() {
  describeLimits();
  useAi.disabled = !config?.aiAvailable;
  useAi.checked = Boolean(config?.aiAvailable);
  updateJobCount();
  updateAiHint();
}

function updateAiHint() {
  if (!config) {
    aiHint.textContent = 'I could not check the AI setting. You still get built-in suggestions.';
  } else if (!config.aiAvailable) {
    aiHint.textContent = 'AI is not set up on this server, so you get built-in suggestions. The README shows how to turn AI on.';
  } else if (useAi.checked) {
    const where = `${config.aiProvider ?? 'the AI service'}${config.aiModel ? ` (${config.aiModel})` : ''}`;
    aiHint.textContent = `Only the job description and up to 6 bullet points go to ${where}. Your contact details are not sent, but names inside a bullet point are.`;
  } else {
    aiHint.textContent = 'Nothing leaves this computer. You still get built-in suggestions.';
  }
}

/* Sending */

/** @returns {{ message: string, focus: HTMLElement } | null} */
function validate() {
  const job = jobInput.value.trim();
  if (job.length < MIN_JOB_CHARS) {
    return { message: `The job description is too short. Paste the full text (at least ${MIN_JOB_CHARS} characters).`, focus: jobInput };
  }
  if (jobInput.value.length > maxJobChars()) {
    return { message: `The job description is too long. The limit is ${number.format(maxJobChars())} characters.`, focus: jobInput };
  }
  if (getMode() === 'file') {
    if (!selectedFile) return { message: 'Choose your resume file, or switch to "Paste text".', focus: fileInput };
  } else if (resumeText.value.trim() === '') {
    return { message: 'Paste your resume text, or switch to "Upload a file".', focus: resumeText };
  } else if (resumeText.value.length > maxResumeChars()) {
    return { message: `The resume text is too long. The limit is ${number.format(maxResumeChars())} characters.`, focus: resumeText };
  }
  return null;
}

function buildForm() {
  const data = new FormData();
  data.set('jobDescription', jobInput.value);
  data.set('useAi', String(useAi.checked && !useAi.disabled));
  if (getMode() === 'file' && selectedFile) data.set('resume', selectedFile, selectedFile.name);
  else data.set('resumeText', resumeText.value);
  return data;
}

/** @param {boolean} value */
function setBusy(value) {
  busy = value;
  form.setAttribute('aria-busy', String(value));
  analyzeButton.disabled = value;
  sampleButton.disabled = value;
  if (value) analyzeButton.replaceChildren(h('span', { class: 'spinner', attrs: { 'aria-hidden': 'true' } }), 'Analyzing…');
  else analyzeButton.textContent = BUTTON_LABEL;
}

/**
 * @param {unknown} error
 * @param {boolean} timedOut
 */
function describeFailure(error, timedOut) {
  if (error instanceof ApiError) {
    const wait = error.retryAfter === null ? '' : ` Wait ${error.retryAfter} seconds, then try again.`;
    return `${error.message}${wait}`;
  }
  if (timedOut) return 'This is taking too long. Try again. If AI is on, you can also turn it off for a faster answer.';
  if (error instanceof TypeError) return 'I could not reach the server. Check that it is still running, then try again.';
  return 'Something went wrong. Please try again.';
}

async function run() {
  if (busy) return;
  hideError();
  const problem = validate();
  if (problem) {
    showError(problem.message);
    problem.focus.focus();
    return;
  }

  setBusy(true);
  say(useAi.checked ? 'Reading your resume and asking the AI for rewrites. This can take up to 30 seconds…' : 'Reading your resume and comparing keywords…');
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let failed = false;
  try {
    show(await analyze(buildForm(), controller.signal));
  } catch (error) {
    failed = true;
    say('');
    showError(describeFailure(error, controller.signal.aborted));
  } finally {
    window.clearTimeout(timer);
    setBusy(false);
  }
  // The button was disabled while busy, so the browser may have dropped the focus. Give it back after an error.
  if (failed && (document.activeElement === null || document.activeElement === document.body)) {
    analyzeButton.focus({ preventScroll: true });
  }
}

/** @param {AnalyzeResponse} data */
function show(data) {
  lastResponse = data;
  renderResults(resultsBody, data, copyText);
  results.hidden = false;
  say(`Done. Your match score is ${data.match.score} out of 100.`);
  resultsTitle.focus({ preventScroll: true });
  results.scrollIntoView({ block: 'start', behavior: reducedMotion.matches ? 'auto' : 'smooth' });
}

async function loadSample() {
  if (busy) return;
  hideError();
  try {
    const [job, resume] = await Promise.all([fetchSample('job-description'), fetchSample('resume')]);
    jobInput.value = job;
    resumeText.value = resume;
    clearFile();
    setMode('text');
    updateJobCount();
  } catch {
    showError('I could not load the sample. Reload the page and try again.');
    return;
  }
  await run();
}

/* Copy and download */

/** @type {WeakMap<HTMLButtonElement, { label: string, timer: number }>} */
const flashing = new WeakMap();

/**
 * Shows a short message on a button, then puts the old label back.
 * @param {HTMLButtonElement} button
 * @param {string} text
 */
function flash(button, text) {
  const previous = flashing.get(button);
  if (previous) window.clearTimeout(previous.timer);
  const label = previous?.label ?? button.textContent ?? '';
  button.textContent = text;
  const timer = window.setTimeout(() => {
    button.textContent = label;
    flashing.delete(button);
  }, 1800);
  flashing.set(button, { label, timer });
}

/** @param {string} text */
async function writeToClipboard(text) {
  try {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // The clipboard can be blocked. Try the older way below.
  }
  const box = h('textarea', { class: 'visually-hidden', attrs: { readonly: '', 'aria-hidden': 'true', tabindex: '-1' } });
  box.value = text;
  document.body.append(box);
  box.select();
  let copied = false;
  try {
    copied = document.execCommand('copy');
  } catch {
    copied = false;
  }
  box.remove();
  return copied;
}

/**
 * @param {string} text
 * @param {HTMLButtonElement} button
 */
async function copyText(text, button) {
  const copied = await writeToClipboard(text);
  button.focus({ preventScroll: true });
  flash(button, copied ? 'Copied!' : 'Could not copy');
  say(copied ? 'Copied to the clipboard.' : 'I could not copy to the clipboard. Use "Download JSON" instead.');
}

/**
 * @param {string} name
 * @param {string} text
 * @param {string} type
 */
function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = h('a', { attrs: { href: url, download: name, hidden: '' } });
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/* Events */

jobInput.addEventListener('input', updateJobCount);
clearJob.addEventListener('click', () => {
  jobInput.value = '';
  updateJobCount();
  jobInput.focus();
});

modeFile.addEventListener('change', () => setMode(getMode()));
modeText.addEventListener('change', () => setMode(getMode()));

fileInput.addEventListener('change', () => chooseFile(fileInput.files?.item(0)));
changeFile.addEventListener('click', () => fileInput.click());
removeFile.addEventListener('click', () => {
  clearFile();
  fileInput.focus();
});

dropzone.addEventListener('dragenter', (event) => {
  if (dragHasFiles(event)) dropzone.classList.add('is-dragover');
});
dropzone.addEventListener('dragleave', (event) => {
  if (!(event.relatedTarget instanceof Node && dropzone.contains(event.relatedTarget))) dropzone.classList.remove('is-dragover');
});
// A file dropped anywhere on the page is used as the resume, so the browser does not open it instead.
window.addEventListener('dragover', (event) => {
  if (dragHasFiles(event)) event.preventDefault();
});
window.addEventListener('drop', (event) => {
  if (!dragHasFiles(event)) return;
  event.preventDefault();
  dropzone.classList.remove('is-dragover');
  const file = event.dataTransfer?.files.item(0);
  if (!file) return;
  setMode('file');
  chooseFile(file);
});

useAi.addEventListener('change', updateAiHint);
form.addEventListener('submit', (event) => {
  event.preventDefault();
  void run();
});
sampleButton.addEventListener('click', () => void loadSample());

copyReport.addEventListener('click', () => {
  if (lastResponse) void copyText(buildMarkdown(lastResponse), copyReport);
});
downloadJson.addEventListener('click', () => {
  if (!lastResponse) return;
  const name = `resume-match-${localDate()}.json`;
  download(name, buildJson(lastResponse), 'application/json');
  say(`Download started: ${name}`);
});
printReport.addEventListener('click', () => window.print());

/* Start */

showFile();
setMode('file');
applyConfig();
fetchConfig().then(
  (value) => {
    config = value;
    applyConfig();
  },
  () => {
    config = null;
    applyConfig();
  },
);
