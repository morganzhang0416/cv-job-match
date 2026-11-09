import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { request } from 'node:http';
import type { AnalyzeResponse, ApiErrorBody } from '../../src/analyze/types.ts';
import { docxFile, para } from './docx.ts';
import { makePdf } from './pdf.ts';

export const JOB = readFileSync(new URL('../../public/samples/job-description.txt', import.meta.url), 'utf8');
export const RESUME = readFileSync(new URL('../../public/samples/resume.txt', import.meta.url), 'utf8');

const lines = (text: string): string[] => text.split('\n').filter((line) => line.trim() !== '');

/** The sample resume as a Word file. Lines that start with "- " become list paragraphs, like bullets in Word. */
export function resumeAsDocx(text = RESUME): Buffer {
  return docxFile(lines(text).map((line) => (line.startsWith('- ') ? para(line.slice(2), { list: true }) : para(line))).join(''));
}

/** The sample resume as a one-page PDF. Lines that start with "- " get a bullet symbol. */
export function resumeAsPdf(text = RESUME): Buffer {
  return makePdf([lines(text).map((line) => (line.startsWith('- ') ? `\u2022 ${line.slice(2)}` : line))]);
}

export interface UploadFile {
  data: Uint8Array;
  name: string;
  /** The form field. The app reads "resume". */
  field?: string;
}

export function makeForm(fields: Record<string, string>, ...files: UploadFile[]): FormData {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) form.append(name, value);
  for (const file of files) form.append(file.field ?? 'resume', new Blob([file.data]), file.name);
  return form;
}

export function postForm(url: string, form: FormData, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(`${url}/api/analyze`, { method: 'POST', body: form, headers });
}

export function postJson(url: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(`${url}/api/analyze`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

/** The answer of a request that worked. */
export async function ok(response: Response): Promise<AnalyzeResponse> {
  const text = await response.text();
  assert.equal(response.status, 200, `expected 200, got ${response.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text) as AnalyzeResponse;
}

/** The error of a request that failed. It checks the status and the JSON shape. */
export async function failure(response: Response, status: number): Promise<ApiErrorBody['error']> {
  const text = await response.text();
  assert.equal(response.status, status, `expected ${status}, got ${response.status}: ${text.slice(0, 300)}`);
  assert.match(response.headers.get('content-type') ?? '', /^application\/json/);
  const body = JSON.parse(text) as ApiErrorBody;
  assert.deepEqual(Object.keys(body), ['error']);
  assert.deepEqual(Object.keys(body.error).sort(), ['code', 'message']);
  return body.error;
}

export interface RawResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

/** A request with exact control over the headers and the body. fetch does not allow this for the Host header. */
export function rawRequest(url: string, options: { method?: string; path: string; headers?: Record<string, string>; body?: string }): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const req = request(url + options.path, { method: options.method ?? 'GET', headers: options.headers ?? {} }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode ?? 0, headers: response.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end(options.body);
  });
}
