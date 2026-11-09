/**
 * Types shared by the server and the browser script (public/app.js imports them in JSDoc).
 * Keep this file free of Node-only imports.
 */

/** How strongly the job description asks for a term. */
export type Importance = 'required' | 'standard' | 'preferred';

/** hard = tools and professional skills, soft = people skills, phrase = other repeated phrases. */
export type TermKind = 'hard' | 'soft' | 'phrase';

export interface KeywordResult {
  key: string;
  label: string;
  kind: TermKind;
  category: string;
  importance: Importance;
  /** How many times the job description mentions it. */
  jobCount: number;
  /** How many times the resume mentions it (0 means missing). */
  resumeCount: number;
  weight: number;
  /** A short line from the job description that shows where the term appears. */
  snippet: string;
}

export interface BreakdownRow {
  key: string;
  label: string;
  matched: number;
  total: number;
  percent: number;
}

export type MatchLevel = 'excellent' | 'strong' | 'fair' | 'partial' | 'low';

export interface MatchResult {
  /** 0 to 100: the share of the job's weighted keywords that the resume covers. */
  score: number;
  level: MatchLevel;
  verdict: string;
  summary: string;
  breakdown: BreakdownRow[];
  matched: KeywordResult[];
  /** Sorted by weight: the most valuable gaps come first. */
  missing: KeywordResult[];
}

export interface RewriteItem {
  /** Position of the bullet in the resume (1 is the first bullet found). */
  id: number;
  original: string;
  /** null means there is no safe rewrite; the tips still apply. */
  rewrite: string | null;
  source: 'ai' | 'offline';
  /** Job keywords that the rewrite uses and the original did not. Check they are true. */
  keywordsAdded: string[];
  tips: string[];
  warnings: string[];
}

export interface RewriteResult {
  mode: 'ai' | 'offline';
  model: string | null;
  /** A plain message for the user, for example why AI was not used. */
  notice: string | null;
  items: RewriteItem[];
}

export interface ResumeInfo {
  source: 'pdf' | 'docx' | 'text' | 'pasted';
  fileName: string | null;
  characters: number;
  words: number;
  bullets: number;
  pages: number | null;
}

export interface AnalyzeResponse {
  match: MatchResult;
  rewrites: RewriteResult;
  resume: ResumeInfo;
}

export interface PublicConfig {
  aiAvailable: boolean;
  aiProvider: string | null;
  aiModel: string | null;
  maxUploadMb: number;
  maxJobChars: number;
  maxResumeChars: number;
  acceptedExtensions: string[];
}

export interface ApiErrorBody {
  error: { code: string; message: string };
}
