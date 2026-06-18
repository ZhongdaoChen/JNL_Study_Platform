import type { Grade, Lang, Sentence, Word } from './types';
import type { Repo } from './repo';
import { tokenizeByLang } from './tokenizer';
import {
  applyReview,
  initialReviewState,
  initialSpellingReviewState,
  READ_FAMILIAR_THRESHOLD,
} from './sm2';
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
        needsSpelling: false,
        exampleSentence: null,
        ...initialReviewState(learnedOn),
        ...initialSpellingReviewState(),
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
  spellingOnly: boolean = false,
  maxCount: number = 0,
): Promise<Word[]> {
  const words = await repo.getWords(childId);
  const t = today();
  const due = words
    .filter((w) => w.lang === lang)
    .filter((w) => !spellingOnly || w.repetitions >= READ_FAMILIAR_THRESHOLD)
    .filter((w) => dateLte(spellingOnly ? w.spellingDueDate : w.dueDate, t))
    .sort((a, b) => {
      const aDue = spellingOnly ? a.spellingDueDate : a.dueDate;
      const bDue = spellingOnly ? b.spellingDueDate : b.dueDate;
      if (aDue !== bDue) return aDue < bDue ? -1 : 1;
      return a.text < b.text ? -1 : a.text > b.text ? 1 : 0;
    });
  return maxCount > 0 ? due.slice(0, maxCount) : due;
}

// 模块3：提交复习反馈，更新 SM-2 状态并记日志
export async function submitReview(
  repo: Repo,
  word: Word,
  grade: Grade,
  spellingOnly: boolean = false,
): Promise<Word> {
  const updated: Word = spellingOnly
    ? (() => {
        const spellingState = mapSpellingState(applyReview(
          {
            interval: word.spellingInterval,
            ef: word.spellingEf,
            repetitions: word.spellingRepetitions,
          },
          grade,
        ));
        const consecutiveSpellingForgotten =
          word.lang === 'en' &&
          grade === 'forgotten' &&
          word.spellingLastGrade === 'forgotten';

        if (!consecutiveSpellingForgotten) {
          return {
            ...word,
            ...spellingState,
          };
        }

        // 英文拼连续两次「彻底陌生」：退回英文读阶段，读熟练度回滚到 3，
        // 并重置拼写进度，之后需重新达到读熟悉阈值才会再次进入英文拼。
        return {
          ...word,
          ...spellingState,
          repetitions: READ_FAMILIAR_THRESHOLD - 1,
          interval: 1,
          dueDate: today(),
          needsSpelling: false,
          ...initialSpellingReviewState(),
        };
      })()
    : (() => {
        const readingState = applyReview(word, grade);
        return {
          ...word,
          ...readingState,
          // 拼写/会写队列资格始终跟随读熟悉度：达到阈值加入，跌破阈值移出。
          needsSpelling: readingState.repetitions >= READ_FAMILIAR_THRESHOLD,
        };
      })();
  // 两次写互不依赖，并行执行，减少一次网络往返的等待
  await Promise.all([
    repo.upsertWord(updated),
    repo.addReviewLog({
      id: crypto.randomUUID(),
      wordId: word.id,
      childId: word.childId,
      grade,
      reviewedAt: new Date().toISOString(),
    }),
  ]);
  return updated;
}

function mapSpellingState(state: ReturnType<typeof applyReview>): Pick<
  Word,
  'spellingInterval' | 'spellingEf' | 'spellingRepetitions' | 'spellingDueDate' | 'spellingLastGrade' | 'spellingLastReviewedAt'
> {
  return {
    spellingInterval: state.interval,
    spellingEf: state.ef,
    spellingRepetitions: state.repetitions,
    spellingDueDate: state.dueDate,
    spellingLastGrade: state.lastGrade,
    spellingLastReviewedAt: state.lastReviewedAt,
  };
}
