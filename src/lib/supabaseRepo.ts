import type { SupabaseClient } from '@supabase/supabase-js';
import type { Child, ReviewLog, Sentence, Word } from './types';
import type { Repo } from './repo';
// 运行时导入带 .ts 扩展名：Vite 构建支持，node --test 直跑本模块时也必须显式扩展名
import { initialSpellingReviewState } from './sm2.ts';

const SUPABASE_PAGE_SIZE = 1000;

// 分页查询链的结构类型：只声明 selectAllRows 用到的方法
// （eq / order 返回同类型构建器，range 返回 Promise）
interface PagedSelect {
  eq(column: string, value: unknown): PagedSelect;
  order(column: string, options?: { ascending?: boolean }): PagedSelect;
  range(from: number, to: number): PromiseLike<{ data: Record<string, unknown>[] | null; error: unknown }>;
}

// Supabase 实现：数据存云端 Postgres，RLS 自动按登录用户隔离。
// UI 通过 Repo 接口调用，与 LocalRepo 完全可互换。

// 数据库行 → 应用类型 的字段映射（snake_case → camelCase）
function rowToChild(r: any): Child {
  return { id: r.id, name: r.name, createdAt: r.created_at };
}
function rowToSentence(r: any): Sentence {
  return { id: r.id, childId: r.child_id, text: r.text, createdAt: r.created_at };
}
function rowToWord(r: any): Word {
  const spelling = r.spelling_due_date
    ? {
        spellingInterval: r.spelling_interval,
        spellingEf: r.spelling_ef,
        spellingRepetitions: r.spelling_repetitions,
        spellingDueDate: r.spelling_due_date,
        spellingLastGrade: r.spelling_last_grade,
        spellingLastReviewedAt: r.spelling_last_reviewed_at,
        spellingPendingRetryCount: r.spelling_pending_retry_count ?? 0,
      }
    : initialSpellingReviewState();
  return {
    id: r.id,
    childId: r.child_id,
    text: r.text,
    lang: r.lang ?? 'en',
    sentenceIds: r.sentence_ids ?? [],
    firstLearnedAt: r.first_learned_at,
    needsSpelling: r.needs_spelling ?? true,
    exampleSentence: r.example_sentence ?? null,
    pronunciationExamples: Array.isArray(r.pronunciation_examples)
      ? r.pronunciation_examples.filter((item: unknown): item is string => typeof item === 'string')
      : [],
    interval: r.interval,
    ef: r.ef,
    repetitions: r.repetitions,
    dueDate: r.due_date,
    lastGrade: r.last_grade,
    lastReviewedAt: r.last_reviewed_at,
    pendingRetryCount: r.pending_retry_count ?? 0,
    volatilityRate: r.volatility_rate ?? 0,
    ...spelling,
  };
}

export class SupabaseRepo implements Repo {
  private sb: SupabaseClient;
  constructor(sb: SupabaseClient) {
    this.sb = sb;
  }

  private fail(ctx: string, error: unknown): never {
    throw new Error(`${ctx}: ${(error as any)?.message ?? error}`);
  }

  // Supabase（PostgREST）单次 select 默认最多返回 1000 行，超出会被静默截断
  // （统计页「累计单词」卡在 1000、复习队列漏词都是这个原因）。
  // 所有「全量读取」查询统一用 range() 分页，直到取回不足一整页为止。
  // 注意：调用方必须给查询带上稳定排序，否则分页过程中可能漏行或重复。
  //
  // PagedSelect：分页查询链的轻量结构类型。Supabase 官方查询构建器的泛型
  // 很复杂且未接入生成的库类型，这里只声明用到的方法，避免引入更多 any。
  private async selectAllRows(
    table: string,
    ctx: string,
    applyFilters: (query: PagedSelect) => PagedSelect,
  ): Promise<Record<string, unknown>[]> {
    const rows: Record<string, unknown>[] = [];
    let from = 0;
    while (true) {
      // 经 unknown 断言：直接断言会触发 supabase 查询构建器的深度泛型递归
      const { data, error } = await applyFilters(
        this.sb.from(table).select('*') as unknown as PagedSelect,
      ).range(from, from + SUPABASE_PAGE_SIZE - 1);
      if (error) this.fail(ctx, error);
      const page = data ?? [];
      rows.push(...page);
      if (page.length < SUPABASE_PAGE_SIZE) break;
      from += SUPABASE_PAGE_SIZE;
    }
    return rows;
  }

