import { pronunciationPlaybackItems } from '../lib/pronunciationRules.ts';
import type { Word } from '../lib/types.ts';

export interface PronunciationPlaybackState {
  items: string[];
  playingIndex: number | null;
}

export function isFirstPronunciationAttempt(
  gradedWordIds: ReadonlySet<string>,
  wordId: string,
): boolean {
  return !gradedWordIds.has(wordId);
}

export function pronunciationOutcome(
  alreadyGraded: boolean,
  correct: boolean,
): {
  grade: 'mastered' | 'forgotten' | null;
  advanceAfterMs: number | null;
  message: string;
} {
  if (alreadyGraded) {
    return {
      grade: null,
      advanceAfterMs: null,
      message: correct ? '这次读对了' : '再试一次',
    };
  }
  return correct
    ? { grade: 'mastered', advanceAfterMs: 1200, message: '读对了' }
    : { grade: 'forgotten', advanceAfterMs: null, message: '再试一次' };
}

export function beginPronunciationOutcome(
  gradedWordIds: Set<string>,
  pendingAttemptWordIds: Set<string>,
  wordId: string,
  correct: boolean,
): ReturnType<typeof pronunciationOutcome> {
  const alreadyGraded = (
    !isFirstPronunciationAttempt(gradedWordIds, wordId)
    || pendingAttemptWordIds.has(wordId)
  );
  if (!alreadyGraded) pendingAttemptWordIds.add(wordId);
  return pronunciationOutcome(alreadyGraded, correct);
}

export function settlePronunciationOutcome(
  gradedWordIds: Set<string>,
  pendingAttemptWordIds: Set<string>,
  wordId: string,
  accepted: boolean,
): void {
  pendingAttemptWordIds.delete(wordId);
  if (accepted) gradedWordIds.add(wordId);
}

export function finalizePendingPronunciationSuccess(
  gradedWordIds: Set<string>,
  pendingSuccessWordIds: Set<string>,
  wordId: string,
): boolean {
  if (!pendingSuccessWordIds.delete(wordId)) return false;
  gradedWordIds.add(wordId);
  return true;
}

export function cancelPendingPronunciationSuccess(
  pendingSuccessWordIds: Set<string>,
  wordId: string,
): boolean {
  return pendingSuccessWordIds.delete(wordId);
}

export function pronunciationMicrophoneDisabled(
  uiMatchesWord: boolean,
  status: string,
  advancePending: boolean,
  automaticGradePending: boolean,
): boolean {
  return (
    !uiMatchesWord
    || status === 'requesting-permission'
    || status === 'assessing'
    || advancePending
    || automaticGradePending
  );
}

export function mergePronunciationExamplesInQueue(
  words: readonly Word[],
  wordId: string,
  examples: string[],
): Word[] {
  return words.map((word) => (
    word.id === wordId ? { ...word, pronunciationExamples: examples } : word
  ));
}

export function mergeExampleSentenceInQueue(
  words: readonly Word[],
  wordId: string,
  sentence: string,
): Word[] {
  return words.map((word) => (
    word.id === wordId ? { ...word, exampleSentence: sentence } : word
  ));
}

export async function fillPronunciationAudioCache(
  items: readonly string[],
  cache: Map<string, string>,
  synthesize: (item: string) => Promise<string>,
): Promise<Map<string, string>> {
  let firstError: unknown;
  for (const item of items) {
    if (cache.has(item)) continue;
    try {
      cache.set(item, await synthesize(item));
    } catch (error) {
      firstError ??= error;
    }
  }
  if (firstError !== undefined) throw firstError;
  return new Map(cache);
}

export interface PronunciationAudioWorker {
  reconcile(wordId: string, items: readonly string[]): Promise<Map<string, string>>;
  invalidate(): void;
}

interface PronunciationAudioRun {
  generation: number;
  promise: Promise<void>;
}

// synthesis 在服务端限流里每用户并发上限就是 2（schema.sql principal_concurrency），
// 客户端并发超过 2 只会被拒绝；读错后 4 条音频分两批并行，比逐条串行快约一半。
const SYNTHESIS_MAX_CONCURRENCY = 2;

