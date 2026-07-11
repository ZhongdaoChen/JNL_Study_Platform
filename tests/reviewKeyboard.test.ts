import test from 'node:test';
import assert from 'node:assert/strict';
import {
  releaseReviewActionFocus,
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
