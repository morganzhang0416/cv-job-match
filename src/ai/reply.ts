import { z } from 'zod';
import { AiError } from './client.ts';

const Item = z.object({
  id: z.number().int().positive(),
  rewrite: z.string().nullable().optional(),
});

// A longer text is cut. It is far over the word limit of the safety checks, so it is refused there.
const MAX_REWRITE_CHARS = 600;

const unreadable = (): AiError => new AiError('bad_reply', 'The AI service answered in a format I could not read.');

/** Some models add reasoning in <think> tags or wrap the JSON in a code fence. */
function stripWrapping(content: string): string {
  const withoutThinking = content.replace(/<think>[\s\S]*?<\/think>/gi, '');
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(withoutThinking);
  return (fenced?.[1] ?? withoutThinking).trim();
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const start = text.search(/[[{]/);
    const end = Math.max(text.lastIndexOf('}'), text.lastIndexOf(']'));
    if (start === -1 || end <= start) throw unreadable();
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      throw unreadable();
    }
  }
}

/** The list of items: the answer itself, the first list inside it, or a single item. */
function findList(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') {
    if ('id' in value) return [value];
    return Object.values(value).find((entry): entry is unknown[] => Array.isArray(entry)) ?? null;
  }
  return null;
}

const QUOTE_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['"', '"'],
  ["'", "'"],
  ['\u201C', '\u201D'],
  ['\u2018', '\u2019'],
];
const LIST_MARKER = /^(?:[-*\u2022\u00B7]|\d{1,2}[.)])\s+/;

/** Removes quotes that wrap the whole text. A quote inside the text, or only at one end, stays. */
function unquote(text: string): string {
  for (const [open, close] of QUOTE_PAIRS) {
    if (text.length > 2 && text.startsWith(open) && text.endsWith(close)) {
      const inner = text.slice(1, -1);
      if (!inner.includes(open) && !inner.includes(close)) return inner.trim();
    }
  }
  return text;
}

/** Cleans one suggested rewrite: one line, no quotes around it, no bullet symbol or number in front. */
export function cleanRewrite(text: string): string {
  let result = text.replace(/\s+/g, ' ').trim();
  // Two rounds, because a model may write the quote before the bullet symbol or after it.
  for (let round = 0; round < 2; round += 1) result = unquote(result.replace(LIST_MARKER, '').trim());
  return result;
}

/**
 * Reads the answer of the AI service. It returns the suggested rewrite for each bullet id that was asked for.
 * null means the AI chose to leave that bullet as it is. Items with an unknown id or a wrong shape are ignored.
 */
export function parseReply(content: string, allowedIds: ReadonlySet<number>): Map<number, string | null> {
  const list = findList(parseJson(stripWrapping(content)));
  if (!list) throw unreadable();

  const replies = new Map<number, string | null>();
  for (const entry of list) {
    const candidate =
      entry && typeof entry === 'object' && typeof (entry as { id?: unknown }).id === 'string' && /^\d{1,6}$/.test((entry as { id: string }).id)
        ? { ...entry, id: Number((entry as { id: string }).id) }
        : entry;
    const item = Item.safeParse(candidate);
    if (!item.success || !allowedIds.has(item.data.id) || replies.has(item.data.id)) continue;

    const rewrite = item.data.rewrite ? cleanRewrite(item.data.rewrite).slice(0, MAX_REWRITE_CHARS) : '';
    replies.set(item.data.id, rewrite || null);
  }
  if (replies.size === 0) throw unreadable();
  return replies;
}
