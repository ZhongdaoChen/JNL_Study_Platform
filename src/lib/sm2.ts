import type { Grade, Word } from './types';
import { addDays, today } from './date';

// ============================================================
// 儿童版 SM-2 间隔重复算法
//
// 与成人原版 SM-2 的差异（专为 5 岁儿童调优）：
//  - 评分只有 3 档（熟练 / 略陌生 / 彻底陌生），而非 0-5 共 6 档
//  - 首次间隔更短（次日就再现），第二次 2-3 天，保持高频
//  - 间隔封顶（默认 21 天 ≈ 3 周），避免间隔过长导致遗忘
//  - "彻底陌生" 直接归零，明日重学
//  - 每日复习量上限由"清单生成"环节控制，不在本引擎内
// ============================================================

export const SM2_CONFIG = {
  INITIAL_EF: 2.5, // 初始熟练度因子
  MIN_EF: 1.3, // 因子下限，防止间隔塌缩为永远很短
  MAX_INTERVAL: 21, // 间隔上限（天），保持幼儿高频复习
  EF_DELTA_MASTERED: +0.1, // 熟练 → 因子上升
  EF_DELTA_FUZZY: -0.1, // 略陌生 → 因子小幅下降
  EF_DELTA_FORGOTTEN: -0.2, // 彻底陌生 → 因子较大下降
  FUZZY_GROWTH: 1.3, // 略陌生时的温和增长系数
};

function clampEf(ef: number): number {
  return Math.max(SM2_CONFIG.MIN_EF, ef);
}

function clampInterval(days: number): number {
  return Math.min(SM2_CONFIG.MAX_INTERVAL, Math.max(0, days));
}

// 新单词刚学会时的初始记忆状态：明日首次复习
export function initialReviewState(learnedOn: string = today()): Pick<
  Word,
  'interval' | 'ef' | 'repetitions' | 'dueDate' | 'lastGrade' | 'lastReviewedAt'
> {
  return {
    interval: 1,
    ef: SM2_CONFIG.INITIAL_EF,
    repetitions: 0,
    dueDate: addDays(learnedOn, 1), // 次日复习
    lastGrade: null,
    lastReviewedAt: null,
  };
}

// 复习后更新该词的 SM-2 状态。纯函数，返回需要更新的字段。
export function applyReview(
  word: Pick<Word, 'interval' | 'ef' | 'repetitions'>,
  grade: Grade,
  on: string = today(),
): Pick<Word, 'interval' | 'ef' | 'repetitions' | 'dueDate' | 'lastGrade' | 'lastReviewedAt'> {
  let { interval, ef, repetitions } = word;

  if (grade === 'forgotten') {
    // 彻底陌生：归零，明日重学
    repetitions = 0;
    ef = clampEf(ef + SM2_CONFIG.EF_DELTA_FORGOTTEN);
    interval = 1;
  } else {
    // 熟练 / 略陌生：都算"记得"，连续答对次数 +1
    repetitions += 1;
    const prevInterval = interval;

    if (grade === 'mastered') {
      ef = clampEf(ef + SM2_CONFIG.EF_DELTA_MASTERED);
      if (repetitions === 1) interval = 1; // 次日
      else if (repetitions === 2) interval = 3; // 2-3 天
      else interval = Math.round(prevInterval * ef);
    } else {
      // fuzzy 略陌生：温和增长，因子小幅下降
      ef = clampEf(ef + SM2_CONFIG.EF_DELTA_FUZZY);
      if (repetitions === 1) interval = 1;
      else if (repetitions === 2) interval = 2;
      else interval = Math.round(prevInterval * SM2_CONFIG.FUZZY_GROWTH);
    }

    interval = clampInterval(interval);
  }

  return {
    interval,
    ef,
    repetitions,
    dueDate: addDays(on, interval),
    lastGrade: grade,
    lastReviewedAt: new Date().toISOString(),
  };
}
