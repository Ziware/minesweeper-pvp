/**
 * Bot worker entry. Receives a `BotRequest` over `postMessage` and replies
 * with a `BotResponse`. Pure compute — never touches DOM.
 *
 * Loaded by Vite as a module worker:
 *   new Worker(new URL('./bot-worker.ts', import.meta.url), { type: 'module' })
 *
 * See [`plans/ai-bot/06-integration.md`](plans/ai-bot/06-integration.md:117).
 */

import type { BotRequest, BotResponse } from './types';
import { runMcts } from './engine/mcts';

const ctx = self as unknown as Worker;

ctx.addEventListener('message', (e: MessageEvent<BotRequest & { id: number }>) => {
  const { obs, config, seed, id } = e.data;
  const t0 = Date.now();
  try {
    const result = runMcts(obs, config, seed);
    const response: BotResponse & { id: number } = {
      id,
      move: result.bestMove,
      elapsedMs: Date.now() - t0,
      simsRun: result.simsRun,
    };
    ctx.postMessage(response);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[bot-worker] failure', err);
    ctx.postMessage({ id, error: String(err) });
  }
});
