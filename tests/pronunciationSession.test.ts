import test from 'node:test';
import assert from 'node:assert/strict';
import {
  advancePronunciationPlayback,
  commitPronunciationOutcome,
  isFirstPronunciationAttempt,
  pronunciationOutcome,
  startPronunciationPlayback,
} from '../src/components/pronunciationSession.ts';

test('an unseen word has a first pronunciation attempt', () => {
  const gradedWordIds = new Set<string>(['known']);

  assert.equal(isFirstPronunciationAttempt(gradedWordIds, 'new'), true);
  assert.equal(isFirstPronunciationAttempt(gradedWordIds, 'known'), false);
});

test('committing a pronunciation outcome locks the word id', () => {
  const gradedWordIds = new Set<string>();

  const outcome = commitPronunciationOutcome(gradedWordIds, 'word-1', true);

  assert.equal(gradedWordIds.has('word-1'), true);
  assert.deepEqual(outcome, {
    grade: 'mastered',
    advanceAfterMs: 1200,
    message: '读对了',
  });
});

test('the first correct result is mastered and advances after the success animation', () => {
  assert.deepEqual(pronunciationOutcome(false, true), {
    grade: 'mastered',
    advanceAfterMs: 1200,
    message: '读对了',
  });
});

test('the first incorrect result is forgotten and stays on the word', () => {
  assert.deepEqual(pronunciationOutcome(false, false), {
    grade: 'forgotten',
    advanceAfterMs: null,
    message: '再试一次',
  });
});

test('retry results update feedback without returning another grade', () => {
  assert.deepEqual(pronunciationOutcome(true, true), {
    grade: null,
    advanceAfterMs: null,
    message: '这次读对了',
  });
  assert.deepEqual(pronunciationOutcome(true, false), {
    grade: null,
    advanceAfterMs: null,
    message: '再试一次',
  });
});

test('playback advances through the target and three examples then stops', () => {
  let state = startPronunciationPlayback('中', ['中国', '中午', '中心']);

  assert.deepEqual(state, {
    items: ['中', '中国', '中午', '中心'],
    playingIndex: 0,
  });

  state = advancePronunciationPlayback(state);
  assert.equal(state.playingIndex, 1);
  state = advancePronunciationPlayback(state);
  assert.equal(state.playingIndex, 2);
  state = advancePronunciationPlayback(state);
  assert.equal(state.playingIndex, 3);
  state = advancePronunciationPlayback(state);
  assert.equal(state.playingIndex, null);
  assert.deepEqual(advancePronunciationPlayback(state), state);
});
