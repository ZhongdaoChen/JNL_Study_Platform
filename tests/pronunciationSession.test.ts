import test from 'node:test';
import assert from 'node:assert/strict';
import {
  advancePronunciationPlayback,
  beginPronunciationOutcome,
  cancelPendingPronunciationSuccess,
  createPronunciationAudioWorker,
  fillPronunciationAudioCache,
  finalizePendingPronunciationSuccess,
  isFirstPronunciationAttempt,
  mergeExampleSentenceInQueue,
  mergePronunciationExamplesInQueue,
  pronunciationOutcome,
  settlePronunciationOutcome,
  startPronunciationPlayback,
} from '../src/components/pronunciationSession.ts';
import type { Word } from '../src/lib/types.ts';

function makeWord(overrides: Partial<Word> = {}): Word {
  return {
    id: 'word-1',
    childId: 'child-1',
    text: '中',
    lang: 'zh',
    sentenceIds: ['sentence-1'],
    firstLearnedAt: '2026-09-01',
    needsSpelling: true,
    exampleSentence: '新的并发例句',
    pronunciationExamples: [],
    interval: 7,
    ef: 2.6,
    repetitions: 3,
    dueDate: '2026-09-15',
    lastGrade: 'mastered',
    lastReviewedAt: '2026-09-08T04:00:00.000Z',
    pendingRetryCount: 1,
    spellingInterval: 4,
    spellingEf: 2.4,
    spellingRepetitions: 2,
    spellingDueDate: '2026-09-12',
    spellingLastGrade: 'fuzzy',
    spellingLastReviewedAt: '2026-09-07T04:00:00.000Z',
    spellingPendingRetryCount: 2,
    volatilityRate: 25,
    ...overrides,
  };
}

test('an unseen word has a first pronunciation attempt', () => {
  const gradedWordIds = new Set<string>(['known']);

  assert.equal(isFirstPronunciationAttempt(gradedWordIds, 'new'), true);
  assert.equal(isFirstPronunciationAttempt(gradedWordIds, 'known'), false);
});

test('an incorrect outcome reserves the first attempt until its grade is accepted', () => {
  const gradedWordIds = new Set<string>();
  const pendingSuccessWordIds = new Set<string>();

  const outcome = beginPronunciationOutcome(
    gradedWordIds,
    pendingSuccessWordIds,
    'word-1',
    false,
  );

  assert.equal(gradedWordIds.has('word-1'), false);
  assert.equal(pendingSuccessWordIds.has('word-1'), true);
  assert.deepEqual(outcome, {
    grade: 'forgotten',
    advanceAfterMs: null,
    message: '再试一次',
  });

  settlePronunciationOutcome(
    gradedWordIds,
    pendingSuccessWordIds,
    'word-1',
    true,
  );
  assert.equal(gradedWordIds.has('word-1'), true);
  assert.equal(pendingSuccessWordIds.has('word-1'), false);
});

test('a rejected coordinator submission does not consume the first pronunciation grade', async () => {
  const coordinatorModule = await import('../src/components/reviewGradeSession.ts');
  const coordinator = coordinatorModule.createReviewGradeCoordinator();
  const previousSave = deferredPromise<string>();
  const previousGrade = coordinatorModule.submitCoordinatedReviewGrade(
    coordinator,
    {
      wordId: 'word-previous',
      source: 'voice',
      advance: true,
    },
    () => previousSave.promise,
  );
  for (const correct of [false, true]) {
    const wordId = correct ? 'word-new-correct' : 'word-new-incorrect';
    const gradedWordIds = new Set<string>();
    const pendingAttemptWordIds = new Set<string>();

    const outcome = beginPronunciationOutcome(
      gradedWordIds,
      pendingAttemptWordIds,
      wordId,
      correct,
    );
    const rejected = await coordinatorModule.submitCoordinatedReviewGrade(
      coordinator,
      {
        wordId,
        source: 'voice',
        advance: correct,
      },
      async () => 'unexpected-save',
    );
    if (!rejected.accepted) {
      settlePronunciationOutcome(
        gradedWordIds,
        pendingAttemptWordIds,
        wordId,
        false,
      );
    }

    assert.equal(outcome.grade, correct ? 'mastered' : 'forgotten');
    assert.deepEqual(rejected, { accepted: false });
    assert.equal(isFirstPronunciationAttempt(gradedWordIds, wordId), true);
  }

  previousSave.resolve('saved');
  await previousGrade;
});

