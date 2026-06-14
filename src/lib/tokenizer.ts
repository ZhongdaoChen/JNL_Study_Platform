// 拆词引擎：把一句话拆成规范化的单词列表
//
// 设计目标（面向 5 岁儿童的英文学习）：
// - 小写化，去掉句首大写差异
// - 去除标点（句号、逗号、问号、引号等）
// - 处理常见缩写（don't / it's 等）保留为一个词
// - 过滤纯数字与空字符串
// - 去重（同一句里重复出现只算一次）

const PUNCTUATION = /[.,!?;:"“”‘’()\[\]{}…]/g;

// 合法单词：纯英文字母，允许词内连字符或撇号（如 don't、ice-cream）
// 借此排除 6/10（日期）、123、a1、cat/dog 等非单词 token
const WORD_RE = /^[a-z]+(?:[-'][a-z]+)*$/;

// 规范化单个 token
export function normalizeWord(raw: string): string {
  return raw
    .toLowerCase()
    .replace(PUNCTUATION, '')
    // 去掉首尾的连字符/撇号残留，但保留词内的 don't、ice-cream
    .replace(/^[-']+|[-']+$/g, '')
    .trim();
}

// 把一句话拆成去重后的规范化单词数组（保持首次出现顺序）
export function tokenize(sentence: string): string[] {
  const rawTokens = sentence.split(/\s+/);
  const seen = new Set<string>();
  const result: string[] = [];

  for (const raw of rawTokens) {
    const word = normalizeWord(raw);
    if (!word) continue;
    if (!WORD_RE.test(word)) continue; // 只保留真正的英文单词
    if (seen.has(word)) continue;
    seen.add(word);
    result.push(word);
  }

  return result;
}
