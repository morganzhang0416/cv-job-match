// @ts-check

/** @typedef {import('../src/analyze/types.ts').AnalyzeResponse} AnalyzeResponse */
/** @typedef {import('../src/analyze/types.ts').PublicConfig} PublicConfig */

/** An error answer from the server. The message is written for people, so it is safe to show. */
export class ApiError extends Error {
  /**
   * @param {string} message
   * @param {number} status
   * @param {string} code
   * @param {number | null} retryAfter Seconds to wait, from the Retry-After header.
   */
  constructor(message, status, code, retryAfter) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

/** @param {unknown} value @param {string} key */
function textField(value, key) {
  if (typeof value !== 'object' || value === null || !(key in value)) return null;
  const field = /** @type {Record<string, unknown>} */ (value)[key];
  return typeof field === 'string' ? field : null;
}

/** @param {Response} response */
async function toApiError(response) {
  /** @type {unknown} */
  let body = null;
  try {
    body = await response.json();
  } catch {
    // The answer was not JSON (for example, a page from a proxy).
  }
  const error = typeof body === 'object' && body !== null && 'error' in body ? body.error : null;
  const retry = Number(response.headers.get('Retry-After'));
  return new ApiError(
    textField(error, 'message') ?? `The server answered with an error (HTTP ${response.status}).`,
    response.status,
    textField(error, 'code') ?? 'http_error',
    Number.isFinite(retry) && retry > 0 ? Math.ceil(retry) : null,
  );
}

/**
 * @param {FormData} form
 * @param {AbortSignal} signal
 * @returns {Promise<AnalyzeResponse>}
 */
export async function analyze(form, signal) {
  const response = await fetch('/api/analyze', { method: 'POST', body: form, signal });
  if (!response.ok) throw await toApiError(response);
  return /** @type {AnalyzeResponse} */ (await response.json());
}

/** @returns {Promise<PublicConfig>} */
export async function fetchConfig() {
  const response = await fetch('/api/config');
  if (!response.ok) throw await toApiError(response);
  return /** @type {PublicConfig} */ (await response.json());
}

/** @param {'job-description' | 'resume'} name */
export async function fetchSample(name) {
  const response = await fetch(`/samples/${name}.txt`);
  if (!response.ok) throw new Error(`The sample "${name}" could not be loaded (HTTP ${response.status}).`);
  return response.text();
}
