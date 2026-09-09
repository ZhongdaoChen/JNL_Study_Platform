import test from 'node:test';
import assert from 'node:assert/strict';
import {
  beginReviewAdvanceDeferral,
  beginReviewGradeNavigation,
  createReviewGradeCoordinator,
  isReviewAdvanceDeferred,
  resetReviewGradeCoordinatorForWord,
  reviewGradeAvailability,
  reviewGradeNavigationAllowed,
  shouldApplyAutomaticGradeCompletion,
  submitCoordinatedReviewGrade,
  waitForReviewGradeFeedback,
} from '../src/components/reviewGradeSession.ts';
import { reviewGradeFromShortcut } from '../src/components/reviewKeyboard.ts';
import { pronunciationMicrophoneDisabled } from '../src/components/pronunciationSession.ts';

function deferredPromise<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, resolve, reject };
}

test('pending automatic grade admits one submission and blocks immediate manual and keyboard grades', async () => {
  const coordinator = createReviewGradeCoordinator();
  const save = deferredPromise<string>();
  let submissionCount = 0;

  const automatic = submitCoordinatedReviewGrade(
    coordinator,
    {
      wordId: 'word-1',
      source: 'voice',
      advance: false,
    },
    () => {
      submissionCount += 1;
      return save.promise;
    },
  );

  const pending = reviewGradeAvailability(coordinator, 'word-1');
  assert.deepEqual(pending, {
    automaticPending: true,
    manualGradeDisabled: true,
    conflictingActionsDisabled: true,
  });
  assert.equal(
    reviewGradeFromShortcut({
      key: 'a',
      code: 'KeyA',
      target: null,
      repeat: false,
      hasCurrentWord: !pending.manualGradeDisabled,
    }),
    null,
  );

  const manual = await submitCoordinatedReviewGrade(
    coordinator,
    {
      wordId: 'word-1',
      source: 'manual',
      advance: true,
    },
    async () => {
      submissionCount += 1;
      return 'manual-save';
    },
  );

  assert.deepEqual(manual, { accepted: false });
  assert.equal(submissionCount, 1);

  save.resolve('voice-save');
  assert.deepEqual(await automatic, {
    accepted: true,
    value: 'voice-save',
  });
  assert.equal(submissionCount, 1);
  assert.deepEqual(reviewGradeAvailability(coordinator, 'word-1'), {
    automaticPending: false,
    manualGradeDisabled: true,
    conflictingActionsDisabled: false,
  });
});

test('incorrect voice lock clears on word change and permits a new manual grade', async () => {
  const coordinator = createReviewGradeCoordinator();

  await submitCoordinatedReviewGrade(
    coordinator,
    {
      wordId: 'word-1',
      source: 'voice',
      advance: false,
    },
    async () => 'saved',
  );

  assert.equal(
    reviewGradeAvailability(coordinator, 'word-1').manualGradeDisabled,
    true,
  );
  assert.equal(resetReviewGradeCoordinatorForWord(coordinator, 'word-2'), true);
  assert.equal(
    reviewGradeAvailability(coordinator, 'word-2').manualGradeDisabled,
    false,
  );

  let manualSubmissions = 0;
  const manual = await submitCoordinatedReviewGrade(
    coordinator,
    {
      wordId: 'word-2',
      source: 'manual',
      advance: true,
    },
    async () => {
      manualSubmissions += 1;
      return 'next-word-save';
    },
  );

  assert.equal(manual.accepted, true);
  assert.equal(manualSubmissions, 1);
});

test('correct automatic grade runs its advance callback once and only after save resolves', async () => {
  const coordinator = createReviewGradeCoordinator();
  const save = deferredPromise<string>();
  let saveResolved = false;
  let advanceCount = 0;

  const automatic = submitCoordinatedReviewGrade(
    coordinator,
    {
      wordId: 'word-1',
      source: 'voice',
      advance: true,
    },
    () => save.promise,
    () => {
      assert.equal(saveResolved, true);
      advanceCount += 1;
    },
  );

  const duplicate = await submitCoordinatedReviewGrade(
    coordinator,
    {
      wordId: 'word-1',
      source: 'manual',
      advance: true,
    },
    async () => 'duplicate',
    () => {
      advanceCount += 1;
    },
  );
  assert.deepEqual(duplicate, { accepted: false });
  assert.equal(advanceCount, 0);

  saveResolved = true;
  save.resolve('saved');
  await automatic;

  assert.equal(advanceCount, 1);
  assert.deepEqual(reviewGradeAvailability(coordinator, 'word-1'), {
    automaticPending: false,
    manualGradeDisabled: false,
    conflictingActionsDisabled: false,
  });
});

