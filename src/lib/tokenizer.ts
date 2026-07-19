// 拆分引擎：把录入内容拆成规范化的学习条目列表。
//
// 录入页支持单词、词组或中文短内容。英文和中文统一按英文逗号/中文逗号拆分；
// 逗号之间的内容作为一个条目保存，内部空格、大小写和标点保持用户输入原样。

const ENTRY_SEPARATOR_RE = /[,，]/;

export function tokenizeEntries(text: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const rawEntry of text.split(ENTRY_SEPARATOR_RE)) {
    const entry = rawEntry.trim();
    if (!entry) continue;
    if (seen.has(entry)) continue;
    seen.add(entry);
    result.push(entry);
  }

  return result;
}

// 英文：按逗号拆分条目，允许单词、词组和短句作为一个复习单位。
export function tokenize(sentence: string): string[] {
  return tokenizeEntries(sentence);
}

// 中文：按逗号拆分条目，允许词语或短句作为一个复习单位。
export function tokenizeZh(sentence: string): string[] {
  return tokenizeEntries(sentence);
}

// 按语言选择拆分器。当前两种语言共享逗号拆分规则，保留 lang 参数以维持调用接口稳定。
export function tokenizeByLang(text: string, _lang: 'en' | 'zh'): string[] {
  return tokenizeEntries(text);
}
