import { AiError, chat } from './ai/client.ts';
import { checkRewrite } from './ai/guardrails.ts';
import { buildMessages } from './ai/prompt.ts';
import { parseReply } from './ai/reply.ts';
import type { PickedBullet } from './analyze/bullets.ts';
import type { JobTerm } from './analyze/keywords.ts';
import { assess, quickFix } from './analyze/quickfix.ts';
import type { RewriteItem, RewriteResult } from './analyze/types.ts';
import type { AiConfig } from './config.ts';

const DEFAULT_MAX_IN_FLIGHT = 4;
const FALLBACK = ' I used the built-in suggestions instead.';

export interface RewriteRequest {
  jobText: string;
  bullets: readonly PickedBullet[];
  terms: readonly JobTerm[];
  /** The user's choice. The AI is used only when this is true and the server has an AI service. */
  useAi: boolean;
}

export interface Rewriter {
  rewrite(request: RewriteRequest): Promise<RewriteResult>;
}

export interface RewriterOptions {
  /** How many AI requests may run at the same time. Other requests get the built-in suggestions. */
  maxInFlight?: number;
  /** Receives one short line when the AI fails. The line never has resume text, answers or keys. */
  log?: (line: string) => void;
}

/** A suggestion from the built-in rules. It changes the opener of a bullet and never adds a fact. */
function offlineItem(bullet: PickedBullet): RewriteItem {
  const fix = quickFix(bullet.text);
  return { id: bullet.id, original: bullet.text, rewrite: fix.rewrite, source: 'offline', keywordsAdded: [], tips: fix.tips, warnings: [] };
}

/** The AI (or its safety check) decided to leave the bullet as it is. Only the tips remain. */
function keptItem(bullet: PickedBullet): RewriteItem {
  return { id: bullet.id, original: bullet.text, rewrite: null, source: 'ai', keywordsAdded: [], tips: assess(bullet.text).tips, warnings: [] };
}

function offlineResult(bullets: readonly PickedBullet[], notice: string | null): RewriteResult {
  return { mode: 'offline', model: null, notice, items: bullets.map(offlineItem) };
}

export function createRewriter(ai: AiConfig | null, options: RewriterOptions = {}): Rewriter {
  const maxInFlight = options.maxInFlight ?? DEFAULT_MAX_IN_FLIGHT;
  const log = options.log ?? ((line: string): void => console.warn(line));
  let inFlight = 0;

  async function viaAi(config: AiConfig, request: RewriteRequest): Promise<RewriteResult> {
    const content = await chat(config, buildMessages(request.jobText, request.bullets, request.terms));
    const replies = parseReply(content, new Set(request.bullets.map((bullet) => bullet.id)));

    let removed = 0;
    const items = request.bullets.map((bullet): RewriteItem => {
      if (!replies.has(bullet.id)) {
        const item = offlineItem(bullet);
        item.warnings.push('The AI did not give a suggestion for this bullet.');
        return item;
      }
      const suggestion = replies.get(bullet.id) ?? null;
      if (suggestion === null) return keptItem(bullet);

      const verdict = checkRewrite(bullet.text, suggestion, request.terms);
      if (verdict.status === 'unchanged') return keptItem(bullet);
      if (verdict.status === 'rejected') {
        removed += 1;
        const item = offlineItem(bullet);
        item.warnings.push(`The AI suggestion was not used because ${verdict.reason}.`);
        return item;
      }
      return {
        id: bullet.id,
        original: bullet.text,
        rewrite: verdict.rewrite,
        source: 'ai',
        keywordsAdded: verdict.keywordsAdded,
        tips: assess(verdict.rewrite).tips,
        warnings: verdict.warnings,
      };
    });

    const notice =
      removed === 0
        ? null
        : `${removed} AI ${removed === 1 ? 'suggestion' : 'suggestions'} did not pass the safety checks. For ${removed === 1 ? 'that bullet' : 'those bullets'}, I used the built-in suggestion.`;
    return { mode: 'ai', model: config.model, notice, items };
  }

  return {
    async rewrite(request) {
      if (!request.useAi || request.bullets.length === 0) return offlineResult(request.bullets, null);
      if (!ai) return offlineResult(request.bullets, 'AI is not set up on this server, so I used the built-in suggestions.');
      if (inFlight >= maxInFlight) return offlineResult(request.bullets, `The AI service is busy with other requests.${FALLBACK}`);

      inFlight += 1;
      try {
        return await viaAi(ai, request);
      } catch (error) {
        if (error instanceof AiError) {
          log(`AI request failed: ${error.kind}`);
          return offlineResult(request.bullets, `${error.message}${FALLBACK}`);
        }
        log(`AI rewrite failed unexpectedly: ${error instanceof Error ? error.name : 'unknown error'}`);
        return offlineResult(request.bullets, `The AI suggestions could not be used.${FALLBACK}`);
      } finally {
        inFlight -= 1;
      }
    },
  };
}
