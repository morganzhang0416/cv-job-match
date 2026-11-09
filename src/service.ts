import { extractBullets, pickBullets } from './analyze/bullets.ts';
import { analyzeMatch } from './analyze/index.ts';
import { countWords, normalizeText } from './analyze/text.ts';
import type { AnalyzeResponse, ResumeInfo } from './analyze/types.ts';
import { MAX_JOB_CHARS, MAX_RESUME_CHARS, MIN_JOB_CHARS } from './config.ts';
import { AppError } from './errors.ts';
import { extractResume } from './extract/index.ts';
import type { Rewriter } from './rewrites.ts';

export type ResumeInput = { kind: 'file'; data: Uint8Array; fileName: string | null } | { kind: 'text'; text: string };

export interface AnalyzeInput {
  jobDescription: string;
  /** null means that the request had no resume. */
  resume: ResumeInput | null;
  /** Send the job text and a few bullets to the AI service. The caller must ask for it. */
  useAi: boolean;
}

export const NO_BULLETS_NOTICE = 'I could not find bullet points in the resume. Put each achievement on its own line that starts with • or -.';

const number = (value: number): string => value.toLocaleString('en-US');

function cleanJob(raw: string): string {
  const text = normalizeText(raw);
  if (text.length < MIN_JOB_CHARS) {
    throw new AppError(400, 'job_too_short', `Paste the job description. It needs at least ${MIN_JOB_CHARS} characters.`);
  }
  if (text.length > MAX_JOB_CHARS) {
    throw new AppError(
      413,
      'job_too_long',
      `The job description has more than ${number(MAX_JOB_CHARS)} characters. Paste only the part about the role and its requirements.`,
    );
  }
  return text;
}

interface ReadResume {
  text: string;
  info: Pick<ResumeInfo, 'source' | 'fileName' | 'pages'>;
}

async function readResume(input: ResumeInput | null): Promise<ReadResume> {
  if (input === null) throw new AppError(400, 'resume_missing', 'Add your resume: upload a file or paste its text.');
  let read: ReadResume;
  if (input.kind === 'file') {
    const { text, source, pages } = await extractResume(input.data);
    read = { text, info: { source, fileName: input.fileName, pages } };
  } else {
    read = { text: normalizeText(input.text), info: { source: 'pasted', fileName: null, pages: null } };
  }
  if (read.text.length > MAX_RESUME_CHARS) {
    throw new AppError(413, 'resume_too_long', `The resume has more than ${number(MAX_RESUME_CHARS)} characters. Use a shorter resume.`);
  }
  return read;
}

/** Runs the whole job: read the resume, score it, pick bullets and write the suggestions. */
export async function analyze(input: AnalyzeInput, rewriter: Rewriter): Promise<AnalyzeResponse> {
  // The job is checked first. This is cheap, so a bad job text does not cost a PDF read.
  const jobText = cleanJob(input.jobDescription);
  const resume = await readResume(input.resume);

  const { match, terms } = analyzeMatch(jobText, resume.text);
  const bullets = extractBullets(resume.text);
  const rewrites = await rewriter.rewrite({ jobText, bullets: pickBullets(bullets, terms), terms, useAi: input.useAi });
  if (bullets.length === 0 && rewrites.notice === null) rewrites.notice = NO_BULLETS_NOTICE;

  return {
    match,
    rewrites,
    resume: { ...resume.info, characters: resume.text.length, words: countWords(resume.text), bullets: bullets.length },
  };
}
