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

// 发音自动进位倒计时期间孩子可以点「听正确读音」：注册一个“进位让行”，
// 倒计时到点后发现有人在播放/准备音频就推迟切词，播放结束后再等一个
// 反馈窗口才进位，避免标准读音刚点开就被切词中止（不播放直接跳下一个）。
let activeAdvanceDeferrals = 0;
let advanceDeferralWaiters: Array<() => void> = [];
// 安全上限：即使让行方意外没有释放，进位最多推迟 60 秒，不会永久卡住。
const MAX_ADVANCE_DEFERRAL_WAIT_MS = 60_000;

export function isReviewAdvanceDeferred(): boolean {
  return activeAdvanceDeferrals > 0;
}

export function beginReviewAdvanceDeferral(): () => void {
  activeAdvanceDeferrals += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    activeAdvanceDeferrals -= 1;
    if (activeAdvanceDeferrals > 0) return;
    const waiters = advanceDeferralWaiters;
    advanceDeferralWaiters = [];
    for (const resolve of waiters) resolve();
  };
}

export function waitForReviewAdvanceDeferralRelease(): Promise<void> {
  if (activeAdvanceDeferrals === 0) return Promise.resolve();
  return new Promise<void>((resolve) => {
    advanceDeferralWaiters.push(resolve);
  });
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
  const startedAt = Date.now();
  while (
    isReviewAdvanceDeferred()
    && Date.now() - startedAt < MAX_ADVANCE_DEFERRAL_WAIT_MS
  ) {
    await waitForReviewAdvanceDeferralRelease();
    // 播放结束后再等一个原反馈窗口才进位，给孩子留出反应时间；
    // 期间若又点开新的播放，循环会继续等待。
    if (delayMs > 0) await wait(delayMs);
  }
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
