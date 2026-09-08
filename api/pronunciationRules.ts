const HAN_CHARACTER_RE = /^\p{Script=Han}$/u;
const HAN_EXAMPLE_RE = /^\p{Script=Han}{2,4}$/u;
const CHINESE_IGNORED_RE = /[\s，。！？、,.!?；;：“”"'（）()[\]【】]/gu;

export function isSingleHanCharacter(text: string): boolean {
  return HAN_CHARACTER_RE.test(text.trim());
}

export function normalizeRecognizedChinese(text: string): string {
  return text.normalize('NFKC').replace(CHINESE_IGNORED_RE, '');
}

export function sanitizePronunciationExamples(character: string, values: unknown): string[] {
  if (!isSingleHanCharacter(character) || !Array.isArray(values)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const word = value.trim();
    if (!HAN_EXAMPLE_RE.test(word) || !word.includes(character) || seen.has(word)) continue;
    seen.add(word);
    result.push(word);
    if (result.length === 3) break;
  }
  return result;
}
