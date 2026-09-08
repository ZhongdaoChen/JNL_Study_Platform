import test from 'node:test';
import assert from 'node:assert/strict';
import { addLearning, archiveWordFromSpelling, getDueReviews, ARCHIVE_SHELVE_DAYS } from '../src/lib/wordService.ts';
import { addDays, today } from '../src/lib/date.ts';
import type { Child, ReviewLog, Sentence, Word } from '../src/lib/types.ts';
import type { Repo } from '../src/lib/repo.ts';

// 内存版 Repo：只实现 wordService 用到的读写，其余给空实现
class FakeRepo implements Repo {
  words: Word[] = [];
  sentences: Sentence[] = [];
  reviewLogs: ReviewLog[] = [];

  async listChildren(): Promise<Child[]> { return []; }
  async addChild(name: string): Promise<Child> {
    return { id: 'child-x', name, createdAt: new Date().toISOString() };
  }
  async addSentence(childId: string, text: string): Promise<Sentence> {
    const s: Sentence = { id: `s-${this.sentences.length + 1}`, childId, text, createdAt: new Date().toISOString() };
    this.sentences.push(s);
    return s;
  }
  async getSentences(childId: string): Promise<Sentence[]> {
    return this.sentences.filter((s) => s.childId === childId);
  }
  async getWords(childId: string): Promise<Word[]> {
    return this.words.filter((w) => w.childId === childId);
  }
  async upsertWord(word: Word): Promise<void> {
    const idx = this.words.findIndex((w) => w.id === word.id);
    if (idx >= 0) this.words[idx] = word;
    else this.words.push(word);
  }
  async updateExampleSentence(wordId: string, sentence: string): Promise<void> {
    const word = this.words.find((item) => item.id === wordId);
    if (word) word.exampleSentence = sentence;
  }
  async updatePronunciationExamples(wordId: string, examples: string[]): Promise<void> {
    const word = this.words.find((item) => item.id === wordId);
    if (word) word.pronunciationExamples = examples;
  }
  async deleteWord(wordId: string): Promise<void> {
    this.words = this.words.filter((w) => w.id !== wordId);
  }
  async deleteWords(wordIds: string[]): Promise<void> {
    const ids = new Set(wordIds);
    this.words = this.words.filter((w) => !ids.has(w.id));
  }
  async addReviewLog(log: ReviewLog): Promise<void> {
    this.reviewLogs.push(log);
  }
  async getReviewLogs(childId: string, wordId?: string): Promise<ReviewLog[]> {
    return this.reviewLogs.filter((l) => l.childId === childId && (wordId ? l.wordId === wordId : true));
  }
  async addFeedback(): Promise<void> {}
}

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

test('spelling selection requires needsSpelling=true', async () => {
  const repo = new FakeRepo();
  repo.words = [
    makeWord({ id: 'kept', needsSpelling: true, repetitions: 4, spellingDueDate: today() }),
    makeWord({ id: 'removed', needsSpelling: false, repetitions: 4, spellingDueDate: today() }),
  ];
  const queue = await getDueReviews(repo, 'child-1', 'en', true, 0);
  assert.deepEqual(queue.map((w) => w.id), ['kept']);
});

test('archived word stays out of spelling queue even when spelling due date passes', async () => {
  const repo = new FakeRepo();
  const word = makeWord({ id: 'archived', repetitions: 4, spellingDueDate: today() });
  repo.words = [word];
  const archived = await archiveWordFromSpelling(repo, word);
  const queue = await getDueReviews(repo, 'child-1', 'en', true, 0);
  assert.equal(archived.needsSpelling, false);
  assert.equal(queue.length, 0);
});

test('reading selection ignores needsSpelling', async () => {
  const repo = new FakeRepo();
  repo.words = [
    makeWord({ id: 'read-anyway', needsSpelling: false, repetitions: 0, dueDate: today() }),
  ];
  const queue = await getDueReviews(repo, 'child-1', 'en', false, 0);
  assert.deepEqual(queue.map((w) => w.id), ['read-anyway']);
});