test('a correct outcome stays pending until its delayed grade is submitted', () => {
  const gradedWordIds = new Set<string>();
  const pendingSuccessWordIds = new Set<string>();

  const outcome = beginPronunciationOutcome(
    gradedWordIds,
    pendingSuccessWordIds,
    'word-1',
    true,
  );

  assert.equal(gradedWordIds.has('word-1'), false);
  assert.equal(pendingSuccessWordIds.has('word-1'), true);
  assert.deepEqual(outcome, {
    grade: 'mastered',
    advanceAfterMs: 1200,
    message: '读对了',
  });

  assert.equal(
    finalizePendingPronunciationSuccess(
      gradedWordIds,
      pendingSuccessWordIds,
      'word-1',
    ),
    true,
  );
  assert.equal(gradedWordIds.has('word-1'), true);
  assert.equal(pendingSuccessWordIds.has('word-1'), false);
});

test('a pending correct outcome prevents duplicate assessment grades', () => {
  const gradedWordIds = new Set<string>();
  const pendingSuccessWordIds = new Set<string>();

  beginPronunciationOutcome(gradedWordIds, pendingSuccessWordIds, 'word-1', true);
  const duplicate = beginPronunciationOutcome(
    gradedWordIds,
    pendingSuccessWordIds,
    'word-1',
    true,
  );

  assert.deepEqual(duplicate, {
    grade: null,
    advanceAfterMs: null,
    message: '这次读对了',
  });
  assert.equal(gradedWordIds.has('word-1'), false);
  assert.equal(pendingSuccessWordIds.has('word-1'), true);
});

test('canceling a pending correct outcome preserves the first-attempt grade', () => {
  const gradedWordIds = new Set<string>();
  const pendingSuccessWordIds = new Set<string>();

  beginPronunciationOutcome(gradedWordIds, pendingSuccessWordIds, 'word-1', true);
  assert.equal(cancelPendingPronunciationSuccess(pendingSuccessWordIds, 'word-1'), true);

  assert.equal(gradedWordIds.has('word-1'), false);
  assert.equal(pendingSuccessWordIds.has('word-1'), false);
  assert.deepEqual(
    beginPronunciationOutcome(gradedWordIds, pendingSuccessWordIds, 'word-1', false),
    {
      grade: 'forgotten',
      advanceAfterMs: null,
      message: '再试一次',
    },
  );
});

test('merging generated examples changes only that field on matching queue words', () => {
  const current = makeWord();
  const duplicate = makeWord({
    exampleSentence: '另一个队列副本的最新例句',
    interval: 11,
    lastGrade: 'instant',
  });
  const untouched = makeWord({ id: 'word-2', text: '文' });

  const result = mergePronunciationExamplesInQueue(
    [current, duplicate, untouched],
    'word-1',
    ['中国', '中午', '中心'],
  );

  assert.deepEqual(result[0], {
    ...current,
    pronunciationExamples: ['中国', '中午', '中心'],
  });
  assert.deepEqual(result[1], {
    ...duplicate,
    pronunciationExamples: ['中国', '中午', '中心'],
  });
  assert.equal(result[2], untouched);
});

test('merging a generated sentence changes only that field on every matching queue copy', () => {
  const current = makeWord({ exampleSentence: null });
  const concurrentlyGradedCopy = makeWord({
    exampleSentence: null,
    pronunciationExamples: ['中国', '中午', '中心'],
    interval: 11,
    lastGrade: 'instant',
  });
  const untouched = makeWord({ id: 'word-2', text: '文' });

  const result = mergeExampleSentenceInQueue(
    [current, concurrentlyGradedCopy, untouched],
    'word-1',
    '中间有一只小猫。',
  );

  assert.deepEqual(result[0], {
    ...current,
    exampleSentence: '中间有一只小猫。',
  });
  assert.deepEqual(result[1], {
    ...concurrentlyGradedCopy,
    exampleSentence: '中间有一只小猫。',
  });
  assert.equal(result[2], untouched);
});

