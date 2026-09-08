import test from 'node:test';
import assert from 'node:assert/strict';
import { applyReviewToQueue, RETRY_GAP_WORDS } from '../src/lib/reviewQueue.ts';
import { today } from '../src/lib/date.ts';
import type { Word } from '../src/lib/types.ts';

function makeWord(overrides: Partial<Word>): Word {
  return {
    id: `w-${Math.floor(Math.random() * 1e9)}`,
    childId: 'child-1',
    text: 'cat',
    lang: 'en',
    sentenceIds: [],
    firstLearnedAt: today(),
    needsSpelling: true,
    exampleSentence: null,
    pronunciationExamples: [],
    interval: 1,
    ef: 2.5,
    repetitions: 0,
    dueDate: today(),
    lastGrade: null,
    lastReviewedAt: null,
    pendingRetryCount: 0,
    spellingInterval: 0,
    spellingEf: 2.5,
    spellingRepetitions: 0,
    spellingDueDate: today(),
    spellingLastGrade: null,
    spellingLastReviewedAt: null,
    spellingPendingRetryCount: 0,
    volatilityRate: 0,
    ...overrides,
  };
}

// 生成长度为 n 的队列，文本依次为 w0, w1, ...
function makeQueue(n: number): Word[] {
  return Array.from({ length: n }, (_, i) => makeWord({ id: `w${i}`, text: `w${i}` }));
}

function texts(queue: Word[]): string[] {
  return queue.map((w) => w.text);
}

test('first forgotten inserts the retry copy after RETRY_GAP_WORDS words', () => {
  const queue = makeQueue(15);
  const updated = { ...queue[0], pendingRetryCount: 2 };
  const next = applyReviewToQueue(queue, updated, {
    spellingOnly: false,
    isRetryAttempt: false,
    gradedIndex: 0,
  });
  assert.equal(next.length, 16);
  // 原词后面先出现 10 个别的词，再出现补做副本，最后是剩余原队列
  assert.equal(next[0].id, 'w0');
  assert.deepEqual(texts(next.slice(1, 1 + RETRY_GAP_WORDS)), [
    'w1', 'w2', 'w3', 'w4', 'w5', 'w6', 'w7', 'w8', 'w9', 'w10',
  ]);
  assert.equal(next[1 + RETRY_GAP_WORDS].id, 'w0');
  assert.deepEqual(texts(next.slice(2 + RETRY_GAP_WORDS)), ['w11', 'w12', 'w13', 'w14']);
});

test('retry attempt appends remaining retries to the very end', () => {
  const queue = makeQueue(3);
  const updated = { ...queue[2], pendingRetryCount: 1 };
  const next = applyReviewToQueue(queue, updated, {
    spellingOnly: false,
    isRetryAttempt: true,
    gradedIndex: 2,
  });
  assert.equal(next.length, 4);
  assert.equal(next[3].id, 'w2');
});

test('no retry copy once pendingRetryCount is consumed', () => {
  const queue = makeQueue(3);
  const updated = { ...queue[2], pendingRetryCount: 0, dueDate: '2026-08-23' };
  const next = applyReviewToQueue(queue, updated, {
    spellingOnly: false,
    isRetryAttempt: true,
    gradedIndex: 2,
  });
  assert.equal(next.length, 3);
  assert.deepEqual(texts(next), ['w0', 'w1', 'w2']);
});

test('short queue falls back to appending at the end', () => {
  const queue = makeQueue(3);
  const updated = { ...queue[0], pendingRetryCount: 2 };
  const next = applyReviewToQueue(queue, updated, {
    spellingOnly: false,
    isRetryAttempt: false,
    gradedIndex: 0,
  });
  assert.equal(next.length, 4);
  assert.equal(next[3].id, 'w0');
});

test('spelling mode reads spellingPendingRetryCount instead of reading retry count', () => {
  const queue = makeQueue(15);
  const updated = { ...queue[0], spellingPendingRetryCount: 2 };
  const next = applyReviewToQueue(queue, updated, {
    spellingOnly: true,
    isRetryAttempt: false,
    gradedIndex: 0,
  });
  assert.equal(next.length, 16);
  assert.equal(next[1 + RETRY_GAP_WORDS].id, 'w0');
});

test('reading mode ignores spellingPendingRetryCount', () => {
  const queue = makeQueue(15);
  const updated = { ...queue[0], spellingPendingRetryCount: 2, pendingRetryCount: 0 };
  const next = applyReviewToQueue(queue, updated, {
    spellingOnly: false,
    isRetryAttempt: false,
    gradedIndex: 0,
  });
  assert.equal(next.length, 15);
});

test('all existing copies of the word are synced to the updated state', () => {
  const queue = makeQueue(3);
  const copy = { ...queue[1], pendingRetryCount: 2 };
  queue.push(copy); // 队列里已有该词的一个补做副本
  const updated = { ...queue[1], pendingRetryCount: 1 };
  const next = applyReviewToQueue(queue, updated, {
    spellingOnly: false,
    isRetryAttempt: true,
    gradedIndex: 1,
  });
  // 补做时再评分：剩余补做追加到队尾，且所有副本同步为最新状态
  assert.equal(next.length, 5);
  const copies = next.filter((w) => w.id === 'w1');
  assert.equal(copies.length, 3);
  assert.ok(copies.every((w) => w.pendingRetryCount === 1));
});
