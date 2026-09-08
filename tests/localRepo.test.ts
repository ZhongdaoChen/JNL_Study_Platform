import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalRepo } from '../src/lib/localRepo.ts';
import type { Word } from '../src/lib/types.ts';

function installLocalStorage(): void {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem(key: string) {
        return values.get(key) ?? null;
      },
      setItem(key: string, value: string) {
        values.set(key, value);
      },
    },
  });
}

function makeWord(): Word {
  return {
    id: 'word-1',
    childId: 'child-1',
    text: '中',
    lang: 'zh',
    sentenceIds: ['sentence-1'],
    firstLearnedAt: '2026-09-01',
    needsSpelling: true,
    exampleSentence: '保留这句最新例句',
    pronunciationExamples: [],
    interval: 9,
    ef: 2.7,
    repetitions: 4,
    dueDate: '2026-09-18',
    lastGrade: 'instant',
    lastReviewedAt: '2026-09-08T04:00:00.000Z',
    pendingRetryCount: 2,
    spellingInterval: 5,
    spellingEf: 2.3,
    spellingRepetitions: 2,
    spellingDueDate: '2026-09-13',
    spellingLastGrade: 'fuzzy',
    spellingLastReviewedAt: '2026-09-07T04:00:00.000Z',
    spellingPendingRetryCount: 1,
    volatilityRate: 31,
  };
}

test('updatePronunciationExamples preserves every other local word field', async () => {
  installLocalStorage();
  const repo = new LocalRepo();
  const original = makeWord();
  await repo.upsertWord(original);

  await repo.updatePronunciationExamples(original.id, ['中国', '中午', '中心']);

  const [updated] = await repo.getWords(original.childId);
  assert.deepEqual(updated, {
    ...original,
    pronunciationExamples: ['中国', '中午', '中心'],
  });
});