test('the first correct result is mastered and advances after the success animation', () => {
  assert.deepEqual(pronunciationOutcome(false, true), {
    grade: 'mastered',
    advanceAfterMs: 1200,
    message: '读对了',
  });
});

test('the first incorrect result is forgotten and stays on the word', () => {
  assert.deepEqual(pronunciationOutcome(false, false), {
    grade: 'forgotten',
    advanceAfterMs: null,
    message: '再试一次',
  });
});

test('retry results update feedback without returning another grade', () => {
  assert.deepEqual(pronunciationOutcome(true, true), {
    grade: null,
    advanceAfterMs: null,
    message: '这次读对了',
  });
  assert.deepEqual(pronunciationOutcome(true, false), {
    grade: null,
    advanceAfterMs: null,
    message: '再试一次',
  });
});

test('playback advances through the target and three examples then stops', () => {
  let state = startPronunciationPlayback('中', ['中国', '中午', '中心']);

  assert.deepEqual(state, {
    items: ['中', '中国', '中午', '中心'],
    playingIndex: 0,
  });

  state = advancePronunciationPlayback(state);
  assert.equal(state.playingIndex, 1);
  state = advancePronunciationPlayback(state);
  assert.equal(state.playingIndex, 2);
  state = advancePronunciationPlayback(state);
  assert.equal(state.playingIndex, 3);
  state = advancePronunciationPlayback(state);
  assert.equal(state.playingIndex, null);
  assert.deepEqual(advancePronunciationPlayback(state), state);
});

test('canceling pronunciation synthesis aborts in-flight items and skips the remaining ones', async () => {
  const calls: string[] = [];
  const signals: AbortSignal[] = [];
  let markSecondStarted: (() => void) | undefined;
  const secondStarted = new Promise<void>((resolve) => {
    markSecondStarted = resolve;
  });
  const worker = createPronunciationAudioWorker(
    async (item, signal) => {
      calls.push(item);
      signals.push(signal);
      if (calls.length === 2) markSecondStarted?.();
      return new Promise((_, reject) => {
        signal.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        }, { once: true });
      });
    },
  );

  const request = worker.reconcile('word-1', ['中', '中国', '中午', '中心']);
  await secondStarted;
  worker.invalidate();

  await assert.rejects(
    request,
    (error: unknown) => error instanceof Error && error.name === 'AbortError',
  );
  // 并发上限为 2：取消时两条在途请求都被中止，剩余两条不再发起。
  assert.deepEqual(calls, ['中', '中国']);
  assert.equal(signals.length, 2);
  assert.equal(signals.every((signal) => signal.aborted), true);
});

