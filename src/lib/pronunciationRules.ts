import type { Grade } from './types.ts';

const HAN_CHARACTER_RE = /^\p{Script=Han}$/u;
const CHINESE_IGNORED_RE = /[\s，。！？、,.!?；;：“”"'（）()[\]【】]/gu;

export function isSingleHanCharacter(text: string): boolean {
  return HAN_CHARACTER_RE.test(text.trim());
}

export function normalizeRecognizedChinese(text: string): string {
  return text.normalize('NFKC').replace(CHINESE_IGNORED_RE, '');
}

export function gradeForPronunciationAttempt(
  isFirstAttempt: boolean,
  correct: boolean,
): Grade | null {
  if (!isFirstAttempt) return null;
  return correct ? 'mastered' : 'forgotten';
}

export function sanitizePronunciationExamples(character: string, values: unknown): string[] {
  if (!isSingleHanCharacter(character) || !Array.isArray(values)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const word = value.trim();
    if (word.length < 2 || word.length > 4 || !word.includes(character) || seen.has(word)) continue;
    seen.add(word);
    result.push(word);
    if (result.length === 3) break;
  }
  return result;
}

export function pronunciationPlaybackItems(target: string, examples: string[]): string[] {
  return isSingleHanCharacter(target) ? [target, ...examples.slice(0, 3)] : [target];
}
