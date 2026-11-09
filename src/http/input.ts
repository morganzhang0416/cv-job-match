import { z } from 'zod';
import { AppError } from '../errors.ts';
import type { AnalyzeInput } from '../service.ts';

const Fields = z.object(
  {
    jobDescription: z.string({ error: 'Send the job description as text, in the field "jobDescription".' }).optional(),
    resumeText: z.string({ error: 'Send the resume text as text, in the field "resumeText".' }).optional(),
    useAi: z.union([z.boolean(), z.string()], { error: 'useAi must be true or false.' }).optional(),
  },
  { error: 'Send the job description and the resume as the fields of one form or one JSON object.' },
);

export interface UploadedFile {
  buffer: Uint8Array;
  originalname: string;
}

const MAX_FILE_NAME_CHARS = 120;

function cleanFileName(name: string): string | null {
  // eslint-disable-next-line no-control-regex
  const clean = name.replace(/[\u0000-\u001F\u007F]/g, ' ').trim();
  return clean === '' ? null : clean.slice(0, MAX_FILE_NAME_CHARS);
}

/** The AI is only used when the caller asks for it. A missing value means "no". */
function wantsAi(value: boolean | string | undefined): boolean {
  if (value === undefined || typeof value === 'boolean') return value ?? false;
  const word = value.trim().toLowerCase();
  if (['true', '1', 'on', 'yes'].includes(word)) return true;
  if (['', 'false', '0', 'off', 'no'].includes(word)) return false;
  throw new AppError(400, 'invalid_request', 'useAi must be true or false.');
}

/** Turns the parsed body (a form or JSON) and the optional file into one input for the analysis. */
export function readInput(body: unknown, file: UploadedFile | undefined): AnalyzeInput {
  const parsed = Fields.safeParse(body ?? {});
  if (!parsed.success) {
    throw new AppError(400, 'invalid_request', parsed.error.issues[0]?.message ?? 'The request is not valid.');
  }
  const { jobDescription = '', resumeText = '', useAi } = parsed.data;

  const hasText = resumeText.trim() !== '';
  if (file && hasText) throw new AppError(400, 'resume_conflict', 'Send a resume file or the resume text, not both.');

  return {
    jobDescription,
    resume: file
      ? { kind: 'file', data: file.buffer, fileName: cleanFileName(file.originalname) }
      : hasText
        ? { kind: 'text', text: resumeText }
        : null,
    useAi: wantsAi(useAi),
  };
}
