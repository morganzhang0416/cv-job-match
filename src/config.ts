import type { PublicConfig } from './analyze/types.ts';

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const MIN_JOB_CHARS = 50;
export const MAX_JOB_CHARS = 20_000;
export const MAX_RESUME_CHARS = 60_000;
export const ACCEPTED_EXTENSIONS: readonly string[] = ['.pdf', '.docx', '.txt', '.md'];

const DEFAULT_PORT = 3000;
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_AI_TIMEOUT_MS = 30_000;
const DEFAULT_GITHUB_ENDPOINT = 'https://models.github.ai/inference';
const DEFAULT_GITHUB_MODEL = 'openai/gpt-4o-mini';
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

/** True for this computer. Accepts "[::1]", the way a web address writes it. */
export function isLocalHost(host: string): boolean {
  return LOCAL_HOSTS.has(host.replace(/^\[|\]$/g, '').toLowerCase());
}

export interface AiConfig {
  /** A short name for the screen: "GitHub Models", or the host name of the endpoint. */
  provider: string;
  /** The address before "/chat/completions", with no trailing slash. */
  baseUrl: string;
  apiKey: string | null;
  model: string;
  /** Ask for a JSON answer. Some local servers do not support this. */
  jsonMode: boolean;
  timeoutMs: number;
}

export interface AppConfig {
  host: string;
  port: number;
  /** Trust the X-Forwarded-For header. Only turn this on behind a proxy that you control. */
  trustProxy: boolean;
  ai: AiConfig | null;
  /** Problems found in the settings. The server prints them when it starts. */
  warnings: string[];
}

type Env = Readonly<Record<string, string | undefined>>;

function text(env: Env, name: string): string | undefined {
  const value = env[name]?.trim();
  return value ? value : undefined;
}

function flag(env: Env, name: string, fallback: boolean): boolean {
  const value = text(env, name)?.toLowerCase();
  if (value === undefined) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(value)) return true;
  if (['0', 'false', 'no', 'off'].includes(value)) return false;
  return fallback;
}

function integer(env: Env, name: string, fallback: number, min: number, max: number, warnings: string[]): number {
  const value = text(env, name);
  if (value === undefined) return fallback;
  const number = /^\d{1,9}$/.test(value) ? Number(value) : Number.NaN;
  if (!Number.isInteger(number) || number < min || number > max) {
    warnings.push(`${name} must be a whole number from ${min} to ${max}. Using ${fallback}.`);
    return fallback;
  }
  return number;
}

/** Checks a web address for the AI service. Returns the address without a trailing slash, or the reason it is not usable. */
function checkAddress(name: string, value: string): { url: string } | { problem: string } {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return { problem: `${name} is not a valid web address.` };
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return { problem: `${name} must start with https:// or http://.` };
  if (parsed.username || parsed.password) return { problem: `${name} must not contain a user name or password. Use AI_API_KEY for the key.` };
  return { url: parsed.href.replace(/\/+$/, '') };
}

function aiFrom(env: Env, warnings: string[]): AiConfig | null {
  const timeoutMs = integer(env, 'AI_TIMEOUT_MS', DEFAULT_AI_TIMEOUT_MS, 1000, 120_000, warnings);
  const jsonMode = flag(env, 'AI_JSON_MODE', true);

  const customUrl = text(env, 'AI_BASE_URL');
  if (customUrl) {
    const checked = checkAddress('AI_BASE_URL', customUrl);
    if ('problem' in checked) {
      warnings.push(`${checked.problem} AI is off.`);
      return null;
    }
    const model = text(env, 'AI_MODEL');
    if (!model) {
      warnings.push('AI_BASE_URL is set, but AI_MODEL is not. AI is off.');
      return null;
    }
    const apiKey = text(env, 'AI_API_KEY') ?? null;
    const target = new URL(checked.url);
    if (apiKey && target.protocol === 'http:' && !isLocalHost(target.hostname)) {
      warnings.push('AI_BASE_URL starts with http://, so the key is sent without encryption. Use https:// if you can.');
    }
    return { provider: target.host, baseUrl: checked.url, apiKey, model, jsonMode, timeoutMs };
  }

  const token = text(env, 'GITHUB_TOKEN') ?? text(env, 'GH_TOKEN');
  if (!token) return null;
  const checked = checkAddress('GITHUB_MODELS_ENDPOINT', text(env, 'GITHUB_MODELS_ENDPOINT') ?? DEFAULT_GITHUB_ENDPOINT);
  if ('problem' in checked) {
    warnings.push(`${checked.problem} AI is off.`);
    return null;
  }
  const model = text(env, 'AI_MODEL') ?? text(env, 'GITHUB_MODELS_MODEL') ?? DEFAULT_GITHUB_MODEL;
  return { provider: 'GitHub Models', baseUrl: checked.url, apiKey: token, model, jsonMode, timeoutMs };
}

/** Reads the settings from environment variables. The app does not read a .env file by itself. */
export function loadConfig(env: Env = process.env): AppConfig {
  const warnings: string[] = [];
  const host = text(env, 'HOST') ?? DEFAULT_HOST;
  if (!isLocalHost(host)) {
    warnings.push(`HOST is ${host}, so other computers on the network can use this tool. There is no login.`);
  }
  return {
    host,
    port: integer(env, 'PORT', DEFAULT_PORT, 0, 65_535, warnings),
    trustProxy: flag(env, 'TRUST_PROXY', false),
    ai: aiFrom(env, warnings),
    warnings,
  };
}

/** What the browser may know. It never includes the key. */
export function toPublicConfig(config: AppConfig): PublicConfig {
  return {
    aiAvailable: config.ai !== null,
    aiProvider: config.ai?.provider ?? null,
    aiModel: config.ai?.model ?? null,
    maxUploadMb: MAX_UPLOAD_BYTES / (1024 * 1024),
    maxJobChars: MAX_JOB_CHARS,
    maxResumeChars: MAX_RESUME_CHARS,
    acceptedExtensions: [...ACCEPTED_EXTENSIONS],
  };
}