test('audio worker runs at most two syntheses concurrently', async () => {
  const calls: string[] = [];
  const resolvers: Array<(url: string) => void> = [];
  let active = 0;
  let maxActive = 0;
  let markSecondStarted: (() => void) | undefined;
  const secondStarted = new Promise<void>((resolve) => {
    markSecondStarted = resolve;
  });
  const worker = createPronunciationAudioWorker((item) => {
    calls.push(item);
    active += 1;
    maxActive = Math.max(maxActive, active);
    if (calls.length === 2) markSecondStarted?.();
    return new Promise<string>((resolve) => {
      resolvers.push((url) => {
        active -= 1;
        resolve(url);
      });
    });
  });

  const request = worker.reconcile('word-1', ['中', '中国', '中午', '中心']);
  await secondStarted;
  assert.equal(maxActive, 2);
  assert.deepEqual(calls, ['中', '中国']);

  for (let settled = 0; settled < 4; settled += 1) {
    while (resolvers.length === 0) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    const settle = resolvers.shift();
    settle?.(`https://audio.example/${settled}.wav`);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  const urls = await request;
  assert.equal(maxActive, 2);
  assert.deepEqual(calls, ['中', '中国', '中午', '中心']);
  assert.deepEqual([...urls.keys()], ['中', '中国', '中午', '中心']);
});

test('changing words waits for canceled synthesis to settle before starting the next word', async () => {
  let active = 0;
  let maxActive = 0;
  let oldSignal: AbortSignal | null = null;
  let rejectOld: ((error: Error) => void) | undefined;
  let resolveNew: ((url: string) => void) | undefined;
  let markOldStarted: (() => void) | undefined;
  let markNewStarted: (() => void) | undefined;
  const oldStarted = new Promise<void>((resolve) => {
    markOldStarted = resolve;
  });
  const newStarted = new Promise<void>((resolve) => {
    markNewStarted = resolve;
  });
  const calls: string[] = [];
  const worker = createPronunciationAudioWorker(
    (item, signal) => {
      calls.push(item);
      active += 1;
      maxActive = Math.max(maxActive, active);
      if (item === '旧') {
        oldSignal = signal;
        markOldStarted?.();
        return new Promise((_, reject) => {
          rejectOld = (error) => {
            active -= 1;
            reject(error);
          };
        });
      }
      markNewStarted?.();
      return new Promise((resolve) => {
        resolveNew = (url) => {
          active -= 1;
          resolve(url);
        };
      });
    },
  );

  const oldRequest = worker.reconcile('word-old', ['旧']);
  const oldResult = oldRequest.catch((error: unknown) => error);
  await oldStarted;
  const newRequest = worker.reconcile('word-new', ['新']);

  assert.equal(oldSignal?.aborted, true);
  assert.deepEqual(calls, ['旧']);
  assert.equal(maxActive, 1);

  rejectOld?.(new DOMException('The operation was aborted.', 'AbortError'));
  await newStarted;
  assert.deepEqual(calls, ['旧', '新']);
  assert.equal(maxActive, 1);

  resolveNew?.('https://audio.example/new.wav');
  const newCache = await newRequest;
  const oldError = await oldResult;
  assert.equal(oldError instanceof Error && oldError.name, 'AbortError');
  assert.equal(newCache.get('新'), 'https://audio.example/new.wav');
});

test('late helper examples join the current worker without requesting cached target audio again', async () => {
  const calls: string[] = [];
  let resolveTarget: ((url: string) => void) | undefined;
  let markTargetStarted: (() => void) | undefined;
  const targetStarted = new Promise<void>((resolve) => {
    markTargetStarted = resolve;
  });
  const worker = createPronunciationAudioWorker(
    async (item) => {
      calls.push(item);
      if (item === '中') {
        markTargetStarted?.();
        return new Promise((resolve) => {
          resolveTarget = resolve;
        });
      }
      return `https://audio.example/${encodeURIComponent(item)}.wav`;
    },
  );

  const targetOnly = worker.reconcile('word-1', ['中']);
  await targetStarted;
  const withExamples = worker.reconcile(
    'word-1',
    ['中', '中国', '中午', '中心'],
  );
  resolveTarget?.('https://audio.example/target.wav');

  await targetOnly;
  const result = await withExamples;

  assert.deepEqual(calls, ['中', '中国', '中午', '中心']);
  assert.equal(calls.filter((item) => item === '中').length, 1);
  assert.deepEqual([...result.keys()], ['中', '中国', '中午', '中心']);
});

test('pronunciation audio worker preserves partial successes and retries only missing items', async () => {
  const firstCalls: string[] = [];
  let shouldFail = true;
  const worker = createPronunciationAudioWorker(async (item) => {
    firstCalls.push(item);
    if (item === '中国' && shouldFail) {
      throw new Error('temporary TTS failure');
    }
    return `https://audio.example/${encodeURIComponent(item)}.wav`;
  });

  await assert.rejects(
    () => worker.reconcile('word-1', ['中', '中国', '中午']),
    /temporary TTS failure/,
  );
  assert.deepEqual(firstCalls, ['中', '中国', '中午']);

  shouldFail = false;
  const beforeRetry = firstCalls.length;
  const result = await worker.reconcile('word-1', ['中', '中国', '中午']);

  assert.deepEqual(firstCalls.slice(beforeRetry), ['中国']);
  assert.deepEqual([...result.keys()], ['中', '中午', '中国']);
});

test('the legacy cache filler remains sequential for existing callers', async () => {
  const calls: string[] = [];
  const cache = new Map([['中', 'https://audio.example/target.wav']]);

  const result = await fillPronunciationAudioCache(
    ['中', '中国', '中午'],
    cache,
    async (item) => {
      calls.push(item);
      return `https://audio.example/${encodeURIComponent(item)}.wav`;
    },
  );

  assert.deepEqual(calls, ['中国', '中午']);
  assert.deepEqual([...result.keys()], ['中', '中国', '中午']);
});

function deferredPromise<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, resolve, reject };
}