test('archiveWordFromSpelling lowers familiarity and postpones due date about one month', async () => {
  const repo = new FakeRepo();
  const word = makeWord({ id: 'w1', repetitions: 5, dueDate: today() });
  repo.words = [word];
  const updated = await archiveWordFromSpelling(repo, word);
  assert.equal(updated.needsSpelling, false);
  assert.equal(updated.repetitions, 2);
  assert.equal(updated.dueDate, addDays(today(), ARCHIVE_SHELVE_DAYS));
  assert.equal(repo.words[0].needsSpelling, false);
  // 暂缓期内不会出现在读复习队列
  const readingQueue = await getDueReviews(repo, 'child-1', 'en', false, 0);
  assert.equal(readingQueue.length, 0);
});

test('new words default to needsSpelling=true', async () => {
  const repo = new FakeRepo();
  const { newWords } = await addLearning(repo, 'child-1', 'cat, dog', 'en');
  assert.deepEqual(newWords, ['cat', 'dog']);
  assert.ok(repo.words.every((w) => w.needsSpelling === true));
  assert.ok(repo.words.every((w) => Array.isArray(w.pronunciationExamples)));
  assert.ok(repo.words.every((w) => w.pronunciationExamples.length === 0));
});

// 30 个逾期 10 天、已复习过的积压词
function makeBacklog(count: number): Word[] {
  return Array.from({ length: count }, (_, i) =>
    makeWord({
      id: `backlog-${i}`,
      text: `backlog-${String(i).padStart(2, '0')}`,
      repetitions: 1,
      lastGrade: 'mastered',
      dueDate: addDays(today(), -10),
    }),
  );
}

test('never-reviewed new word is reserved even when buried in overdue backlog', async () => {
  const repo = new FakeRepo();
  const buried = makeWord({ id: 'buried-new', text: 'buriednew', dueDate: addDays(today(), -5) });
  repo.words = [...makeBacklog(30), buried];
  // 旧逻辑下它排在 30 个更早到期的积压词之后，10 个名额轮不到它
  const queue = await getDueReviews(repo, 'child-1', 'en', false, 10);
  assert.equal(queue.length, 10);
  assert.ok(queue.some((w) => w.id === 'buried-new'));
});

test('without new words the cap still picks the most overdue words first', async () => {
  const repo = new FakeRepo();
  repo.words = makeBacklog(30);
  const queue = await getDueReviews(repo, 'child-1', 'en', false, 10);
  assert.equal(queue.length, 10);
  assert.ok(queue.every((w) => w.id.startsWith('backlog-')));
});

test('recently forgotten words (repetitions=0 but graded) do not take the new-word slot', async () => {
  const repo = new FakeRepo();
  const fresh = makeWord({ id: 'fresh-new', text: 'freshnew', dueDate: addDays(today(), -5) });
  const forgotten = makeWord({
    id: 'just-forgotten',
    text: 'justforgotten',
    repetitions: 0,
    lastGrade: 'forgotten',
    dueDate: addDays(today(), -5),
  });
  repo.words = [...makeBacklog(30), fresh, forgotten];
  const queue = await getDueReviews(repo, 'child-1', 'en', false, 10);
  assert.equal(queue.length, 10);
  // 新词保底名额只给「从未评过分」的词；刚彻底陌生的词走不稳定/逾期桶，不占新词名额
  assert.ok(queue.some((w) => w.id === 'fresh-new'));
  assert.ok(!queue.some((w) => w.id === 'just-forgotten'));
});

test('spelling queue is unaffected by the new-word reservation', async () => {
  const repo = new FakeRepo();
  repo.words = Array.from({ length: 15 }, (_, i) =>
    makeWord({
      id: `spell-${i}`,
      text: `spell-${i}`,
      repetitions: 4, // 拼写队列门槛
      lastGrade: 'mastered',
      spellingDueDate: today(),
    }),
  );
  const queue = await getDueReviews(repo, 'child-1', 'en', true, 10);
  assert.equal(queue.length, 10);
});
