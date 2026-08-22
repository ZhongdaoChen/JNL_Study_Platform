import type { Grade, Lang, Sentence, Word } from './types';
import type { Repo } from './repo';
// 运行时导入带 .ts 扩展名：Vite 构建支持，node --test 直跑本模块时也必须显式扩展名
import { tokenizeByLang } from './tokenizer.ts';
import { computeVolatilityRate } from './statsService.ts';
import {
  applyReview,
  initialReviewState,
  initialSpellingReviewState,
  READ_FAMILIAR_THRESHOLD,
} from './sm2.ts';
import { addDays, dateLte, today } from './date.ts';

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
  selectedTokens?: string[],
): Promise<{ sentence: Sentence; newWords: string[]; reviewedExisting: string[] }> {
  const sentence = await repo.addSentence(childId, text.trim());
  const tokens = selectedTokens ?? tokenizeByLang(text, lang);
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
        needsSpelling: true,
        exampleSentence: null,
        volatilityRate: 0,
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
// 取出指定语言中所有到期（dueDate <= 今天）的词。
// 默认按到期日升序、同日按字母/字序（稳定）；触发每日上限时按配额选词：
// 从未复习的新词 10%（保底，避免第一次复习被积压淹没）、逾期超 3 天 40%（逾期最久优先）、
// 不稳定 30%（波动率高优先）、普通 20%；各桶不足时剩余名额按该顺序补齐。
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
    // 拼写/会写队列要求「需要拼写」：在拼写界面点删除会置为 false 移出队列
    .filter((w) => !spellingOnly || w.needsSpelling)
    .filter((w) => !spellingOnly || w.repetitions >= READ_FAMILIAR_THRESHOLD)
    .filter((w) => dateLte(spellingOnly ? w.spellingDueDate : w.dueDate, t))
    .sort((a, b) => compareDueThenText(a, b, spellingOnly));
  if (maxCount <= 0 || due.length <= maxCount) return due;
  return selectDueReviews(due, maxCount, spellingOnly, t);
}

function compareDueThenText(a: Word, b: Word, spellingOnly: boolean): number {
  const aDue = spellingOnly ? a.spellingDueDate : a.dueDate;
  const bDue = spellingOnly ? b.spellingDueDate : b.dueDate;
  if (aDue !== bDue) return aDue < bDue ? -1 : 1;
  return a.text < b.text ? -1 : a.text > b.text ? 1 : 0;
}

function selectDueReviews(
  due: Word[],
  maxCount: number,
  spellingOnly: boolean,
  todayStr: string,
): Word[] {
  const severeCutoff = addDays(todayStr, -3);
  const quotas = reviewQuotas(maxCount);
  const selected: Word[] = [];
  const selectedIds = new Set<string>();

  // 从未复习的新词单独保底：否则积压一大时，新词第一次复习（最容易忘的一次）
  // 会被逾期桶的长队无限推迟。拼写队列里的词读熟练度都 >= 4，此桶自然为空。
  const neverReviewed = due
    .filter((w) => isNeverReviewed(w))
    .sort((a, b) => compareDueThenText(a, b, spellingOnly));
  const severeOverdue = due
    .filter((w) => !isNeverReviewed(w))
    .filter((w) => dateLte(dueDateForMode(w, spellingOnly), severeCutoff))
    .sort((a, b) => compareDueThenText(a, b, spellingOnly));
  const unstable = due
    .filter((w) => !isNeverReviewed(w))
    .filter((w) => !dateLte(dueDateForMode(w, spellingOnly), severeCutoff))
    .filter((w) => isUnstable(w, spellingOnly))
    .sort((a, b) => compareUnstable(a, b, spellingOnly));
  const normal = due
    .filter((w) => !isNeverReviewed(w))
    .filter((w) => !dateLte(dueDateForMode(w, spellingOnly), severeCutoff))
    .filter((w) => !isUnstable(w, spellingOnly))
    .sort((a, b) => compareDueThenText(a, b, spellingOnly));

  takeUnique(selected, neverReviewed, quotas.neverReviewed, selectedIds);
  takeUnique(selected, severeOverdue, quotas.severeOverdue, selectedIds);
  takeUnique(selected, unstable, quotas.unstable, selectedIds);
  takeUnique(selected, normal, quotas.normal, selectedIds);

  if (selected.length < maxCount) {
    takeUnique(
      selected,
      [...neverReviewed, ...severeOverdue, ...unstable, ...normal],
      maxCount - selected.length,
      selectedIds,
    );
  }

  return selected;
}

