import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { extractBullets } from '../src/analyze/bullets.ts';
import { countWords, normalizeText } from '../src/analyze/text.ts';
import { MAX_UPLOAD_BYTES } from '../src/config.ts';
import { failure, JOB, makeForm, ok, postForm, postJson, rawRequest, RESUME, resumeAsDocx, resumeAsPdf } from './helpers/api.ts';
import { makePdf } from './helpers/pdf.ts';
import { startServer, type TestServer } from './helpers/server.ts';

let server: TestServer;
before(async () => {
  server = await startServer();
});
after(async () => {
  await server.close();
});

describe('basic routes', () => {
  it('answers the health check', async () => {
    const response = await fetch(`${server.url}/api/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'ok' });
  });

  it('tells the browser its limits, and that no AI is set up', async () => {
    const response = await fetch(`${server.url}/api/config`);
    assert.deepEqual(await response.json(), {
      aiAvailable: false,
      aiProvider: null,
      aiModel: null,
      maxUploadMb: 5,
      maxJobChars: 20_000,
      maxResumeChars: 60_000,
      acceptedExtensions: ['.pdf', '.docx', '.txt', '.md'],
    });
  });

  it('answers an unknown API address with a JSON 404', async () => {
    const error = await failure(await fetch(`${server.url}/api/nothing`), 404);
    assert.equal(error.code, 'not_found');
  });

  it('answers the wrong method with 405 and says which method to use', async () => {
    for (const method of ['GET', 'PUT', 'DELETE']) {
      const response = await fetch(`${server.url}/api/analyze`, { method });
      assert.equal(response.headers.get('allow'), 'POST');
      assert.equal((await failure(response, 405)).code, 'method_not_allowed');
    }
  });

  it('answers an unknown page with a short text 404', async () => {
    const response = await fetch(`${server.url}/nothing-here`);
    assert.equal(response.status, 404);
    assert.match(response.headers.get('content-type') ?? '', /^text\/plain/);
    assert.equal(await response.text(), 'Not found');
  });
});

describe('analysis of pasted text', () => {
  it('scores the sample resume and returns six rewrite cards', async () => {
    const result = await ok(await postJson(server.url, { jobDescription: JOB, resumeText: RESUME }));

    assert.equal(result.match.score, 68);
    assert.equal(result.match.level, 'strong');
    assert.ok(result.match.missing.length > 0);
    const text = normalizeText(RESUME);
    assert.deepEqual(result.resume, {
      source: 'pasted',
      fileName: null,
      pages: null,
      characters: text.length,
      words: countWords(text),
      bullets: 12,
    });

    assert.equal(result.rewrites.mode, 'offline');
    assert.equal(result.rewrites.model, null);
    assert.equal(result.rewrites.notice, null);
    assert.equal(result.rewrites.items.length, 6);
    const bullets = extractBullets(text);
    for (const item of result.rewrites.items) {
      assert.equal(item.original, bullets[item.id - 1]);
      assert.equal(item.source, 'offline');
    }
    assert.equal(new Set(result.rewrites.items.map((item) => item.id)).size, 6);
  });

  it('gives the same answer every time for the same input', async () => {
    const first = await ok(await postJson(server.url, { jobDescription: JOB, resumeText: RESUME }));
    const second = await ok(await postJson(server.url, { jobDescription: JOB, resumeText: RESUME }));
    assert.deepEqual(second, first);
  });

  it('says so when the resume has no bullet points', async () => {
    const skillsOnly =
      'Alex Taylor\nSoftware Engineer\n\nSKILLS\nJavaScript, TypeScript, React, Node.js, Express, PostgreSQL, MongoDB, AWS, Docker, Git, GitHub Actions, Jest, REST APIs, Agile, Python, Linux, Terraform, Kubernetes, SQL, Redis\n';
    const result = await ok(await postJson(server.url, { jobDescription: JOB, resumeText: skillsOnly }));
    assert.equal(result.resume.bullets, 0);
    assert.deepEqual(result.rewrites.items, []);
    assert.match(result.rewrites.notice ?? '', /could not find bullet points/);
  });
});

describe('analysis of uploaded files', () => {
  let pastedScore = 0;
  before(async () => {
    pastedScore = (await ok(await postJson(server.url, { jobDescription: JOB, resumeText: RESUME }))).match.score;
  });

  it('reads a text file', async () => {
    const result = await ok(await postForm(server.url, makeForm({ jobDescription: JOB }, { data: Buffer.from(RESUME), name: 'alex.txt' })));
    assert.equal(result.resume.source, 'text');
    assert.equal(result.resume.fileName, 'alex.txt');
    assert.equal(result.resume.pages, null);
    assert.equal(result.match.score, pastedScore);
  });

  it('reads a Word file and gets the same score as the text', async () => {
    const result = await ok(await postForm(server.url, makeForm({ jobDescription: JOB }, { data: resumeAsDocx(), name: 'alex.docx' })));
    assert.equal(result.resume.source, 'docx');
    assert.equal(result.resume.fileName, 'alex.docx');
    assert.equal(result.resume.bullets, 12);
    assert.equal(result.match.score, pastedScore);
  });

  it('reads a PDF file and gets the same score as the text', async () => {
    const result = await ok(await postForm(server.url, makeForm({ jobDescription: JOB }, { data: resumeAsPdf(), name: 'alex.pdf' })));
    assert.equal(result.resume.source, 'pdf');
    assert.equal(result.resume.pages, 1);
    assert.equal(result.resume.bullets, 12);
    assert.equal(result.match.score, pastedScore);
  });

  it('finds the file type from the content, not from the name', async () => {
    const pdfNamedTxt = await ok(await postForm(server.url, makeForm({ jobDescription: JOB }, { data: resumeAsPdf(), name: 'resume.txt' })));
    assert.equal(pdfNamedTxt.resume.source, 'pdf');
    const textNamedPdf = await ok(await postForm(server.url, makeForm({ jobDescription: JOB }, { data: Buffer.from(RESUME), name: 'resume.pdf' })));
    assert.equal(textNamedPdf.resume.source, 'text');
  });

  it('keeps a file name with special letters', async () => {
    const name = 'résumé – Zoë Ng.txt';
    const result = await ok(await postForm(server.url, makeForm({ jobDescription: JOB }, { data: Buffer.from(RESUME), name })));
    assert.equal(result.resume.fileName, name);
  });

  it('cleans a file name that has a line break, and cuts a very long one', async () => {
    const broken = await ok(await postForm(server.url, makeForm({ jobDescription: JOB }, { data: Buffer.from(RESUME), name: 'a\nb.txt' })));
    assert.equal(broken.resume.fileName, 'a b.txt');
    const long = await ok(await postForm(server.url, makeForm({ jobDescription: JOB }, { data: Buffer.from(RESUME), name: `${'x'.repeat(300)}.txt` })));
    assert.equal(long.resume.fileName?.length, 120);
  });

  it('ignores an empty resumeText field when a file is sent', async () => {
    const form = makeForm({ jobDescription: JOB, resumeText: '  ' }, { data: Buffer.from(RESUME), name: 'alex.txt' });
    assert.equal((await ok(await postForm(server.url, form))).resume.source, 'text');
  });

  it('reads the pasted text of a form without a file', async () => {
    const result = await ok(await postForm(server.url, makeForm({ jobDescription: JOB, resumeText: RESUME, useAi: 'false' })));
    assert.equal(result.resume.source, 'pasted');
    assert.equal(result.match.score, pastedScore);
  });
});

describe('checks on the fields', () => {
  it('asks for the job description when it is missing or short', async () => {
    for (const body of [{ resumeText: RESUME }, { jobDescription: '', resumeText: RESUME }, { jobDescription: 'Software engineer', resumeText: RESUME }]) {
      assert.equal((await failure(await postJson(server.url, body), 400)).code, 'job_too_short');
    }
  });

  it('rejects a job description that is too long', async () => {
    const error = await failure(await postJson(server.url, { jobDescription: 'a '.repeat(10_001), resumeText: RESUME }), 413);
    assert.equal(error.code, 'job_too_long');
    assert.match(error.message, /20,000/);
  });

  it('rejects fields of the wrong type, and a body that is not an object', async () => {
    const bad: unknown[] = [
      { jobDescription: 5, resumeText: RESUME },
      { jobDescription: JOB, resumeText: ['a'] },
      { jobDescription: JOB, resumeText: RESUME, useAi: 'maybe' },
      { jobDescription: JOB, resumeText: RESUME, useAi: 3 },
      [],
    ];
    for (const body of bad) {
      assert.equal((await failure(await postJson(server.url, body), 400)).code, 'invalid_request', JSON.stringify(body));
    }
  });

  it('asks for a resume when there is none', async () => {
    for (const body of [{ jobDescription: JOB }, { jobDescription: JOB, resumeText: '   \n ' }]) {
      assert.equal((await failure(await postJson(server.url, body), 400)).code, 'resume_missing');
    }
  });

  it('does not take a file and pasted text together', async () => {
    const form = makeForm({ jobDescription: JOB, resumeText: RESUME }, { data: Buffer.from(RESUME), name: 'alex.txt' });
    assert.equal((await failure(await postForm(server.url, form), 400)).code, 'resume_conflict');
  });

  it('rejects a resume with too few words', async () => {
    const error = await failure(await postJson(server.url, { jobDescription: JOB, resumeText: 'Alex Taylor, software engineer, TypeScript and React.' }), 422);
    assert.equal(error.code, 'resume_too_short');
  });

  it('rejects a job description with too few skills', async () => {
    const vague = 'We are looking for a friendly person to join our small team in a lovely office near the beach in Auckland.';
    const error = await failure(await postJson(server.url, { jobDescription: vague, resumeText: RESUME }), 422);
    assert.equal(error.code, 'job_too_vague');
  });

  it('rejects resume text that is too long', async () => {
    const error = await failure(await postJson(server.url, { jobDescription: JOB, resumeText: 'word '.repeat(12_001) }), 413);
    assert.equal(error.code, 'resume_too_long');
    assert.match(error.message, /60,000/);
  });

  it('checks the job description before it reads the file', async () => {
    const form = makeForm({ jobDescription: 'too short' }, { data: Buffer.from('%PDF-1.4 this is not a real pdf'), name: 'x.pdf' });
    assert.equal((await failure(await postForm(server.url, form), 400)).code, 'job_too_short');
  });
});

describe('checks on the request body', () => {
  it('rejects broken JSON, and never quotes it back', async () => {
    const error = await failure(await postJson(server.url, '{"jobDescription": "SECRET-TEXT'), 400);
    assert.equal(error.code, 'invalid_json');
    assert.ok(!error.message.includes('SECRET'));
  });

  it('rejects JSON that is not an object', async () => {
    for (const body of ['"text"', 'null', '12']) {
      assert.equal((await failure(await postJson(server.url, body), 400)).code, 'invalid_json', body);
    }
  });

  it('rejects a JSON body that is too big', async () => {
    const error = await failure(await postJson(server.url, { jobDescription: JOB, resumeText: 'a'.repeat(600 * 1024) }), 413);
    assert.equal(error.code, 'body_too_large');
  });

  it('rejects content types other than JSON and forms', async () => {
    const asText = await fetch(`${server.url}/api/analyze`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JOB });
    assert.equal((await failure(asText, 415)).code, 'unsupported_media_type');
    const noBody = await fetch(`${server.url}/api/analyze`, { method: 'POST' });
    assert.equal((await failure(noBody, 415)).code, 'unsupported_media_type');
  });

  it('rejects a form that is broken, and never quotes it back', async () => {
    const response = await rawRequest(server.url, {
      method: 'POST',
      path: '/api/analyze',
      headers: { 'content-type': 'multipart/form-data; boundary=xyz' },
      body: '--xyz\r\nContent-Disposition: form-data; name="jobDescription"\r\n\r\nSECRET-TEXT',
    });
    assert.equal(response.status, 400);
    const body = JSON.parse(response.body) as { error: { code: string; message: string } };
    assert.equal(body.error.code, 'bad_upload');
    assert.ok(!response.body.includes('SECRET'));
  });

  it('rejects a text field in a form that is too big', async () => {
    const error = await failure(await postForm(server.url, makeForm({ jobDescription: JOB, resumeText: 'a'.repeat(600 * 1024) })), 413);
    assert.equal(error.code, 'text_too_large');
  });
});

describe('checks on the file', () => {
  const upload = (data: Uint8Array, name = 'cv.bin', extra: Record<string, string> = {}): Promise<Response> =>
    postForm(server.url, makeForm({ jobDescription: JOB, ...extra }, { data, name }));

  it('rejects a file over the size limit', async () => {
    const error = await failure(await upload(Buffer.alloc(MAX_UPLOAD_BYTES + 1, 'a'), 'big.txt'), 413);
    assert.equal(error.code, 'file_too_large');
    assert.match(error.message, /5 MB/);
  });

  it('accepts a file of exactly the size limit', async () => {
    // The file passes the size check. It then stops at the limit for the text of a resume.
    const error = await failure(await upload(Buffer.alloc(MAX_UPLOAD_BYTES, 'a'), 'edge.txt'), 413);
    assert.equal(error.code, 'resume_too_long');
  });

  it('rejects a file type that is not supported', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52]);
    assert.equal((await failure(await upload(png, 'photo.png'), 415)).code, 'unsupported_file');
  });

  it('rejects an empty file', async () => {
    assert.equal((await failure(await upload(new Uint8Array(0), 'empty.txt'), 400)).code, 'empty_file');
  });

  it('rejects a PDF that has no text, like a scan', async () => {
    assert.equal((await failure(await upload(makePdf([[]]), 'scan.pdf'), 422)).code, 'no_text');
  });

  it('rejects a PDF that is broken', async () => {
    const error = await failure(await upload(Buffer.from('%PDF-1.4 this is not a real pdf'), 'broken.pdf'), 422);
    assert.equal(error.code, 'unreadable_file');
  });

  it('rejects two files', async () => {
    const form = makeForm(
      { jobDescription: JOB },
      { data: Buffer.from(RESUME), name: 'a.txt' },
      { data: Buffer.from(RESUME), name: 'b.txt' },
    );
    assert.equal((await failure(await postForm(server.url, form), 400)).code, 'bad_upload');
  });

  it('rejects a file in the wrong field', async () => {
    const form = makeForm({ jobDescription: JOB }, { data: Buffer.from(RESUME), name: 'a.txt', field: 'cv' });
    assert.equal((await failure(await postForm(server.url, form), 400)).code, 'bad_upload');
  });
});
