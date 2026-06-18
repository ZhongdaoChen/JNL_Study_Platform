// 拆词引擎：把一句话拆成规范化的单词列表
//
// 设计目标（面向 5 岁儿童的英文学习）：
// - 先小写化去重，再统一转成首字母大写显示/存储
// - 去除标点（句号、逗号、问号、引号等）
// - 处理常见缩写（don't / it's 等）保留为一个词
// - 过滤纯数字与空字符串
// - 去重（同一句里重复出现只算一次）

const PUNCTUATION = /[.,!?;:"“”‘’()\[\]{}…]/g;

// 合法单词：纯英文字母，允许词内连字符或撇号（如 don't、ice-cream）
// 借此排除 6/10（日期）、123、a1、cat/dog 等非单词 token
const WORD_RE = /^[a-z]+(?:[-'][a-z]+)*$/;

// 英文单词统一显示/存储为首字母大写
export function capitalizeWord(word: string): string {
  return word ? word[0].toUpperCase() + word.slice(1) : word;
}

// 规范化单个 token（先转成小写，便于大小写无关去重）
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
    const normalized = normalizeWord(raw);
    if (!normalized) continue;
    if (!WORD_RE.test(normalized)) continue; // 只保留真正的英文单词
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(capitalizeWord(normalized));
  }

  return result;
}

// 中文：把一句话拆成去重后的单个汉字（保持首次出现顺序）。
// 只保留汉字（CJK 统一表意文字），过滤标点、空格、数字、字母等。
const HAN_RE = /[\u4e00-\u9fff\u3400-\u4dbf]/;

export function tokenizeZh(sentence: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const ch of sentence) {
    if (!HAN_RE.test(ch)) continue; // 只保留汉字
    if (seen.has(ch)) continue;
    seen.add(ch);
    result.push(ch);
  }
  return result;
}

// 按语言选择拆分器
export function tokenizeByLang(text: string, lang: 'en' | 'zh'): string[] {
  return lang === 'zh' ? tokenizeZh(text) : tokenize(text);
}
