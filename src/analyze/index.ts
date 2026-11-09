import type { MatchResult } from './types.ts';
import { AppError } from '../errors.ts';
import { extractJobTerms, profileResume, type JobTerm } from './keywords.ts';
import { scoreMatch } from './match.ts';
import { countWords } from './text.ts';

/** A job description needs at least this many skills or keywords to give a fair score. */
export const MIN_JOB_TERMS = 3;
/** A resume needs at least this many words to give a fair score. */
export const MIN_RESUME_WORDS = 20;

export interface Analysis {
  match: MatchResult;
  /** The job terms behind the score. The rewrite step uses them to pick and check bullets. */
  terms: JobTerm[];
}

/** Scores a resume against a job description. Everything runs in this process and nothing is sent anywhere. */
export function analyzeMatch(jobText: string, resumeText: string): Analysis {
  if (countWords(resumeText) < MIN_RESUME_WORDS) {
    throw new AppError(
      422,
      'resume_too_short',
      `The resume has fewer than ${MIN_RESUME_WORDS} words. Upload the full resume, or paste all of its text.`,
    );
  }
  const terms = extractJobTerms(jobText);
  if (terms.length < MIN_JOB_TERMS) {
    throw new AppError(
      422,
      'job_too_vague',
      `I found fewer than ${MIN_JOB_TERMS} skills or keywords in the job description. Paste the full text, including the requirements.`,
    );
  }
  return { match: scoreMatch(terms, profileResume(resumeText)), terms };
}

export { extractJobTerms, profileResume } from './keywords.ts';
export { countTerm, termKeysIn } from './match.ts';
export type { JobTerm, ResumeProfile } from './keywords.ts';
