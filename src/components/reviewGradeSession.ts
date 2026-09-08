export type ReviewGradeSource = 'manual' | 'voice';

export interface ReviewGradeCoordinator {
  pendingWordIds: Set<string>;
  automaticPendingWordId: string | null;
  forwardNavigatedWordIds: Set<string>;
  voiceLockedWordId: string | null;
  currentWordId: string | null;
}

export interface ReviewGradeAvailability {
  automaticPending: boolean;
  manualGradeDisabled: boolean;
  conflictingActionsDisabled: boolean;
}

export type ReviewGradeSubmissionResult<T> =
  | { accepted: true; value: T }
  | { accepted: false };

export type ReviewGradeNavigationDirection = 'previous' | 'next';

export function createReviewGradeCoordinator(): ReviewGradeCoordinator {
  return {
    pendingWordIds: new Set<string>(),
    automaticPendingWordId: null,
    forwardNavigatedWordIds: new Set<string>(),
    voiceLockedWordId: null,
    currentWordId: null,
  };
}

export function reviewGradeAvailability(
  coordinator: ReviewGradeCoordinator,
  wordId: string,
): ReviewGradeAvailability {
  const automaticPending = coordinator.automaticPendingWordId !== null;
  return {
    automaticPending,
    manualGradeDisabled: (
      automaticPending
      || coordinator.pendingWordIds.has(wordId)
      || coordinator.voiceLockedWordId === wordId
    ),
    conflictingActionsDisabled: automaticPending,
  };
}

export function reviewGradeNavigationAllowed(
  coordinator: ReviewGradeCoordinator,
  direction: ReviewGradeNavigationDirection,
): boolean {
  return (
    direction === 'next'
    || coordinator.automaticPendingWordId === null
  );
}

export function beginReviewGradeNavigation(
  coordinator: ReviewGradeCoordinator,
  wordId: string,
  direction: ReviewGradeNavigationDirection,
): boolean {
  if (!reviewGradeNavigationAllowed(coordinator, direction)) {
    return false;
  }
  if (
    direction === 'next'
    && coordinator.automaticPendingWordId === wordId
  ) {
    coordinator.forwardNavigatedWordIds.add(wordId);
  }
  return true;
}

export function shouldApplyAutomaticGradeCompletion(
  coordinator: ReviewGradeCoordinator,
  wordId: string,
  currentWordId: string | null,
): boolean {
  return (
    currentWordId === wordId
    && !coordinator.forwardNavigatedWordIds.has(wordId)
  );
}

export async function waitForReviewGradeFeedback(
  delayMs: number,
  wait: (delayMs: number) => Promise<void> = (ms) => (
    new Promise<void>((resolve) => {
      setTimeout(resolve, ms);
    })
  ),
): Promise<void> {
  if (delayMs > 0) await wait(delayMs);
}

export function resetReviewGradeCoordinatorForWord(
  coordinator: ReviewGradeCoordinator,
  wordId: string | null,
): boolean {
  coordinator.currentWordId = wordId;
  if (
    coordinator.voiceLockedWordId === null
    || coordinator.voiceLockedWordId === wordId
  ) {
    return false;
  }
  coordinator.voiceLockedWordId = null;
  return true;
}

export function beginReviewGradeSubmission(
  coordinator: ReviewGradeCoordinator,
  wordId: string,
  source: ReviewGradeSource,
): boolean {
  if (
    coordinator.pendingWordIds.has(wordId)
    || coordinator.automaticPendingWordId !== null
    || coordinator.voiceLockedWordId === wordId
  ) {
    return false;
  }

  coordinator.currentWordId ??= wordId;
  coordinator.pendingWordIds.add(wordId);
  if (source === 'voice') {
    coordinator.automaticPendingWordId = wordId;
  }
  return true;
}

export function finishReviewGradeSubmission(
  coordinator: ReviewGradeCoordinator,
  {
    wordId,
    source,
    advance,
    committed,
  }: {
    wordId: string;
    source: ReviewGradeSource;
    advance: boolean;
    committed: boolean;
  },
): void {
  if (
    committed
    && source === 'voice'
    && !advance
    && coordinator.currentWordId === wordId
    && !coordinator.forwardNavigatedWordIds.has(wordId)
  ) {
    coordinator.voiceLockedWordId = wordId;
  }
  coordinator.pendingWordIds.delete(wordId);
  if (coordinator.automaticPendingWordId === wordId) {
    coordinator.automaticPendingWordId = null;
  }
  coordinator.forwardNavigatedWordIds.delete(wordId);
}

export async function submitCoordinatedReviewGrade<T>(
  coordinator: ReviewGradeCoordinator,
  {
    wordId,
    source,
    advance,
  }: {
    wordId: string;
    source: ReviewGradeSource;
    advance: boolean;
  },
  persist: () => Promise<T>,
  onCommitted?: (value: T) => void | Promise<void>,
  onStateChange: () => void = () => {},
  onAccepted?: () => void,
): Promise<ReviewGradeSubmissionResult<T>> {
  if (!beginReviewGradeSubmission(coordinator, wordId, source)) {
    return { accepted: false };
  }

  onStateChange();
  let committed = false;
  try {
    onAccepted?.();
    const value = await persist();
    committed = true;
    await onCommitted?.(value);
    return { accepted: true, value };
  } finally {
    finishReviewGradeSubmission(coordinator, {
      wordId,
      source,
      advance,
      committed,
    });
    onStateChange();
  }
}