test('pending automatic grade allows forward navigation but keeps previous navigation blocked', async () => {
  const coordinator = createReviewGradeCoordinator();
  const save = deferredPromise<string>();

  const automatic = submitCoordinatedReviewGrade(
    coordinator,
    {
      wordId: 'word-1',
      source: 'voice',
      advance: true,
    },
    () => save.promise,
  );

  assert.equal(
    reviewGradeNavigationAllowed(coordinator, 'next'),
    true,
  );
  assert.equal(
    reviewGradeNavigationAllowed(coordinator, 'previous'),
    false,
  );
  assert.equal(
    beginReviewGradeNavigation(coordinator, 'word-1', 'previous'),
    false,
  );
  assert.equal(
    beginReviewGradeNavigation(coordinator, 'word-1', 'next'),
    true,
  );
  assert.equal(
    reviewGradeNavigationAllowed(coordinator, 'previous'),
    false,
  );
  assert.deepEqual(reviewGradeAvailability(coordinator, 'word-2'), {
    automaticPending: true,
    manualGradeDisabled: true,
    conflictingActionsDisabled: true,
  });
  const manualOnNextWord = await submitCoordinatedReviewGrade(
    coordinator,
    {
      wordId: 'word-2',
      source: 'manual',
      advance: true,
    },
    async () => 'unexpected-save',
  );
  assert.deepEqual(manualOnNextWord, { accepted: false });

  save.resolve('saved');
  await automatic;
});

test('new-word pronunciation stays disabled and its voice grade is rejected while the previous save is pending', async () => {
  const coordinator = createReviewGradeCoordinator();
  const save = deferredPromise<string>();

  const automatic = submitCoordinatedReviewGrade(
    coordinator,
    {
      wordId: 'word-1',
      source: 'voice',
      advance: true,
    },
    () => save.promise,
  );

  assert.equal(
    beginReviewGradeNavigation(coordinator, 'word-1', 'next'),
    true,
  );
  const availability = reviewGradeAvailability(coordinator, 'word-2');
  assert.equal(
    pronunciationMicrophoneDisabled(
      true,
      'idle',
      false,
      availability.automaticPending,
    ),
    true,
  );

  const rejected = await submitCoordinatedReviewGrade(
    coordinator,
    {
      wordId: 'word-2',
      source: 'voice',
      advance: false,
    },
    async () => 'unexpected-save',
  );
  assert.deepEqual(rejected, { accepted: false });

  save.resolve('saved');
  await automatic;
});

test('delayed incorrect completion after navigation does not install a stale manual-grade lock', async () => {
  const coordinator = createReviewGradeCoordinator();
  const save = deferredPromise<string>();

  resetReviewGradeCoordinatorForWord(coordinator, 'word-1');
  const automatic = submitCoordinatedReviewGrade(
    coordinator,
    {
      wordId: 'word-1',
      source: 'voice',
      advance: false,
    },
    () => save.promise,
  );

  assert.equal(
    beginReviewGradeNavigation(coordinator, 'word-1', 'next'),
    true,
  );
  resetReviewGradeCoordinatorForWord(coordinator, 'word-2');
  save.resolve('saved');
  await automatic;

  resetReviewGradeCoordinatorForWord(coordinator, 'word-1');
  assert.equal(
    reviewGradeAvailability(coordinator, 'word-1').manualGradeDisabled,
    false,
  );
});

test('same-word incorrect completion still locks manual grading after persistence', async () => {
  const coordinator = createReviewGradeCoordinator();
  const save = deferredPromise<string>();

  resetReviewGradeCoordinatorForWord(coordinator, 'word-1');
  const automatic = submitCoordinatedReviewGrade(
    coordinator,
    {
      wordId: 'word-1',
      source: 'voice',
      advance: false,
    },
    () => save.promise,
  );

  assert.equal(
    reviewGradeAvailability(coordinator, 'word-1').manualGradeDisabled,
    true,
  );
  save.resolve('saved');
  await automatic;

  assert.equal(
    reviewGradeAvailability(coordinator, 'word-1').manualGradeDisabled,
    true,
  );
});

