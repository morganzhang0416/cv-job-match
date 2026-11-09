import { z } from 'zod';
import type { AiConfig } from '../config.ts';

export interface ChatMessage {
  role: 'system' | 'user';
  content: string;
}

export type AiErrorKind = 'auth' | 'not_found' | 'rate_limit' | 'server' | 'network' | 'timeout' | 'rejected' | 'bad_reply';

/** A problem with the AI service. The message is plain and safe to show: it never contains the key or text from the provider. */
export class AiError extends Error {
  readonly kind: AiErrorKind;

  constructor(kind: AiErrorKind, message: string) {
    super(message);
    this.name = 'AiError';
    this.kind = kind;
  }
}

const TEMPERATURE = 0.2;
// A normal answer is a few hundred words. This stops a wrong address from filling the memory.
const MAX_REPLY_CHARS = 500_000;

const ChatReply = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string() }) })).min(1),
});

function errorForStatus(status: number): AiError {
  if (status === 401 || status === 403) {
    return new AiError('auth', 'The AI service did not accept the access token. Check the token and its permissions.');
  }
  if (status === 404) {
    return new AiError('not_found', 'The AI service could not find the model or the address. Check AI_MODEL and the service address.');
  }
  if (status === 408 || status === 504) return new AiError('timeout', 'The AI service took too long to answer.');
  if (status === 429) return new AiError('rate_limit', 'The AI service is busy, or its usage limit is reached. Try again later.');
  if (status >= 500) return new AiError('server', 'The AI service had a problem. Try again later.');
  return new AiError('rejected', `The AI service refused the request (HTTP ${status}).`);
}

const timedOut = (): AiError => new AiError('timeout', 'The AI service took too long to answer.');

interface Options {
  temperature: boolean;
  json: boolean;
}

async function post(config: AiConfig, messages: readonly ChatMessage[], options: Options): Promise<{ status: number; body: string }> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (config.apiKey) headers.authorization = `Bearer ${config.apiKey}`;
  const body = JSON.stringify({
    model: config.model,
    messages,
    ...(options.temperature ? { temperature: TEMPERATURE } : {}),
    ...(options.json ? { response_format: { type: 'json_object' } } : {}),
  });

  try {
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(config.timeoutMs),
    });
    const text = await response.text();
    if (text.length > MAX_REPLY_CHARS) throw new AiError('bad_reply', 'The AI service sent an answer that is too large.');
    return { status: response.status, body: text };
  } catch (error) {
    if (error instanceof AiError) throw error;
    if ((error as { name?: string } | null)?.name === 'TimeoutError') throw timedOut();
    throw new AiError('network', 'I could not reach the AI service. Check the service address and your network connection.');
  }
}

/** Reads the text of the first answer from an OpenAI-compatible "chat completions" reply. */
function contentOf(body: string): string {
  try {
    const parsed = ChatReply.safeParse(JSON.parse(body));
    if (parsed.success) return parsed.data.choices[0]?.message.content ?? '';
  } catch {
    // A body that is not JSON is handled below.
  }
  throw new AiError('bad_reply', 'The AI service answered in a format I could not read.');
}

/**
 * Sends one chat request and returns the text of the answer.
 * Some services do not accept "temperature" or JSON mode. If a service says so, the request is sent once more without them.
 */
export async function chat(config: AiConfig, messages: readonly ChatMessage[]): Promise<string> {
  let result = await post(config, messages, { temperature: true, json: config.jsonMode });

  if (result.status === 400 && /temperature|response_format|json_object|json mode/i.test(result.body)) {
    result = await post(config, messages, { temperature: false, json: false });
  }
  if (result.status < 200 || result.status >= 300) throw errorForStatus(result.status);
  return contentOf(result.body);
}
