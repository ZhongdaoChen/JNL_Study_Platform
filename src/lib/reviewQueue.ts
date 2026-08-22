import type { Word } from './types';

// 复习会话队列的「当天补做」排队规则。
//
// 「彻底陌生」会让一个词在今天的队列里再出现几遍（补做次数 =
// pendingRetryCount / spellingPendingRetryCount，由 submitReview 写入）。
// 为避免补做全部堆在队尾、同一个词连着出现好几遍：
//  - 第一次被判「彻底陌生」时，补做副本插到该词往后约 RETRY_GAP_WORDS 个词处；
//  - 之后每次补做再评分时，仍按原有逻辑把剩余补做追加到整个队列末尾。
export const RETRY_GAP_WORDS = 10;

export interface ApplyReviewToQueueOptions {
  spellingOnly: boolean;
  // 本次评分时该词是否已处于补做状态（评分前 pendingRetryCount > 0 且今天到期）
  isRetryAttempt: boolean;
  // 被评分的词在队列中的位置；找不到时传 -1，副本将放到队尾兜底
  gradedIndex: number;
}

export function applyReviewToQueue(
  queue: Word[],
  updated: Word,
  opts: ApplyReviewToQueueOptions,
): Word[] {
  // 先同步队列里该词的所有副本（原位置 + 已排好的补做副本）为最新状态
  const next = queue.map((w) => (w.id === updated.id ? updated : w));
  const pendingRetryCount = opts.spellingOnly
    ? updated.spellingPendingRetryCount
    : updated.pendingRetryCount;
  if (pendingRetryCount <= 0) return next;
  if (opts.isRetryAttempt) return [...next, updated];
  const base = opts.gradedIndex >= 0 ? opts.gradedIndex : next.length - 1;
  const insertAt = Math.min(base + 1 + RETRY_GAP_WORDS, next.length);
  next.splice(insertAt, 0, updated);
  return next;
}
