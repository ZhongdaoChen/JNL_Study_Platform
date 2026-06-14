import type { Child, ReviewLog, Sentence, Word } from './types';
import type { Repo } from './repo';

// 本地存储实现：数据保存在浏览器 localStorage。
// 用于无后台时立即试用；接入 Supabase 后改用 SupabaseRepo 即可多设备同步。

const KEY = 'kid-english-db-v1';

interface DB {
  children: Child[];
  sentences: Sentence[];
  words: Word[];
  reviewLogs: ReviewLog[];
}

function emptyDB(): DB {
  return { children: [], sentences: [], words: [], reviewLogs: [] };
}

function load(): DB {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyDB();
    return { ...emptyDB(), ...JSON.parse(raw) };
  } catch {
    return emptyDB();
  }
}

function save(db: DB) {
  localStorage.setItem(KEY, JSON.stringify(db));
}

function uid(): string {
  return crypto.randomUUID();
}

export class LocalRepo implements Repo {
  async listChildren(): Promise<Child[]> {
    return load().children;
  }

  async addChild(name: string): Promise<Child> {
    const db = load();
    const child: Child = { id: uid(), name, createdAt: new Date().toISOString() };
    db.children.push(child);
    save(db);
    return child;
  }

  async addSentence(childId: string, text: string): Promise<Sentence> {
    const db = load();
    const sentence: Sentence = {
      id: uid(),
      childId,
      text,
      createdAt: new Date().toISOString(),
    };
    db.sentences.push(sentence);
    save(db);
    return sentence;
  }

  async getSentences(childId: string): Promise<Sentence[]> {
    return load().sentences.filter((s) => s.childId === childId);
  }

  async getWords(childId: string): Promise<Word[]> {
    // 兼容旧数据：早期单词没有 lang 字段，统一视为英文
    return load()
      .words.filter((w) => w.childId === childId)
      .map((w) => ({ ...w, lang: w.lang ?? 'en' }));
  }

  async upsertWord(word: Word): Promise<void> {
    const db = load();
    const idx = db.words.findIndex((w) => w.id === word.id);
    if (idx >= 0) db.words[idx] = word;
    else db.words.push(word);
    save(db);
  }

  async deleteWord(wordId: string): Promise<void> {
    const db = load();
    db.words = db.words.filter((w) => w.id !== wordId);
    // 一并清理该词的复习日志
    db.reviewLogs = db.reviewLogs.filter((l) => l.wordId !== wordId);
    save(db);
  }

  async deleteWords(wordIds: string[]): Promise<void> {
    const ids = new Set(wordIds);
    const db = load();
    db.words = db.words.filter((w) => !ids.has(w.id));
    db.reviewLogs = db.reviewLogs.filter((l) => !ids.has(l.wordId));
    save(db);
  }

  async addReviewLog(log: ReviewLog): Promise<void> {
    const db = load();
    db.reviewLogs.push(log);
    save(db);
  }

  async getReviewLogs(childId: string): Promise<ReviewLog[]> {
    return load().reviewLogs.filter((l) => l.childId === childId);
  }
}