  async listChildren(): Promise<Child[]> {
    const rows = await this.selectAllRows('children', 'listChildren', (q) =>
      q.order('created_at'),
    );
    return rows.map(rowToChild);
  }

  async addChild(name: string): Promise<Child> {
    // owner 由数据库默认值 auth.uid() 填充
    const { data, error } = await this.sb
      .from('children')
      .insert({ name })
      .select()
      .single();
    if (error) this.fail('addChild', error);
    return rowToChild(data);
  }

  async addSentence(childId: string, text: string): Promise<Sentence> {
    const { data, error } = await this.sb
      .from('sentences')
      .insert({ child_id: childId, text })
      .select()
      .single();
    if (error) this.fail('addSentence', error);
    return rowToSentence(data);
  }

  async getSentences(childId: string): Promise<Sentence[]> {
    const rows = await this.selectAllRows('sentences', 'getSentences', (q) =>
      q.eq('child_id', childId).order('created_at').order('id'),
    );
    return rows.map(rowToSentence);
  }

  async getWords(childId: string): Promise<Word[]> {
    const rows = await this.selectAllRows('words', 'getWords', (q) =>
      q.eq('child_id', childId).order('id'),
    );
    return rows.map(rowToWord);
  }

  async upsertWord(word: Word): Promise<void> {
    const { error } = await this.sb.from('words').upsert({
      id: word.id,
      child_id: word.childId,
      text: word.text,
      lang: word.lang,
      sentence_ids: word.sentenceIds,
      first_learned_at: word.firstLearnedAt,
      needs_spelling: word.needsSpelling,
      example_sentence: word.exampleSentence,
      interval: word.interval,
      ef: word.ef,
      repetitions: word.repetitions,
      due_date: word.dueDate,
      last_grade: word.lastGrade,
      last_reviewed_at: word.lastReviewedAt,
      pending_retry_count: word.pendingRetryCount,
      volatility_rate: word.volatilityRate,
      spelling_interval: word.spellingInterval,
      spelling_ef: word.spellingEf,
      spelling_repetitions: word.spellingRepetitions,
      spelling_due_date: word.spellingDueDate,
      spelling_last_grade: word.spellingLastGrade,
      spelling_last_reviewed_at: word.spellingLastReviewedAt,
      spelling_pending_retry_count: word.spellingPendingRetryCount,
    });
    if (error) this.fail('upsertWord', error);
  }

  async updatePronunciationExamples(wordId: string, examples: string[]): Promise<void> {
    const { error } = await this.sb
      .from('words')
      .update({ pronunciation_examples: examples })
      .eq('id', wordId);
    if (error) this.fail('updatePronunciationExamples', error);
  }

  async deleteWord(wordId: string): Promise<void> {
    // review_logs 通过外键 on delete cascade 自动删除
    const { error } = await this.sb.from('words').delete().eq('id', wordId);
    if (error) this.fail('deleteWord', error);
  }

  async deleteWords(wordIds: string[]): Promise<void> {
    if (wordIds.length === 0) return;
    const { error } = await this.sb.from('words').delete().in('id', wordIds);
    if (error) this.fail('deleteWords', error);
  }

  async addReviewLog(log: ReviewLog): Promise<void> {
    const { error } = await this.sb.from('review_logs').insert({
      id: log.id,
      child_id: log.childId,
      word_id: log.wordId,
      grade: log.grade,
      reviewed_at: log.reviewedAt,
    });
    if (error) this.fail('addReviewLog', error);
  }

  async getReviewLogs(childId: string, wordId?: string): Promise<ReviewLog[]> {
    const rows = await this.selectAllRows('review_logs', 'getReviewLogs', (q) => {
      const filtered = q
        .eq('child_id', childId)
        .order('reviewed_at', { ascending: true })
        .order('id', { ascending: true });
      return wordId ? filtered.eq('word_id', wordId) : filtered;
    });

    return rows.map((r: any) => ({
      id: r.id,
      wordId: r.word_id,
      childId: r.child_id,
      grade: r.grade,
      reviewedAt: r.reviewed_at,
    }));
  }

  async addFeedback(content: string): Promise<void> {
    // owner 由数据库默认值 auth.uid() 填充
    const { error } = await this.sb.from('feedback').insert({ content });
    if (error) this.fail('addFeedback', error);
  }
}