test('forward navigation consumes pending automatic advance and prevents completion UI on the next word', async () => {
  const coordinator = createReviewGradeCoordinator();
  const save = deferredPromise<string>();
  let currentWordId = 'word-1';
  let automaticAdvanceCount = 0;
  let completionUiCount = 0;

  const automatic = submitCoordinatedReviewGrade(
    coordinator,
    {
      wordId: 'word-1',
      source: 'voice',
      advance: true,
    },
    () => save.promise,
    () => {
      if (shouldApplyAutomaticGradeCompletion(
        coordinator,
        'word-1',
        currentWordId,
      )) {
        completionUiCount += 1;
        automaticAdvanceCount += 1;
      }
    },
  );

  assert.equal(
    beginReviewGradeNavigation(coordinator, 'word-1', 'next'),
    true,
  );
  assert.equal(
    shouldApplyAutomaticGradeCompletion(
      coordinator,
      'word-1',
      currentWordId,
    ),
    false,
  );
  currentWordId = 'word-2';
  save.resolve('saved');
  await automatic;

  assert.equal(automaticAdvanceCount, 0);
  assert.equal(completionUiCount, 0);
});

test('correct feedback delay starts after persistence and keeps its full duration', async () => {
  const coordinator = createReviewGradeCoordinator();
  const save = deferredPromise<string>();
  const feedbackDelay = deferredPromise<void>();
  const events: string[] = [];

  const automatic = submitCoordinatedReviewGrade(
    coordinator,
    {
      wordId: 'word-1',
      source: 'voice',
      advance: true,
    },
    async () => {
      const value = await save.promise;
      events.push('persisted');
      return value;
    },
    async () => {
      await waitForReviewGradeFeedback(1200, async (delayMs) => {
        events.push(`delay:${delayMs}`);
        await feedbackDelay.promise;
      });
      events.push('advanced');
    },
  );

  assert.deepEqual(events, []);
  save.resolve('saved');
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(events, ['persisted', 'delay:1200']);

  feedbackDelay.resolve();
  await automatic;
  assert.deepEqual(events, ['persisted', 'delay:1200', 'advanced']);
});

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
}

test('feedback wait without deferral keeps the original single delay', async () => {
  const delays: number[] = [];
  await waitForReviewGradeFeedback(2000, async (delayMs) => {
    delays.push(delayMs);
  });
  assert.deepEqual(delays, [2000]);
  assert.equal(isReviewAdvanceDeferred(), false);
});

test('an active deferral holds the advance and adds one grace window after release', async () => {
  const delays: number[] = [];
  const release = beginReviewAdvanceDeferral();
  let resolved = false;
  const waiting = waitForReviewGradeFeedback(1200, async (delayMs) => {
    delays.push(delayMs);
  }).then(() => {
    resolved = true;
  });

  await flushMicrotasks();
  assert.deepEqual(delays, [1200]);
  assert.equal(resolved, false);
  assert.equal(isReviewAdvanceDeferred(), true);

  release();
  await waiting;
  assert.deepEqual(delays, [1200, 1200]);
  assert.equal(resolved, true);
  assert.equal(isReviewAdvanceDeferred(), false);
});

test('a deferral started during the grace window defers the advance again', async () => {
  const delays: number[] = [];
  let waitCount = 0;
  let secondRelease: (() => void) | null = null;
  const firstRelease = beginReviewAdvanceDeferral();
  let resolved = false;
  const waiting = waitForReviewGradeFeedback(1200, async (delayMs) => {
    delays.push(delayMs);
    waitCount += 1;
    if (waitCount === 2) {
      // 第一轮播放刚结束，孩子又立刻点开了「听正确读音」。
      secondRelease = beginReviewAdvanceDeferral();
    }
  }).then(() => {
    resolved = true;
  });

  await flushMicrotasks();
  firstRelease();
  await flushMicrotasks();
  assert.equal(resolved, false);
  assert.deepEqual(delays, [1200, 1200]);

  assert.ok(secondRelease !== null);
  secondRelease();
  await waiting;
  assert.deepEqual(delays, [1200, 1200, 1200]);
  assert.equal(isReviewAdvanceDeferred(), false);
});
