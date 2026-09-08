import { pronunciationPlaybackItems } from '../lib/pronunciationRules.ts';
import type { Word } from '../lib/types.ts';

export interface PronunciationPlaybackState {
  items: string[];
  playingIndex: number | null;
}

export function isFirstPronunciationAttempt(
  gradedWordIds: ReadonlySet<string>,
  wordId: string,
): boolean {
  return !gradedWordIds.has(wordId);
}

export function pronunciationOutcome(
  alreadyGraded: boolean,
  correct: boolean,
): {
  grade: 'mastered' | 'forgotten' | null;
  advanceAfterMs: number | null;
  message: string;
} {
  if (alreadyGraded) {
    return {
      grade: null,
      advanceAfterMs: null,
      message: correct ? '这次读对了' : '再试一次',
    };
  }
  return correct
    ? { grade: 'mastered', advanceAfterMs: 1200, message: '读对了' }
    : { grade: 'forgotten', advanceAfterMs: null, message: '再试一次' };
}

export function beginPronunciationOutcome(
  gradedWordIds: Set<string>,
  pendingSuccessWordIds: Set<string>,
  wordId: string,
  correct: boolean,
): ReturnType<typeof pronunciationOutcome> {
  const alreadyGraded = (
    !isFirstPronunciationAttempt(gradedWordIds, wordId)
    || pendingSuccessWordIds.has(wordId)
  );
  if (!alreadyGraded) {
    if (correct) pendingSuccessWordIds.add(wordId);
    else gradedWordIds.add(wordId);
  }
  return pronunciationOutcome(alreadyGraded, correct);
}

export function finalizePendingPronunciationSuccess(
  gradedWordIds: Set<string>,
  pendingSuccessWordIds: Set<string>,
  wordId: string,
): boolean {
  if (!pendingSuccessWordIds.delete(wordId)) return false;
  gradedWordIds.add(wordId);
  return true;
}

export function cancelPendingPronunciationSuccess(
  pendingSuccessWordIds: Set<string>,
  wordId: string,
): boolean {
  return pendingSuccessWordIds.delete(wordId);
}

export function mergePronunciationExamplesInQueue(
  words: readonly Word[],
  wordId: string,
  examples: string[],
): Word[] {
  return words.map((word) => (
    word.id === wordId ? { ...word, pronunciationExamples: examples } : word
  ));
}

export function startPronunciationPlayback(
  target: string,
  examples: string[],
): PronunciationPlaybackState {
  const items = pronunciationPlaybackItems(target, examples);
  return {
    items,
    playingIndex: items.length > 0 ? 0 : null,
  };
}

export function advancePronunciationPlayback(
  state: PronunciationPlaybackState,
): PronunciationPlaybackState {
  if (state.playingIndex === null) return state;
  const nextIndex = state.playingIndex + 1;
  return {
    ...state,
    playingIndex: nextIndex < state.items.length ? nextIndex : null,
  };
}
