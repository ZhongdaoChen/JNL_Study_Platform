import type { SupabaseClient } from '@supabase/supabase-js';
import type { Child, ReviewLog, Sentence, Word } from './types';
import type { Repo } from './repo';
import { initialSpellingReviewState } from './sm2';

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
      }
    : initialSpellingReviewState();
  return {
    id: r.id,
    childId: r.child_id,
    text: r.text,
    lang: r.lang ?? 'en',
    sentenceIds: r.sentence_ids ?? [],
    firstLearnedAt: r.first_learned_at,
    needsSpelling: r.needs_spelling ?? false,
    exampleSentence: r.example_sentence ?? null,
    interval: r.interval,
    ef: r.ef,
    repetitions: r.repetitions,
    dueDate: r.due_date,
    lastGrade: r.last_grade,
    lastReviewedAt: r.last_reviewed_at,
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

  async listChildren(): Promise<Child[]> {
    const { data, error } = await this.sb
      .from('children')
      .select('*')
      .order('created_at');
    if (error) this.fail('listChildren', error);
    return (data ?? []).map(rowToChild);
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
    const { data, error } = await this.sb
      .from('sentences')
      .select('*')
      .eq('child_id', childId);
    if (error) this.fail('getSentences', error);
    return (data ?? []).map(rowToSentence);
  }

  async getWords(childId: string): Promise<Word[]> {
    const { data, error } = await this.sb
      .from('words')
      .select('*')
      .eq('child_id', childId);
    if (error) this.fail('getWords', error);
    return (data ?? []).map(rowToWord);
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
      spelling_interval: word.spellingInterval,
      spelling_ef: word.spellingEf,
      spelling_repetitions: word.spellingRepetitions,
      spelling_due_date: word.spellingDueDate,
      spelling_last_grade: word.spellingLastGrade,
      spelling_last_reviewed_at: word.spellingLastReviewedAt,
    });
    if (error) this.fail('upsertWord', error);
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

  async getReviewLogs(childId: string): Promise<ReviewLog[]> {
    const { data, error } = await this.sb
      .from('review_logs')
      .select('*')
      .eq('child_id', childId);
    if (error) this.fail('getReviewLogs', error);
    return (data ?? []).map((r: any) => ({
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
