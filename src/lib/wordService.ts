import type { Grade, Lang, Sentence, Word } from './types';
import type { Repo } from './repo';
import { tokenizeByLang } from './tokenizer';
import { applyReview, initialReviewState } from './sm2';
import { dateLte, today } from './date';

// 业务服务层：把"拆词 + SM-2 + 仓储"组合成模块要用的高层操作。

// 模块1：录入今日新内容
// 输入一句话 → 保存句子 → 按语言拆分（英文按词 / 中文按字）→
// 新词初始化记忆状态，旧词补充语境。en 与 zh 互不干扰。
export async function addLearning(
  repo: Repo,
  childId: string,
  text: string,
  lang: Lang = 'en',
  learnedOn: string = today(),
): Promise<{ sentence: Sentence; newWords: string[]; reviewedExisting: string[] }> {
  const sentence = await repo.addSentence(childId, text.trim());
  const tokens = tokenizeByLang(text, lang);
  const existing = (await repo.getWords(childId)).filter((w) => w.lang === lang);
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
        lang,
        sentenceIds: [sentence.id],
        firstLearnedAt: learnedOn,
        exampleSentence: null,
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
// 取出指定语言中所有到期（dueDate <= 今天）的词，按到期日升序、同日按字母/字序（稳定）。
// 不设上限：当天所有到期的词都会列出。
// 进度记忆：每次评分会立即更新该词的 dueDate（推到未来），评过的词即退出到期池，
// 因此下次重新进入复习页时只返回尚未复习的词，自动从上次进度继续。
export async function getDueReviews(
  repo: Repo,
  childId: string,
  lang: Lang = 'en',
): Promise<Word[]> {
  const words = await repo.getWords(childId);
  const t = today();
  return words
    .filter((w) => w.lang === lang)
    .filter((w) => dateLte(w.dueDate, t))
    .sort((a, b) => {
      if (a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? -1 : 1;
      return a.text < b.text ? -1 : a.text > b.text ? 1 : 0;
    });
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