export function createPronunciationAudioWorker(
  synthesize: (item: string, signal: AbortSignal) => Promise<string>,
): PronunciationAudioWorker {
  let currentWordId: string | null = null;
  let generation = 0;
  let desiredItems: string[] = [];
  let cache = new Map<string, string>();
  const activeControllers = new Set<AbortController>();
  let activeRun: PronunciationAudioRun | null = null;

  function reset(wordId: string | null): void {
    generation += 1;
    currentWordId = wordId;
    desiredItems = [];
    cache = new Map();
    for (const controller of activeControllers) controller.abort();
    activeControllers.clear();
  }

  function ensureRun(): PronunciationAudioRun {
    if (activeRun) return activeRun;
    const run: PronunciationAudioRun = {
      generation,
      promise: Promise.resolve(),
    };
    run.promise = drain(run.generation);
    activeRun = run;
    void run.promise.then(
      () => {
        if (activeRun === run) activeRun = null;
      },
      () => {
        if (activeRun === run) activeRun = null;
      },
    );
    return run;
  }

  async function drain(runGeneration: number): Promise<void> {
    const attempted = new Set<string>();
    const inFlight = new Set<Promise<void>>();
    let firstError: unknown;

    const isStale = (): boolean => (
      runGeneration !== generation || currentWordId === null
    );

    async function runItem(item: string): Promise<void> {
      const controller = new AbortController();
      activeControllers.add(controller);
      try {
        const url = await synthesize(item, controller.signal);
        if (isStale()) throw pronunciationAbortError();
        cache.set(item, url);
      } catch (error) {
        if (isStale() || controller.signal.aborted) {
          throw pronunciationAbortError(error);
        }
        firstError ??= error;
      } finally {
        activeControllers.delete(controller);
      }
    }

    try {
      while (!isStale()) {
        const item = desiredItems.find(
          (candidate) => !cache.has(candidate) && !attempted.has(candidate),
        );
        if (item !== undefined && inFlight.size < SYNTHESIS_MAX_CONCURRENCY) {
          attempted.add(item);
          const tracked = runItem(item).finally(() => {
            inFlight.delete(tracked);
          });
          inFlight.add(tracked);
          continue;
        }
        if (inFlight.size === 0) break;
        await Promise.race(inFlight);
      }
    } finally {
      // 保证所有在途请求都有归属，避免未处理的 Promise 拒绝。
      await Promise.allSettled([...inFlight]);
    }

    if (isStale()) throw pronunciationAbortError();
    if (firstError !== undefined) throw firstError;
  }

  return {
    async reconcile(wordId, items) {
      if (currentWordId !== wordId) reset(wordId);
      desiredItems = [...new Set(items)];
      const requestGeneration = generation;

      while (requestGeneration === generation && currentWordId === wordId) {
        if (desiredItems.every((item) => cache.has(item))) {
          return new Map(cache);
        }

        const run = ensureRun();
        try {
          await run.promise;
        } catch (error) {
          if (run.generation !== requestGeneration) continue;
          if (requestGeneration !== generation || currentWordId !== wordId) {
            throw pronunciationAbortError(error);
          }
          throw error;
        }
      }

      throw pronunciationAbortError();
    },
    invalidate() {
      reset(null);
    },
  };
}

function pronunciationAbortError(cause?: unknown): Error {
  if (cause instanceof Error && cause.name === 'AbortError') return cause;
  return new DOMException('The operation was aborted.', 'AbortError');
}

export function startPronunciationPlayback(
  target: string,
  examples: string[],
): PronunciationPlaybackState {
  const items = pronunciationPlaybackItems(target, examples);
  return {
    items,
    playingIndex: items.length > 0 ? 0 : null,
  };
}

export function advancePronunciationPlayback(
  state: PronunciationPlaybackState,
): PronunciationPlaybackState {
  if (state.playingIndex === null) return state;
  const nextIndex = state.playingIndex + 1;
  return {
    ...state,
    playingIndex: nextIndex < state.items.length ? nextIndex : null,
  };
}