// 「从未复习」= 读熟练度为 0 且从未评过分。注意刚被判「彻底陌生」的词
// repetitions 也会归零，但那些词 lastGrade 非空，会走不稳定桶的优先逻辑。
function isNeverReviewed(word: Word): boolean {
  return word.repetitions === 0 && word.lastGrade === null;
}

function reviewQuotas(maxCount: number): {
  neverReviewed: number;
  severeOverdue: number;
  unstable: number;
  normal: number;
} {
  const weighted = [
    { key: 'neverReviewed' as const, weight: 0.1, value: maxCount * 0.1 },
    // 逾期桶从 50% 让出 10% 给新词保底
    { key: 'severeOverdue' as const, weight: 0.4, value: maxCount * 0.4 },
    { key: 'unstable' as const, weight: 0.3, value: maxCount * 0.3 },
    { key: 'normal' as const, weight: 0.2, value: maxCount * 0.2 },
  ];
  const quotas = {
    neverReviewed: Math.floor(weighted[0].value),
    severeOverdue: Math.floor(weighted[1].value),
    unstable: Math.floor(weighted[2].value),
    normal: Math.floor(weighted[3].value),
  };
  let remaining =
    maxCount - quotas.neverReviewed - quotas.severeOverdue - quotas.unstable - quotas.normal;
  weighted
    .sort((a, b) => {
      const fractionDiff = (b.value - Math.floor(b.value)) - (a.value - Math.floor(a.value));
      if (fractionDiff !== 0) return fractionDiff;
      return b.weight - a.weight;
    })
    .forEach(({ key }) => {
      if (remaining <= 0) return;
      quotas[key] += 1;
      remaining -= 1;
    });
  return quotas;
}

function takeUnique(
  target: Word[],
  candidates: Word[],
  count: number,
  selectedIds: Set<string>,
): void {
  let taken = 0;
  for (const word of candidates) {
    if (taken >= count) return;
    if (selectedIds.has(word.id)) continue;
    target.push(word);
    selectedIds.add(word.id);
    taken += 1;
  }
}

function dueDateForMode(word: Word, spellingOnly: boolean): string {
  return spellingOnly ? word.spellingDueDate : word.dueDate;
}

function isUnstable(word: Word, spellingOnly: boolean): boolean {
  const lastGrade = spellingOnly ? word.spellingLastGrade : word.lastGrade;
  return lastGrade === 'forgotten' || lastGrade === 'fuzzy' || word.volatilityRate > 0;
}

function compareUnstable(a: Word, b: Word, spellingOnly: boolean): number {
  const aLastGrade = spellingOnly ? a.spellingLastGrade : a.lastGrade;
  const bLastGrade = spellingOnly ? b.spellingLastGrade : b.lastGrade;
  const aRecentlyWeak = aLastGrade === 'forgotten' || aLastGrade === 'fuzzy';
  const bRecentlyWeak = bLastGrade === 'forgotten' || bLastGrade === 'fuzzy';
  if (aRecentlyWeak !== bRecentlyWeak) return aRecentlyWeak ? -1 : 1;
  if (a.volatilityRate !== b.volatilityRate) return b.volatilityRate - a.volatilityRate;
  return compareDueThenText(a, b, spellingOnly);
}

