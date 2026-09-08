import test from 'node:test';
import assert from 'node:assert/strict';
import {
  advancePronunciationPlayback,
  beginPronunciationOutcome,
  cancelPendingPronunciationSuccess,
  fillPronunciationAudioCache,
  finalizePendingPronunciationSuccess,
  isFirstPronunciationAttempt,
  mergeExampleSentenceInQueue,
  mergePronunciationExamplesInQueue,
  pronunciationOutcome,
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

test('an incorrect outcome locks the word id immediately', () => {
  const gradedWordIds = new Set<string>();
  const pendingSuccessWordIds = new Set<string>();

  const outcome = beginPronunciationOutcome(
    gradedWordIds,
    pendingSuccessWordIds,
    'word-1',
    false,
  );

  assert.equal(gradedWordIds.has('word-1'), true);
  assert.equal(pendingSuccessWordIds.has('word-1'), false);
  assert.deepEqual(outcome, {
    grade: 'forgotten',
    advanceAfterMs: null,
    message: '再试一次',
  });
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

test('pronunciation audio prefetch is sequential and preserves item order', async () => {
  const cache = new Map<string, string>();
  const calls: string[] = [];
  let active = 0;
  let maxActive = 0;

  const result = await fillPronunciationAudioCache(
    ['中', '中国', '中午', '中心'],
    cache,
    async (item) => {
      calls.push(item);
      active += 1;
      maxActive = Math.max(maxActive, active);
      await Promise.resolve();
      active -= 1;
      return `https://audio.example/${encodeURIComponent(item)}.wav`;
    },
  );

  assert.equal(maxActive, 1);
  assert.deepEqual(calls, ['中', '中国', '中午', '中心']);
  assert.deepEqual([...result.keys()], ['中', '中国', '中午', '中心']);
});

test('pronunciation audio prefetch keeps partial successes and retries only missing items', async () => {
  const cache = new Map<string, string>();
  const firstCalls: string[] = [];

  await assert.rejects(
    () => fillPronunciationAudioCache(
      ['中', '中国', '中午'],
      cache,
      async (item) => {
        firstCalls.push(item);
        if (item === '中国') throw new Error('temporary TTS failure');
        return `https://audio.example/${encodeURIComponent(item)}.wav`;
      },
    ),
    /temporary TTS failure/,
  );

  assert.deepEqual(firstCalls, ['中', '中国', '中午']);
  assert.deepEqual([...cache.keys()], ['中', '中午']);

  const retryCalls: string[] = [];
  const result = await fillPronunciationAudioCache(
    ['中', '中国', '中午'],
    cache,
    async (item) => {
      retryCalls.push(item);
      return `https://audio.example/${encodeURIComponent(item)}.wav`;
    },
  );

  assert.deepEqual(retryCalls, ['中国']);
  assert.deepEqual([...result.keys()], ['中', '中午', '中国']);
});
