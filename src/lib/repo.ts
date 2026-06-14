import type { Child, ReviewLog, Sentence, Word } from './types';

// 数据仓储接口：UI 只依赖这个接口，不关心底层是本地存储还是 Supabase。
// 这样未来从本地切换到云端同步时，UI 代码无需改动。
export interface Repo {
  // 孩子档案
  listChildren(): Promise<Child[]>;
  addChild(name: string): Promise<Child>;

  // 句子
  addSentence(childId: string, text: string): Promise<Sentence>;
  getSentences(childId: string): Promise<Sentence[]>;

  // 单词
  getWords(childId: string): Promise<Word[]>;
  upsertWord(word: Word): Promise<void>;
  deleteWord(wordId: string): Promise<void>;
  deleteWords(wordIds: string[]): Promise<void>;

  // 复习日志
  addReviewLog(log: ReviewLog): Promise<void>;
  getReviewLogs(childId: string): Promise<ReviewLog[]>;
}
