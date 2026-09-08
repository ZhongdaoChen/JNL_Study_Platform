import test from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseRepo } from '../src/lib/supabaseRepo.ts';

// 假 Supabase 客户端：只实现 select 链（eq/order/range），
// 并且和真实 PostgREST 一样「单次请求最多返回 1000 行」，
// 用来回归验证 Repo 的分页逻辑。
const PAGE_LIMIT = 1000;

function fakeSupabase(tables: Record<string, Record<string, unknown>[]>) {
  return {
    from(table: string) {
      const allRows = tables[table] ?? [];
      const builder: {
        filters: ((row: Record<string, unknown>) => boolean)[];
        select: () => typeof builder;
        eq: (col: string, value: unknown) => typeof builder;
        order: () => typeof builder;
        range: (from: number, to: number) => Promise<{ data: Record<string, unknown>[]; error: null }>;
      } = {
        filters: [],
        select() {
          return this;
        },
        eq(col, value) {
          this.filters.push((row) => row[col] === value);
          return this;
        },
        order() {
          return this;
        },
        range(from, to) {
          const filtered = allRows.filter((row) => this.filters.every((f) => f(row)));
          return Promise.resolve({ data: filtered.slice(from, to + 1), error: null });
        },
      };
      return builder;
    },
  };
}

function makeWordRow(i: number, childId: string): Record<string, unknown> {
  return {
    id: `word-${i}`,
    child_id: childId,
    text: `word${i}`,
    lang: 'en',
    sentence_ids: [],
    first_learned_at: '2026-08-01T00:00:00Z',
    needs_spelling: true,
    example_sentence: null,
    interval: 1,
    ef: 2.5,
    repetitions: 0,
    due_date: '2026-08-20',
    last_grade: null,
    last_reviewed_at: null,
    pending_retry_count: 0,
    volatility_rate: 0,
    spelling_due_date: null,
  };
}

function makeRepo(tables: Record<string, Record<string, unknown>[]>): SupabaseRepo {
  return new SupabaseRepo(fakeSupabase(tables) as unknown as SupabaseClient);
}

test('getWords paginates past the 1000-row limit and keeps child filter', async () => {
  const words: Record<string, unknown>[] = [];
  for (let i = 0; i < 2500; i += 1) words.push(makeWordRow(i, 'child-1'));
  for (let i = 0; i < 3; i += 1) words.push(makeWordRow(9000 + i, 'child-2'));

  const repo = makeRepo({ words });
  const result = await repo.getWords('child-1');
  assert.equal(result.length, 2500);
  assert.ok(result.every((w) => w.childId === 'child-1'));
  assert.equal(result[0].text, 'word0');
  assert.equal(result[2499].text, 'word2499');
});

test('getWords returns everything when exactly at one page', async () => {
  const words: Record<string, unknown>[] = [];
  for (let i = 0; i < PAGE_LIMIT; i += 1) words.push(makeWordRow(i, 'child-1'));
  const repo = makeRepo({ words });
  const result = await repo.getWords('child-1');
  assert.equal(result.length, PAGE_LIMIT);
});

test('getWords maps pronunciation examples and falls back for older rows', async () => {
  const repo = makeRepo({
    words: [
      {
        ...makeWordRow(1, 'child-1'),
        pronunciation_examples: ['中国', '中午', '中间'],
      },
      makeWordRow(2, 'child-1'),
    ],
  });

  const result = await repo.getWords('child-1');

  assert.deepEqual(result[0].pronunciationExamples, ['中国', '中午', '中间']);
  assert.deepEqual(result[1].pronunciationExamples, []);
});

test('getSentences paginates past the 1000-row limit', async () => {
  const sentences = Array.from({ length: 1500 }, (_, i) => ({
    id: `s-${i}`,
    child_id: 'child-1',
    text: `sentence ${i}`,
    created_at: '2026-08-01T00:00:00Z',
  }));
  const repo = makeRepo({ sentences });
  const result = await repo.getSentences('child-1');
  assert.equal(result.length, 1500);
  assert.equal(result[1499].text, 'sentence 1499');
});

test('getReviewLogs still paginates and honors the word filter', async () => {
  const logs: Record<string, unknown>[] = [];
  for (let i = 0; i < 2300; i += 1) {
    logs.push({
      id: `log-${i}`,
      child_id: 'child-1',
      word_id: 'word-a',
      grade: 'mastered',
      reviewed_at: '2026-08-01T00:00:00Z',
    });
  }
  for (let i = 0; i < 5; i += 1) {
    logs.push({
      id: `log-b-${i}`,
      child_id: 'child-1',
      word_id: 'word-b',
      grade: 'instant',
      reviewed_at: '2026-08-02T00:00:00Z',
    });
  }

  const repo = makeRepo({ review_logs: logs });
  const all = await repo.getReviewLogs('child-1');
  assert.equal(all.length, 2305);
  const onlyB = await repo.getReviewLogs('child-1', 'word-b');
  assert.equal(onlyB.length, 5);
  assert.ok(onlyB.every((l) => l.wordId === 'word-b'));
});
