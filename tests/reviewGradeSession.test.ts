import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createReviewGradeCoordinator,
  resetReviewGradeCoordinatorForWord,
  reviewGradeAvailability,
  submitCoordinatedReviewGrade,
} from '../src/components/reviewGradeSession.ts';
import { reviewGradeFromShortcut } from '../src/components/reviewKeyboard.ts';

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