// 模块3：提交复习反馈，更新 SM-2 状态并记日志
export async function submitReview(
  repo: Repo,
  word: Word,
  grade: Grade,
  spellingOnly: boolean = false,
  suppressRepetitionGain: boolean = false,
): Promise<Word> {
  const todayStr = today();
  const tomorrow = addDays(today(), 1);
  const reviewedAt = new Date().toISOString();
  const updated: Word = spellingOnly
    ? (() => {
        const rawSpellingState = mapSpellingState(applyReview(
          {
            interval: word.spellingInterval,
            ef: word.spellingEf,
            repetitions: word.spellingRepetitions,
          },
          grade,
        ));
        const spellingState = suppressRepetitionGain && grade !== 'forgotten'
          ? { ...rawSpellingState, spellingRepetitions: word.spellingRepetitions }
          : rawSpellingState;
        const consecutiveSpellingForgotten =
          word.lang === 'en' &&
          grade === 'forgotten' &&
          word.spellingLastGrade === 'forgotten' &&
          word.spellingPendingRetryCount <= 0;

        if (grade === 'forgotten' && !suppressRepetitionGain) {
          // 第一次彻底陌生：仍保留在今天，等待同日队尾再复习两遍
          return {
            ...word,
            ...spellingState,
            spellingInterval: 0,
            spellingDueDate: todayStr,
            spellingPendingRetryCount: 2,
          };
        }

        if (!consecutiveSpellingForgotten) {
          const remaining = suppressRepetitionGain ? Math.max(0, word.spellingPendingRetryCount - 1) : 0;
          return {
            ...word,
            ...spellingState,
            ...(suppressRepetitionGain ? {
              spellingInterval: remaining > 0 ? 0 : 1,
              spellingDueDate: remaining > 0 ? todayStr : tomorrow,
            } : {}),
            spellingPendingRetryCount: remaining,
          };
        }

        // 英文拼连续两次「彻底陌生」：退回英文读阶段，读熟练度回滚到 3，
        // 并重置拼写进度，之后需重新达到读熟悉阈值才会再次进入英文拼。
        return {
          ...word,
          ...spellingState,
          repetitions: READ_FAMILIAR_THRESHOLD - 1,
          interval: 1,
          dueDate: tomorrow,
          needsSpelling: false,
          ...initialSpellingReviewState(),
        };
      })()
    : (() => {
        const rawReadingState = applyReview(word, grade);
        const readingState = suppressRepetitionGain && grade !== 'forgotten'
          ? { ...rawReadingState, repetitions: word.repetitions }
          : rawReadingState;

        if (grade === 'forgotten' && !suppressRepetitionGain) {
          // 第一次彻底陌生：仍保留在今天，等待同日队尾再复习两遍
          return {
            ...word,
            ...readingState,
            interval: 0,
            dueDate: todayStr,
            needsSpelling: false,
            pendingRetryCount: 2,
          };
        }

        const remaining = suppressRepetitionGain ? Math.max(0, word.pendingRetryCount - 1) : 0;
        return {
          ...word,
          ...readingState,
          ...(suppressRepetitionGain ? {
            interval: remaining > 0 ? 0 : 1,
            dueDate: remaining > 0 ? todayStr : tomorrow,
          } : {}),
          pendingRetryCount: remaining,
          // 拼写/会写队列资格始终跟随读熟悉度：达到阈值加入，跌破阈值移出。
          needsSpelling: readingState.repetitions >= READ_FAMILIAR_THRESHOLD,
        };
      })();
  const nextLog = {
    id: crypto.randomUUID(),
    wordId: word.id,
    childId: word.childId,
    grade,
    reviewedAt,
  };
  const logs = await repo.getReviewLogs(word.childId, word.id);
  updated.volatilityRate = computeVolatilityRate(
    logs.concat(nextLog),
  );
  // 两次写互不依赖，并行执行，减少一次网络往返的等待
  await Promise.all([
    repo.upsertWord(updated),
    repo.addReviewLog(nextLog),
  ]);
  return updated;
}

// 拼写/会写复习页「删除」= 归档（软删除）：不删数据，只把这个词移出复习安排。
//  - needsSpelling 置 false：拼写选词会过滤掉它；
//  - 读 repetitions 回落到 2：跌破「已熟悉读」阈值，也顺带退出拼写资格；
//  - 读到期日推迟约一个月：这期间读、拼队列都不会再排到它。
// 暂缓期过后它会重新进入读复习；再次读到熟悉阈值时，needsSpelling 会按既有规则自动恢复为 true。
export const ARCHIVE_SHELVE_DAYS = 30; // 归档后的暂缓天数（约一个月）

export async function archiveWordFromSpelling(repo: Repo, word: Word): Promise<Word> {
  const updated: Word = {
    ...word,
    needsSpelling: false,
    repetitions: 2,
    dueDate: addDays(today(), ARCHIVE_SHELVE_DAYS),
  };
  await repo.upsertWord(updated);
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
