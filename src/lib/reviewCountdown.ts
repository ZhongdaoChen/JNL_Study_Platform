// 复习倒计时按条目调整的规则：
// 配置里的秒数针对单个词 / 双词组合；三个单词及以上的词组读起来更久，
// 倒计时按倍数放宽（如配置 10 秒，词组给 20 秒）。

export const PHRASE_MIN_WORDS = 3; // 达到该词数视为「词组」
export const PHRASE_COUNTDOWN_MULTIPLIER = 2; // 词组倒计时倍数

// 条目包含的单词数：按空白拆分。中文单字条目计为 1。
export function entryWordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

// 某个条目实际使用的倒计时秒数。0 = 关闭倒计时，保持不变。
export function countdownSecForWord(baseSec: number, text: string): number {
  if (baseSec <= 0) return 0;
  return entryWordCount(text) >= PHRASE_MIN_WORDS
    ? baseSec * PHRASE_COUNTDOWN_MULTIPLIER
    : baseSec;
}

// 新词仅在倒计时启用且本次模块会话尚未手动启动时保持暂停。
export function shouldPauseNewReviewCountdown(
  countdownEnabled: boolean,
  hasManuallyStarted: boolean,
): boolean {
  return countdownEnabled && !hasManuallyStarted;
}
