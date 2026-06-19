import type { ReviewLog, Word } from './types';
import { addDays, today, toDateStr } from './date';
import { READ_FAMILIAR_THRESHOLD } from './sm2';

// 把任意时间戳（ISO 或 YYYY-MM-DD）归一化成日期字符串
function dayOf(ts: string): string {
  return ts.slice(0, 10);
}

export interface Stats {
  totalWords: number;
  masteredWords: number; // 已熟悉读（repetitions >= 阈值）
  learningWords: number; // 学习中
  dueTodayEn: number; // 今日待复习英文
  dueTodayZh: number; // 今日待复习中文
  dueTomorrow: number; // 预测明日待复习
  reviewsTotal: number; // 累计复习次数
  streak: number; // 连续学习天数（截至今天/昨天）
  trend: { date: string; count: number }[]; // 近 7 天每日复习次数
  gradeBreakdown: { instant: number; mastered: number; fuzzy: number; forgotten: number }; // 各档累计次数
}

export function computeStats(words: Word[], logs: ReviewLog[]): Stats {
  const t = today();
  const tomorrow = addDays(t, 1);

  const masteredWords = words.filter((w) => w.repetitions >= READ_FAMILIAR_THRESHOLD).length;
  const dueTodayEn = words.filter((w) => w.lang === 'en' && w.dueDate <= t).length;
  const dueTodayZh = words.filter((w) => w.lang === 'zh' && w.dueDate <= t).length;
  const dueTomorrow = words.filter((w) => w.dueDate <= tomorrow).length;

  // 各档累计次数
  const gradeBreakdown = { instant: 0, mastered: 0, fuzzy: 0, forgotten: 0 };
  for (const l of logs) gradeBreakdown[l.grade] += 1;

  // 活跃日集合：录入新词的日期 + 复习日期
  const activeDays = new Set<string>();
  for (const w of words) activeDays.add(dayOf(w.firstLearnedAt));
  for (const l of logs) activeDays.add(dayOf(l.reviewedAt));

  // 连续学习天数：从今天往前数，遇到第一个无活动的日期停止。
  // 允许今天还没学（从昨天起算），避免清晨显示中断。
  let streak = 0;
  const start = activeDays.has(t) ? t : addDaysLocal(t, -1);
  let cursor = start;
  if (activeDays.has(cursor)) {
    while (activeDays.has(cursor)) {
      streak += 1;
      cursor = addDaysLocal(cursor, -1);
    }
  }

  // 近 7 天复习趋势
  const trend: { date: string; count: number }[] = [];
  const counts = new Map<string, number>();
  for (const l of logs) {
    const d = dayOf(l.reviewedAt);
    counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  for (let i = 6; i >= 0; i--) {
    const d = addDaysLocal(t, -i);
    trend.push({ date: d, count: counts.get(d) ?? 0 });
  }

  return {
    totalWords: words.length,
    masteredWords,
    learningWords: words.length - masteredWords,
    dueTodayEn,
    dueTodayZh,
    dueTomorrow,
    reviewsTotal: logs.length,
    streak,
    trend,
    gradeBreakdown,
  };
}

// 轻量日期加减（不依赖外部，避免循环依赖）
function addDaysLocal(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return toDateStr(d);
}
