import test from 'node:test';
import assert from 'node:assert/strict';
import {
  releaseReviewActionFocus,
  reviewGradeFromShortcut,
  shouldToggleCountdownPause,
} from '../src/components/reviewKeyboard.ts';

function target(interactive: boolean) {
  return {
    closest: () => (interactive ? {} : null),
  } as EventTarget;
}

test('space toggles countdown pause when review countdown is active', () => {
  assert.equal(
    shouldToggleCountdownPause({
      key: ' ',
      code: 'Space',
      target: target(false),
      countdownEnabled: true,
      hasCurrentWord: true,
    }),
    true,
  );
});

test('space does not toggle countdown pause from interactive elements', () => {
  assert.equal(
    shouldToggleCountdownPause({
      key: ' ',
      code: 'Space',
      target: target(true),
      countdownEnabled: true,
      hasCurrentWord: true,
    }),
    false,
  );
});

test('space does not toggle countdown pause when countdown is disabled', () => {
  assert.equal(
    shouldToggleCountdownPause({
      key: ' ',
      code: 'Space',
      target: target(false),
      countdownEnabled: false,
      hasCurrentWord: true,
    }),
    false,
  );
});

test('asdf keys map to review grades from left to right', () => {
  assert.equal(
    reviewGradeFromShortcut({
      key: 'a',
      code: 'KeyA',
      target: target(false),
      repeat: false,
      hasCurrentWord: true,
    }),
    'instant',
  );
  assert.equal(
    reviewGradeFromShortcut({
      key: 'S',
      code: 'KeyS',
      target: target(false),
      repeat: false,
      hasCurrentWord: true,
    }),
    'mastered',
  );
  assert.equal(
    reviewGradeFromShortcut({
      key: 'd',
      code: 'KeyD',
      target: target(false),
      repeat: false,
      hasCurrentWord: true,
    }),
    'fuzzy',
  );
  assert.equal(
    reviewGradeFromShortcut({
      key: 'F',
      code: 'KeyF',
      target: target(false),
      repeat: false,
      hasCurrentWord: true,
    }),
    'forgotten',
  );
});

test('asdf shortcuts do not grade from interactive elements', () => {
  assert.equal(
    reviewGradeFromShortcut({
      key: 'a',
      code: 'KeyA',
      target: target(true),
      repeat: false,
      hasCurrentWord: true,
    }),
    null,
  );
});

test('asdf shortcuts do not grade when no current word is visible', () => {
  assert.equal(
    reviewGradeFromShortcut({
      key: 'a',
      code: 'KeyA',
      target: target(false),
      repeat: false,
      hasCurrentWord: false,
    }),
    null,
  );
});

test('asdf shortcuts ignore repeated keydown events', () => {
  assert.equal(
    reviewGradeFromShortcut({
      key: 'a',
      code: 'KeyA',
      target: target(false),
      repeat: true,
      hasCurrentWord: true,
    }),
    null,
  );
});

test('non-asdf keys do not map to review grades', () => {
  assert.equal(
    reviewGradeFromShortcut({
      key: ' ',
      code: 'Space',
      target: target(false),
      repeat: false,
      hasCurrentWord: true,
    }),
    null,
  );
});

test('review action buttons release focus after click', () => {
  let blurCount = 0;
  const button = {
    blur: () => {
      blurCount += 1;
    },
  } as HTMLElement;

  releaseReviewActionFocus(button);

  assert.equal(blurCount, 1);
});
