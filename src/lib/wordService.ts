import type { Grade, Sentence, Word } from './types';
import type { Repo } from './repo';
import { tokenize } from './tokenizer';
import { applyReview, initialReviewState } from './sm2';
import { dateLte, today } from './date';

// 业务服务层：把"拆词 + SM-2 + 仓储"组合成模块要用的高层操作。

// 模块1：录入今日新内容
// 输入一句话 → 保存句子 → 拆词 → 新词初始化记忆状态，旧词补充语境
export async function addLearning(
  repo: Repo,
  childId: string,
  text: string,
  learnedOn: string = today(),
): Promise<{ sentence: Sentence; newWords: string[]; reviewedExisting: string[] }> {
  const sentence = await repo.addSentence(childId, text.trim());
  const tokens = tokenize(text);
  const existing = await repo.getWords(childId);
  const byText = new Map(existing.map((w) => [w.text, w]));

  const newWords: string[] = [];
  const reviewedExisting: string[] = [];

  for (const t of tokens) {
    const found = byText.get(t);
    if (found) {
      // 已学过：把这个句子加入它的语境列表
      if (!found.sentenceIds.includes(sentence.id)) {
        found.sentenceIds.push(sentence.id);
        await repo.upsertWord(found);
      }
      reviewedExisting.push(t);
    } else {
      // 新词：按所选学习日期初始化记忆状态
      const word: Word = {
        id: crypto.randomUUID(),
        childId,
        text: t,
        sentenceIds: [sentence.id],
        firstLearnedAt: learnedOn,
        ...initialReviewState(learnedOn),
      };
      await repo.upsertWord(word);
      byText.set(t, word);
      newWords.push(t);
    }
  }

  return { sentence, newWords, reviewedExisting };
}

// 模块2：今日复习清单
// 取出所有到期（dueDate <= 今天）的词，按到期日升序，限制每日数量
export async function getDueReviews(
  repo: Repo,
  childId: string,
  limit = 10,
): Promise<Word[]> {
  const words = await repo.getWords(childId);
  const t = today();
  const due = words
    .filter((w) => dateLte(w.dueDate, t))
    .sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0));
  return due.slice(0, limit);
}

// 模块3：提交复习反馈，更新 SM-2 状态并记日志
export async function submitReview(
  repo: Repo,
  word: Word,
  grade: Grade,
): Promise<Word> {
  const updated: Word = { ...word, ...applyReview(word, grade) };
  await repo.upsertWord(updated);
  await repo.addReviewLog({
    id: crypto.randomUUID(),
    wordId: word.id,
    childId: word.childId,
    grade,
    reviewedAt: new Date().toISOString(),
  });
  return updated;
}
