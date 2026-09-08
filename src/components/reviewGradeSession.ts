export type ReviewGradeSource = 'manual' | 'voice';

export interface ReviewGradeCoordinator {
  pendingWordIds: Set<string>;
  automaticPendingWordId: string | null;
  voiceLockedWordId: string | null;
}

export interface ReviewGradeAvailability {
  automaticPending: boolean;
  manualGradeDisabled: boolean;
  conflictingActionsDisabled: boolean;
}

export type ReviewGradeSubmissionResult<T> =
  | { accepted: true; value: T }
  | { accepted: false };

export function createReviewGradeCoordinator(): ReviewGradeCoordinator {
  return {
    pendingWordIds: new Set<string>(),
    automaticPendingWordId: null,
    voiceLockedWordId: null,
  };
}

export function reviewGradeAvailability(
  coordinator: ReviewGradeCoordinator,
  wordId: string,
): ReviewGradeAvailability {
  const automaticPending = coordinator.automaticPendingWordId === wordId;
  return {
    automaticPending,
    manualGradeDisabled: (
      coordinator.pendingWordIds.has(wordId)
      || coordinator.voiceLockedWordId === wordId
    ),
    conflictingActionsDisabled: automaticPending,
  };
}

export function resetReviewGradeCoordinatorForWord(
  coordinator: ReviewGradeCoordinator,
  wordId: string | null,
): boolean {
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
    || coordinator.voiceLockedWordId === wordId
  ) {
    return false;
  }

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
  if (committed && source === 'voice' && !advance) {
    coordinator.voiceLockedWordId = wordId;
  }
  coordinator.pendingWordIds.delete(wordId);
  if (coordinator.automaticPendingWordId === wordId) {
    coordinator.automaticPendingWordId = null;
  }
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
